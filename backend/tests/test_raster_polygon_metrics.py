from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app.artifacts import RuntimeArtifact, RuntimeRasterLayer
from app.polygon_metrics import calculate_custom_polygon_metrics


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


def test_raster_custom_polygon_reports_known_unimplemented_metrics_as_unavailable(tmp_path: Path) -> None:
    metrics, metadata = calculate_custom_polygon_metrics(
        raster_artifact(tmp_path),
        POLYGON_LEFT_COLUMN,
        ["species_richness_mammals"],
    )

    assert metrics == {"species_richness_mammals": None}
    assert metadata["metric_coverage"]["unavailable"] == [
        {
            "metric_id": "species_richness_mammals",
            "reason": "species_range_accumulator_not_in_live_artifact",
        }
    ]
