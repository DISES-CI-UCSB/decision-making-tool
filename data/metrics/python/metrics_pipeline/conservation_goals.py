"""Build solution-level conservation goal sidecars from Prioritizr summary CSVs.

The summary CSV is the canonical source for target-hit reporting. It contains
one row per conservation feature with target, held, shortfall, and met fields.
This module reshapes those rows into a JSON document that is easier for the app
to load than a large CSV while keeping the existing metrics cache lightweight.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from blob_manifest import DEFAULT_MANIFEST_URL, fetch_manifest
from cli_utils import find_repo_root, resolve_output_dir
from local_io import DEFAULT_CACHE_DIR, cached_download

GOALS_FORMAT = "conservation-goals-v1"
GOALS_SUFFIX = ".goals.json"
DEFAULT_GOALS_OUTPUT_DIR = Path("data/metrics/generated/goals")
DEFAULT_GOALS_BLOB_DIRECTORY = "metrics/goals"
DEFAULT_LOCAL_MANIFEST = Path(
    "development-artifacts/layer-manifest/staging/nick-runs-2026-05-27-compact-metrics.json"
)
PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
SPECIES_CSV_URL = (
    f"{PUBLIC_BLOB_HOST}/inputs/features/species/biomod_spp_ranges_updatedIUCN.csv"
)
THREATENED_IUCN_STATUSES = frozenset({"CR", "EN", "VU"})
EXCLUDED_SPECIES_CLASSES = frozenset({"Actinopteri"})

STRATEGIC_ECOSYSTEM_FEATURES = {
    "paramos": "Páramos",
    "bosque_seco": "Dry Forest",
    "mangroves": "Mangroves",
    "humedales": "Wetlands",
    "wetlands": "Wetlands",
}

SPECIES_GROUP_LABELS = {
    "mammals": "Mammals",
    "birds": "Birds",
    "amphibians": "Amphibians",
    "reptiles": "Reptiles",
    "plants": "Plants",
}

CLASS_TO_GROUP = {
    "mammalia": "mammals",
    "aves": "birds",
    "amphibia": "amphibians",
    "squamata": "reptiles",
    "crocodylia": "reptiles",
    "magnoliopsida": "plants",
    "magnoliospida": "plants",
}

IUCN_STATUS_ORDER = ("CR", "EN", "VU", "NT", "LC", "DD", "other", "unknown")


@dataclass
class GoalCount:
    met: int = 0
    total: int = 0

    def record(self, met: bool | None) -> None:
        self.total += 1
        if met is True:
            self.met += 1

    def as_dict(self, *, species: bool = False) -> dict[str, int | float | None]:
        if species:
            result: dict[str, int | float | None] = {
                "metSpeciesCount": self.met,
                "totalSpeciesCount": self.total,
            }
        else:
            result = {
                "metCount": self.met,
                "totalCount": self.total,
            }
        result["pctMet"] = _pct(self.met, self.total)
        return result


@dataclass(frozen=True)
class GoalSpeciesRecord:
    scientific_name: str
    csv_class: str
    iucn_status: str
    range_km2: float | None
    threatened: bool


@dataclass
class SpeciesGroupCount:
    total: GoalCount = field(default_factory=GoalCount)
    by_status: dict[str, GoalCount] = field(
        default_factory=lambda: {status: GoalCount() for status in IUCN_STATUS_ORDER}
    )

    def record(self, met: bool | None, iucn_status: str) -> None:
        self.total.record(met)
        self.by_status[_normalize_iucn_status(iucn_status)].record(met)


def build_goals_document(
    *,
    solution: dict[str, Any],
    summary_csv_path: Path,
    species_records: list[GoalSpeciesRecord],
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Convert one solution summary CSV into a frontend-friendly goals document."""

    species_lookup = {
        _normalize_species_name(record.scientific_name): record for record in species_records
    }
    summary_rows = _read_summary_rows(summary_csv_path)

    all_count = GoalCount()
    by_type: dict[str, GoalCount] = {
        "species": GoalCount(),
        "strategicEcosystems": GoalCount(),
        "ecosystems": GoalCount(),
        "other": GoalCount(),
    }
    species_group_counts = {
        group: SpeciesGroupCount() for group in SPECIES_GROUP_LABELS
    }
    species_iucn_counts = {status: GoalCount() for status in IUCN_STATUS_ORDER}
    raw_type_counts: Counter[str] = Counter()

    species_features: list[dict[str, Any]] = []
    strategic_features: list[dict[str, Any]] = []
    ecosystem_features: list[dict[str, Any]] = []
    other_features: list[dict[str, Any]] = []
    unmatched_species_count = 0
    ignored_species_row_count = 0

    for row in summary_rows:
        feature_type = _feature_type(row)
        met = _parse_bool_or_none(row.get("met"))
        raw_type_counts[_clean_text(row.get("type")) or "NA"] += 1
        all_count.record(met)
        by_type[feature_type].record(met)

        feature = _base_feature(row, feature_type=feature_type, met=met)
        if feature_type == "species":
            record = species_lookup.get(_normalize_species_name(feature["featureName"]))
            if record is None:
                unmatched_species_count += 1
                iucn_status = "unknown"
            else:
                iucn_status = _normalize_iucn_status(record.iucn_status)

            taxon_group = _taxon_group(row.get("class"))
            if taxon_group is None:
                ignored_species_row_count += 1
            else:
                species_group_counts[taxon_group].record(met, iucn_status)

            species_iucn_counts[iucn_status].record(met)
            feature.update({
                "taxonClass": _clean_text(row.get("class")) or None,
                "taxonGroup": taxon_group,
                "iucnStatus": iucn_status,
                "rangeKm2": record.range_km2 if record is not None else None,
                "threatened": record.threatened if record is not None else None,
            })
            species_features.append(feature)
        elif feature_type == "strategicEcosystems":
            feature["label"] = STRATEGIC_ECOSYSTEM_FEATURES.get(
                _normalize_feature_id(feature["featureName"]),
                feature["featureName"],
            )
            strategic_features.append(feature)
        elif feature_type == "ecosystems":
            ecosystem_features.append(feature)
        else:
            other_features.append(feature)

    generated = generated_at or _utc_now_iso()
    return {
        "format": GOALS_FORMAT,
        "solutionId": str(solution.get("id") or ""),
        "solutionName": str(solution.get("name") or solution.get("id") or ""),
        "generatedAt": generated,
        "source": {
            "summaryCsvUrl": solution.get("metadataUrl"),
            "summaryCsvRows": len(summary_rows),
            "speciesLookupUrl": SPECIES_CSV_URL,
        },
        "targetContext": _target_context(solution, summary_rows),
        "summary": {
            **all_count.as_dict(),
            "byType": {
                "species": by_type["species"].as_dict(species=True),
                "strategicEcosystems": by_type["strategicEcosystems"].as_dict(),
                "ecosystems": by_type["ecosystems"].as_dict(),
                "other": by_type["other"].as_dict(),
            },
        },
        "rollups": {
            "species": {
                **by_type["species"].as_dict(species=True),
                "byTaxa": _species_group_rollups(species_group_counts),
                "byIucnStatus": _count_rollups(species_iucn_counts, species=True),
                "unmatchedSpeciesCount": unmatched_species_count,
                "ignoredSpeciesRowCount": ignored_species_row_count,
            },
            "strategicEcosystems": by_type["strategicEcosystems"].as_dict(),
            "ecosystems": by_type["ecosystems"].as_dict(),
        },
        "features": {
            "species": species_features,
            "strategicEcosystems": strategic_features,
            "ecosystems": ecosystem_features,
            "other": other_features,
        },
        "diagnostics": {
            "rawTypeCounts": dict(sorted(raw_type_counts.items())),
            "rowCounts": {
                "species": len(species_features),
                "strategicEcosystems": len(strategic_features),
                "ecosystems": len(ecosystem_features),
                "other": len(other_features),
            },
        },
    }


def write_goals_document(output_dir: Path, solution_id: str, doc: dict[str, Any]) -> Path:
    target = goals_output_path(output_dir, solution_id)
    _write_json_atomic(target, doc)
    return target


def goals_output_path(output_dir: Path, solution_id: str) -> Path:
    return output_dir / "cache" / f"{_safe_solution_id(solution_id)}{GOALS_SUFFIX}"


def expected_goals_blob_path(
    solution_id: str,
    *,
    goals_blob_directory: str = DEFAULT_GOALS_BLOB_DIRECTORY,
) -> str:
    normalized_directory = goals_blob_directory.strip("/")
    return f"{normalized_directory}/{_safe_solution_id(solution_id)}{GOALS_SUFFIX}"


def expected_goals_public_url(
    public_blob_host: str,
    solution_id: str,
    *,
    goals_blob_directory: str = DEFAULT_GOALS_BLOB_DIRECTORY,
) -> str:
    return (
        f"{public_blob_host.rstrip('/')}/"
        f"{expected_goals_blob_path(solution_id, goals_blob_directory=goals_blob_directory)}"
    )


def _read_summary_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def _base_feature(row: dict[str, str], *, feature_type: str, met: bool | None) -> dict[str, Any]:
    feature_name = _clean_text(row.get("feature"))
    return {
        "featureId": _normalize_feature_id(feature_name),
        "featureName": feature_name,
        "featureType": feature_type,
        "met": met,
        "totalAmount": _parse_float(row.get("total_amount")),
        "absoluteTarget": _parse_float(row.get("absolute_target")),
        "absoluteHeld": _parse_float(row.get("absolute_held")),
        "absoluteShortfall": _parse_float(row.get("absolute_shortfall")),
        "relativeTarget": _parse_relative_float(row.get("relative_target")),
        "relativeHeld": _parse_relative_float(row.get("relative_held")),
        "relativeShortfall": _parse_relative_float(row.get("relative_shortfall")),
        "scenario": _clean_text(row.get("scenario") or row.get("solution") or row.get("run")) or None,
    }


def _feature_type(row: dict[str, str]) -> str:
    raw_type = _clean_text(row.get("type")).lower()
    feature_id = _normalize_feature_id(row.get("feature") or "")
    if raw_type == "species":
        return "species"
    if feature_id in STRATEGIC_ECOSYSTEM_FEATURES:
        return "strategicEcosystems"
    if raw_type == "ecosystem":
        return "ecosystems"
    return "other"


def _target_context(solution: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    finder_inputs = solution.get("finderInputs") if isinstance(solution.get("finderInputs"), dict) else {}
    targets_by_type: dict[str, list[float]] = {
        "species": [],
        "strategicEcosystems": [],
        "ecosystems": [],
        "other": [],
    }
    for row in rows:
        target = _parse_relative_float(row.get("relative_target"))
        if target is None:
            continue
        targets_by_type[_feature_type(row)].append(target)

    return {
        "finderTargetPercent": finder_inputs.get("targetPercent"),
        "targetFeatureSet": finder_inputs.get("targetFeatureSet"),
        "targetFeatureIds": finder_inputs.get("targetFeatureIds") or [],
        "relativeTargetsByType": {
            key: _unique_sorted_numbers(values)
            for key, values in targets_by_type.items()
            if values
        },
    }


def _species_group_rollups(groups: dict[str, SpeciesGroupCount]) -> dict[str, Any]:
    return {
        group: {
            "label": SPECIES_GROUP_LABELS[group],
            **count.total.as_dict(species=True),
            "iucnStatusBreakdown": _count_rollups(count.by_status, species=True),
        }
        for group, count in groups.items()
        if count.total.total > 0
    }


def _count_rollups(counts: dict[str, GoalCount], *, species: bool = False) -> dict[str, Any]:
    return {
        key: count.as_dict(species=species)
        for key, count in counts.items()
        if count.total > 0
    }


def _pct(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round((numerator / denominator) * 100.0, 4)


def _parse_bool_or_none(value: Any) -> bool | None:
    text = _clean_text(value).lower()
    if text in {"true", "1", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    return None


def _parse_float(value: Any) -> float | None:
    text = _clean_text(value)
    if not text or text.upper() == "NA":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_relative_float(value: Any) -> float | None:
    """Parse relative target/held/shortfall values as 0-1 fractions.

    Upstream CSVs usually store proportions such as 0.17. Some fixtures and
    legacy exports use percent points such as 17 for the same 17% target.
    """

    parsed = _parse_float(value)
    if parsed is None:
        return None
    if abs(parsed) > 1:
        return parsed / 100.0
    return parsed


def _taxon_group(value: Any) -> str | None:
    return CLASS_TO_GROUP.get(_clean_text(value).lower())


def _normalize_iucn_status(value: str) -> str:
    status = _clean_text(value).upper()
    if status in {"CR", "EN", "VU", "NT", "LC", "DD"}:
        return status
    if status:
        return "other"
    return "unknown"


def _normalize_species_name(value: str) -> str:
    normalized = value.replace("_", " ").strip().lower()
    return re.sub(r"\s+", " ", normalized)


def _normalize_feature_id(value: str) -> str:
    normalized = _normalize_species_name(value)
    return re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")


def _clean_text(value: Any) -> str:
    text = str(value or "").strip()
    return "" if text.upper() == "NA" else text


def _unique_sorted_numbers(values: list[float]) -> list[float]:
    return sorted({round(value, 10) for value in values})


def _safe_solution_id(solution_id: str) -> str:
    return solution_id.replace("/", "_").replace(" ", "_")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_json_atomic(target: Path, doc: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    tmp.replace(target)


def _load_manifest_from_file(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_goal_species_records(csv_path: Path) -> list[GoalSpeciesRecord]:
    """Read the species metadata needed for goal details without raster dependencies."""

    records: list[GoalSpeciesRecord] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            cls = _clean_text(row.get("class"))
            if cls in EXCLUDED_SPECIES_CLASSES:
                continue
            name = _clean_text(row.get("scientific_name"))
            if not name:
                continue
            iucn = _clean_text(row.get("iucn_status"))
            records.append(
                GoalSpeciesRecord(
                    scientific_name=name,
                    csv_class=cls,
                    iucn_status=iucn,
                    range_km2=_parse_float(row.get("range_km2")),
                    threatened=iucn in THREATENED_IUCN_STATUSES,
                )
            )
    return records


def _load_manifest_payload(args: argparse.Namespace, repo_root: Path) -> tuple[dict[str, Any], str]:
    if args.manifest_file:
        path = args.manifest_file
        if not path.is_absolute():
            path = repo_root / path
        return _load_manifest_from_file(path), str(path)
    local_manifest = repo_root / DEFAULT_LOCAL_MANIFEST
    if local_manifest.exists():
        return _load_manifest_from_file(local_manifest), str(local_manifest)
    return fetch_manifest(args.manifest_url).raw, args.manifest_url


def _summary_csv_path(url: str, cache_dir: Path, *, force: bool) -> Path:
    if url.startswith("http://") or url.startswith("https://"):
        return cached_download(url, cache_dir, force=force).path
    return Path(url)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest-file",
        type=Path,
        default=None,
        help=(
            "Local manifest JSON to read. Defaults to the Nick-runs staging manifest "
            "when present, otherwise --manifest-url."
        ),
    )
    parser.add_argument(
        "--manifest-url",
        default=DEFAULT_MANIFEST_URL,
        help=f"Manifest URL fallback (default: {DEFAULT_MANIFEST_URL}).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_GOALS_OUTPUT_DIR,
        help=f"Directory for local goals cache and report (default: {DEFAULT_GOALS_OUTPUT_DIR}).",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIR / "goals",
        help="Directory for downloaded summary CSVs and species lookup CSV.",
    )
    parser.add_argument(
        "--goals-blob-directory",
        default=DEFAULT_GOALS_BLOB_DIRECTORY,
        help=f"Future Blob prefix recorded in the report (default: {DEFAULT_GOALS_BLOB_DIRECTORY}).",
    )
    parser.add_argument(
        "--solution-id",
        action="append",
        default=None,
        help="Generate only the listed solution ids (repeatable).",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Re-download source CSVs even when cached locally.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    repo_root = find_repo_root()
    output_dir = resolve_output_dir(repo_root, args.output_dir)
    cache_dir = resolve_output_dir(repo_root, args.cache_dir)
    manifest, manifest_source = _load_manifest_payload(args, repo_root)
    public_blob_host = str(manifest.get("publicBlobHost") or "").rstrip("/")
    solution_ids = set(args.solution_id or [])

    species_csv_path = cached_download(
        SPECIES_CSV_URL,
        cache_dir,
        force=args.force_download,
    ).path
    species_records = load_goal_species_records(species_csv_path)

    entries: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for solution in manifest.get("solutions") or []:
        solution_id = str(solution.get("id") or "")
        if solution_ids and solution_id not in solution_ids:
            continue
        metadata_url = str(solution.get("metadataUrl") or "")
        if not metadata_url.endswith(".csv"):
            continue
        try:
            csv_path = _summary_csv_path(metadata_url, cache_dir, force=args.force_download)
            doc = build_goals_document(
                solution=solution,
                summary_csv_path=csv_path,
                species_records=species_records,
            )
            local_path = write_goals_document(output_dir, solution_id, doc)
            expected_blob_path = expected_goals_blob_path(
                solution_id,
                goals_blob_directory=args.goals_blob_directory,
            )
            entries.append({
                "solutionId": solution_id,
                "solutionName": solution.get("name"),
                "sourceSummaryCsvUrl": metadata_url,
                "goalsPath": str(local_path.relative_to(repo_root)),
                "expectedBlobPath": expected_blob_path,
                "expectedPublicUrl": (
                    f"{public_blob_host}/{expected_blob_path}" if public_blob_host else None
                ),
                "summary": doc["summary"],
                "rowCounts": doc["diagnostics"]["rowCounts"],
            })
            print(f"[goals] wrote {solution_id} -> {local_path}")
        except Exception as exc:  # noqa: BLE001 - generation should continue per solution.
            failures.append({"solutionId": solution_id, "error": str(exc)})
            print(f"[goals] FAILED {solution_id}: {exc}")

    report = {
        "generatedAt": _utc_now_iso(),
        "format": "conservation-goals-report-v1",
        "manifestSource": manifest_source,
        "goalsBlobDirectory": args.goals_blob_directory,
        "entries": entries,
        "failures": failures,
    }
    report_path = output_dir / "goals-publish-report.json"
    _write_json_atomic(report_path, report)
    print(f"[goals] report -> {report_path}")
    print(f"[goals] generated {len(entries)} goal sidecar(s), {len(failures)} failure(s)")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
