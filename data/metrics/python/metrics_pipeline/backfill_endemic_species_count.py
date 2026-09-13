"""Incremental backfill for metric #27 endemic_species_count.

Reads Colombia-endemic flags from biomod_spp_responsibilidad_national.csv
(deduped on scientific_name) and counts species-goals compact rows whose
solution-covered range area is positive. Marine documents are marked
not_applicable. Missing species-goals for a land scope fail closed.

Reuse document I/O and catalog restamp helpers from the land-use backfill.
This script does not touch rasters or CLC class mappings.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping, Sequence

from backfill_land_use_of_aoi import (
    CACHE_SUFFIX,
    discover_metric_paths,
    dump_metric_document,
    load_metric_document,
    restamp_catalog_signature,
    scope_is_empty,
    solution_stem,
)
from cli_utils import find_repo_root
from compact_metrics import COMPACT_CACHE_SUFFIX
from metric_definitions import computable_metrics
from metric_output import empty_boundary, not_applicable
from metrics_contract import PROVENANCE_KEY
from solution_domain import normalize_domain
from species_data import DEFAULT_ENDEMIC_CSV, load_endemic_flags
from species_goals import (
    CATALOG_ROW_LAYOUT,
    COMPACT_ROW_LAYOUT,
    GEOGRAPHY_LEVELS,
    catalog_path,
    compact_partition_path,
)

ENDEMIC_METRIC_ID = "endemic_species_count"
DEFAULT_OUTPUT_DIR = Path("data/metrics/generated/endemic-species-count-backfill")
ENDEMIC_SOURCE = "csv:biomod_spp_responsibilidad_national+species-goals"
READY_NOTES = (
    "Count of Colombia-endemic non-fish species with solution-covered range "
    "area > 0 in this scope. Endemic flag from biomod_spp_responsibilidad_national.csv "
    "(0/1); missing names treated as non-endemic."
)
MISSING_GOALS_NOTES = (
    "Species-goals compact sidecar is missing for this land scope; "
    "endemic_species_count cannot be computed."
)
MARINE_NOTES = (
    "Metric does not apply to the 'marine' solution domain (supported: land)."
)

_COVERED_IDX = COMPACT_ROW_LAYOUT.index("solutionCoveredAreaKm2")
_SPECIES_IDX = COMPACT_ROW_LAYOUT.index("speciesIndex")
_SCOPE_IDX = COMPACT_ROW_LAYOUT.index("scopeIndex")
_NAME_IDX = CATALOG_ROW_LAYOUT.index("scientificName")


def endemic_definition():
    return next(
        item for item in computable_metrics() if item.metric_id == ENDEMIC_METRIC_ID
    )


def _row_is_endemic_present(
    row: Sequence[Any],
    *,
    scientific_name_by_index: Mapping[int, str],
    endemic_by_name: Mapping[str, bool],
) -> bool:
    if len(row) <= _COVERED_IDX:
        return False
    covered = row[_COVERED_IDX]
    if (
        isinstance(covered, bool)
        or not isinstance(covered, (int, float))
        or covered <= 0
    ):
        return False
    name = scientific_name_by_index.get(row[_SPECIES_IDX])
    return bool(name and endemic_by_name.get(name, False))


def count_endemic_species_by_scope(
    rows: Sequence[Sequence[Any]],
    *,
    scientific_name_by_index: Mapping[int, str],
    endemic_by_name: Mapping[str, bool],
) -> dict[int, int]:
    """Count endemic species with positive covered area, grouped by scopeIndex."""

    counts: dict[int, int] = defaultdict(int)
    for row in rows:
        if not isinstance(row, Sequence) or len(row) <= _SCOPE_IDX:
            continue
        if not _row_is_endemic_present(
            row,
            scientific_name_by_index=scientific_name_by_index,
            endemic_by_name=endemic_by_name,
        ):
            continue
        scope_index = row[_SCOPE_IDX]
        if isinstance(scope_index, bool) or not isinstance(scope_index, int):
            continue
        counts[scope_index] += 1
    return counts


def count_endemic_species_present(
    rows: Sequence[Sequence[Any]],
    *,
    scientific_name_by_index: Mapping[int, str],
    endemic_by_name: Mapping[str, bool],
    scope_index: int | None = None,
) -> int:
    """Count endemic species with solutionCoveredAreaKm2 > 0 in one scope."""

    counts = count_endemic_species_by_scope(
        rows,
        scientific_name_by_index=scientific_name_by_index,
        endemic_by_name=endemic_by_name,
    )
    if scope_index is None:
        return sum(counts.values())
    return counts.get(scope_index, 0)


def upsert_metric_in_catalog_order(
    metrics: list[dict[str, Any]],
    row: dict[str, Any],
) -> list[dict[str, Any]]:
    """Replace or insert ``row`` so metric ids stay in catalog order."""

    metric_id = str(row.get("metricId") or "")
    catalog_ids = [item.metric_id for item in computable_metrics()]
    target_pos = (
        catalog_ids.index(metric_id) if metric_id in catalog_ids else len(catalog_ids)
    )
    catalog_pos = {item_id: index for index, item_id in enumerate(catalog_ids)}
    updated = [
        dict(existing)
        for existing in metrics
        if isinstance(existing, dict) and existing.get("metricId") != metric_id
    ]
    insert_at = len(updated)
    for index, existing in enumerate(updated):
        existing_id = existing.get("metricId")
        if (
            isinstance(existing_id, str)
            and existing_id in catalog_pos
            and catalog_pos[existing_id] > target_pos
        ):
            insert_at = index
            break
    updated.insert(insert_at, dict(row))
    return updated


def document_domain(document: Mapping[str, Any]) -> str:
    provenance = document.get(PROVENANCE_KEY)
    if isinstance(provenance, dict):
        return normalize_domain(provenance.get("solutionDomain"))
    return "land"


def restamp_document(
    document: dict[str, Any],
    *,
    release_id: str | None = None,
) -> dict[str, Any]:
    updated = deepcopy(document)
    if release_id:
        provenance = updated.get(PROVENANCE_KEY)
        if not isinstance(provenance, dict):
            raise ValueError("Document is missing metricsProvenance.")
        updated[PROVENANCE_KEY] = dict(provenance)
        updated[PROVENANCE_KEY]["releaseId"] = release_id
    return restamp_catalog_signature(updated)


def resolve_catalog_path(species_goals_root: Path) -> Path | None:
    candidates = (
        catalog_path(species_goals_root),
        species_goals_root / "catalog" / "v1" / "catalog.json",
    )
    for path in candidates:
        if path.is_file():
            return path
    return None


def resolve_partition_path(
    species_goals_root: Path,
    solution_id: str,
    level: str,
) -> Path | None:
    candidates: list[Path] = []
    if level in GEOGRAPHY_LEVELS:
        candidates.append(compact_partition_path(species_goals_root, solution_id, level))
    candidates.append(
        species_goals_root
        / "compact"
        / "v1"
        / solution_id
        / f"{level}.species-goals.compact.json"
    )
    for path in candidates:
        if path.is_file():
            return path
    return None


def load_scientific_names(catalog_document: Mapping[str, Any]) -> dict[int, str]:
    rows = catalog_document.get("rows")
    if not isinstance(rows, list):
        return {}
    names: dict[int, str] = {}
    for index, row in enumerate(rows):
        if not isinstance(row, Sequence) or len(row) <= _NAME_IDX:
            continue
        name = row[_NAME_IDX]
        if isinstance(name, str) and name:
            names[index] = name
    return names


def scope_catalog_index(partition: Mapping[str, Any], scope_id: str) -> int | None:
    catalog = partition.get("scopeCatalog")
    if not isinstance(catalog, list):
        return None
    for index, entry in enumerate(catalog):
        if isinstance(entry, Sequence) and entry and str(entry[0]) == scope_id:
            return index
    return None


class SpeciesGoalsIndex:
    """Lazy catalog + per-solution endemic counts. Raw partition rows are not kept."""

    def __init__(self, species_goals_root: Path) -> None:
        self.root = species_goals_root
        self._names: dict[int, str] | None = None
        self._catalog_missing = False
        self._partitions: dict[tuple[str, str], dict[str, Any] | None] = {}
        self._endemic_index: dict[
            tuple[str, str], tuple[dict[str, int], dict[int, int]] | None
        ] = {}

    def scientific_names(self) -> dict[int, str] | None:
        if self._catalog_missing:
            return None
        if self._names is not None:
            return self._names
        path = resolve_catalog_path(self.root)
        if path is None:
            self._catalog_missing = True
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            self._catalog_missing = True
            return None
        self._names = load_scientific_names(raw)
        return self._names

    def partition(self, solution_id: str, level: str) -> dict[str, Any] | None:
        key = (solution_id, level)
        if key in self._partitions:
            return self._partitions[key]
        path = resolve_partition_path(self.root, solution_id, level)
        if path is None:
            self._partitions[key] = None
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            self._partitions[key] = None
            return None
        self._partitions[key] = raw
        return raw

    def endemic_index(
        self,
        solution_id: str,
        level: str,
        endemic_by_name: Mapping[str, bool],
    ) -> tuple[dict[str, int], dict[int, int]] | None:
        """Return (scope_id → index, scope_index → endemic count), or None if missing."""

        key = (solution_id, level)
        if key in self._endemic_index:
            return self._endemic_index[key]
        names = self.scientific_names()
        path = resolve_partition_path(self.root, solution_id, level)
        if names is None or path is None:
            self._endemic_index[key] = None
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            self._endemic_index[key] = None
            return None
        catalog = raw.get("scopeCatalog")
        rows = raw.get("rows")
        if not isinstance(catalog, list) or not isinstance(rows, list):
            self._endemic_index[key] = None
            return None
        scope_ids: dict[str, int] = {}
        for index, entry in enumerate(catalog):
            if isinstance(entry, Sequence) and entry:
                scope_ids[str(entry[0])] = index
        counts = count_endemic_species_by_scope(
            rows,
            scientific_name_by_index=names,
            endemic_by_name=endemic_by_name,
        )
        result = (scope_ids, counts)
        self._endemic_index[key] = result
        return result


def endemic_row_for_scope(
    *,
    domain: str,
    empty_scope: bool,
    solution_id: str,
    level: str,
    scope_id: str,
    goals: SpeciesGoalsIndex,
    endemic_by_name: Mapping[str, bool],
) -> dict[str, Any]:
    definition = endemic_definition()
    if domain == "marine":
        return not_applicable(definition, notes=MARINE_NOTES)
    if empty_scope:
        return empty_boundary(definition)

    names = goals.scientific_names()
    indexed = goals.endemic_index(solution_id, level, endemic_by_name)
    if names is None or indexed is None:
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
    scope_ids, counts = indexed
    scope_index = scope_ids.get(scope_id)
    if scope_index is None:
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
        "value": counts.get(scope_index, 0),
        "unit": definition.unit,
        "status": "ready",
        "source": ENDEMIC_SOURCE,
        "notes": READY_NOTES,
        "labelKey": definition.label_key,
        "formatHint": definition.format_hint,
    }


def backfill_verbose_document(
    document: dict[str, Any],
    *,
    endemic_by_name: Mapping[str, bool],
    goals: SpeciesGoalsIndex,
    release_id: str | None = None,
) -> dict[str, Any]:
    updated = deepcopy(document)
    geographies = updated.get("geographies")
    if not isinstance(geographies, dict):
        raise ValueError("Document is missing geographies.")
    domain = document_domain(updated)
    solution_id = str(updated.get("solutionId") or "")
    if not solution_id:
        raise ValueError("Document is missing solutionId.")

    for level, scopes in geographies.items():
        if not isinstance(scopes, dict):
            continue
        for scope_id, scope in scopes.items():
            if not isinstance(scope, dict):
                continue
            metrics = scope.get("metrics")
            if not isinstance(metrics, list):
                raise ValueError(f"{level}/{scope_id} is missing a metrics array.")
            row = endemic_row_for_scope(
                domain=domain,
                empty_scope=scope_is_empty(scope),
                solution_id=solution_id,
                level=str(level),
                scope_id=str(scope_id),
                goals=goals,
                endemic_by_name=endemic_by_name,
            )
            scope["metrics"] = upsert_metric_in_catalog_order(metrics, row)
    return restamp_document(updated, release_id=release_id)


def _select_paths(paths: list[Path], limit: int | None) -> list[Path]:
    if limit is None:
        return paths
    selected: list[Path] = []
    seen: list[str] = []
    for path in paths:
        stem = solution_stem(path)
        if stem not in seen:
            if len(seen) >= limit:
                continue
            seen.append(stem)
        selected.append(path)
    return selected


def _verbose_counterpart(path: Path) -> Path:
    name = path.name
    if name.endswith(COMPACT_CACHE_SUFFIX):
        return path.with_name(name[: -len(COMPACT_CACHE_SUFFIX)] + CACHE_SUFFIX)
    if name.endswith(CACHE_SUFFIX):
        return path.with_name(name[: -len(CACHE_SUFFIX)] + COMPACT_CACHE_SUFFIX)
    return path.with_suffix(path.suffix + ".verbose.json")


def run_backfill(
    *,
    input_dir: Path,
    output_dir: Path,
    species_goals_root: Path,
    endemic_csv: Path,
    in_place: bool = False,
    dry_run: bool = False,
    limit: int | None = None,
    release_id: str | None = None,
    verbose_too: bool = False,
) -> dict[str, Any]:
    if in_place:
        output_dir = input_dir
    elif output_dir.resolve() == input_dir.resolve():
        raise ValueError(
            "Refusing to overwrite the source cache; pass --in-place or a new --output-dir."
        )
    if not endemic_csv.is_file():
        raise FileNotFoundError(f"Endemic CSV not found: {endemic_csv}")
    if not species_goals_root.is_dir():
        raise FileNotFoundError(f"Species-goals root does not exist: {species_goals_root}")

    paths = _select_paths(discover_metric_paths(input_dir), limit)
    if not paths:
        raise FileNotFoundError(f"No metric documents found under {input_dir}")

    endemic_by_name = load_endemic_flags(endemic_csv)
    goals = SpeciesGoalsIndex(species_goals_root)
    written: list[str] = []
    updated: dict[str, Any] = {}
    unique_stems: list[str] = []

    grouped: dict[str, list[Path]] = defaultdict(list)
    for path in paths:
        grouped[solution_stem(path)].append(path)
    unique_stems.extend(grouped)

    for stem, group_paths in grouped.items():
        for path in group_paths:
            document, compact = load_metric_document(path)
            updated = backfill_verbose_document(
                document,
                endemic_by_name=endemic_by_name,
                goals=goals,
                release_id=release_id,
            )
            relative = path.relative_to(input_dir)
            destination = path if in_place else output_dir / relative
            if dry_run:
                written.append(str(relative))
                continue
            dump_metric_document(destination, updated, compact=compact)
            written.append(str(destination))
            if verbose_too:
                counterpart = _verbose_counterpart(destination)
                dump_metric_document(counterpart, updated, compact=not compact)
                written.append(str(counterpart))
        print(f"[endemic-species-count] {stem}", flush=True)

    report = {
        "inputDir": str(input_dir),
        "outputDir": str(output_dir),
        "speciesGoalsRoot": str(species_goals_root),
        "endemicCsv": str(endemic_csv),
        "dryRun": dry_run,
        "inPlace": in_place,
        "verboseToo": verbose_too,
        "releaseId": release_id,
        "solutionFiles": len(paths),
        "uniqueSolutions": len(unique_stems),
        "endemicSpeciesInCsv": sum(1 for flag in endemic_by_name.values() if flag),
        "catalogSignature": (updated.get(PROVENANCE_KEY) or {}).get("catalogSignature"),
        "written": written,
    }
    return report


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        required=True,
        help="Source verbose/compact cache directory (or a parent that contains both).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=(
            "New output directory (default: data/metrics/generated/"
            "endemic-species-count-backfill). Never overwrites --input-dir "
            "unless --in-place is set."
        ),
    )
    parser.add_argument(
        "--species-goals-root",
        type=Path,
        required=True,
        help=(
            "Release root that contains species-goals/catalog/v1 and "
            "species-goals/compact/v1/{solutionId}/{level}.species-goals.compact.json."
        ),
    )
    parser.add_argument(
        "--endemic-csv",
        type=Path,
        default=DEFAULT_ENDEMIC_CSV,
        help=f"Endemic flag CSV (default: {DEFAULT_ENDEMIC_CSV}).",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite the source cache. Off by default.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and restamp, but do not write files.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only the first N unique solution ids (sorted).",
    )
    parser.add_argument(
        "--release-id",
        default=None,
        help="Optional provenance.releaseId restamp before catalogSignature.",
    )
    parser.add_argument(
        "--verbose-too",
        action="store_true",
        help="Also write the counterpart compact/verbose document next to each output.",
    )
    return parser.parse_args(argv)


def _resolve(repo_root: Path, path: Path) -> Path:
    return path if path.is_absolute() else repo_root / path


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    repo_root = find_repo_root()
    report = run_backfill(
        input_dir=_resolve(repo_root, args.input_dir),
        output_dir=_resolve(repo_root, args.output_dir),
        species_goals_root=_resolve(repo_root, args.species_goals_root),
        endemic_csv=_resolve(repo_root, args.endemic_csv),
        in_place=args.in_place,
        dry_run=args.dry_run,
        limit=args.limit,
        release_id=args.release_id,
        verbose_too=args.verbose_too,
    )
    print("[endemic-species-count] " + json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
