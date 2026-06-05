from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app.artifacts import RuntimeArtifact, RuntimeRasterLayer, RuntimeSpeciesMatrix
from app.polygon_metrics import calculate_custom_polygon_metrics
from sparse.format import SparseMetadata, SpeciesMatrixEntry, encode_species_matrix


POLYGON_LEFT_COLUMN = {
    "type": "Polygon",
    "coordinates": [
        [
            [0.0, 0.0],
            [1000.0, 0.0],
            [1000.0, 2000.0],
            [0.0, 2000.0],
            [0.0, 0.0],
        ]
    ],
}


def write_tif(path: Path, data: np.ndarray, *, nodata: float | int | None = None) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[1],
        height=data.shape[0],
        count=1,
        dtype=data.dtype,
        crs="EPSG:3857",
        transform=from_origin(0.0, 2000.0, 1000.0, 1000.0),
        nodata=nodata,
    ) as dataset:
        dataset.write(data, 1)
    return path


def raster_artifact(tmp_path: Path) -> RuntimeArtifact:
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
    entries: list[tuple[str, str, str, list[int]]],
) -> Path:
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
            name=name,
            iucn=iucn,
            csv_class=csv_class,
            cell_ids=np.asarray(cell_ids, dtype=np.uint32),
            metadata=SparseMetadata(
                width=metadata.width,
                height=metadata.height,
                x_origin=metadata.x_origin,
                y_origin=metadata.y_origin,
                x_scale=metadata.x_scale,
                y_scale=metadata.y_scale,
                nodata=metadata.nodata,
                crs=metadata.crs,
                count=len(cell_ids),
            ),
        )
        for name, iucn, csv_class, cell_ids in entries
    ]
    path.write_bytes(encode_species_matrix(matrix_entries))
    return path


def raster_artifact_with_species(tmp_path: Path) -> RuntimeArtifact:
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
