import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from calculators.area import selected_area_km2
from raster_metrics import RasterError, read_reference_raster, read_solution_raster


def _write_solution_raster(path, data, *, nodata):
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype=data.dtype,
        crs="EPSG:32618",
        transform=from_origin(0, data.shape[0], 1, 1),
        nodata=nodata,
    ) as dataset:
        dataset.write(data, 1)


def test_read_solution_raster_preserves_categorical_masks(tmp_path):
    raster_path = tmp_path / "solution.tif"
    data = np.array([[0, 1, 2, 255]], dtype=np.uint8)
    _write_solution_raster(raster_path, data, nodata=255)

    raster = read_solution_raster(raster_path)

    assert raster.valid_cells == 3
    assert raster.selected_cells == 2
    assert raster.solution_data_valid_mask.tolist() == [[True, True, True, False]]
    assert raster.grid_mask.tolist() == [[True, True, True, True]]
    assert raster.new_prioritizr_mask.tolist() == [[False, True, False, False]]
    assert raster.pre_existing_mask.tolist() == [[False, False, True, False]]
    assert raster.selected_mask.tolist() == [[False, True, True, False]]
    assert not np.any(raster.new_prioritizr_mask & raster.pre_existing_mask)
    assert np.array_equal(
        raster.selected_mask,
        raster.new_prioritizr_mask | raster.pre_existing_mask,
    )
    np.testing.assert_equal(
        raster.category_values,
        np.array([[0.0, 1.0, 2.0, np.nan]]),
    )


def test_read_solution_raster_handles_zero_nan_and_explicit_nodata(tmp_path):
    raster_path = tmp_path / "floating-solution.tif"
    data = np.array([[0.0, 1.0, 2.0, np.nan, -9999.0]], dtype=np.float32)
    _write_solution_raster(raster_path, data, nodata=-9999.0)

    raster = read_solution_raster(raster_path)

    assert raster.solution_data_valid_mask.tolist() == [
        [True, True, True, False, False]
    ]
    assert raster.new_prioritizr_mask.tolist() == [
        [False, True, False, False, False]
    ]
    assert raster.pre_existing_mask.tolist() == [
        [False, False, True, False, False]
    ]
    np.testing.assert_equal(
        raster.category_values,
        np.array([[0.0, 1.0, 2.0, np.nan, np.nan]]),
    )


def test_read_solution_raster_rejects_unexpected_finite_value(tmp_path):
    raster_path = tmp_path / "invalid-solution.tif"
    data = np.array([[0.0, 1.0, 2.0, 3.0]], dtype=np.float32)
    _write_solution_raster(raster_path, data, nodata=None)

    with pytest.raises(
        RasterError,
        match=r"unsupported finite value\(s\): 3.*Expected only 0.*1.*2",
    ):
        read_solution_raster(raster_path)


def test_read_reference_raster_accepts_categorical_values(tmp_path):
    raster_path = tmp_path / "categorical-reference.tif"
    data = np.array([[3, 430, 65535]], dtype=np.uint16)
    _write_solution_raster(raster_path, data, nodata=65535)

    raster = read_reference_raster(raster_path)

    assert raster.valid_cells == 2
    assert raster.selected_cells == 0
    assert raster.valid_mask.tolist() == [[True, True, False]]
    assert not raster.selected_mask.any()
    assert raster.category_values is None


def test_existing_selected_mask_calculator_includes_values_one_and_two(tmp_path):
    raster_path = tmp_path / "selected-area-solution.tif"
    data = np.array([[0, 1, 2, 255]], dtype=np.uint8)
    _write_solution_raster(raster_path, data, nodata=255)

    raster = read_solution_raster(raster_path)

    assert selected_area_km2(raster) == pytest.approx(2 / 1_000_000)
