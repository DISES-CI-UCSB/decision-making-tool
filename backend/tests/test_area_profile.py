from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from pydantic import ValidationError
from rasterio.transform import from_origin

from app.area_profile import calculate_custom_area_profile
from app.artifacts import (
    ArtifactState,
    ArtifactValidationError,
    _validate_ecosystem_grid_alignment,
)
from app.ecosystem_inventory import RuntimeEcosystemInventory, load_ecosystem_inventory
from app.main import app
from app import main as main_module
from app.models import CustomAreaProfileRequest
from app.species_index import (
    load_runtime_species_bitset_index,
    normalize_species_name,
    sort_species_records,
    species_dataset_id,
    stream_species_overlap_records,
)
from raster_metrics import read_solution_raster
from mec_compact import build_composite_taxonomy, load_composite_crosswalk
from sparse.species_bitset import build_species_bitset
from tests.test_raster_polygon_metrics import (
    POLYGON_LEFT_COLUMN,
    raster_artifact,
    raster_artifact_with_species,
    streaming_raster_artifact_with_species,
)


def test_area_profile_request_requires_non_empty_known_sections() -> None:
    with pytest.raises(ValidationError):
        CustomAreaProfileRequest(geometry=POLYGON_LEFT_COLUMN, sections=[])
    with pytest.raises(ValidationError):
        CustomAreaProfileRequest(
            geometry=POLYGON_LEFT_COLUMN,
            sections=["marine"],  # type: ignore[list-item]
        )

    request = CustomAreaProfileRequest(
        geometry=POLYGON_LEFT_COLUMN,
        sections=["species", "species", "ecosystems"],
    )
    assert request.sections == ["species", "ecosystems"]


def test_species_id_normalizes_nfkc_case_and_whitespace() -> None:
    composed = "  Águila   HARPYJA "
    decomposed = "a\u0301guila harpyja"

    assert normalize_species_name(composed) == "águila harpyja"
    assert species_dataset_id(composed) == species_dataset_id(decomposed)
    assert species_dataset_id(composed).startswith("species:v1:")
    assert len(species_dataset_id(composed)) == len("species:v1:") + 64


def test_warmed_species_metadata_and_overlap_records_match_streaming(tmp_path: Path) -> None:
    warmed = raster_artifact_with_species(tmp_path)
    streaming = streaming_raster_artifact_with_species(tmp_path)
    assert warmed.species_index is not None

    from app.metric_adapters import build_custom_aoi_raster

    raster = build_custom_aoi_raster(warmed.reference_raster_path, POLYGON_LEFT_COLUMN)
    warmed_records = warmed.species_index.overlap_records("mammals", raster)
    streaming_records = stream_species_overlap_records(
        streaming.species_matrices["mammals"],
        raster,
    )

    assert warmed_records == streaming_records
    assert [record.scientific_name for record in warmed_records] == ["Present mammal"]
    assert warmed_records[0].iucn_status == "LC"
    assert warmed_records[0].group == "mammals"
    assert warmed.species_index.groups["mammals"].species_metadata[0].csv_class == "Mammalia"


def test_cell_major_species_inventory_matches_species_major_index(tmp_path: Path) -> None:
    species_major = raster_artifact_with_species(tmp_path)
    assert species_major.species_index is not None
    matrix_paths = {
        group: matrix.path
        for group, matrix in species_major.species_matrices.items()
        if group != "threatened"
    }
    data_path = tmp_path / "species.cells.bits"
    metadata_path = tmp_path / "species.cells.json"
    build_species_bitset(matrix_paths, data_path, metadata_path)
    cell_major = load_runtime_species_bitset_index(data_path, metadata_path)

    from app.metric_adapters import build_custom_aoi_raster

    raster = build_custom_aoi_raster(
        species_major.reference_raster_path,
        POLYGON_LEFT_COLUMN,
    )
    expected = [
        record
        for group in ("amphibians", "birds", "mammals", "plants", "reptiles")
        for record in species_major.species_index.overlap_records(group, raster)
    ]
    assert cell_major.all_overlap_records(raster) == sort_species_records(expected)
    assert cell_major.count_overlaps("threatened", raster) == 0


def test_cell_major_species_coverage_uses_aoi_and_solution_categories(
    tmp_path: Path,
) -> None:
    artifact = raster_artifact_with_species(tmp_path)
    matrix_paths = {
        group: matrix.path
        for group, matrix in artifact.species_matrices.items()
        if group != "threatened"
    }
    data_path = tmp_path / "species.cells.bits"
    metadata_path = tmp_path / "species.cells.json"
    build_species_bitset(matrix_paths, data_path, metadata_path)
    cell_major = load_runtime_species_bitset_index(data_path, metadata_path)

    from app.metric_adapters import build_custom_aoi_raster

    aoi = build_custom_aoi_raster(
        artifact.reference_raster_path,
        POLYGON_LEFT_COLUMN,
    )
    solution_path = tmp_path / "solution.tif"
    with rasterio.open(
        solution_path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="uint8",
        crs="EPSG:3857",
        transform=from_origin(0.0, 2000.0, 1000.0, 1000.0),
        nodata=255,
    ) as dataset:
        dataset.write(np.array([[2, 1], [0, 0]], dtype=np.uint8), 1)

    records = {
        record.scientific_name: record
        for record in cell_major.detailed_coverage_records(
            aoi,
            read_solution_raster(solution_path),
        )
    }

    mammal = records["Present mammal"]
    assert mammal.range_area_km2 == pytest.approx(2.0)
    assert mammal.range_in_aoi_area_km2 == pytest.approx(1.0)
    assert mammal.range_in_aoi_pct == pytest.approx(50.0)
    assert mammal.solution_covered_in_aoi_pct == pytest.approx(100.0)
    assert mammal.pre_existing_covered_in_aoi_pct == pytest.approx(100.0)
    assert mammal.new_covered_in_aoi_pct == pytest.approx(0.0)

    bird = records["Present bird"]
    assert bird.range_in_aoi_pct == pytest.approx(100.0)
    assert bird.solution_covered_in_aoi_pct == pytest.approx(0.0)


def test_species_profile_uses_five_bundles_and_never_threatened_union(tmp_path: Path) -> None:
    sections, selection, status = calculate_custom_area_profile(
        raster_artifact_with_species(tmp_path),
        POLYGON_LEFT_COLUMN,
        ["species"],
    )

    species = sections["species"]
    assert status == "complete"
    assert selection["status"] == "selected"
    assert selection["selected_cell_count"] == 2
    assert selection["area_km2"] == pytest.approx(2.0)
    assert species["status"] == "complete"
    assert species["record_count"] == 3
    assert [record["scientific_name"] for record in species["records"]] == [
        "Present bird",
        "Present mammal",
        "Present reptile",
    ]
    assert all(record["group"] != "threatened" for record in species["records"])
    assert species["id_scope"] == "runtime-species-dataset"


def test_profile_reports_zero_cells_instead_of_empty_biodiversity(tmp_path: Path) -> None:
    outside = {
        "type": "Polygon",
        "coordinates": [
            [
                [3000.0, 3000.0],
                [4000.0, 3000.0],
                [4000.0, 4000.0],
                [3000.0, 4000.0],
                [3000.0, 3000.0],
            ]
        ],
    }
    sections, selection, status = calculate_custom_area_profile(
        raster_artifact_with_species(tmp_path),
        outside,
        ["species", "ecosystems"],
    )

    assert status == "zero_cells"
    assert selection["status"] == "zero_cells"
    assert selection["selected_cell_count"] == 0
    assert selection["area_km2"] == 0.0
    assert sections["species"]["status"] == "zero_cells"
    assert sections["ecosystems"]["status"] == "zero_cells"


def test_missing_ecosystem_artifact_is_typed_unavailable(tmp_path: Path) -> None:
    sections, _, status = calculate_custom_area_profile(
        raster_artifact(tmp_path),
        POLYGON_LEFT_COLUMN,
        ["ecosystems"],
    )

    assert status == "partial"
    assert sections["ecosystems"] == {
        "status": "unavailable",
        "canonical_summary_view": "broadEcosystem",
        "classified_area_km2": 0.0,
        "views": [],
        "reason": "ecosystem_artifact_not_packaged",
    }


def test_ecosystem_loader_validates_composite_provenance(tmp_path: Path) -> None:
    raster_path = tmp_path / "mec.tif"
    raster_path.write_bytes(b"mec raster fixture")
    crosswalk_path = tmp_path / "crosswalk.csv"
    crosswalk_path.write_text(
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "1,Bosque,Orobioma,Contexto bosque,Orobioma Región,Bosque,Bosque húmedo\n",
        encoding="utf-8",
    )
    raster_sha256 = hashlib.sha256(raster_path.read_bytes()).hexdigest()
    crosswalk_sha256 = hashlib.sha256(crosswalk_path.read_bytes()).hexdigest()
    provenance_path = tmp_path / "provenance.json"
    provenance_path.write_text(
        json.dumps(
            {
                "format": "mec-2024-provenance-v1",
                "generatedAt": "2026-07-29T00:00:00Z",
                "source": {"publisher": "IDEAM"},
                "catalog": {
                    "rowCount": 1,
                    "crosswalkSha256": crosswalk_sha256,
                    "crosswalkSignature": "fixture",
                    "tupleFields": [
                        "tipo_ecos",
                        "gran_bioma",
                        "bioma_iavh",
                        "ecos_sintesis",
                        "ecos_general",
                    ],
                },
                "outputs": {
                    "compositeRaster": {"sha256": raster_sha256},
                    "crosswalk": {"sha256": crosswalk_sha256},
                },
                "rasterization": {"dtype": "uint16", "nodata": 0},
                "grid": {"fingerprintSha256": "fixture"},
            }
        ),
        encoding="utf-8",
    )

    inventory = load_ecosystem_inventory(
        raster_path,
        crosswalk_path,
        provenance_path,
        raster_sha256=raster_sha256,
        crosswalk_sha256=crosswalk_sha256,
    )

    assert [view.view_id for view in inventory.taxonomy.views] == [
        "biomeFamily",
        "broadBiomeContext",
        "biomeRegion",
        "broadEcosystem",
        "detailedEcosystem",
    ]


def test_ecosystem_profile_maps_all_five_views_and_present_classes(tmp_path: Path) -> None:
    crosswalk = (
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "1,Bosque,Orobioma,Contexto bosque,Orobioma Región,Bosque,Bosque húmedo\n"
        "2,Sabana,Orobioma,Contexto sabana,Orobioma Región,Sabana,Sabana seca\n"
    )
    taxonomy = build_composite_taxonomy(load_composite_crosswalk(crosswalk))
    mec_path = tmp_path / "mec.tif"
    with rasterio.open(
        mec_path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="uint16",
        crs="EPSG:3857",
        transform=from_origin(0.0, 2000.0, 1000.0, 1000.0),
        nodata=0,
    ) as dataset:
        dataset.write(np.array([[1, 2], [1, 0]], dtype=np.uint16), 1)

    base = raster_artifact(tmp_path)
    inventory = RuntimeEcosystemInventory(
        raster_path=mec_path,
        crosswalk_path=tmp_path / "crosswalk.csv",
        provenance_path=tmp_path / "provenance.json",
        taxonomy=taxonomy,
        provenance={},
    )
    artifact = replace(base, ecosystem_inventory=inventory)
    sections, _, status = calculate_custom_area_profile(
        artifact,
        POLYGON_LEFT_COLUMN,
        ["ecosystems"],
    )

    ecosystem = sections["ecosystems"]
    assert status == "complete"
    assert ecosystem["status"] == "complete"
    assert ecosystem["canonical_summary_view"] == "broadEcosystem"
    assert ecosystem["classified_area_km2"] == pytest.approx(2.0)
    assert [view["id"] for view in ecosystem["views"]] == [
        "biomeFamily",
        "broadBiomeContext",
        "biomeRegion",
        "broadEcosystem",
        "detailedEcosystem",
    ]
    assert all(len(view["records"]) == 1 for view in ecosystem["views"])
    assert all(
        view["records"][0]["share_of_classified_pct"] == pytest.approx(100.0)
        for view in ecosystem["views"]
    )
    assert all(
        set(view["records"][0]) == {
            "id",
            "label",
            "area_km2",
                "national_area_km2",
            "share_of_classified_pct",
                "share_of_national_class_pct",
                "solution_covered_area_km2",
                "solution_covered_pct_of_aoi",
                "pre_existing_covered_area_km2",
                "pre_existing_covered_pct_of_aoi",
                "new_covered_area_km2",
                "new_covered_pct_of_aoi",
        }
        for view in ecosystem["views"]
    )


def test_ecosystem_profile_calculates_real_solution_category_coverage(
    tmp_path: Path,
) -> None:
    taxonomy = build_composite_taxonomy(
        load_composite_crosswalk(
            "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
            "biomeRegion,broadEcosystem,detailedEcosystem\n"
            "1,Bosque,Orobioma,Contexto bosque,Orobioma Región,Bosque,Bosque húmedo\n"
        )
    )
    mec_path = tmp_path / "mec.tif"
    with rasterio.open(
        mec_path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="uint16",
        crs="EPSG:3857",
        transform=from_origin(0.0, 2000.0, 1000.0, 1000.0),
        nodata=0,
    ) as dataset:
        dataset.write(np.ones((2, 2), dtype=np.uint16), 1)

    solution_path = tmp_path / "solution.tif"
    with rasterio.open(
        solution_path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="uint8",
        crs="EPSG:3857",
        transform=from_origin(0.0, 2000.0, 1000.0, 1000.0),
        nodata=255,
    ) as dataset:
        dataset.write(np.array([[2, 0], [1, 0]], dtype=np.uint8), 1)

    base = raster_artifact(tmp_path)
    artifact = replace(
        base,
        ecosystem_inventory=RuntimeEcosystemInventory(
            raster_path=mec_path,
            crosswalk_path=tmp_path / "crosswalk.csv",
            provenance_path=tmp_path / "provenance.json",
            taxonomy=taxonomy,
            provenance={},
        ),
    )
    sections, _, _ = calculate_custom_area_profile(
        artifact,
        POLYGON_LEFT_COLUMN,
        ["ecosystems"],
        read_solution_raster(solution_path),
    )
    record = next(
        view["records"][0]
        for view in sections["ecosystems"]["views"]
        if view["id"] == "broadEcosystem"
    )

    assert record["share_of_national_class_pct"] == pytest.approx(50.0)
    assert record["solution_covered_pct_of_aoi"] == pytest.approx(100.0)
    assert record["pre_existing_covered_pct_of_aoi"] == pytest.approx(50.0)
    assert record["new_covered_pct_of_aoi"] == pytest.approx(50.0)


def test_ecosystem_inventory_grid_must_align_with_reference(tmp_path: Path) -> None:
    base = raster_artifact(tmp_path)
    assert base.reference_raster_path is not None
    taxonomy = build_composite_taxonomy(
        load_composite_crosswalk(
            "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
            "biomeRegion,broadEcosystem,detailedEcosystem\n"
            "1,Bosque,Orobioma,Contexto,Orobioma Región,Bosque,Bosque húmedo\n"
        )
    )
    mismatched_path = tmp_path / "mismatched-mec.tif"
    with rasterio.open(
        mismatched_path,
        "w",
        driver="GTiff",
        width=1,
        height=1,
        count=1,
        dtype="uint16",
        crs="EPSG:3857",
        transform=from_origin(0.0, 1000.0, 1000.0, 1000.0),
        nodata=0,
    ) as dataset:
        dataset.write(np.array([[1]], dtype=np.uint16), 1)
    inventory = RuntimeEcosystemInventory(
        raster_path=mismatched_path,
        crosswalk_path=tmp_path / "crosswalk.csv",
        provenance_path=tmp_path / "provenance.json",
        taxonomy=taxonomy,
        provenance={},
    )

    with pytest.raises(ArtifactValidationError, match="does not align"):
        _validate_ecosystem_grid_alignment(base.reference_raster_path, inventory)


def test_area_profile_endpoint_returns_additive_v1_contract(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact = raster_artifact_with_species(tmp_path)
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
        "/area-profile/custom-polygon",
        json={
            "geometry": POLYGON_LEFT_COLUMN,
            "sections": ["species", "ecosystems"],
            "artifact_version": "test-raster",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["format"] == "custom-aoi-area-profile-v1"
    assert body["status"] == "partial"
    assert body["artifact_version"] == "test-raster"
    assert body["selection"]["status"] == "selected"
    assert body["selection"]["area_km2"] == pytest.approx(2.0)
    assert body["requested_sections"] == ["species", "ecosystems"]
    assert body["sections"]["species"]["status"] == "complete"
    assert body["sections"]["ecosystems"]["status"] == "unavailable"


def test_area_profile_endpoint_treats_geometry_failure_as_http_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact = raster_artifact(tmp_path)
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
        "/area-profile/custom-polygon",
        json={
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [1, 0], [1, 1]]],
            },
            "sections": ["species"],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["status"] == "invalid_request"
