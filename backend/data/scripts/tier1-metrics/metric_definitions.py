"""Tier 1 metric catalog.

Stable IDs, labels, units, format hints, and source notes for the 14 Tier 1
metrics emitted by this batch. Metric numbers reference rows in
docs/design/DISES Metrics - Finalized Metrics.csv.

Default selection (11 single-solution + 3 deferred catalog entries = 14):
  Single-solution, computed in this MVP:
    1, 2, 4, 17, 18, 30, 31, 32, 36, 59, 60
  Deferred (defined here for catalog stability; values omitted from MVP JSON):
    70, 71, 72  (pairwise comparison metrics)

Edit METRIC_CATALOG below if the Tier 1 scope changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

MetricFormatHint = Literal["number", "percent", "currency", "ratio", "index"]
MetricKind = Literal[
    "metadata_summary",
    "metadata_coverage",
    "selected_area",
    "national_percent",
    "binary_overlap_area",
    "binary_overlap_percent_of_selected",
    "deferred_pairwise",
]


@dataclass(frozen=True)
class MetricDefinition:
    metric_id: str
    metric_number: int
    label_key: str
    english_label: str
    spanish_label: str
    unit: str | None
    format_hint: MetricFormatHint
    source_note: str
    kind: MetricKind
    layer_id: str | None = None


# Order here is the order written into the per-solution sidecars.
METRIC_CATALOG: tuple[MetricDefinition, ...] = (
    MetricDefinition(
        metric_id="metric-1",
        metric_number=1,
        label_key="metrics.tier1.conservation_goals_met",
        english_label="Conservation Goals Met",
        spanish_label="Metas de conservación cumplidas",
        unit="%",
        format_hint="percent",
        source_note="Reads pctTargetsMet from solution summaryMetrics in the manifest.",
        kind="metadata_summary",
    ),
    MetricDefinition(
        metric_id="metric-2",
        metric_number=2,
        label_key="metrics.tier1.species_groups_protected",
        english_label="Species Groups Protected",
        spanish_label="Grupos de especies protegidos",
        unit="count",
        format_hint="number",
        source_note=(
            "Counts coverage[] rows where met == true. Marked derivation_needed "
            "when no usable coverage rows are present."
        ),
        kind="metadata_coverage",
    ),
    MetricDefinition(
        metric_id="metric-4",
        metric_number=4,
        label_key="metrics.tier1.ecosystem_coverage",
        english_label="Ecosystem Coverage",
        spanish_label="Cobertura de ecosistemas",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'ecosistemas' layer.",
        kind="binary_overlap_area",
        layer_id="ecosistemas",
    ),
    MetricDefinition(
        metric_id="metric-17",
        metric_number=17,
        label_key="metrics.tier1.national_contribution",
        english_label="National Contribution",
        spanish_label="Contribución nacional",
        unit="%",
        format_hint="percent",
        source_note="Selected km^2 divided by total valid km^2 in the solution raster.",
        kind="national_percent",
    ),
    MetricDefinition(
        metric_id="metric-18",
        metric_number=18,
        label_key="metrics.tier1.priority_area_total",
        english_label="Priority Area (Selected)",
        spanish_label="Área prioritaria seleccionada",
        unit="km2",
        format_hint="number",
        source_note="Total selected km^2 from the solution raster (national scope).",
        kind="selected_area",
    ),
    MetricDefinition(
        metric_id="metric-30",
        metric_number=30,
        label_key="metrics.tier1.ecosystem_paramo",
        english_label="Ecosystem Coverage - Páramo",
        spanish_label="Cobertura de páramo",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'paramos' layer.",
        kind="binary_overlap_area",
        layer_id="paramos",
    ),
    MetricDefinition(
        metric_id="metric-31",
        metric_number=31,
        label_key="metrics.tier1.ecosystem_dry_forest",
        english_label="Ecosystem Coverage - Dry Forest",
        spanish_label="Cobertura de bosque seco",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'bosque_seco' layer.",
        kind="binary_overlap_area",
        layer_id="bosque_seco",
    ),
    MetricDefinition(
        metric_id="metric-32",
        metric_number=32,
        label_key="metrics.tier1.ecosystem_wetlands",
        english_label="Ecosystem Coverage - Wetlands",
        spanish_label="Cobertura de humedales",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'wetlands' layer.",
        kind="binary_overlap_area",
        layer_id="wetlands",
    ),
    MetricDefinition(
        metric_id="metric-36",
        metric_number=36,
        label_key="metrics.tier1.ecosystem_mangroves",
        english_label="Mangrove Coverage",
        spanish_label="Cobertura de manglares",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'mangroves' layer.",
        kind="binary_overlap_area",
        layer_id="mangroves",
    ),
    MetricDefinition(
        metric_id="metric-59",
        metric_number=59,
        label_key="metrics.tier1.indigenous_reservations_area",
        english_label="Indigenous Reservations Area",
        spanish_label="Área de resguardos indígenas",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'resguardos' layer.",
        kind="binary_overlap_area",
        layer_id="resguardos",
    ),
    MetricDefinition(
        metric_id="metric-60",
        metric_number=60,
        label_key="metrics.tier1.community_councils_area",
        english_label="Community Councils Area",
        spanish_label="Área de consejos comunitarios",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'comunidades' layer.",
        kind="binary_overlap_area",
        layer_id="comunidades",
    ),
    # Deferred (definition-only; values omitted from MVP JSON, see write_solution_sidecar).
    MetricDefinition(
        metric_id="metric-70",
        metric_number=70,
        label_key="metrics.tier1.agreement_area",
        english_label="Agreement Area",
        spanish_label="Área de acuerdo",
        unit="km2",
        format_hint="number",
        source_note="Pairwise A∩B; deferred to live comparison logic in the app.",
        kind="deferred_pairwise",
    ),
    MetricDefinition(
        metric_id="metric-71",
        metric_number=71,
        label_key="metrics.tier1.unique_to_a",
        english_label="Unique to Solution A",
        spanish_label="Único en esolution A",
        unit="km2",
        format_hint="number",
        source_note="Pairwise A−B; deferred to live comparison logic in the app.",
        kind="deferred_pairwise",
    ),
    MetricDefinition(
        metric_id="metric-72",
        metric_number=72,
        label_key="metrics.tier1.unique_to_b",
        english_label="Unique to Solution B",
        spanish_label="Único en esolution B",
        unit="km2",
        format_hint="number",
        source_note="Pairwise B−A; deferred to live comparison logic in the app.",
        kind="deferred_pairwise",
    ),
)


def deferred_metric_ids() -> set[str]:
    return {m.metric_id for m in METRIC_CATALOG if m.kind == "deferred_pairwise"}


def computable_metrics() -> tuple[MetricDefinition, ...]:
    return tuple(m for m in METRIC_CATALOG if m.kind != "deferred_pairwise")


def required_layer_ids() -> tuple[str, ...]:
    seen: list[str] = []
    for m in METRIC_CATALOG:
        if m.layer_id and m.layer_id not in seen:
            seen.append(m.layer_id)
    return tuple(seen)
