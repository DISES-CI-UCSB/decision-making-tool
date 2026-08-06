from metric_definitions import MetricDefinition
from metric_output import (
    blocked_no_data,
    empty_boundary,
    metric_value,
    not_applicable,
    status_counts,
)


def _definition(*, unit: str | None = "km2") -> MetricDefinition:
    return MetricDefinition(
        metric_id="demo_metric",
        metric_number=999,
        label_key="metrics.demo",
        english_label="Demo",
        spanish_label="Demo",
        unit=unit,
        format_hint="number",
        source_note="Source data is unavailable.",
        kind="blocked_no_data",
    )


def test_metric_value_preserves_output_contract_and_optional_details():
    metric = metric_value(
        _definition(),
        value=12.5,
        status="ready",
        notes="Computed.",
        source="raster:demo",
        details={"sampleCount": 3},
    )

    assert metric == {
        "metricId": "demo_metric",
        "value": 12.5,
        "unit": "km2",
        "status": "ready",
        "source": "raster:demo",
        "notes": "Computed.",
        "labelKey": "metrics.demo",
        "formatHint": "number",
        "details": {"sampleCount": 3},
    }


def test_status_helpers_preserve_metric_status_contracts():
    definition = _definition()

    assert not_applicable(definition)["status"] == "not_applicable"
    assert empty_boundary(definition)["value"] is None
    assert blocked_no_data(definition) == {
        "metricId": "demo_metric",
        "value": None,
        "unit": "km2",
        "status": "blocked",
        "source": "n/a",
        "notes": "Source data is unavailable.",
        "labelKey": "metrics.demo",
        "formatHint": "number",
    }


def test_empty_boundary_uses_none_for_every_unit():
    for unit in ("count", "km2", "%"):
        assert empty_boundary(_definition(unit=unit))["value"] is None


def test_status_counts_groups_metric_outputs():
    assert status_counts([
        {"status": "ready"},
        {"status": "blocked"},
        {"status": "ready"},
    ]) == {"ready": 2, "blocked": 1}
