"""Grid-CRS behavior of the custom AOI path, ahead of the EPSG:9377 migration."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine
from rasterio.features import bounds, geometry_mask
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import transform_geom

from app.metric_adapters import build_custom_aoi_raster
from raster_metrics import RasterError, read_reference_raster

# Pinned v0.2 land solution grid: 1000 m cells on EPSG:9377.
LAND_GRID_TRANSFORM = (
    1000.0,
    0.0,
    4331309.911856957,
    0.0,
    -999.9999999999999,
    2933186.9308051495,
)

WGS84_SQUARE = {
    "type": "Polygon",
    "coordinates": [
        [
            [-75.0, 5.0],
            [-74.0, 5.0],
            [-74.0, 6.0],
            [-75.0, 6.0],
            [-75.0, 5.0],
        ]
    ],
}


def write_reference(
    path: Path,
    *,
    crs: str | None,
    transform: Affine,
    shape: tuple[int, int] = (6, 6),
) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=shape[1],
        height=shape[0],
        count=1,
        dtype="uint8",
        crs=crs,
        transform=transform,
        nodata=0,
    ) as dataset:
        dataset.write(np.ones(shape, dtype=np.uint8), 1)
    return path


def projected_grid_transform() -> tuple[dict, Affine]:
    """Return the WGS84 square in EPSG:9377 plus a 6x6 grid padded around it."""
    projected = transform_geom("EPSG:4326", "EPSG:9377", WGS84_SQUARE)
    left, bottom, right, top = bounds(projected)
    x_pad = (right - left) / 2
    y_pad = (top - bottom) / 2
    transform = from_bounds(
        left - x_pad,
        bottom - y_pad,
        right + x_pad,
        top + y_pad,
        6,
        6,
    )
    return projected, transform


def test_wgs84_polygon_selects_same_cells_as_pre_projected_polygon(tmp_path: Path) -> None:
    projected_geometry, transform = projected_grid_transform()
    reference = write_reference(tmp_path / "grid_9377.tif", crs="EPSG:9377", transform=transform)

    from_wgs84 = build_custom_aoi_raster(reference, WGS84_SQUARE)
    already_projected = build_custom_aoi_raster(
        reference,
        projected_geometry,
        source_crs="EPSG:9377",
    )

    assert from_wgs84.selected_cells > 0
    np.testing.assert_array_equal(
        from_wgs84.selected_mask,
        already_projected.selected_mask,
    )


def test_polygon_already_in_grid_crs_is_not_reprojected(tmp_path: Path) -> None:
    projected_geometry, transform = projected_grid_transform()
    reference = write_reference(tmp_path / "grid_9377.tif", crs="EPSG:9377", transform=transform)

    raster = build_custom_aoi_raster(reference, projected_geometry, source_crs="EPSG:9377")
    expected = geometry_mask(
        [projected_geometry],
        out_shape=(6, 6),
        transform=transform,
        invert=True,
        all_touched=False,
    )

    np.testing.assert_array_equal(raster.selected_mask, expected)


def test_wgs84_grid_rasterization_does_not_regress(tmp_path: Path) -> None:
    transform = from_origin(-76.0, 7.0, 1.0, 1.0)
    reference = write_reference(
        tmp_path / "grid_4326.tif",
        crs="EPSG:4326",
        transform=transform,
        shape=(4, 4),
    )

    raster = build_custom_aoi_raster(reference, WGS84_SQUARE)
    expected = geometry_mask(
        [WGS84_SQUARE],
        out_shape=(4, 4),
        transform=transform,
        invert=True,
        all_touched=False,
    )

    np.testing.assert_array_equal(raster.selected_mask, expected)
    assert raster.selected_mask.tolist() == [
        [False, False, False, False],
        [False, True, False, False],
        [False, False, False, False],
        [False, False, False, False],
    ]


def test_reference_grid_without_crs_fails_instead_of_guessing(tmp_path: Path) -> None:
    reference = write_reference(
        tmp_path / "grid_no_crs.tif",
        crs=None,
        transform=from_origin(0.0, 6.0, 1.0, 1.0),
    )

    with pytest.raises(RasterError, match="CRS"):
        build_custom_aoi_raster(reference, WGS84_SQUARE)


def test_projected_1000m_grid_has_constant_one_km2_cells(tmp_path: Path) -> None:
    reference = write_reference(
        tmp_path / "land_grid.tif",
        crs="EPSG:9377",
        transform=Affine(*LAND_GRID_TRANSFORM),
        shape=(4, 4),
    )

    areas = read_reference_raster(reference).pixel_area_km2_per_row

    assert areas.shape == (4,)
    assert len(set(areas.tolist())) == 1
    assert areas[0] == pytest.approx(1.0, abs=1e-12)


def test_geographic_grid_keeps_latitude_varying_row_areas(tmp_path: Path) -> None:
    reference = write_reference(
        tmp_path / "geographic_grid.tif",
        crs="EPSG:4326",
        transform=from_origin(-79.18333333333334, 12.65, 0.00833333333333333, 0.00833333333333333),
        shape=(4, 4),
    )

    areas = read_reference_raster(reference).pixel_area_km2_per_row

    # Rows run north to south, so cells widen as cos(latitude) grows.
    assert areas[-1] > areas[0]
    assert areas[0] == pytest.approx(0.8378, abs=1e-4)
