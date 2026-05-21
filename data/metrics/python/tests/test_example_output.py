"""Structural and sanity checks against the generated example output.

Loads data/metrics/generated/examples/ecos17_estr30_runap_hf.metrics.json
and verifies:
  - Top-level schema is intact (required keys, correct types).
  - Every metric entry has all required fields with valid types.
  - Metrics with status "ready" have numeric values, not None.
  - Numeric values are in plausible ranges (percent in [0,100], areas > 0).
  - Overlap areas do not exceed the total selected area.

These checks do not require rasterio or numpy. They will fail fast if a
pipeline change accidentally breaks the output schema or produces nonsense
values.
"""

from __future__ import annotations

import math

import pytest

# Required keys on every metric entry.
_METRIC_KEYS = {
    "metricId",
    "value",
    "unit",
    "status",
    "source",
    "notes",
    "labelKey",
    "formatHint",
}

_VALID_STATUSES = {"ready", "blocked", "pending", "derivation_needed"}

# Metric IDs whose overlap areas must not exceed total selected area.
_OVERLAP_METRIC_IDS = {
    "ecosystem_coverage",
    "ecosystem_coverage_paramo",
    "ecosystem_coverage_dry_forest",
    "ecosystem_coverage_wetlands",
    "mangrove_coverage",
    "indigenous_reservations_area",
    "community_councils_area",
}


def _find(metrics: list[dict], metric_id: str) -> dict | None:
    return next((m for m in metrics if m["metricId"] == metric_id), None)


# ---------------------------------------------------------------------------
# Top-level structure
# ---------------------------------------------------------------------------

class TestTopLevelSchema:
    def test_required_keys(self, example_output):
        assert {"solutionId", "generatedAt", "geographies"} <= example_output.keys()

    def test_solution_id_is_string(self, example_output):
        assert isinstance(example_output["solutionId"], str)
        assert example_output["solutionId"] != ""

    def test_generated_at_is_string(self, example_output):
        assert isinstance(example_output["generatedAt"], str)

    def test_national_geography_present(self, example_output):
        assert "national" in example_output["geographies"]

    def test_colombia_scope_present(self, example_output):
        assert "colombia" in example_output["geographies"]["national"]

    def test_metrics_is_nonempty_list(self, national_metrics):
        assert isinstance(national_metrics, list)
        assert len(national_metrics) > 0


# ---------------------------------------------------------------------------
# Per-metric entry schema
# ---------------------------------------------------------------------------

class TestMetricEntrySchema:
    def test_all_entries_have_required_keys(self, national_metrics):
        for metric in national_metrics:
            missing = _METRIC_KEYS - metric.keys()
            assert not missing, (
                f"Metric '{metric.get('metricId')}' is missing keys: {missing}"
            )

    def test_all_status_values_are_known(self, national_metrics):
        for metric in national_metrics:
            assert metric["status"] in _VALID_STATUSES, (
                f"Metric '{metric['metricId']}' has unknown status '{metric['status']}'"
            )

    def test_ready_metrics_have_numeric_values(self, national_metrics):
        for metric in national_metrics:
            if metric["status"] == "ready":
                assert isinstance(metric["value"], (int, float)), (
                    f"Metric '{metric['metricId']}' is ready but value is {metric['value']!r}"
                )
                assert not math.isnan(metric["value"]), (
                    f"Metric '{metric['metricId']}' value is NaN"
                )

    def test_non_ready_metrics_have_null_or_numeric_value(self, national_metrics):
        for metric in national_metrics:
            if metric["status"] != "ready":
                assert metric["value"] is None or isinstance(metric["value"], (int, float))

    def test_metric_ids_are_unique(self, national_metrics):
        ids = [m["metricId"] for m in national_metrics]
        assert len(ids) == len(set(ids)), "Duplicate metricId in national metrics"


# ---------------------------------------------------------------------------
# Value range sanity checks
# ---------------------------------------------------------------------------

class TestValueRanges:
    def test_national_contribution_is_valid_percent(self, national_metrics):
        metric = _find(national_metrics, "national_contribution")
        assert metric is not None, "national_contribution metric missing"
        assert metric["status"] == "ready"
        assert 0 < metric["value"] <= 100

    def test_priority_area_is_positive(self, national_metrics):
        metric = _find(national_metrics, "priority_area_in_region")
        assert metric is not None, "priority_area_in_region metric missing"
        assert metric["status"] == "ready"
        assert metric["value"] > 0

    def test_overlap_areas_do_not_exceed_selected_area(self, national_metrics):
        total_metric = _find(national_metrics, "priority_area_in_region")
        assert total_metric is not None
        total_area = total_metric["value"]

        for metric in national_metrics:
            if metric["metricId"] in _OVERLAP_METRIC_IDS and metric["status"] == "ready":
                assert metric["value"] <= total_area * 1.0001, (
                    f"Metric '{metric['metricId']}' overlap {metric['value']:.2f} km² "
                    f"exceeds total selected area {total_area:.2f} km²"
                )

    def test_all_ready_km2_values_are_non_negative(self, national_metrics):
        for metric in national_metrics:
            if metric["status"] == "ready" and metric.get("unit") == "km2":
                assert metric["value"] >= 0, (
                    f"Metric '{metric['metricId']}' has negative km² value: {metric['value']}"
                )
