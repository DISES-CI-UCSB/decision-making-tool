"""Incremental backfill for threatened_species_secured on untargeted land.

Default: restamp metric #3 on the 24 untargeted land solutions only. Policy
comes from document provenance when present, otherwise from catalog
finderInputs.structuredTargets. Missing policy never defaults to scalar.

``details.speciesException`` is emitted only when the document already carries
a matching generationConfig.speciesException. Dual-reference rows keep
partial/null, targetPercent 17/30 outcomes, and
manifest:finderInputs.structuredTargets.

Reuse endemic helpers and land-use I/O. This script does not touch rasters
or republish SIRAP packets.
"""

from __future__ import annotations

import argparse
import json
import sys
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
from metric_definitions import computable_metrics
from metric_output import empty_boundary, metric_value, not_applicable
from metrics_contract import PROVENANCE_KEY
from solution_catalog import load_solution_catalog
from species_data import DEFAULT_ENDEMIC_CSV, load_endemic_flags
from species_goals import (
    CATALOG_ROW_LAYOUT,
    COMPACT_ROW_LAYOUT,
    FLAG_CONFIGURED_TARGET_MET,
    FLAG_MET_17,
    FLAG_MET_30,
)
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
) -> tuple[dict[str, int], dict[int, int], dict[int, dict[str, int]]] | None:
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
    del partition
    return scope_ids, endemic_counts, threatened_counts


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
        str, tuple[dict[str, int], dict[int, int], dict[int, dict[str, int]]] | None
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
            if domain == "land" and indexed is not None:
                scope_ids, endemic_by_index, threatened_by_index = indexed
                scope_index = scope_ids.get(str(scope_id))
                if scope_index is not None:
                    endemic_count = endemic_by_index.get(scope_index, 0)
                    threatened_counts = threatened_by_index.get(
                        scope_index, zero_threatened
                    )
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
    parser = argparse.ArgumentParser(description=__doc__)
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
    parser.add_argument("--release-id", default="catalog-v3-7-0")
    return parser.parse_args(argv)


def _resolve(repo_root: Path, path: Path) -> Path:
    return path if path.is_absolute() else repo_root / path


def run_backfill(args: argparse.Namespace, *, repo_root: Path | None = None) -> dict[str, Any]:
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
    threatened_indexes = _threatened_indexes(species_catalog["rows"])
    metric_ids = None if args.stamp_all_species_metrics else {SECURED_METRIC_ID}

    files = _discover_solution_files(compact_dir, verbose_dir)
    if len(files) != EXPECTED_REGULAR_SOLUTION_COUNT:
        raise SystemExit(
            f"expected {EXPECTED_REGULAR_SOLUTION_COUNT} solutions to stamp, found {len(files)}"
        )

    if args.all_regular_solutions:
        selected_ids = [GOLD_ID] + [sid for sid in sorted(files) if sid != GOLD_ID]
    else:
        selected_ids = select_untargeted_land_ids(sorted(files), catalog_by_id)

    gold_values = None
    written: list[str] = []
    validation_issues: list[str] = []
    for solution_id in selected_ids:
        pair = files[solution_id]
        source_path = pair.get("compact") or pair.get("verbose")
        if source_path is None:
            raise SystemExit(f"{solution_id} has no compact or verbose document")
        document, _was_compact = load_metric_document(source_path)
        document = stamp_document(
            document,
            species_goals_root=release_root,
            scientific_names=scientific_names,
            endemic_by_name=endemic_by_name,
            threatened_indexes=threatened_indexes,
            release_id=args.release_id,
            catalog_solution=catalog_by_id.get(solution_id),
            metric_ids=metric_ids,
        )
        if not args.all_regular_solutions:
            validation_issues.extend(
                f"{solution_id}/{issue}"
                for issue in validate_dual_reference_secured(document)
            )
            if validation_issues:
                raise SystemExit("VALIDATION ABORT: " + "; ".join(validation_issues[:8]))
        if "compact" in pair:
            destination = _output_path(pair["compact"], compact_dir, output_compact_dir)
            dump_metric_document(destination, document, compact=True)
            written.append(str(destination))
        if "verbose" in pair:
            destination = _output_path(pair["verbose"], verbose_dir, output_verbose_dir)
            dump_metric_document(destination, document, compact=False)
            written.append(str(destination))
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
        print(f"[threatened-species-secured] {solution_id}", flush=True)

    report = {
        "releaseId": args.release_id,
        "discoveredSolutions": len(files),
        "selectedSolutions": selected_ids,
        "selectedCount": len(selected_ids),
        "onlyUntargetedLand": not args.all_regular_solutions,
        "securedOnly": metric_ids == {SECURED_METRIC_ID},
        "inPlace": args.in_place,
        "written": written,
        "gold": gold_values,
        "expectedGold": EXPECTED_GOLD,
    }
    return report


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    report = run_backfill(args)
    notes_dir = _resolve(find_repo_root(), args.release_root) / "_notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    out = notes_dir / "stamp-threatened-secured-contract-2026-09-21.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in report if key != "written"}, indent=2))
    print(f"written {len(report['written'])} files", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
