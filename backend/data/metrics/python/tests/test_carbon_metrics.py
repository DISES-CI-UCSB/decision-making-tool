"""Tests for carbon weighted-sum and national-share metrics."""

import numpy as np
import pytest

from calculators.carbon import national_carbon_percent
from helpers import raster_from_fixture


def test_national_carbon_percent_uses_layer_extent_when_solution_valid_is_selected_only():
    """National denominator must not collapse to the selected solution footprint."""
    raster = raster_from_fixture(
        {
            "shape": [2, 2],
            "pixel_area_km2": 1,
            "selected": [[1, 0], [0, 0]],
            "valid": [[1, 0], [0, 0]],
        }
    )
    layer_values = np.array([[10, 10], [10, 10]], dtype=np.float64)

    assert national_carbon_percent(raster, layer_values) == pytest.approx(25.0)


def test_national_carbon_percent_ignores_nodata_carbon_cells():
    raster = raster_from_fixture(
        {
            "shape": [2, 2],
            "pixel_area_km2": 1,
            "selected": [[1, 0], [0, 0]],
            "valid": [[1, 1], [1, 1]],
        }
    )
    layer_values = np.array([[10, np.nan], [10, 10]], dtype=np.float64)

    assert national_carbon_percent(raster, layer_values) == pytest.approx(100 / 3)
