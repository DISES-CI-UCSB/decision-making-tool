"""Tests for area calculator functions (metrics #17 and #18).

Uses tiny JSON fixtures so expected values can be verified by eye without
needing rasterio or real TIF files.
"""

import pytest

from calculators.area import national_contribution_pct, selected_area_km2
from helpers import raster_from_fixture


class TestSelectedAreaKm2:
    def test_uniform_grid(self, uniform_raster, uniform_fixture):
        expected = uniform_fixture["expected"]["selected_area_km2"]
        assert selected_area_km2(uniform_raster) == pytest.approx(expected)

    def test_uniform_grid_cell_count(self, uniform_raster, uniform_fixture):
        expected_cells = uniform_fixture["expected"]["selected_cells"]
        pixel_area = uniform_fixture["pixel_area_km2"]
        assert selected_area_km2(uniform_raster) == pytest.approx(expected_cells * pixel_area)

    def test_nodata_grid(self, nodata_raster, nodata_fixture):
        expected = nodata_fixture["expected"]["selected_area_km2"]
        assert selected_area_km2(nodata_raster) == pytest.approx(expected)

    def test_nodata_does_not_inflate_selected_area(self, nodata_raster, nodata_fixture):
        """Nodata cells in the valid mask must not count toward selected area."""
        total_cells = nodata_fixture["shape"][0] * nodata_fixture["shape"][1]
        pixel_area = nodata_fixture["pixel_area_km2"]
        assert selected_area_km2(nodata_raster) < total_cells * pixel_area


class TestNationalContributionPct:
    def test_uniform_grid(self, uniform_raster, uniform_fixture):
        expected = uniform_fixture["expected"]["national_contribution_pct"]
        assert national_contribution_pct(uniform_raster) == pytest.approx(expected)

    def test_nodata_grid(self, nodata_raster, nodata_fixture):
        expected = nodata_fixture["expected"]["national_contribution_pct"]
        assert national_contribution_pct(nodata_raster) == pytest.approx(expected)

    def test_result_is_percentage_not_fraction(self, uniform_raster):
        """Result must be in [0, 100], not [0, 1]."""
        result = national_contribution_pct(uniform_raster)
        assert 0 < result <= 100

    def test_zero_valid_area_returns_none(self, uniform_fixture):
        """When the raster has no valid cells the function must return None."""
        empty_fixture = {**uniform_fixture, "valid": [[0, 0, 0, 0]] * 4, "selected": [[0, 0, 0, 0]] * 4}
        raster = raster_from_fixture(empty_fixture)
        assert national_contribution_pct(raster) is None
