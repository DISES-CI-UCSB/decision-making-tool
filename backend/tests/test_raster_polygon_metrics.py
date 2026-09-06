from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin
from rasterio.warp import transform_geom

from app import artifacts as artifacts_module
from app import main as main_module
from app.artifacts import (
    ArtifactState,
    RuntimeArtifact,
    RuntimeRasterLayer,
    RuntimeSpeciesMatrix,
    load_runtime_artifact,
)
from app.config import Settings
from app.main import app
from app.polygon_metrics import calculate_custom_polygon_metrics
from app.species_index import SpeciesIndexLoadError, load_runtime_species_index
from sparse.format import SparseMetadata, SpeciesMatrixEntry, encode_species_matrix


FIXTURE_GRID_CRS = "EPSG:3857"


def wgs84_box(min_x: float, min_y: float, max_x: float, max_y: float) -> dict:
    """Express a fixture-grid box as the WGS84 GeoJSON the API actually receives."""
    ring = [
        [min_x, min_y],
        [max_x, min_y],
        [max_x, max_y],
        [min_x, max_y],
        [min_x, min_y],
    ]
    projected = transform_geom(
        FIXTURE_GRID_CRS,
        "EPSG:4326",
        {"type": "Polygon", "coordinates": [ring]},
    )
    # transform_geom returns tuples; the API only ever sees JSON arrays.
    return {
        "type": "Polygon",
        "coordinates": [
            [[float(x), float(y)] for x, y in projected["coordinates"][0]]
        ],
    }


POLYGON_LEFT_COLUMN = wgs84_box(0.0, 0.0, 1000.0, 2000.0)
POLYGON_RIGHT_COLUMN = wgs84_box(1000.0, 0.0, 2000.0, 2000.0)
POLYGON_OUTSIDE_GRID = wgs84_box(3000.0, 0.0, 4000.0, 1000.0)


def write_tif(path: Path, data: np.ndarray, *, nodata: float | int | None = None) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[1],
        height=data.shape[0],
        count=1,
        dtype=data.dtype,
        crs=FIXTURE_GRID_CRS,
        transform=from_origin(0.0, 2000.0, 1000.0, 1000.0),
        nodata=nodata,
    ) as dataset:
        dataset.write(data, 1)
    return path


def raster_artifact(tmp_path: Path, *, coastal: bool = False) -> RuntimeArtifact:
    reference = write_tif(
        tmp_path / "reference.tif",
        np.array([[1, 1], [1, 0 if coastal else 1]], dtype=np.uint8),
        nodata=0,
    )
    recharge = write_tif(
        tmp_path / "recharge.tif",
        np.array([[1, 0], [1, 0]], dtype=np.uint8),
        nodata=255,
    )
    biomass = write_tif(
        tmp_path / "biomass.tif",
        np.array([[10, 20], [30, 40]], dtype=np.float32),
        nodata=-9999,
    )
    return RuntimeArtifact(
        manifest={"artifact_version": "test-raster"},
        reference_raster_path=reference,
        raster_layers={
            "recarga_agua": RuntimeRasterLayer(
                layer_id="recarga_agua",
                path=recharge,
                kind="binary",
                rendering={"valueType": "binary", "selectedValue": 1},
                metric_ids=("water_regulation_area", "water_regulation_pct"),
            ),
            "biomasa": RuntimeRasterLayer(
                layer_id="biomasa",
                path=biomass,
                kind="continuous",
                rendering={"valueType": "continuous"},
                metric_ids=("carbon_storage_biomass", "carbon_pct_of_national"),
            ),
        },
    )


def write_species_matrix(
    path: Path,
    entries: list[tuple[str, str, str, list[int]]]
    | list[tuple[str, str, str, list[int], float | None]],
) -> Path:
    """Write a fixture bundle. Entries may append an exact range area in km²."""
    metadata = SparseMetadata(
        width=2,
        height=2,
        x_origin=0.0,
        y_origin=2000.0,
        x_scale=1000.0,
        y_scale=-1000.0,
        nodata=255,
        crs="EPSG:3857",
        count=0,
    )
    matrix_entries = [
        SpeciesMatrixEntry(
            name=entry[0],
            iucn=entry[1],
            csv_class=entry[2],
            cell_ids=np.asarray(entry[3], dtype=np.uint32),
            metadata=SparseMetadata(
                width=metadata.width,
                height=metadata.height,
                x_origin=metadata.x_origin,
                y_origin=metadata.y_origin,
                x_scale=metadata.x_scale,
                y_scale=metadata.y_scale,
                nodata=metadata.nodata,
                crs=metadata.crs,
                count=len(entry[3]),
            ),
            area_km2=entry[4] if len(entry) > 4 else None,
        )
        for entry in entries
    ]
    path.write_bytes(encode_species_matrix(matrix_entries))
    return path


def raster_artifact_with_species(tmp_path: Path) -> RuntimeArtifact:
    return _raster_artifact_with_species(tmp_path, warm_index=True)


def streaming_raster_artifact_with_species(tmp_path: Path) -> RuntimeArtifact:
    return _raster_artifact_with_species(tmp_path, warm_index=False)


def _raster_artifact_with_species(tmp_path: Path, *, warm_index: bool) -> RuntimeArtifact:
    artifact = raster_artifact(tmp_path)
    species_matrices = {
        "mammals": RuntimeSpeciesMatrix(
            group="mammals",
            path=write_species_matrix(
                tmp_path / "species_mammals.smtx.gz",
                [
                    ("Present mammal", "LC", "Mammalia", [0, 1]),
                    ("Absent mammal", "LC", "Mammalia", [3]),
                ],
            ),
            metric_ids=("species_richness_mammals",),
        ),
        "birds": RuntimeSpeciesMatrix(
            group="birds",
            path=write_species_matrix(
                tmp_path / "species_birds.smtx.gz",
                [("Present bird", "LC", "Aves", [2])],
            ),
            metric_ids=("species_richness_birds",),
        ),
        "amphibians": RuntimeSpeciesMatrix(
            group="amphibians",
            path=write_species_matrix(
                tmp_path / "species_amphibians.smtx.gz",
                [("Absent amphibian", "LC", "Amphibia", [1])],
            ),
            metric_ids=("species_richness_amphibians",),
        ),
        "reptiles": RuntimeSpeciesMatrix(
            group="reptiles",
            path=write_species_matrix(
                tmp_path / "species_reptiles.smtx.gz",
                [("Present reptile", "LC", "Squamata", [0])],
            ),
            metric_ids=("species_richness_reptiles",),
        ),
        "plants": RuntimeSpeciesMatrix(
            group="plants",
            path=write_species_matrix(
                tmp_path / "species_plants.smtx.gz",
                [("Absent plant", "LC", "Magnoliopsida", [1, 3])],
            ),
            metric_ids=("species_richness_plants",),
        ),
        "threatened": RuntimeSpeciesMatrix(
            group="threatened",
            path=write_species_matrix(
                tmp_path / "species_threatened.smtx.gz",
                [
                    ("Threatened present", "VU", "Mammalia", [2]),
                    ("Threatened absent", "EN", "Aves", [1]),
                ],
            ),
            metric_ids=("threatened_species_count",),
        ),
    }
    return RuntimeArtifact(
        manifest=artifact.manifest,
        reference_raster_path=artifact.reference_raster_path,
        raster_layers=artifact.raster_layers,
        species_matrices=species_matrices,
        species_pool_sizes={
            "total_non_fish": 6,
            "threatened_total": 2,
            "by_bucket": {
                "mammals": 2,
                "birds": 1,
                "amphibians": 1,
                "reptiles": 1,
                "plants": 1,
            },
        },
        species_index=load_runtime_species_index(species_matrices) if warm_index else None,
    )


def test_raster_custom_polygon_returns_real_area_and_overlap_metrics(tmp_path: Path) -> None:
    metrics, metadata = calculate_custom_polygon_metrics(
        raster_artifact(tmp_path),
        POLYGON_LEFT_COLUMN,
        ["area", "water_regulation_area", "water_regulation_pct"],
    )

    assert metrics["priority_area_in_region"] == pytest.approx(2.0)
    assert metrics["national_contribution"] == pytest.approx(50.0)
    assert metrics["water_regulation_area"] == pytest.approx(2.0)
    assert metrics["water_regulation_pct"] == pytest.approx(100.0)
    assert metadata["matched_cell_count"] == 2
    assert metadata["processed_cell_count"] == 4
    assert metadata["metric_source"] == "colombia-raster-geometry-mask-v1"


@pytest.mark.parametrize(
    ("case", "coastal", "geometry", "expected_national_contribution"),
    [
        ("inland", False, POLYGON_LEFT_COLUMN, 50.0),
        ("coastal", True, POLYGON_RIGHT_COLUMN, 100.0 / 3.0),
    ],
)
def test_custom_polygon_api_reports_aoi_as_full_region(
    case: str,
    coastal: bool,
    geometry: dict,
    expected_national_contribution: float,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact_dir = tmp_path / case
    artifact_dir.mkdir()
    artifact = raster_artifact(artifact_dir, coastal=coastal)
    state = ArtifactState(
        required=True,
        available=True,
        manifest_path="test-manifest.json",
        artifact_version="test-raster",
        message="ready",
    )
    monkeypatch.setattr(main_module, "get_artifact_state", lambda settings: state)
    monkeypatch.setattr(main_module, "get_runtime_artifact", lambda settings: artifact)

    response = TestClient(app).post(
        "/metrics/custom-polygon",
        json={
            "geometry": geometry,
            "metrics": [
                "priority_area_pct_of_region",
                "national_contribution",
            ],
        },
    )

    assert response.status_code == 200
    metrics = response.json()["metrics"]
    assert metrics["priority_area_pct_of_region"] == pytest.approx(100.0)
    assert metrics["national_contribution"] == pytest.approx(
        expected_national_contribution
    )
    assert metrics["national_contribution"] < metrics["priority_area_pct_of_region"]


def test_custom_aoi_percent_is_unavailable_without_valid_in_domain_cells(
    tmp_path: Path,
) -> None:
    metrics, metadata = calculate_custom_polygon_metrics(
        raster_artifact(tmp_path),
        POLYGON_OUTSIDE_GRID,
        ["priority_area_pct_of_region", "national_contribution"],
    )

    assert metrics == {
        "priority_area_pct_of_region": None,
        "national_contribution": 0.0,
    }
    assert metadata["metric_coverage"]["unavailable"] == [
        {
            "metric_id": "priority_area_pct_of_region",
            "reason": "aoi_has_no_valid_cells",
        }
    ]


def test_raster_custom_polygon_uses_weighted_carbon_calculators(tmp_path: Path) -> None:
    metrics, metadata = calculate_custom_polygon_metrics(
        raster_artifact(tmp_path),
        POLYGON_LEFT_COLUMN,
        ["carbon_storage_biomass", "carbon_biomass_total", "carbon_pct_of_national"],
    )

    assert metrics["carbon_storage_biomass"] == pytest.approx(40.0)
    assert metrics["carbon_biomass_total"] == pytest.approx(40.0)
    assert metrics["carbon_pct_of_national"] == pytest.approx(40.0)
    assert metadata["metric_coverage"]["layer_ids_used"] == ["biomasa"]


def test_raster_custom_polygon_uses_species_matrix_bundles(tmp_path: Path) -> None:
    metrics, metadata = calculate_custom_polygon_metrics(
        raster_artifact_with_species(tmp_path),
        POLYGON_LEFT_COLUMN,
        [
            "species_richness_mammals",
            "species_richness_birds",
            "species_richness_amphibians",
            "species_richness_reptiles",
            "species_richness_plants",
            "threatened_species_count",
            "species_pct_of_national",
        ],
    )

    assert metrics["species_richness_mammals"] == 1
    assert metrics["species_richness_birds"] == 1
    assert metrics["species_richness_amphibians"] == 0
    assert metrics["species_richness_reptiles"] == 1
    assert metrics["species_richness_plants"] == 0
    assert metrics["threatened_species_count"] == 1
    assert metrics["species_pct_of_national"] == pytest.approx(50.0)
    assert metadata["metric_coverage"]["species_matrix_groups_used"] == [
        "amphibians",
        "birds",
        "mammals",
        "plants",
        "reptiles",
        "threatened",
    ]


def test_warmed_species_index_matches_streaming_species_values(tmp_path: Path) -> None:
    requested_metrics = [
        "species_richness_mammals",
        "species_richness_birds",
        "species_richness_amphibians",
        "species_richness_reptiles",
        "species_richness_plants",
        "threatened_species_count",
        "species_pct_of_national",
    ]
    streaming_metrics, _ = calculate_custom_polygon_metrics(
        streaming_raster_artifact_with_species(tmp_path),
        POLYGON_LEFT_COLUMN,
        requested_metrics,
    )
    warmed_metrics, _ = calculate_custom_polygon_metrics(
        raster_artifact_with_species(tmp_path),
        POLYGON_LEFT_COLUMN,
        requested_metrics,
    )

    assert warmed_metrics == streaming_metrics


def test_warmed_species_index_does_not_reopen_gzip_bundles(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact = raster_artifact_with_species(tmp_path)

    def fail_gzip_open(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("species metric request should use the warmed index")

    monkeypatch.setattr("app.metric_adapters.gzip.open", fail_gzip_open)

    metrics, _ = calculate_custom_polygon_metrics(
        artifact,
        POLYGON_LEFT_COLUMN,
        ["species_richness_mammals", "species_pct_of_national"],
    )

    assert metrics["species_richness_mammals"] == 1
    assert metrics["species_pct_of_national"] == pytest.approx(50.0)


def test_warmed_species_index_close_removes_owned_cache_dir(tmp_path: Path) -> None:
    artifact = raster_artifact_with_species(tmp_path)
    assert artifact.species_index is not None
    cache_dir = artifact.species_index.cache_dir

    assert cache_dir.exists()

    artifact.species_index.close()

    assert not cache_dir.exists()
    artifact.species_index.close()


def test_warmed_species_index_load_failure_cleans_partial_cache(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_dir = tmp_path / "species-cache"

    def fake_mkdtemp(*, prefix: str) -> str:
        assert prefix == "dmt-species-index-"
        cache_dir.mkdir()
        return str(cache_dir)

    valid_matrix = write_species_matrix(
        tmp_path / "species_mammals.smtx.gz",
        [("Present mammal", "LC", "Mammalia", [0, 1])],
    )
    invalid_matrix = tmp_path / "species_birds.smtx.gz"
    invalid_matrix.write_bytes(b"not a species matrix")
    monkeypatch.setattr("app.species_index.tempfile.mkdtemp", fake_mkdtemp)

    with pytest.raises(SpeciesIndexLoadError):
        load_runtime_species_index(
            {
                "mammals": RuntimeSpeciesMatrix(group="mammals", path=valid_matrix),
                "birds": RuntimeSpeciesMatrix(group="birds", path=invalid_matrix),
            }
        )

    assert not cache_dir.exists()


def test_runtime_artifact_cache_reset_removes_species_index_cache(tmp_path: Path) -> None:
    artifact = raster_artifact_with_species(tmp_path)
    assert artifact.species_index is not None
    cache_dir = artifact.species_index.cache_dir

    artifacts_module._RUNTIME_ARTIFACT = artifact
    artifacts_module._RUNTIME_STATE = None
    artifacts_module._RUNTIME_SETTINGS_KEY = None

    artifacts_module.reset_runtime_artifact_cache()

    assert not cache_dir.exists()


def test_raster_artifact_warmup_reports_species_index_metadata(tmp_path: Path) -> None:
    reference = write_tif(
        tmp_path / "reference.tif",
        np.array([[1, 1], [1, 1]], dtype=np.uint8),
        nodata=0,
    )
    recharge = write_tif(
        tmp_path / "recharge.tif",
        np.array([[1, 0], [1, 0]], dtype=np.uint8),
        nodata=255,
    )
    species_mammals = write_species_matrix(
        tmp_path / "species_mammals.smtx.gz",
        [
            ("Present mammal", "LC", "Mammalia", [0, 1]),
            ("Absent mammal", "LC", "Mammalia", [3]),
        ],
    )
    manifest = {
        "artifact_version": "test-raster-species-index",
        "artifact_kind": "colombia-raster-custom-aoi/v1",
        "schema_version": "metrics-artifact-manifest/v1",
        "created_at": "2026-06-08T00:00:00Z",
        "checksum": {"algorithm": "sha256", "value": "test"},
        "source_manifest": {"purpose": "unit test"},
        "reference_raster_path": reference.name,
        "reference_raster_checksum": {"algorithm": "sha256", "value": sha256_file(reference)},
        "raster_layers": [
            {
                "layer_id": "recarga_agua",
                "path": recharge.name,
                "kind": "binary",
                "rendering": {"valueType": "binary", "selectedValue": 1},
                "metric_ids": ["water_regulation_area"],
                "checksum": {"algorithm": "sha256", "value": sha256_file(recharge)},
            }
        ],
        "species_matrices": [
            {
                "group": "mammals",
                "path": species_mammals.name,
                "metric_ids": ["species_richness_mammals"],
                "checksum": {"algorithm": "sha256", "value": sha256_file(species_mammals)},
            }
        ],
        "species_pool_sizes": {"total_non_fish": 2},
        "metric_coverage": {"implemented_now": ["species_richness_mammals"]},
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    artifact, state = load_runtime_artifact(
        Settings(
            artifact_dir=tmp_path,
            artifact_manifest_path=manifest_path,
            sirap_artifact_root=tmp_path / "sirap",
            artifact_required=True,
            artifact_schema_version="metrics-artifact-manifest/v1",
        )
    )

    species_index_metadata = state.metadata["species_index"]
    assert artifact.species_index is not None
    assert species_index_metadata["status"] == "ready"
    assert species_index_metadata["group_count"] == 1
    assert species_index_metadata["species_count"] == 2
    assert species_index_metadata["groups"]["mammals"]["species_count"] == 2
    assert species_index_metadata["memory_bytes"] > 0


def test_raster_custom_polygon_reports_secured_species_as_unavailable(tmp_path: Path) -> None:
    metrics, metadata = calculate_custom_polygon_metrics(
        raster_artifact_with_species(tmp_path),
        POLYGON_LEFT_COLUMN,
        ["threatened_species_secured"],
    )

    assert metrics == {"threatened_species_secured": None}
    assert metadata["metric_coverage"]["unavailable"] == [
        {
            "metric_id": "threatened_species_secured",
            "reason": "requires_species_target_percent",
        }
    ]


def test_raster_custom_polygon_reports_species_groups_as_target_dependent(
    tmp_path: Path,
) -> None:
    metrics, metadata = calculate_custom_polygon_metrics(
        raster_artifact_with_species(tmp_path),
        POLYGON_LEFT_COLUMN,
        ["species_groups_protected"],
    )

    assert metrics == {"species_groups_protected": None}
    assert metadata["metric_coverage"]["unavailable"] == [
        {
            "metric_id": "species_groups_protected",
            "reason": "requires_species_target_percent",
        }
    ]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
