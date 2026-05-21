"""Tests for binary-overlap calculator functions (metrics #4, #30–32, #36, #59, #60).

All five ecosystem-coverage calculators and both social-governance calculators
share the same underlying overlap_km2 formula. Rather than duplicating tests
for each named function, this file tests:
  1. The shared overlap_km2 primitive directly against fixture layer cases.
  2. One representative function per module to confirm it routes correctly.
  3. Edge cases: full overlap, partial overlap, zero overlap, nodata grids.
"""

import numpy as np
import pytest

from helpers import layer_mask
from raster_metrics import overlap_km2

# Individual named calculators — one per module as representative smoke tests.
from calculators.ecosystem_coverage import (
    dry_forest_km2,
    ecosystem_total_km2,
    mangroves_km2,
    paramo_km2,
    wetlands_km2,
)
from calculators.social_governance import (
    community_councils_km2,
    indigenous_reservations_km2,
)


# ---------------------------------------------------------------------------
# overlap_km2 primitive — uniform grid layer cases
# ---------------------------------------------------------------------------

class TestOverlapKm2Primitive:
    def test_full_layer(self, uniform_raster, uniform_fixture):
        mask = layer_mask(uniform_fixture, "full_layer")
        expected = uniform_fixture["layers"]["full_layer"]["expected_overlap_km2"]
        result = overlap_km2(
            uniform_raster.selected_mask,
            mask,
            uniform_raster.pixel_area_km2_per_row,
        )
        assert result == pytest.approx(expected)

    def test_top_half(self, uniform_raster, uniform_fixture):
        mask = layer_mask(uniform_fixture, "top_half")
        expected = uniform_fixture["layers"]["top_half"]["expected_overlap_km2"]
        result = overlap_km2(
            uniform_raster.selected_mask,
            mask,
            uniform_raster.pixel_area_km2_per_row,
        )
        assert result == pytest.approx(expected)

    def test_empty_layer(self, uniform_raster, uniform_fixture):
        mask = layer_mask(uniform_fixture, "empty_layer")
        expected = uniform_fixture["layers"]["empty_layer"]["expected_overlap_km2"]
        result = overlap_km2(
            uniform_raster.selected_mask,
            mask,
            uniform_raster.pixel_area_km2_per_row,
        )
        assert result == pytest.approx(expected)

    def test_unselected_only(self, uniform_raster, uniform_fixture):
        """Layer covering only unselected cells must produce zero overlap."""
        mask = layer_mask(uniform_fixture, "unselected_only")
        expected = uniform_fixture["layers"]["unselected_only"]["expected_overlap_km2"]
        result = overlap_km2(
            uniform_raster.selected_mask,
            mask,
            uniform_raster.pixel_area_km2_per_row,
        )
        assert result == pytest.approx(expected)

    def test_overlap_never_exceeds_selected_area(self, uniform_raster, uniform_fixture):
        """Overlap with any layer cannot exceed the selected area."""
        selected_area = uniform_fixture["expected"]["selected_area_km2"]
        for layer_name in uniform_fixture["layers"]:
            mask = layer_mask(uniform_fixture, layer_name)
            result = overlap_km2(
                uniform_raster.selected_mask,
                mask,
                uniform_raster.pixel_area_km2_per_row,
            )
            assert result <= selected_area + 1e-9, (
                f"Layer '{layer_name}' overlap {result} exceeds selected area {selected_area}"
            )

    def test_nodata_grid_full_layer(self, nodata_raster, nodata_fixture):
        """With nodata cells, overlap equals only the selected (non-nodata) area."""
        mask = layer_mask(nodata_fixture, "full_layer")
        expected = nodata_fixture["layers"]["full_layer"]["expected_overlap_km2"]
        result = overlap_km2(
            nodata_raster.selected_mask,
            mask,
            nodata_raster.pixel_area_km2_per_row,
        )
        assert result == pytest.approx(expected)


# ---------------------------------------------------------------------------
# Named calculator smoke tests — one per named function
# ---------------------------------------------------------------------------
#
# Each function wraps overlap_km2 with a named layer mask argument. Testing
# that they produce the same result as calling overlap_km2 directly confirms
# the routing is correct.

class TestEcosystemCoverageCalculators:
    def _expected_full(self, fixture):
        return fixture["layers"]["full_layer"]["expected_overlap_km2"]

    def _full_mask(self, fixture):
        return layer_mask(fixture, "full_layer")

    def test_ecosystem_total_km2(self, uniform_raster, uniform_fixture):
        mask = self._full_mask(uniform_fixture)
        assert ecosystem_total_km2(uniform_raster, mask) == pytest.approx(
            self._expected_full(uniform_fixture)
        )

    def test_paramo_km2(self, uniform_raster, uniform_fixture):
        mask = self._full_mask(uniform_fixture)
        assert paramo_km2(uniform_raster, mask) == pytest.approx(
            self._expected_full(uniform_fixture)
        )

    def test_dry_forest_km2(self, uniform_raster, uniform_fixture):
        mask = self._full_mask(uniform_fixture)
        assert dry_forest_km2(uniform_raster, mask) == pytest.approx(
            self._expected_full(uniform_fixture)
        )

    def test_wetlands_km2(self, uniform_raster, uniform_fixture):
        mask = self._full_mask(uniform_fixture)
        assert wetlands_km2(uniform_raster, mask) == pytest.approx(
            self._expected_full(uniform_fixture)
        )

    def test_mangroves_km2(self, uniform_raster, uniform_fixture):
        mask = self._full_mask(uniform_fixture)
        assert mangroves_km2(uniform_raster, mask) == pytest.approx(
            self._expected_full(uniform_fixture)
        )

    def test_partial_overlap_matches_primitive(self, uniform_raster, uniform_fixture):
        """Named functions must match overlap_km2 for the same mask."""
        mask = layer_mask(uniform_fixture, "top_half")
        direct = overlap_km2(
            uniform_raster.selected_mask,
            mask,
            uniform_raster.pixel_area_km2_per_row,
        )
        assert ecosystem_total_km2(uniform_raster, mask) == pytest.approx(direct)
        assert paramo_km2(uniform_raster, mask) == pytest.approx(direct)
        assert wetlands_km2(uniform_raster, mask) == pytest.approx(direct)


class TestSocialGovernanceCalculators:
    def _full_mask(self, fixture):
        return layer_mask(fixture, "full_layer")

    def test_indigenous_reservations_km2(self, uniform_raster, uniform_fixture):
        mask = self._full_mask(uniform_fixture)
        expected = uniform_fixture["layers"]["full_layer"]["expected_overlap_km2"]
        assert indigenous_reservations_km2(uniform_raster, mask) == pytest.approx(expected)

    def test_community_councils_km2(self, uniform_raster, uniform_fixture):
        mask = self._full_mask(uniform_fixture)
        expected = uniform_fixture["layers"]["full_layer"]["expected_overlap_km2"]
        assert community_councils_km2(uniform_raster, mask) == pytest.approx(expected)

    def test_zero_overlap_social(self, uniform_raster, uniform_fixture):
        mask = layer_mask(uniform_fixture, "empty_layer")
        assert indigenous_reservations_km2(uniform_raster, mask) == pytest.approx(0.0)
        assert community_councils_km2(uniform_raster, mask) == pytest.approx(0.0)
