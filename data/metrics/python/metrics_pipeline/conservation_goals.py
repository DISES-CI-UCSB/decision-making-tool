"""Build solution-level conservation goal sidecars from Prioritizr summary CSVs.

The summary CSV is the canonical source for target-hit reporting. It contains
one row per conservation feature with target, held, shortfall, and met fields.
This module reshapes those rows into a JSON document that is easier for the app
to load than a large CSV while keeping the existing metrics cache lightweight.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from blob_manifest import (
    DEFAULT_MANIFEST_URL,
    solution_blob_basename,
    fetch_manifest,
)
from cli_utils import find_repo_root, resolve_output_dir
from local_io import DEFAULT_CACHE_DIR, cached_download
from path_contracts import (
    solution_artifact_path,
    solution_blob_path,
    solution_public_url,
)
from solution_domain import SolutionDomain, is_batch_solution, solution_domain
from release_config import load_release_config
from solution_catalog import (
    SolutionCatalog,
    SolutionCatalogError,
    bind_release_output,
    catalog_binding,
    load_release_plan,
    load_solution_catalog,
    release_plan_cache_policy,
    validate_catalog_solution_ids,
)
from solution_input_signature import canonical_sha256
from species_taxonomy import BUCKET_LABELS as SPECIES_GROUP_LABELS, class_bucket, normalize_class_name
from summary_metadata import resolve_summary_csv_url

GOALS_FORMAT = "conservation-goals-v1"
GOALS_PROVENANCE_FORMAT = "conservation-goals-provenance-v1"
GOALS_SUFFIX = ".goals.json"
GENERATED_ROOT = Path("data/metrics/generated")
DEFAULT_GOALS_OUTPUT_DIR = GENERATED_ROOT / "goals"
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

#: Summary CSVs declare the feature type in ``feature_type`` (v0.2 exports) or in
#: ``type`` (earlier exports). The first column present wins.
FEATURE_TYPE_COLUMNS = ("feature_type", "type")

DECLARED_FEATURE_TYPES = {
    "species": "species",
    "ecosystem": "ecosystems",
    "strategic ecosystem": "strategicEcosystems",
}

IUCN_STATUS_ORDER = ("CR", "EN", "VU", "NT", "LC", "DD", "other", "unknown")

#: A land summary whose species rows exceed this share of unresolved taxon groups
#: is rejected rather than published with a hollowed-out taxon rollup.
MAX_UNRESOLVED_TAXON_FRACTION = 0.02


class GoalsSchemaError(ValueError):
    """Raised when a summary CSV cannot be classified under any known schema."""


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
    taxon_group: str | None
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
    summary_csv_url: str | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Convert one solution summary CSV into a frontend-friendly goals document."""

    domain = solution_domain(solution)
    resolved_summary_url = summary_csv_url or resolve_summary_csv_url(
        str(solution.get("metadataUrl") or "")
    )
    species_lookup = {
        _normalize_species_name(record.scientific_name): record for record in species_records
    }
    summary_columns, summary_rows = _read_summary_rows(summary_csv_path)
    if domain != "marine" and _feature_type_column(summary_columns) is None:
        raise GoalsSchemaError(
            f"{summary_csv_path} declares no feature type column "
            f"({' or '.join(FEATURE_TYPE_COLUMNS)}); refusing to classify "
            f"{len(summary_rows)} land rows as 'other'"
        )

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
    raw_taxon_class_counts: Counter[str] = Counter()
    unresolved_taxon_classes: Counter[str] = Counter()

    species_features: list[dict[str, Any]] = []
    strategic_features: list[dict[str, Any]] = []
    ecosystem_features: list[dict[str, Any]] = []
    other_features: list[dict[str, Any]] = []
    unmatched_species_count = 0
    ignored_species_row_count = 0

    for row in summary_rows:
        feature_type = _feature_type(row, domain)
        met = _parse_bool_or_none(row.get("met"))
        raw_type_counts[_declared_feature_type(row) or "NA"] += 1
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

            raw_taxon_class = _clean_text(row.get("class"))
            raw_taxon_class_counts[raw_taxon_class or "NA"] += 1
            taxon_class, taxon_group = _resolve_taxon(record, raw_taxon_class)
            if taxon_group is None:
                ignored_species_row_count += 1
                unresolved_taxon_classes[raw_taxon_class or "NA"] += 1
            else:
                species_group_counts[taxon_group].record(met, iucn_status)

            species_iucn_counts[iucn_status].record(met)
            feature.update({
                "taxonClass": taxon_class,
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

    if species_features and (
        ignored_species_row_count / len(species_features) > MAX_UNRESOLVED_TAXON_FRACTION
    ):
        offenders = ", ".join(
            f"{name} ({count})" for name, count in sorted(unresolved_taxon_classes.items())
        )
        raise GoalsSchemaError(
            f"{summary_csv_path} leaves {ignored_species_row_count} of "
            f"{len(species_features)} species rows without a taxon group, above the "
            f"{MAX_UNRESOLVED_TAXON_FRACTION:.0%} tolerance; unresolved classes: {offenders}"
        )

    generated = generated_at or _utc_now_iso()
    return {
        "format": GOALS_FORMAT,
        "solutionId": str(solution.get("id") or ""),
        "solutionName": str(solution.get("name") or solution.get("id") or ""),
        "generatedAt": generated,
        "source": {
            "metadataUrl": solution.get("metadataUrl"),
            "summaryCsvUrl": resolved_summary_url,
            "summaryCsvRows": len(summary_rows),
            "solutionDomain": domain,
            "speciesLookupUrl": SPECIES_CSV_URL,
        },
        "targetContext": _target_context(solution, summary_rows, domain),
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
            "rawTaxonClassCounts": dict(sorted(raw_taxon_class_counts.items())),
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
    return solution_artifact_path(output_dir, solution_id, suffix=GOALS_SUFFIX)


def _goals_provenance(
    *,
    solution: dict[str, Any],
    catalog: SolutionCatalog,
    summary_csv_url: str,
    summary_csv_sha256: str,
    species_csv_sha256: str | None,
) -> dict[str, Any]:
    catalog_entry = catalog.by_id[str(solution["id"])]
    descriptor = {
        "format": GOALS_PROVENANCE_FORMAT,
        "goalsFormat": GOALS_FORMAT,
        "catalogSolution": catalog_entry.to_dict(),
        "manifestSolution": {
            key: value
            for key, value in solution.items()
            if key != "precomputedMetricUrls"
        },
        "summaryCsv": {
            "url": summary_csv_url,
            "sha256": summary_csv_sha256,
        },
        "speciesCsv": {
            "url": SPECIES_CSV_URL if species_csv_sha256 else None,
            "sha256": species_csv_sha256,
        },
    }
    return {
        "format": GOALS_PROVENANCE_FORMAT,
        "releaseId": catalog.release_id,
        "catalogBinding": catalog_binding(catalog),
        "solutionBasename": catalog_entry.solution_basename,
        "rasterSha256": catalog_entry.raster_sha256,
        "summaryCsvUrl": summary_csv_url,
        "summaryCsvSha256": summary_csv_sha256,
        "speciesCsvSha256": species_csv_sha256,
        "inputSignature": canonical_sha256(descriptor),
    }


def _goal_count_is_valid(value: Any, *, species: bool = False) -> bool:
    if not isinstance(value, dict):
        return False
    met_key = "metSpeciesCount" if species else "metCount"
    total_key = "totalSpeciesCount" if species else "totalCount"
    met = value.get(met_key)
    total = value.get(total_key)
    pct = value.get("pctMet")
    return (
        isinstance(met, int)
        and not isinstance(met, bool)
        and isinstance(total, int)
        and not isinstance(total, bool)
        and 0 <= met <= total
        and (pct is None or isinstance(pct, (int, float)))
    )


def goals_document_is_complete(
    document: dict[str, Any],
    *,
    solution_id: str,
    expected_provenance: dict[str, Any] | None = None,
) -> bool:
    features = document.get("features")
    summary = document.get("summary")
    by_type = summary.get("byType") if isinstance(summary, dict) else None
    source = document.get("source")
    target_context = document.get("targetContext")
    rollups = document.get("rollups")
    diagnostics = document.get("diagnostics")
    row_counts = (
        diagnostics.get("rowCounts")
        if isinstance(diagnostics, dict)
        else None
    )
    feature_keys = ("species", "strategicEcosystems", "ecosystems", "other")
    if not (
        document.get("format") == GOALS_FORMAT
        and document.get("solutionId") == solution_id
        and isinstance(document.get("generatedAt"), str)
        and bool(document["generatedAt"])
        and (
            expected_provenance is None
            or document.get("goalsProvenance") == expected_provenance
        )
        and isinstance(source, dict)
        and {
            "metadataUrl",
            "summaryCsvUrl",
            "summaryCsvRows",
            "solutionDomain",
            "speciesLookupUrl",
        }.issubset(source)
        and isinstance(source.get("summaryCsvRows"), int)
        and source["summaryCsvRows"] >= 0
        and source.get("solutionDomain") in {"land", "marine"}
        and isinstance(target_context, dict)
        and isinstance(summary, dict)
        and _goal_count_is_valid(summary)
        and isinstance(by_type, dict)
        and set(by_type) == set(feature_keys)
        and _goal_count_is_valid(by_type.get("species"), species=True)
        and all(
            _goal_count_is_valid(by_type.get(key))
            for key in ("strategicEcosystems", "ecosystems", "other")
        )
        and isinstance(rollups, dict)
        and {"species", "strategicEcosystems", "ecosystems"}.issubset(rollups)
        and isinstance(features, dict)
        and set(features) == set(feature_keys)
        and all(isinstance(features.get(key), list) for key in feature_keys)
        and isinstance(diagnostics, dict)
        and isinstance(diagnostics.get("rawTypeCounts"), dict)
        and isinstance(row_counts, dict)
        and set(row_counts) == set(feature_keys)
        and all(
            row_counts[key] == len(features[key])
            for key in feature_keys
        )
        and source["summaryCsvRows"] == sum(row_counts.values())
        and summary["totalCount"] == sum(row_counts.values())
        and by_type["species"]["totalSpeciesCount"] == row_counts["species"]
        and all(
            by_type[key]["totalCount"] == row_counts[key]
            for key in ("strategicEcosystems", "ecosystems", "other")
        )
    ):
        return False
    required_feature_fields = {
        "featureId",
        "featureName",
        "featureType",
        "met",
        "totalAmount",
        "absoluteTarget",
        "absoluteHeld",
        "absoluteShortfall",
        "relativeTarget",
        "relativeHeld",
        "relativeShortfall",
        "scenario",
    }
    return all(
        isinstance(feature, dict)
        and required_feature_fields.issubset(feature)
        and feature.get("featureType") == feature_type
        and isinstance(feature.get("featureId"), str)
        and isinstance(feature.get("featureName"), str)
        and (
            feature.get("met") is None
            or isinstance(feature.get("met"), bool)
        )
        for feature_type in feature_keys
        for feature in features[feature_type]
    )


def _goals_is_resumable(
    path: Path,
    *,
    solution_id: str,
    expected_provenance: dict[str, Any],
) -> bool:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return goals_document_is_complete(
        document,
        solution_id=solution_id,
        expected_provenance=expected_provenance,
    )


def expected_goals_blob_path(
    solution_id: str,
    *,
    goals_blob_directory: str = DEFAULT_GOALS_BLOB_DIRECTORY,
) -> str:
    return solution_blob_path(
        solution_id,
        blob_directory=goals_blob_directory,
        suffix=GOALS_SUFFIX,
    )


def expected_goals_public_url(
    public_blob_host: str,
    solution_id: str,
    *,
    goals_blob_directory: str = DEFAULT_GOALS_BLOB_DIRECTORY,
) -> str:
    return solution_public_url(
        public_blob_host,
        solution_id,
        blob_directory=goals_blob_directory,
        suffix=GOALS_SUFFIX,
    )


def _read_summary_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        columns = list(reader.fieldnames or [])
        rows = list(reader)
    if any(_clean_text(row.get("evaluated")) for row in rows):
        rows = [
            row
            for row in rows
            if _clean_text(row.get("evaluated")) == "prioritizr_model"
        ]
    return columns, rows


def _feature_type_column(columns: Any) -> str | None:
    return next((column for column in FEATURE_TYPE_COLUMNS if column in columns), None)


def _declared_feature_type(row: dict[str, str]) -> str:
    """Read the feature type a summary row declares, whichever column carries it."""

    column = _feature_type_column(row)
    return _clean_text(row.get(column)) if column is not None else ""


def _declared_feature_category(row: dict[str, str]) -> str | None:
    declared = re.sub(r"[\s_]+", " ", _declared_feature_type(row).lower())
    return DECLARED_FEATURE_TYPES.get(declared)


def _base_feature(row: dict[str, str], *, feature_type: str, met: bool | None) -> dict[str, Any]:
    feature_name = _clean_text(row.get("feature"))
    feature = {
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
    evaluation_source = _clean_text(row.get("evaluated"))
    if evaluation_source:
        feature["evaluationSource"] = evaluation_source
    return feature


def _feature_type(
    row: dict[str, str],
    domain: SolutionDomain = "land",
) -> str:
    feature_name = _clean_text(row.get("feature"))
    if domain == "marine":
        if re.match(r"^manglar", feature_name, flags=re.IGNORECASE):
            return "strategicEcosystems"
        return "ecosystems"
    declared = _declared_feature_category(row)
    if declared is not None:
        return declared
    if _normalize_feature_id(feature_name) in STRATEGIC_ECOSYSTEM_FEATURES:
        return "strategicEcosystems"
    return "other"


def _target_context(
    solution: dict[str, Any],
    rows: list[dict[str, str]],
    domain: SolutionDomain = "land",
) -> dict[str, Any]:
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
        targets_by_type[_feature_type(row, domain)].append(target)

    return {
        "finderTargetPercent": finder_inputs.get("targetPercent"),
        "targetFeatureSet": finder_inputs.get("targetFeatureSet"),
        "targetFeatureIds": finder_inputs.get("targetFeatureIds") or [],
        "structuredTargets": finder_inputs.get("structuredTargets"),
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


def _resolve_taxon(
    record: GoalSpeciesRecord | None,
    csv_class: str,
) -> tuple[str | None, str | None]:
    """Resolve a species row's taxonomic class and metric group.

    The species catalog is authoritative. The summary CSV's ``class`` column is
    solver output that has been observed to batch one class into
    ``Magnoliopsida_1``/``Magnoliopsida_2``, so it is only consulted for rows
    that have no catalog match.
    """

    if record is not None and record.taxon_group is not None:
        return record.csv_class or None, record.taxon_group
    return normalize_class_name(csv_class) or None, class_bucket(csv_class)


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
                    taxon_group=class_bucket(cls),
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
    if args.manifest_url:
        return fetch_manifest(args.manifest_url).raw, args.manifest_url
    local_manifest = repo_root / DEFAULT_LOCAL_MANIFEST
    if local_manifest.exists():
        return _load_manifest_from_file(local_manifest), str(local_manifest)
    return fetch_manifest(DEFAULT_MANIFEST_URL).raw, DEFAULT_MANIFEST_URL


def _summary_csv_path(url: str, cache_dir: Path, *, force: bool) -> Path:
    if url.startswith("http://") or url.startswith("https://"):
        return cached_download(url, cache_dir, force=force).path
    return Path(url)


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    manifest_source = parser.add_mutually_exclusive_group()
    manifest_source.add_argument(
        "--manifest-file",
        type=Path,
        default=None,
        help=(
            "Local manifest JSON to read. Cannot be combined with --manifest-url."
        ),
    )
    manifest_source.add_argument(
        "--manifest-url",
        default=None,
        help=(
            "Manifest URL to fetch. Without an explicit source, the local Nick-runs "
            f"staging manifest is used when present, otherwise {DEFAULT_MANIFEST_URL}."
        ),
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
    parser.add_argument("--release-id", default=None)
    parser.add_argument("--solution-catalog", type=Path, default=None)
    parser.add_argument("--release-plan", type=Path, default=None)
    parser.add_argument(
        "--cache-policy",
        choices=("use-cache", "recompute-all"),
        default="use-cache",
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
    args = parser.parse_args(argv)
    if args.release_id and args.solution_catalog is None:
        parser.error("--release-id requires --solution-catalog")
    if args.release_plan is not None and not args.release_id:
        parser.error("--release-plan requires --release-id")
    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    repo_root = find_repo_root()
    catalog = (
        load_solution_catalog(resolve_output_dir(repo_root, args.solution_catalog))
        if args.solution_catalog is not None
        else None
    )
    if catalog is not None and catalog.release_id != args.release_id:
        raise SystemExit("[goals] ERROR: release ID does not match solution catalog")
    if catalog is not None and args.release_plan is not None:
        args.cache_policy = release_plan_cache_policy(
            resolve_output_dir(repo_root, args.release_plan),
            catalog=catalog,
        )
    if args.release_id:
        release_config = load_release_config(args.release_id)
        args.goals_blob_directory = release_config.goals_current_directory
        if args.output_dir == DEFAULT_GOALS_OUTPUT_DIR:
            # The local tree mirrors the Blob prefix so both stay in one contract.
            args.output_dir = GENERATED_ROOT / release_config.goals_current_directory
    output_dir = resolve_output_dir(repo_root, args.output_dir)
    cache_dir = resolve_output_dir(repo_root, args.cache_dir)
    manifest, manifest_source = _load_manifest_payload(args, repo_root)
    public_blob_host = str(manifest.get("publicBlobHost") or "").rstrip("/")
    solution_ids = set(args.solution_id or [])

    batch_solutions = [
        solution
        for solution in manifest.get("solutions") or []
        if isinstance(solution, dict) and is_batch_solution(solution)
    ]
    if catalog is not None:
        validate_catalog_solution_ids(
            catalog,
            (str(solution.get("id")) for solution in batch_solutions),
        )
        for solution in batch_solutions:
            entry = catalog.by_id[str(solution["id"])]
            if solution_domain(solution) != entry.domain:
                raise SystemExit(
                    f"[goals] ERROR: domain mismatch for {solution['id']!r}"
                )
            observed_basename = solution_blob_basename(solution)
            if observed_basename != entry.solution_basename:
                raise SystemExit(
                    f"[goals] ERROR: basename mismatch for {solution['id']!r}"
                )

    solutions: list[dict[str, Any]] = []
    for solution in batch_solutions:
        solution_id = str(solution.get("id") or "")
        if solution_ids and solution_id not in solution_ids:
            continue
        metadata_path = urlsplit(str(solution.get("metadataUrl") or "")).path.lower()
        if metadata_path.endswith((".csv", ".json")):
            solutions.append(solution)
    if catalog is not None and args.release_plan is not None:
        recompute_ids = set(
            load_release_plan(
                resolve_output_dir(repo_root, args.release_plan),
                catalog=catalog,
                action="recompute",
            )
        )
        solutions = [
            solution
            for solution in solutions
            if str(solution.get("id")) in recompute_ids
        ]
        if len(solutions) != len(recompute_ids):
            raise SystemExit(
                "[goals] ERROR: release plan recompute count does not match goals selection"
            )
    if catalog is not None:
        bind_release_output(
            output_dir,
            catalog=catalog,
            component="conservation-goals",
        )

    species_records: list[GoalSpeciesRecord] = []
    species_csv_sha256: str | None = None
    if any(solution_domain(solution) == "land" for solution in solutions):
        species_download = cached_download(
            SPECIES_CSV_URL,
            cache_dir,
            force=args.force_download,
        )
        species_csv_sha256 = species_download.sha256
        species_records = load_goal_species_records(species_download.path)

    entries: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for solution in solutions:
        solution_id = str(solution.get("id") or "")
        metadata_url = str(solution.get("metadataUrl") or "")
        try:
            summary_csv_url = resolve_summary_csv_url(metadata_url)
            csv_path = _summary_csv_path(
                summary_csv_url,
                cache_dir,
                force=args.force_download,
            )
            summary_csv_sha256 = _sha256_path(csv_path)
            goals_provenance = (
                _goals_provenance(
                    solution=solution,
                    catalog=catalog,
                    summary_csv_url=summary_csv_url,
                    summary_csv_sha256=summary_csv_sha256,
                    species_csv_sha256=(
                        species_csv_sha256
                        if solution_domain(solution) == "land"
                        else None
                    ),
                )
                if catalog is not None
                else None
            )
            local_path = goals_output_path(output_dir, solution_id)
            if (
                args.cache_policy == "use-cache"
                and goals_provenance is not None
                and _goals_is_resumable(
                    local_path,
                    solution_id=solution_id,
                    expected_provenance=goals_provenance,
                )
            ):
                doc = json.loads(local_path.read_text(encoding="utf-8"))
                resume_skipped = True
            else:
                doc = build_goals_document(
                    solution=solution,
                    summary_csv_path=csv_path,
                    species_records=species_records,
                    summary_csv_url=summary_csv_url,
                )
                if goals_provenance is not None:
                    doc["goalsProvenance"] = goals_provenance
                local_path = write_goals_document(output_dir, solution_id, doc)
                resume_skipped = False
            expected_blob_path = expected_goals_blob_path(
                solution_id,
                goals_blob_directory=args.goals_blob_directory,
            )
            entries.append({
                "solutionId": solution_id,
                "solutionName": solution.get("name"),
                "sourceSummaryCsvUrl": summary_csv_url,
                "cachePath": str(local_path.relative_to(repo_root)),
                "expectedBlobPath": expected_blob_path,
                "expectedPublicUrl": (
                    f"{public_blob_host}/{expected_blob_path}" if public_blob_host else None
                ),
                "summary": doc["summary"],
                "rowCounts": doc["diagnostics"]["rowCounts"],
                "resumeSkipped": resume_skipped,
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
        "cachePolicy": args.cache_policy,
        "solutionCatalog": (
            {
                "releaseId": catalog.release_id,
                "catalogVersion": catalog.catalog_version,
                "sha256": catalog.sha256,
            }
            if catalog is not None
            else None
        ),
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
