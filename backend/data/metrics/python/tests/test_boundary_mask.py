import numpy as np
import pytest
from rasterio.features import bounds
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import transform_geom

from boundaries.boundary_id_grid import BoundaryIdGridCache
from boundaries.boundary_loader import (
    BoundaryFeature,
    BoundarySourceMetadata,
    canonical_geometry_sha256,
)
from boundaries.boundary_mask import (
    BoundaryMaskCache,
    BoundaryRasterizationError,
    rasterize_boundary,
)
from raster_metrics import RasterFingerprint


WGS84_SQUARE = {
    "type": "Polygon",
    "coordinates": [[
        [-75.0, 5.0],
        [-74.0, 5.0],
        [-74.0, 6.0],
        [-75.0, 6.0],
        [-75.0, 5.0],
    ]],
}


def _fingerprint(width, height, transform, crs):
    return RasterFingerprint(
        width=width,
        height=height,
        transform=(
            transform.a,
            transform.b,
            transform.c,
            transform.d,
            transform.e,
            transform.f,
        ),
        crs=crs,
    )


def _land_grid():
    return _fingerprint(
        width=4,
        height=4,
        transform=from_origin(-76.0, 7.0, 1.0, 1.0),
        crs="EPSG:4326",
    )


def _marine_grid():
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
    return projected, _fingerprint(6, 6, transform, "EPSG:9377")


def test_rasterize_boundary_preserves_same_crs_behavior():
    mask = rasterize_boundary(WGS84_SQUARE, _land_grid())

    assert mask.dtype == np.bool_
    assert mask.tolist() == [
        [False, False, False, False],
        [False, True, False, False],
        [False, False, False, False],
        [False, False, False, False],
    ]


def test_rasterize_boundary_reprojects_wgs84_to_projected_grid():
    projected_geometry, marine_grid = _marine_grid()

    reprojected_mask = rasterize_boundary(WGS84_SQUARE, marine_grid)
    projected_mask = rasterize_boundary(
        projected_geometry,
        marine_grid,
        source_crs="EPSG:9377",
    )

    assert reprojected_mask.any()
    np.testing.assert_array_equal(reprojected_mask, projected_mask)


def test_boundary_mask_cache_separates_land_and_marine_grids():
    _, marine_grid = _marine_grid()
    land_grid = _land_grid()
    cache = BoundaryMaskCache()

    land_mask = cache.get("departments", "example", WGS84_SQUARE, land_grid)
    marine_mask = cache.get("departments", "example", WGS84_SQUARE, marine_grid)

    assert land_mask.shape == (4, 4)
    assert marine_mask.shape == (6, 6)
    assert cache.get("departments", "example", WGS84_SQUARE, land_grid) is land_mask
    assert cache.get("departments", "example", WGS84_SQUARE, marine_grid) is marine_mask
    assert land_mask is not marine_mask


def test_boundary_mask_cache_preserves_rasterized_cell_count():
    cache = BoundaryMaskCache()
    mask = cache.get("departments", "example", WGS84_SQUARE, _land_grid())

    assert cache.cell_count(mask) == 1
    assert cache.cell_count(mask) == int(np.count_nonzero(mask))


def test_boundary_mask_cache_invalidates_on_source_hash_change():
    cache = BoundaryMaskCache()
    grid = _land_grid()

    first = cache.get(
        "departments",
        "05",
        WGS84_SQUARE,
        grid,
        source_sha256="a" * 64,
    )
    second = cache.get(
        "departments",
        "05",
        WGS84_SQUARE,
        grid,
        source_sha256="b" * 64,
    )

    np.testing.assert_array_equal(first, second)
    assert first is not second


def test_boundary_mask_cache_invalidates_on_geometry_hash_change():
    cache = BoundaryMaskCache()
    grid = _land_grid()
    shifted = {
        "type": "Polygon",
        "coordinates": [[
            [-74.0, 5.0],
            [-73.0, 5.0],
            [-73.0, 6.0],
            [-74.0, 6.0],
            [-74.0, 5.0],
        ]],
    }

    first = cache.get("departments", "05", WGS84_SQUARE, grid)
    second = cache.get("departments", "05", shifted, grid)

    assert first is not second
    assert not np.array_equal(first, second)


def _metadata(source_sha256):
    return BoundarySourceMetadata(
        url="https://example.test/departments.geojson",
        sha256=source_sha256,
        crs="EPSG:4326",
        feature_count=1,
        id_field="boundary_id",
        name_field="boundary_name",
        catalog_sha256="c" * 64,
        geometry_collection_sha256="d" * 64,
        feature_behavior="matching_frontend_identify_feature",
    )


def test_boundary_id_grid_cache_invalidates_on_boundary_source_change():
    geometry_sha256 = canonical_geometry_sha256(WGS84_SQUARE)
    first_feature = BoundaryFeature(
        boundary_id="05",
        name="Antioquia",
        geo_level="departments",
        geometry=WGS84_SQUARE,
        properties={},
        source_metadata=_metadata("a" * 64),
        geometry_sha256=geometry_sha256,
    )
    second_feature = BoundaryFeature(
        boundary_id="05",
        name="Antioquia",
        geo_level="departments",
        geometry=WGS84_SQUARE,
        properties={},
        source_metadata=_metadata("b" * 64),
        geometry_sha256=geometry_sha256,
    )
    cache = BoundaryIdGridCache()
    masks = BoundaryMaskCache()

    first = cache.get({"departments": [first_feature]}, _land_grid(), masks)
    second = cache.get({"departments": [second_feature]}, _land_grid(), masks)

    assert first is not second
    np.testing.assert_array_equal(
        first["departments"].flat,
        second["departments"].flat,
    )


def test_boundary_id_grid_cache_invalidates_on_boundary_name_change():
    first_feature = BoundaryFeature(
        boundary_id="05",
        name="Antioquia",
        geo_level="departments",
        geometry=WGS84_SQUARE,
        properties={},
    )
    renamed_feature = BoundaryFeature(
        boundary_id="05",
        name="Antioquia renamed",
        geo_level="departments",
        geometry=WGS84_SQUARE,
        properties={},
    )
    cache = BoundaryIdGridCache()
    masks = BoundaryMaskCache()

    first = cache.get({"departments": [first_feature]}, _land_grid(), masks)
    renamed = cache.get({"departments": [renamed_feature]}, _land_grid(), masks)

    assert first is not renamed
    assert first["departments"].boundary_names == ("Antioquia",)
    assert renamed["departments"].boundary_names == ("Antioquia renamed",)


def test_boundary_id_grid_cache_does_not_reuse_shapes_across_grids():
    _, marine_grid = _marine_grid()
    land_grid = _land_grid()
    feature = BoundaryFeature(
        boundary_id="example",
        name="Example",
        geo_level="departments",
        geometry=WGS84_SQUARE,
        properties={},
    )
    mask_cache = BoundaryMaskCache()
    grid_cache = BoundaryIdGridCache()
    boundaries = {"departments": [feature]}

    land_grids = grid_cache.get(boundaries, land_grid, mask_cache)
    marine_grids = grid_cache.get(boundaries, marine_grid, mask_cache)

    assert land_grids["departments"].flat.shape == (16,)
    assert marine_grids["departments"].flat.shape == (36,)
    assert grid_cache.get(boundaries, land_grid, mask_cache) is land_grids
    assert land_grids is not marine_grids


@pytest.mark.parametrize(
    ("geometry", "fingerprint", "source_crs", "message"),
    [
        (WGS84_SQUARE, _land_grid(), None, "Boundary source CRS is missing"),
        (WGS84_SQUARE, _land_grid(), "not-a-crs", "Boundary source CRS is invalid"),
        (
            WGS84_SQUARE,
            RasterFingerprint(
                width=1,
                height=1,
                transform=(1.0, 0.0, 0.0, 0.0, -1.0, 1.0),
                crs=None,
            ),
            "EPSG:4326",
            "Reference raster CRS is missing",
        ),
        ({"type": "Polygon", "coordinates": []}, _land_grid(), "EPSG:4326", "valid GeoJSON"),
    ],
)
def test_rasterize_boundary_fails_clearly_for_invalid_inputs(
    geometry,
    fingerprint,
    source_crs,
    message,
):
    with pytest.raises(BoundaryRasterizationError, match=message):
        rasterize_boundary(geometry, fingerprint, source_crs=source_crs)
