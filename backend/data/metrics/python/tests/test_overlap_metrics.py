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
import rasterio
from rasterio.transform import from_origin

from calculator_registry import categorical_area_calculator, overlap_area_calculator
from helpers import layer_mask
from metric_definitions import computable_metrics
from raster_metrics import overlap_km2, read_layer_values

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
        values = self._full_mask(uniform_fixture).astype(np.uint32)
        assert ecosystem_total_km2(uniform_raster, values) == pytest.approx(
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
        assert ecosystem_total_km2(uniform_raster, mask.astype(np.uint32)) == pytest.approx(direct)
        assert paramo_km2(uniform_raster, mask) == pytest.approx(direct)
        assert wetlands_km2(uniform_raster, mask) == pytest.approx(direct)

    def test_iavh_classes_exclude_zero_unknown_and_uint32_nodata(
        self,
        tmp_path,
        uniform_raster,
    ):
        nodata = np.iinfo(np.uint32).max
        values = np.array([
            [17, 429, 1, 430],
            [17, 0, 431, 429],
            [nodata, 1, 430, 999],
            [nodata, nodata, nodata, nodata],
        ], dtype=np.uint32)
        layer_path = tmp_path / "ecosistemas_IAVH_2024.tif"
        fingerprint = uniform_raster.fingerprint

        with rasterio.open(
            layer_path,
            "w",
            driver="GTiff",
            height=values.shape[0],
            width=values.shape[1],
            count=1,
            dtype=values.dtype,
            crs=fingerprint.crs,
            transform=from_origin(0, 4, 1, 1),
            nodata=nodata,
        ) as dataset:
            dataset.write(values, 1)

        layer_values = read_layer_values(layer_path, fingerprint)

        assert np.isnan(layer_values[2, 0])
        assert ecosystem_total_km2(uniform_raster, layer_values) == pytest.approx(2.0)

    def test_ecosystem_coverage_catalog_uses_only_authoritative_iavh_source(self):
        definition = next(
            metric for metric in computable_metrics()
            if metric.metric_id == "ecosystem_coverage"
        )

        assert definition.kind == "categorical_overlap_area"
        assert definition.layer_id == "ecosistemas_IAVH_2024"
        assert definition.layer_id != "ecosistemas"
        assert definition.label_key == "metrics.tier1.ecosystem_coverage"
        assert definition.english_label == "Ecosystem Coverage"
        assert definition.spanish_label == "Cobertura de ecosistemas"
        assert definition.unit == "km2"
        assert definition.off_manifest_url is not None
        assert definition.off_manifest_url.endswith(
            "/inputs/features/ecosystems/ecosistemas_IAVH_2024.tif"
        )
        assert categorical_area_calculator(definition.metric_id) is ecosystem_total_km2
        assert overlap_area_calculator("ecosistemas") is None

    def test_scoped_raster_preserves_generic_aoi_overlap(self, uniform_raster):
        values = np.ones(uniform_raster.selected_mask.shape, dtype=np.uint32)
        boundary = np.zeros_like(uniform_raster.selected_mask)
        boundary[0, :] = True

        national = ecosystem_total_km2(uniform_raster, values)
        aoi = ecosystem_total_km2(uniform_raster.with_boundary_mask(boundary), values)

        assert national == pytest.approx(uniform_raster.selected_area_km2)
        assert 0 < aoi < national


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
