"""Reusable backfill: threatened-species metrics from species-goals sidecars.

Lifecycle: off-pipeline recovery after ``main.py --skip-species`` or when
species metric rows must be repaired without raster recomputation. Default
mode restamps metric #3 (``threatened_species_secured``) on the 24 untargeted
land solutions only; optional flags widen scope or reconcile all ten species
metrics (same behavior as ``reconcile_all_species_metrics.py``).

Policy comes from document provenance when present, otherwise from the runtime
manifest ``finderInputs.structuredTargets``. Missing policy never defaults to
scalar. ``details.speciesException`` is emitted only when the document already
carries a matching ``generationConfig.speciesException``.

Safe reuse: write to separate ``--output-*`` dirs unless ``--in-place`` is
intentional. Expects a full regular compact/verbose cache (
``EXPECTED_REGULAR_SOLUTION_COUNT`` files); update module constants when the
regular solution census changes. Reuses endemic backfill and land-use I/O. Does
not touch rasters or republish SIRAP packets.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping, Sequence

from backfill_endemic_species_count import (
    ENDEMIC_SOURCE,
    MARINE_NOTES,
    MISSING_GOALS_NOTES,
    READY_NOTES,
    count_endemic_species_by_scope,
    endemic_definition,
    load_scientific_names,
    resolve_partition_path,
    restamp_document,
    species_goals_level,
    upsert_metric_in_catalog_order,
)
from backfill_land_use_of_aoi import (
    dump_metric_document,
    load_metric_document,
    scope_is_empty,
    solution_stem,
)
from cli_utils import find_repo_root
from compact_metrics import COMPACT_CACHE_SUFFIX
from metric_definitions import computable_metrics, species_metric_ids
from metric_output import empty_boundary, metric_value, not_applicable
from metrics_contract import PROVENANCE_KEY, regular_artifact_completeness_issues
from solution_catalog import load_solution_catalog
from species_data import DEFAULT_ENDEMIC_CSV, SpeciesRecord, load_endemic_flags
from species_goals import (
    CATALOG_ROW_LAYOUT,
    COMPACT_ROW_LAYOUT,
    FLAG_CONFIGURED_TARGET_MET,
    FLAG_MET_17,
    FLAG_MET_30,
    FLAG_TARGET_CONFIGURED,
)
from species_taxonomy import BUCKET_LABELS, CLASS_BUCKETS
from species_target_policy import (
    REFERENCE_THRESHOLDS,
    TARGET_POLICY_SOURCE,
    SpeciesTargetPolicyError,
    resolve_species_target_policy,
)

GOLD_ID = "eco17_estr17_serv17_esprep17_runap_iheh2022"
EXPECTED_GOLD = {
    "endemic_species_count": 481,
    "threatened_species_count": 204,
    "threatened_species_secured": 204,
}
EXPECTED_REGULAR_SOLUTION_COUNT = 172
EXPECTED_UNTARGETED_LAND_COUNT = 24
SPECIES_TARGET_MARKERS = ("esprep", "esprn")
SIRAP_PATH_MARKERS = ("sirap-2026-", "/sirap/", "\\sirap\\")
SECURED_METRIC_ID = "threatened_species_secured"
COUNT_METRIC_ID = "threatened_species_count"
ENDEMIC_METRIC_ID = "endemic_species_count"
THREATENED_SOURCE = "csv:biomod_spp_ranges_updatedIUCN+species-goals"
CACHE_SUFFIX = ".metrics.json"
DEFAULT_RUNTIME_MANIFEST = Path("preflight/candidate-runtime-manifest.json")
_COVERED_IDX = COMPACT_ROW_LAYOUT.index("solutionCoveredAreaKm2")
_SPECIES_IDX = COMPACT_ROW_LAYOUT.index("speciesIndex")
_SCOPE_IDX = COMPACT_ROW_LAYOUT.index("scopeIndex")
_FLAGS_IDX = COMPACT_ROW_LAYOUT.index("flags")
_IUCN_IDX = CATALOG_ROW_LAYOUT.index("iucnStatus")
_GROUP_IDX = CATALOG_ROW_LAYOUT.index("group")
_RANGE_IDX = COMPACT_ROW_LAYOUT.index("rangeAreaKm2")
_AVAILABILITY_IDX = CATALOG_ROW_LAYOUT.index("availability")
_NATIONAL_RANGE_IDX = CATALOG_ROW_LAYOUT.index("nationalRangeKm2")
_RICHNESS_METRIC_BY_BUCKET = {
    bucket: f"species_richness_{bucket}" for bucket in CLASS_BUCKETS
}


def _metric_def(metric_id: str):
    return next(item for item in computable_metrics() if item.metric_id == metric_id)


def is_species_targeted_id(solution_id: str) -> bool:
    lowered = solution_id.lower()
    return any(marker in lowered for marker in SPECIES_TARGET_MARKERS)


def path_looks_like_sirap_batch(path: Path) -> bool:
    rendered = str(path.resolve()).lower()
    return any(marker in rendered for marker in SIRAP_PATH_MARKERS)


def load_runtime_catalog_solutions(path: Path) -> dict[str, dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    solutions = raw.get("solutions") if isinstance(raw, Mapping) else None
    if not isinstance(solutions, list) or not solutions:
        raise ValueError(f"{path} has no solutions array.")
    by_id: dict[str, dict[str, Any]] = {}
    for entry in solutions:
        if not isinstance(entry, Mapping):
            continue
        solution_id = entry.get("id")
        if isinstance(solution_id, str) and solution_id:
            by_id[solution_id] = dict(entry)
    if not by_id:
        raise ValueError(f"{path} has no usable solution ids.")
    return by_id


def catalog_policy_kind(catalog_solution: Mapping[str, Any] | None) -> str:
    """Classify policy from catalog finderInputs. Never guess scalar."""

    if catalog_solution is None:
        raise ValueError(
            "Refusing to guess species target policy without catalog finderInputs."
        )
    if catalog_solution.get("domain") == "marine":
        return "marine"
    try:
        return resolve_species_target_policy(catalog_solution).kind
    except SpeciesTargetPolicyError as exc:
        message = str(exc)
        if "require catalog and available species inventories" in message:
            return "per_species"
        raise


def resolve_policy_kind(
    document: Mapping[str, Any],
    catalog_solution: Mapping[str, Any] | None,
) -> str:
    provenance = document.get(PROVENANCE_KEY) or document.get("metricsProvenance") or {}
    stored = (provenance.get("speciesTargetPolicy") or {}).get("kind")
    if stored:
        return str(stored)
    return catalog_policy_kind(catalog_solution)


def document_exception_binding(document: Mapping[str, Any]) -> dict[str, Any] | None:
    """Return generationConfig.speciesException only when it is a real binding."""

    provenance = document.get(PROVENANCE_KEY) or document.get("metricsProvenance") or {}
    if not isinstance(provenance, Mapping):
        return None
    generation = provenance.get("generationConfig")
    if not isinstance(generation, Mapping):
        return None
    stored = generation.get("speciesException")
    if isinstance(stored, Mapping) and stored:
        return dict(stored)
    return None


def assert_regular_cache_dirs(*paths: Path) -> None:
    for path in paths:
        if path_looks_like_sirap_batch(path):
            raise ValueError(f"Refusing SIRAP retained-batch path: {path}")


def select_untargeted_land_ids(
    discovered_ids: Sequence[str],
    catalog_by_id: Mapping[str, Mapping[str, Any]],
) -> list[str]:
    selected: list[str] = []
    for solution_id in discovered_ids:
        if is_species_targeted_id(solution_id):
            continue
        catalog_solution = catalog_by_id.get(solution_id)
        if catalog_solution is None:
            raise ValueError(f"Catalog is missing {solution_id}.")
        if catalog_solution.get("domain") == "marine":
            continue
        if catalog_policy_kind(catalog_solution) != "dual_reference":
            raise ValueError(
                f"{solution_id} is untargeted by name but catalog policy is not "
                "dual_reference."
            )
        selected.append(solution_id)
    assert_untargeted_land_selection(selected, catalog_by_id)
    return selected


def assert_untargeted_land_selection(
    solution_ids: Sequence[str],
    catalog_by_id: Mapping[str, Mapping[str, Any]],
) -> None:
    if GOLD_ID in solution_ids:
        raise ValueError(f"Refusing to mutate gold solution {GOLD_ID}.")
    if len(solution_ids) != EXPECTED_UNTARGETED_LAND_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_UNTARGETED_LAND_COUNT} untargeted land solutions, "
            f"found {len(solution_ids)}."
        )
    seen: set[str] = set()
    for solution_id in solution_ids:
        if solution_id in seen:
            raise ValueError(f"Duplicate untargeted solution {solution_id}.")
        seen.add(solution_id)
        if is_species_targeted_id(solution_id):
            raise ValueError(f"Refusing species-targeted solution {solution_id}.")
        catalog_solution = catalog_by_id.get(solution_id)
        if catalog_solution is None:
            raise ValueError(f"Catalog is missing {solution_id}.")
        if catalog_solution.get("domain") == "marine":
            raise ValueError(f"Refusing marine solution {solution_id}.")
        kind = catalog_policy_kind(catalog_solution)
        if kind != "dual_reference":
            raise ValueError(
                f"Refusing {solution_id}: catalog policy is {kind!r}, not dual_reference."
            )


def _threatened_indexes(catalog_rows: Sequence[Sequence[Any]]) -> set[int]:
    return {
        index
        for index, row in enumerate(catalog_rows)
        if isinstance(row, Sequence) and len(row) > _IUCN_IDX and row[_IUCN_IDX] in {"CR", "EN", "VU"}
    }


def _count_threatened_by_scope(
    partition: Mapping[str, Any],
    threatened_indexes: set[int],
) -> dict[int, dict[str, int]]:
    counts: dict[int, dict[str, int]] = defaultdict(
        lambda: {
            "threatened_present": 0,
            "threatened_secured": 0,
            "threatened_17": 0,
            "threatened_30": 0,
        }
    )
    for row in partition.get("rows") or []:
        if not isinstance(row, Sequence) or len(row) <= _FLAGS_IDX:
            continue
        covered = row[_COVERED_IDX]
        if not isinstance(covered, (int, float)) or isinstance(covered, bool) or covered <= 0:
            continue
        species_index = row[_SPECIES_IDX]
        if species_index not in threatened_indexes:
            continue
        scope_index = row[_SCOPE_IDX]
        if isinstance(scope_index, bool) or not isinstance(scope_index, int):
            continue
        bucket = counts[scope_index]
        bucket["threatened_present"] += 1
        flags = row[_FLAGS_IDX]
        if isinstance(flags, int):
            if flags & FLAG_CONFIGURED_TARGET_MET:
                bucket["threatened_secured"] += 1
            if flags & FLAG_MET_17:
                bucket["threatened_17"] += 1
            if flags & FLAG_MET_30:
                bucket["threatened_30"] += 1
    return counts


def _catalog_records(
    catalog_rows: Sequence[Sequence[Any]],
) -> tuple[list[SpeciesRecord], list[SpeciesRecord]]:
    all_records: list[SpeciesRecord] = []
    available_records: list[SpeciesRecord] = []
    for row in catalog_rows:
        if not isinstance(row, Sequence) or len(row) <= _AVAILABILITY_IDX:
            continue
        record = SpeciesRecord(
            scientific_name=str(row[CATALOG_ROW_LAYOUT.index("scientificName")]),
            csv_class="",
            iucn_status=str(row[_IUCN_IDX] or ""),
            range_km2=(
                float(row[_NATIONAL_RANGE_IDX])
                if isinstance(row[_NATIONAL_RANGE_IDX], (int, float))
                and not isinstance(row[_NATIONAL_RANGE_IDX], bool)
                else None
            ),
            bucket=str(row[_GROUP_IDX]) if row[_GROUP_IDX] in CLASS_BUCKETS else None,
            threatened=row[_IUCN_IDX] in {"CR", "EN", "VU"},
        )
        all_records.append(record)
        if row[_AVAILABILITY_IDX] == "available":
            available_records.append(record)
    return all_records, available_records


def _empty_species_counts() -> dict[str, Any]:
    return {
        "presentByBucket": {bucket: 0 for bucket in CLASS_BUCKETS},
        "coverageByBucket": {
            bucket: {"met": 0, "total": 0, "byStatus": {}}
            for bucket in CLASS_BUCKETS
        },
        "referenceByThreshold": {
            threshold: {
                bucket: {"met": 0, "total": 0, "byStatus": {}}
                for bucket in CLASS_BUCKETS
            }
            for threshold in REFERENCE_THRESHOLDS
        },
        "allPresent": 0,
        "threatenedPresent": 0,
        "threatenedSecured": 0,
        "threatenedReference": {threshold: 0 for threshold in REFERENCE_THRESHOLDS},
    }


def _record_coverage(
    bucket_counts: dict[str, Any],
    *,
    met: bool,
    iucn_status: str,
) -> None:
    bucket_counts["total"] += 1
    if met:
        bucket_counts["met"] += 1
    status = iucn_status if iucn_status in {"CR", "EN", "VU", "NT", "LC", "DD"} else (
        "other" if iucn_status else "unknown"
    )
    status_counts = bucket_counts["byStatus"].setdefault(
        status, {"met": 0, "total": 0}
    )
    status_counts["total"] += 1
    if met:
        status_counts["met"] += 1


def _count_all_species_by_scope(
    partition: Mapping[str, Any],
    catalog_rows: Sequence[Sequence[Any]],
) -> dict[int, dict[str, Any]]:
    counts: dict[int, dict[str, Any]] = defaultdict(_empty_species_counts)
    for row in partition.get("rows") or []:
        if not isinstance(row, Sequence) or len(row) <= _FLAGS_IDX:
            continue
        scope_index = row[_SCOPE_IDX]
        species_index = row[_SPECIES_IDX]
        if (
            isinstance(scope_index, bool)
            or not isinstance(scope_index, int)
            or isinstance(species_index, bool)
            or not isinstance(species_index, int)
            or not 0 <= species_index < len(catalog_rows)
        ):
            continue
        catalog_row = catalog_rows[species_index]
        bucket = catalog_row[_GROUP_IDX]
        iucn_status = str(catalog_row[_IUCN_IDX] or "")
        flags = row[_FLAGS_IDX] if isinstance(row[_FLAGS_IDX], int) else 0
        range_area = row[_RANGE_IDX]
        covered = row[_COVERED_IDX]
        if (
            not isinstance(range_area, (int, float))
            or isinstance(range_area, bool)
            or range_area <= 0
        ):
            continue
        scope_counts = counts[scope_index]
        if bucket in CLASS_BUCKETS and flags & FLAG_TARGET_CONFIGURED:
            _record_coverage(
                scope_counts["coverageByBucket"][bucket],
                met=bool(flags & FLAG_CONFIGURED_TARGET_MET),
                iucn_status=iucn_status,
            )
        if bucket in CLASS_BUCKETS:
            for threshold, flag in (
                (REFERENCE_THRESHOLDS[0], FLAG_MET_17),
                (REFERENCE_THRESHOLDS[1], FLAG_MET_30),
            ):
                _record_coverage(
                    scope_counts["referenceByThreshold"][threshold][bucket],
                    met=bool(flags & flag),
                    iucn_status=iucn_status,
                )
        if (
            not isinstance(covered, (int, float))
            or isinstance(covered, bool)
            or covered <= 0
        ):
            continue
        scope_counts["allPresent"] += 1
        if bucket in CLASS_BUCKETS:
            scope_counts["presentByBucket"][bucket] += 1
        if iucn_status in {"CR", "EN", "VU"}:
            scope_counts["threatenedPresent"] += 1
            if flags & FLAG_CONFIGURED_TARGET_MET:
                scope_counts["threatenedSecured"] += 1
            if flags & FLAG_MET_17:
                scope_counts["threatenedReference"][REFERENCE_THRESHOLDS[0]] += 1
            if flags & FLAG_MET_30:
                scope_counts["threatenedReference"][REFERENCE_THRESHOLDS[1]] += 1
    return counts


def _coverage_details(by_bucket: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    groups: dict[str, Any] = {}
    total_met = 0
    total_species = 0
    status_order = ("CR", "EN", "VU", "NT", "LC", "DD", "other", "unknown")
    for bucket in CLASS_BUCKETS:
        count = by_bucket[bucket]
        if not count["total"]:
            continue
        total_met += count["met"]
        total_species += count["total"]
        groups[bucket] = {
            "label": BUCKET_LABELS[bucket],
            "metSpeciesCount": count["met"],
            "totalSpeciesCount": count["total"],
            "iucnStatusBreakdown": {
                status: {
                    "metSpeciesCount": count["byStatus"][status]["met"],
                    "totalSpeciesCount": count["byStatus"][status]["total"],
                }
                for status in status_order
                if status in count["byStatus"]
            },
        }
    return {
        "summary": {
            "metSpeciesCount": total_met,
            "totalSpeciesCount": total_species,
        },
        "groups": groups,
    }


def _apply_exception(
    row: dict[str, Any],
    exception_binding: Mapping[str, Any] | None,
) -> dict[str, Any]:
    if exception_binding is None or row.get("status") not in {"ready", "partial"}:
        return row
    updated = dict(row)
    updated["status"] = "partial"
    updated["notes"] = (
        f"{updated.get('notes') or ''} Partial: {exception_binding['excluded']} "
        "approved unavailable species sources were excluded."
    ).strip()
    updated["details"] = {
        **(updated.get("details") or {}),
        "speciesException": dict(exception_binding),
    }
    return updated


def _all_species_rows(
    *,
    domain: str,
    empty_scope: bool,
    counts: Mapping[str, Any] | None,
    policy_kind: str,
    exception_binding: Mapping[str, Any] | None,
    available_species_count: int,
) -> list[dict[str, Any]]:
    definitions = {definition.metric_id: definition for definition in computable_metrics()}
    if domain == "marine":
        return [
            not_applicable(
                definitions[metric_id],
                notes="Metric does not apply to the 'marine' solution domain (supported: land).",
            )
            for metric_id in species_metric_ids()
        ]
    if empty_scope:
        return [empty_boundary(definitions[metric_id]) for metric_id in species_metric_ids()]
    if counts is None:
        raise ValueError("Species-goals compact sidecar is missing for a non-empty land scope.")

    rows: dict[str, dict[str, Any]] = {}
    configured_details = _coverage_details(counts["coverageByBucket"])
    if policy_kind == "dual_reference":
        outcomes = []
        for threshold in REFERENCE_THRESHOLDS:
            details = _coverage_details(counts["referenceByThreshold"][threshold])
            outcomes.append(
                {
                    "targetPercent": threshold,
                    "value": details["summary"]["metSpeciesCount"],
                    "details": details,
                }
            )
        rows["species_groups_protected"] = metric_value(
            definitions["species_groups_protected"],
            value=None,
            status="partial",
            notes="No species optimization target was configured; reporting 17% and 30% reference-threshold outcomes.",
            source=TARGET_POLICY_SOURCE,
            details={"thresholdOutcomes": outcomes},
        )
    else:
        met_count = configured_details["summary"]["metSpeciesCount"]
        total_count = configured_details["summary"]["totalSpeciesCount"]
        rows["species_groups_protected"] = metric_value(
            definitions["species_groups_protected"],
            value=met_count,
            status="ready",
            notes=f"{met_count:,} of {total_count:,} modeled species with configured targets meet their target.",
            source="csv:biomod_spp_ranges_updatedIUCN+species-goals",
            details=configured_details,
        )

    for bucket, metric_id in _RICHNESS_METRIC_BY_BUCKET.items():
        rows[metric_id] = metric_value(
            definitions[metric_id],
            value=counts["presentByBucket"][bucket],
            status="ready",
            notes=f"Species count with positive solution-covered range area in this scope (bucket: {bucket}).",
            source="csv:biomod_spp_ranges_updatedIUCN+species-goals",
        )
    rows[COUNT_METRIC_ID] = metric_value(
        definitions[COUNT_METRIC_ID],
        value=counts["threatenedPresent"],
        status="ready",
        notes="CR/EN/VU non-fish species with positive solution-covered range area in this scope.",
        source=THREATENED_SOURCE,
    )
    if policy_kind == "dual_reference":
        rows[SECURED_METRIC_ID] = metric_value(
            definitions[SECURED_METRIC_ID],
            value=None,
            status="partial",
            notes="No species optimization target was configured; reporting 17% and 30% reference-threshold outcomes.",
            source=TARGET_POLICY_SOURCE,
            details={
                "thresholdOutcomes": [
                    {
                        "targetPercent": threshold,
                        "value": counts["threatenedReference"][threshold],
                    }
                    for threshold in REFERENCE_THRESHOLDS
                ]
            },
        )
    else:
        rows[SECURED_METRIC_ID] = metric_value(
            definitions[SECURED_METRIC_ID],
            value=counts["threatenedSecured"],
            status="ready",
            notes="Threatened species whose configured target is met in this scope.",
            source=THREATENED_SOURCE,
        )
    rows[ENDEMIC_METRIC_ID] = _endemic_row(
        domain=domain,
        empty_scope=False,
        count=counts["endemicPresent"],
    )
    pct = (
        counts["allPresent"] / available_species_count * 100.0
        if available_species_count
        else 0.0
    )
    rows["species_pct_of_national"] = metric_value(
        definitions["species_pct_of_national"],
        value=pct,
        status="ready",
        notes="Non-fish species present in scope divided by the available national species pool × 100.",
        source="csv:biomod_spp_ranges_updatedIUCN+species-goals",
    )
    return [
        _apply_exception(rows[metric_id], exception_binding)
        for metric_id in species_metric_ids()
    ]


def _contract_details(
    exception_binding: Mapping[str, Any] | None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    details = dict(extra) if extra else {}
    if isinstance(exception_binding, Mapping) and exception_binding:
        details["speciesException"] = dict(exception_binding)
    return details or None


def _threatened_rows(
    *,
    domain: str,
    empty_scope: bool,
    counts: dict[str, int] | None,
    policy_kind: str,
    exception_binding: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    count_def = _metric_def(COUNT_METRIC_ID)
    secured_def = _metric_def(SECURED_METRIC_ID)
    if domain == "marine":
        return [
            not_applicable(
                count_def,
                notes="Metric does not apply to the 'marine' solution domain (supported: land).",
            ),
            not_applicable(
                secured_def,
                notes="Metric does not apply to the 'marine' solution domain (supported: land).",
            ),
        ]
    if empty_scope:
        return [empty_boundary(count_def), empty_boundary(secured_def)]
    if counts is None:
        notes = "Species-goals compact sidecar is missing for this land scope."
        return [
            metric_value(
                count_def,
                value=None,
                status="blocked",
                notes=notes,
                source=THREATENED_SOURCE,
            ),
            metric_value(
                secured_def,
                value=None,
                status="blocked",
                notes=notes,
                source=THREATENED_SOURCE,
            ),
        ]
    count_row = metric_value(
        count_def,
        value=counts["threatened_present"],
        status="ready",
        notes=(
            "Count of CR/EN/VU non-fish species whose Calculator A "
            "solution-covered range area is > 0 in this scope."
        ),
        source=THREATENED_SOURCE,
        details=_contract_details(exception_binding),
    )
    if policy_kind == "dual_reference":
        secured_row = metric_value(
            secured_def,
            value=None,
            status="partial",
            notes=(
                "No species optimization target was configured; reporting "
                "17% and 30% reference-threshold outcomes."
            ),
            source=TARGET_POLICY_SOURCE,
            details=_contract_details(
                exception_binding,
                {
                    "thresholdOutcomes": [
                        {
                            "targetPercent": REFERENCE_THRESHOLDS[0],
                            "value": counts["threatened_17"],
                        },
                        {
                            "targetPercent": REFERENCE_THRESHOLDS[1],
                            "value": counts["threatened_30"],
                        },
                    ]
                },
            ),
        )
    else:
        secured_row = metric_value(
            secured_def,
            value=counts["threatened_secured"],
            status="ready",
            notes=(
                "Count of threatened species whose Calculator A configured "
                "target is met in this scope."
            ),
            source=THREATENED_SOURCE,
            details=_contract_details(exception_binding),
        )
    return [count_row, secured_row]


def _endemic_row(
    *,
    domain: str,
    empty_scope: bool,
    count: int | None,
) -> dict[str, Any]:
    definition = endemic_definition()
    if domain == "marine":
        return not_applicable(definition, notes=MARINE_NOTES)
    if empty_scope:
        return empty_boundary(definition)
    if count is None:
        return {
            "metricId": definition.metric_id,
            "value": None,
            "unit": definition.unit,
            "status": "blocked",
            "source": ENDEMIC_SOURCE,
            "notes": MISSING_GOALS_NOTES,
            "labelKey": definition.label_key,
            "formatHint": definition.format_hint,
        }
    return {
        "metricId": definition.metric_id,
        "value": count,
        "unit": definition.unit,
        "status": "ready",
        "source": ENDEMIC_SOURCE,
        "notes": READY_NOTES,
        "labelKey": definition.label_key,
        "formatHint": definition.format_hint,
    }


def _load_level_counts(
    *,
    species_goals_root: Path,
    solution_id: str,
    level: str,
    scientific_names: Mapping[int, str],
    endemic_by_name: Mapping[str, bool],
    threatened_indexes: set[int],
    catalog_rows: Sequence[Sequence[Any]] | None = None,
) -> tuple[
    dict[str, int],
    dict[int, int],
    dict[int, dict[str, int]],
    dict[int, dict[str, Any]],
] | None:
    path = resolve_partition_path(species_goals_root, solution_id, level)
    if path is None:
        return None
    partition = json.loads(path.read_text(encoding="utf-8"))
    scope_ids: dict[str, int] = {}
    for index, entry in enumerate(partition.get("scopeCatalog") or []):
        if isinstance(entry, Sequence) and entry:
            scope_ids[str(entry[0])] = index
    endemic_counts = count_endemic_species_by_scope(
        partition.get("rows") or [],
        scientific_name_by_index=scientific_names,
        endemic_by_name=endemic_by_name,
    )
    threatened_counts = _count_threatened_by_scope(partition, threatened_indexes)
    all_species_counts = (
        _count_all_species_by_scope(partition, catalog_rows)
        if catalog_rows is not None
        else {}
    )
    for scope_index, scope_counts in all_species_counts.items():
        scope_counts["endemicPresent"] = endemic_counts.get(scope_index, 0)
    del partition
    return scope_ids, endemic_counts, threatened_counts, all_species_counts


def _should_write_metric(metric_id: str, metric_ids: set[str] | None) -> bool:
    return metric_ids is None or metric_id in metric_ids


def stamp_document(
    document: dict[str, Any],
    *,
    species_goals_root: Path,
    scientific_names: Mapping[int, str],
    endemic_by_name: Mapping[str, bool],
    threatened_indexes: set[int],
    release_id: str,
    catalog_solution: Mapping[str, Any] | None = None,
    metric_ids: set[str] | None = None,
    exception_binding: Mapping[str, Any] | None = None,
    catalog_rows: Sequence[Sequence[Any]] | None = None,
    available_species_count: int | None = None,
    policy_provenance: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    updated = deepcopy(document)
    geographies = updated.get("geographies")
    if not isinstance(geographies, dict):
        raise ValueError("Document is missing geographies.")
    provenance = updated.get(PROVENANCE_KEY) or {}
    domain = "marine" if provenance.get("solutionDomain") == "marine" else "land"
    solution_id = str(updated.get("solutionId") or "")
    if domain == "marine" and metric_ids == {SECURED_METRIC_ID}:
        raise ValueError(f"Refusing incremental secured restamp of marine {solution_id}.")
    if is_species_targeted_id(solution_id) and metric_ids == {SECURED_METRIC_ID}:
        raise ValueError(
            f"Refusing incremental secured restamp of species-targeted {solution_id}."
        )
    policy_kind = resolve_policy_kind(updated, catalog_solution)
    if metric_ids == {SECURED_METRIC_ID} and policy_kind != "dual_reference":
        raise ValueError(
            f"Refusing incremental secured restamp of {solution_id}: policy is "
            f"{policy_kind!r}, not dual_reference."
        )
    stored_exception = document_exception_binding(updated)
    if exception_binding and stored_exception is None:
        details_exception = None
    elif exception_binding and stored_exception != dict(exception_binding):
        raise ValueError(
            "speciesException binding does not match generationConfig.speciesException."
        )
    else:
        details_exception = stored_exception
    level_cache: dict[
        str,
        tuple[
            dict[str, int],
            dict[int, int],
            dict[int, dict[str, int]],
            dict[int, dict[str, Any]],
        ]
        | None,
    ] = {}
    zero_threatened = {
        "threatened_present": 0,
        "threatened_secured": 0,
        "threatened_17": 0,
        "threatened_30": 0,
    }

    for level, scopes in geographies.items():
        if not isinstance(scopes, dict):
            continue
        lookup_level = species_goals_level(str(level))
        if lookup_level not in level_cache:
            level_cache[lookup_level] = (
                None
                if domain == "marine"
                else _load_level_counts(
                    species_goals_root=species_goals_root,
                    solution_id=solution_id,
                    level=lookup_level,
                    scientific_names=scientific_names,
                    endemic_by_name=endemic_by_name,
                    threatened_indexes=threatened_indexes,
                    catalog_rows=catalog_rows,
                )
            )
        indexed = level_cache[lookup_level]
        for scope_id, scope in scopes.items():
            if not isinstance(scope, dict):
                continue
            metrics = scope.get("metrics")
            if not isinstance(metrics, list):
                raise ValueError(f"{level}/{scope_id} is missing a metrics array.")
            endemic_count = None
            threatened_counts = None
            all_species_counts = None
            if domain == "land" and indexed is not None:
                (
                    scope_ids,
                    endemic_by_index,
                    threatened_by_index,
                    all_species_by_index,
                ) = indexed
                scope_index = scope_ids.get(str(scope_id))
                if scope_index is not None:
                    endemic_count = endemic_by_index.get(scope_index, 0)
                    threatened_counts = threatened_by_index.get(
                        scope_index, zero_threatened
                    )
                    all_species_counts = all_species_by_index.get(
                        scope_index, _empty_species_counts()
                    )
                    all_species_counts["endemicPresent"] = endemic_count
            if metric_ids == set(species_metric_ids()):
                for row in _all_species_rows(
                    domain=domain,
                    empty_scope=scope_is_empty(scope),
                    counts=all_species_counts,
                    policy_kind=policy_kind,
                    exception_binding=details_exception,
                    available_species_count=available_species_count or 0,
                ):
                    metrics = upsert_metric_in_catalog_order(metrics, row)
                scope["metrics"] = metrics
                continue
            if _should_write_metric(ENDEMIC_METRIC_ID, metric_ids):
                metrics = upsert_metric_in_catalog_order(
                    metrics,
                    _endemic_row(
                        domain=domain,
                        empty_scope=scope_is_empty(scope),
                        count=endemic_count,
                    ),
                )
            for row in _threatened_rows(
                domain=domain,
                empty_scope=scope_is_empty(scope),
                counts=threatened_counts,
                policy_kind=policy_kind,
                exception_binding=details_exception,
            ):
                if _should_write_metric(str(row.get("metricId") or ""), metric_ids):
                    metrics = upsert_metric_in_catalog_order(metrics, row)
            scope["metrics"] = metrics
    if policy_provenance is not None:
        updated[PROVENANCE_KEY]["speciesTargetPolicy"] = dict(policy_provenance)
    elif policy_kind in {"scalar", "marine"}:
        updated[PROVENANCE_KEY].pop("speciesTargetPolicy", None)
    if metric_ids == set(species_metric_ids()):
        generation = updated[PROVENANCE_KEY].get("generationConfig")
        if not isinstance(generation, dict):
            raise ValueError("Document is missing generationConfig.")
        generation["speciesSkipped"] = False
        generation["speciesBoundaryLevelsSkipped"] = []
    return restamp_document(updated, release_id=release_id)


def _national_values(document: Mapping[str, Any]) -> dict[str, Any]:
    national = ((document.get("geographies") or {}).get("national") or {}).get(
        "colombia"
    ) or {}
    wanted = {
        ENDEMIC_METRIC_ID,
        COUNT_METRIC_ID,
        SECURED_METRIC_ID,
        "land_use_forests_and_semi_natural_areas_pct",
        "land_use_artificial_surfaces_pct",
        "species_groups_protected",
    }
    values: dict[str, Any] = {}
    for row in national.get("metrics") or []:
        metric_id = row.get("metricId")
        if metric_id in wanted:
            values[metric_id] = {"value": row.get("value"), "status": row.get("status")}
    return values


def iter_secured_metrics(document: Mapping[str, Any]):
    geographies = document.get("geographies") or {}
    if not isinstance(geographies, Mapping):
        return
    for level, scopes in geographies.items():
        if not isinstance(scopes, Mapping):
            continue
        for scope_id, scope in scopes.items():
            if not isinstance(scope, Mapping):
                continue
            for row in scope.get("metrics") or []:
                if isinstance(row, Mapping) and row.get("metricId") == SECURED_METRIC_ID:
                    yield str(level), str(scope_id), row


def validate_dual_reference_secured(document: Mapping[str, Any]) -> list[str]:
    issues: list[str] = []
    found = False
    expected_exception = document_exception_binding(document)
    for level, scope_id, row in iter_secured_metrics(document):
        found = True
        status = row.get("status")
        if status == "empty":
            continue
        details = row.get("details") if isinstance(row.get("details"), Mapping) else {}
        outcomes = details.get("thresholdOutcomes")
        percents = (
            [item.get("targetPercent") for item in outcomes]
            if isinstance(outcomes, list)
            else None
        )
        observed_exception = details.get("speciesException")
        if (
            status != "partial"
            or row.get("value") is not None
            or row.get("source") != TARGET_POLICY_SOURCE
            or percents != [REFERENCE_THRESHOLDS[0], REFERENCE_THRESHOLDS[1]]
            or any(
                "thresholdPercent" in item for item in outcomes if isinstance(item, Mapping)
            )
            or observed_exception != expected_exception
        ):
            issues.append(f"{level}/{scope_id} failed dual-reference secured contract")
    if not found:
        issues.append("threatened_species_secured is missing")
    return issues


def validate_all_species_metrics(document: Mapping[str, Any]) -> list[str]:
    expected = set(species_metric_ids())
    domain = (
        "marine"
        if (document.get(PROVENANCE_KEY) or {}).get("solutionDomain") == "marine"
        else "land"
    )
    issues: list[str] = []
    for level, scopes in (document.get("geographies") or {}).items():
        if not isinstance(scopes, Mapping):
            continue
        for scope_id, scope in scopes.items():
            if not isinstance(scope, Mapping):
                continue
            rows = [
                row
                for row in scope.get("metrics") or []
                if isinstance(row, Mapping) and row.get("metricId") in expected
            ]
            observed = [str(row["metricId"]) for row in rows]
            if set(observed) != expected or len(observed) != len(expected):
                issues.append(
                    f"{level}/{scope_id} species ids differ from species_metric_ids()"
                )
                continue
            empty = scope_is_empty(scope)
            for row in rows:
                status = row.get("status")
                expected_statuses = (
                    {"not_applicable"}
                    if domain == "marine"
                    else {"empty"}
                    if empty
                    else {"ready", "partial"}
                )
                if status not in expected_statuses:
                    issues.append(
                        f"{level}/{scope_id}/{row['metricId']} has status {status!r}"
                    )
    return issues


def is_completed_species_reconciliation(document: Mapping[str, Any]) -> bool:
    provenance = document.get(PROVENANCE_KEY)
    generation = provenance.get("generationConfig") if isinstance(provenance, Mapping) else None
    completeness = document.get("speciesCompleteness")
    return (
        not validate_all_species_metrics(document)
        and isinstance(generation, Mapping)
        and generation.get("speciesSkipped") is False
        and generation.get("speciesBoundaryLevelsSkipped") == []
        and isinstance(completeness, Mapping)
        and completeness.get("complete") is True
        and completeness.get("missing") == 0
    )


def mark_species_complete(
    document: dict[str, Any],
    *,
    catalog_total: int,
    available_expected: int,
    exception_binding: Mapping[str, Any] | None,
) -> None:
    excluded = catalog_total - available_expected
    completeness = {
        "catalogTotal": catalog_total,
        "availableExpected": available_expected,
        "excluded": excluded,
        "expected": available_expected,
        "aligned": available_expected,
        "processed": available_expected,
        "missing": 0,
        "missingUnexpected": 0,
        "exception": dict(exception_binding) if exception_binding else None,
        "complete": True,
    }
    document["speciesCompleteness"] = completeness
    document[PROVENANCE_KEY]["speciesCompleteness"] = deepcopy(completeness)


def _document_is_national_only(document: Mapping[str, Any]) -> bool:
    return set((document.get("geographies") or {}).keys()) == {"national"}


def _discover_solution_files(compact_dir: Path, verbose_dir: Path) -> dict[str, dict[str, Path]]:
    grouped: dict[str, dict[str, Path]] = defaultdict(dict)
    for directory, kind, suffix in (
        (compact_dir, "compact", COMPACT_CACHE_SUFFIX),
        (verbose_dir, "verbose", CACHE_SUFFIX),
    ):
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob(f"*{suffix}")):
            grouped[solution_stem(path)][kind] = path
    return grouped


def _output_path(source: Path, source_dir: Path, output_dir: Path) -> Path:
    return output_dir / source.relative_to(source_dir)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Off-pipeline backfill: restamp threatened-species metrics (default "
            "metric #3 on untargeted land) or reconcile all species metrics "
            "from completed species-goals sidecars without rerunning main.py."
        )
    )
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--compact-dir", type=Path, required=True)
    parser.add_argument("--verbose-dir", type=Path, required=True)
    parser.add_argument(
        "--runtime-manifest",
        type=Path,
        default=None,
        help="Runtime catalog with finderInputs.structuredTargets.",
    )
    parser.add_argument("--output-compact-dir", type=Path, default=None)
    parser.add_argument("--output-verbose-dir", type=Path, default=None)
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite --compact-dir/--verbose-dir. Off by default.",
    )
    parser.add_argument(
        "--all-regular-solutions",
        action="store_true",
        help="Opt in to stamping every regular solution. Default is the 24 untargeted land ids.",
    )
    parser.add_argument(
        "--stamp-all-species-metrics",
        action="store_true",
        help="Also rewrite endemic_species_count and threatened_species_count.",
    )
    parser.add_argument(
        "--reconcile-all-species",
        action="store_true",
        help="Reconcile and validate every species metric for every regular solution.",
    )
    parser.add_argument("--release-id", default="catalog-v3-7-0")
    return parser.parse_args(argv)


def _resolve(repo_root: Path, path: Path) -> Path:
    return path if path.is_absolute() else repo_root / path


def run_backfill(args: argparse.Namespace, *, repo_root: Path | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    root = repo_root or find_repo_root()
    release_root = _resolve(root, args.release_root)
    compact_dir = _resolve(root, args.compact_dir)
    verbose_dir = _resolve(root, args.verbose_dir)
    assert_regular_cache_dirs(compact_dir, verbose_dir)
    if args.output_compact_dir:
        assert_regular_cache_dirs(_resolve(root, args.output_compact_dir))
    if args.output_verbose_dir:
        assert_regular_cache_dirs(_resolve(root, args.output_verbose_dir))

    if args.in_place:
        output_compact_dir = compact_dir
        output_verbose_dir = verbose_dir
    else:
        if args.output_compact_dir is None or args.output_verbose_dir is None:
            raise SystemExit(
                "Refusing to overwrite the source cache; pass --in-place or both "
                "--output-compact-dir and --output-verbose-dir."
            )
        output_compact_dir = _resolve(root, args.output_compact_dir)
        output_verbose_dir = _resolve(root, args.output_verbose_dir)
        if (
            output_compact_dir.resolve() == compact_dir.resolve()
            or output_verbose_dir.resolve() == verbose_dir.resolve()
        ):
            raise SystemExit(
                "Output directories match the source cache; pass --in-place to overwrite."
            )

    runtime_manifest = _resolve(
        root, args.runtime_manifest or (release_root / DEFAULT_RUNTIME_MANIFEST)
    )
    load_solution_catalog(release_root / "solution-catalog.json")
    catalog_by_id = load_runtime_catalog_solutions(runtime_manifest)
    endemic_by_name = load_endemic_flags(DEFAULT_ENDEMIC_CSV)
    species_catalog = json.loads(
        (release_root / "species-goals/catalog/v1/catalog.json").read_text()
    )
    scientific_names = load_scientific_names(species_catalog)
    catalog_rows = species_catalog["rows"]
    threatened_indexes = _threatened_indexes(catalog_rows)
    reconcile_all = bool(getattr(args, "reconcile_all_species", False))
    metric_ids = (
        set(species_metric_ids())
        if reconcile_all
        else None
        if args.stamp_all_species_metrics
        else {SECURED_METRIC_ID}
    )
    catalog_records, available_records = _catalog_records(catalog_rows)

    files = _discover_solution_files(compact_dir, verbose_dir)
    if len(files) != EXPECTED_REGULAR_SOLUTION_COUNT:
        raise SystemExit(
            f"expected {EXPECTED_REGULAR_SOLUTION_COUNT} solutions to stamp, found {len(files)}"
        )

    if args.all_regular_solutions or reconcile_all:
        selected_ids = [GOLD_ID] + [sid for sid in sorted(files) if sid != GOLD_ID]
    else:
        selected_ids = select_untargeted_land_ids(sorted(files), catalog_by_id)

    gold_values = None
    written: list[str] = []
    validation_issues: list[str] = []
    outcomes: list[dict[str, Any]] = []
    for solution_id in selected_ids:
        pair = files[solution_id]
        if reconcile_all and set(pair) != {"compact", "verbose"}:
            outcomes.append(
                {
                    "solutionId": solution_id,
                    "status": "FAIL",
                    "issues": ["both compact and detailed source documents are required"],
                }
            )
            continue
        compact_destination = (
            _output_path(pair["compact"], compact_dir, output_compact_dir)
            if "compact" in pair
            else None
        )
        verbose_destination = (
            _output_path(pair["verbose"], verbose_dir, output_verbose_dir)
            if "verbose" in pair
            else None
        )
        if (
            reconcile_all
            and compact_destination is not None
            and verbose_destination is not None
            and compact_destination.is_file()
            and verbose_destination.is_file()
        ):
            compact_output, _ = load_metric_document(compact_destination)
            verbose_output, _ = load_metric_document(verbose_destination)
            if (
                compact_output.get("solutionId") == solution_id
                and verbose_output.get("solutionId") == solution_id
                and is_completed_species_reconciliation(compact_output)
                and is_completed_species_reconciliation(verbose_output)
            ):
                outcomes.append(
                    {
                        "solutionId": solution_id,
                        "status": "PASS",
                        "issues": [],
                        "resumed": True,
                    }
                )
                print(f"[species-reconciliation] SKIP {solution_id}", flush=True)
                continue
        source_path = pair.get("compact") or pair.get("verbose")
        if source_path is None:
            raise SystemExit(f"{solution_id} has no compact or verbose document")
        document, _was_compact = load_metric_document(source_path)
        catalog_solution = catalog_by_id.get(solution_id)
        try:
            policy_provenance = None
            if (
                catalog_solution is not None
                and catalog_solution.get("domain") != "marine"
            ):
                policy = resolve_species_target_policy(
                    catalog_solution,
                    catalog_records=catalog_records,
                    available_records=available_records,
                )
                policy_provenance = policy.provenance
            document = stamp_document(
                document,
                species_goals_root=release_root,
                scientific_names=scientific_names,
                endemic_by_name=endemic_by_name,
                threatened_indexes=threatened_indexes,
                release_id=args.release_id,
                catalog_solution=catalog_solution,
                metric_ids=metric_ids,
                catalog_rows=catalog_rows if reconcile_all else None,
                available_species_count=len(available_records),
                policy_provenance=policy_provenance,
            )
            if reconcile_all:
                species_issues = validate_all_species_metrics(document)
                if species_issues:
                    raise ValueError("; ".join(species_issues[:8]))
                exception_binding = document_exception_binding(document)
                mark_species_complete(
                    document,
                    catalog_total=len(catalog_records),
                    available_expected=len(available_records),
                    exception_binding=exception_binding,
                )
                domain = (
                    "marine"
                    if (document.get(PROVENANCE_KEY) or {}).get("solutionDomain")
                    == "marine"
                    else "land"
                )
                contract_issues = regular_artifact_completeness_issues(
                    document,
                    national_only=_document_is_national_only(document),
                    domain=domain,
                    skip_species=False,
                )
                if contract_issues:
                    raise ValueError("; ".join(contract_issues[:8]))
        except (KeyError, TypeError, ValueError, SpeciesTargetPolicyError) as exc:
            if not reconcile_all:
                raise
            outcomes.append(
                {
                    "solutionId": solution_id,
                    "status": "FAIL",
                    "issues": [str(exc)],
                }
            )
            continue
        if not args.all_regular_solutions and not reconcile_all:
            validation_issues.extend(
                f"{solution_id}/{issue}"
                for issue in validate_dual_reference_secured(document)
            )
            if validation_issues:
                raise SystemExit("VALIDATION ABORT: " + "; ".join(validation_issues[:8]))
        if "compact" in pair:
            assert compact_destination is not None
            dump_metric_document(compact_destination, document, compact=True)
            written.append(str(compact_destination))
        if "verbose" in pair:
            assert verbose_destination is not None
            dump_metric_document(verbose_destination, document, compact=False)
            written.append(str(verbose_destination))
        if solution_id == GOLD_ID:
            gold_values = _national_values(document)
            for metric_id, expected in EXPECTED_GOLD.items():
                observed = gold_values.get(metric_id, {}).get("value")
                if observed != expected:
                    raise SystemExit(
                        f"GOLD ABORT {metric_id}: expected {expected}, got {observed} "
                        f"({gold_values})"
                    )
            forest = gold_values.get(
                "land_use_forests_and_semi_natural_areas_pct", {}
            ).get("value")
            artificial = gold_values.get("land_use_artificial_surfaces_pct", {}).get(
                "value"
            )
            if not isinstance(forest, (int, float)) or not isinstance(
                artificial, (int, float)
            ):
                raise SystemExit(f"GOLD ABORT land-use missing: {gold_values}")
            if forest <= artificial:
                raise SystemExit(
                    f"GOLD ABORT land-use inversion: forest={forest} artificial={artificial}"
                )
        outcomes.append(
            {"solutionId": solution_id, "status": "PASS", "issues": []}
        )
        label = "species-reconciliation" if reconcile_all else "threatened-species-secured"
        print(f"[{label}] PASS {solution_id}", flush=True)

    totals = {
        status: sum(outcome["status"] == status for outcome in outcomes)
        for status in ("PASS", "WARN", "FAIL")
    }
    report = {
        "releaseId": args.release_id,
        "discoveredSolutions": len(files),
        "selectedSolutions": selected_ids,
        "selectedCount": len(selected_ids),
        "onlyUntargetedLand": not (args.all_regular_solutions or reconcile_all),
        "securedOnly": metric_ids == {SECURED_METRIC_ID},
        "reconcileAllSpecies": reconcile_all,
        "speciesMetricIds": list(species_metric_ids()),
        "inPlace": args.in_place,
        "written": written,
        "outcomes": outcomes,
        "totals": totals,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "gold": gold_values,
        "expectedGold": EXPECTED_GOLD,
    }
    return report


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    report = run_backfill(args)
    notes_dir = _resolve(find_repo_root(), args.release_root) / "_notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    out = notes_dir / (
        "reconcile-all-species-report.json"
        if args.reconcile_all_species
        else "stamp-threatened-secured-contract-2026-09-21.json"
    )
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in report if key != "written"}, indent=2))
    print(f"written {len(report['written'])} files", flush=True)
    return 1 if report["totals"]["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
