"""Pure builders for the metric output contract and status summaries."""

from __future__ import annotations

from typing import Any

from metric_definitions import MetricDefinition


def metric_value(
    definition: MetricDefinition,
    *,
    value: float | int | None,
    status: str,
    notes: str | None,
    source: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metric = {
        "metricId": definition.metric_id,
        "value": value,
        "unit": definition.unit,
        "status": status,
        "source": source,
        "notes": notes,
        "labelKey": definition.label_key,
        "formatHint": definition.format_hint,
    }
    if details is not None:
        metric["details"] = details
    return metric


def not_applicable(
    definition: MetricDefinition,
    *,
    notes: str = "Metric is only available at national scope.",
) -> dict[str, Any]:
    return metric_value(
        definition,
        value=None,
        status="not_applicable",
        notes=notes,
        source="n/a",
    )


def empty_boundary(definition: MetricDefinition) -> dict[str, Any]:
    """Build output for a boundary with no valid raster overlap."""
    return metric_value(
        definition,
        value=None,
        status="empty",
        notes="Boundary has zero cells intersecting verified solution valid data.",
        source="raster:boundary_mask",
    )


def blocked_no_data(definition: MetricDefinition) -> dict[str, Any]:
    return metric_value(
        definition,
        value=None,
        status="blocked",
        notes=definition.source_note,
        source="n/a",
    )


def status_counts(metric_values: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for metric in metric_values:
        status = metric["status"]
        counts[status] = counts.get(status, 0) + 1
    return counts
