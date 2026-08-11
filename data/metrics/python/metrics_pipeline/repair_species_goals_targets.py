"""Repair configured-target metadata in existing species-goals compact sidecars.

This command never reads rasters. It preserves all area measures and 17/30 flags,
then atomically rewrites target values, configured-target flags, target provenance,
completion checksums, and a repair inventory from verified summary CSVs.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from species_goals import (
    COMPACT_ROW_LAYOUT,
    COMPLETION_FORMAT,
    FLAG_CONFIGURED_TARGET_MET,
    FLAG_TARGET_CONFIGURED,
    FLAG_UNAVAILABLE,
    GEOGRAPHY_LEVELS,
    SpeciesGoalsContractError,
    _atomic_json_write,
    _completion_path,
    _file_sha256,
    canonical_sha256,
    compact_partition_path,
    validate_catalog,
    validate_compact,
)
from species_target_policy import normalize_species_feature_id

REPAIR_INVENTORY_FORMAT = "species-goals-target-repair-v1"
SUPPORTED_EVALUATIONS = frozenset({"prioritizr_model", "post-hoc"})
SPECIES_SOLUTION_MARKERS = ("EspRep", "EspRN")
EXPECTED_SPECIES_SOLUTION_COUNT = 144
EXPECTED_UNTARGETED_LAND_SOLUTION_COUNT = 24
EXPECTED_REPAIRED_ARTIFACT_COUNT = (
    EXPECTED_SPECIES_SOLUTION_COUNT * len(GEOGRAPHY_LEVELS)
)


def load_summary_targets(
    path: Path,
    *,
    expected_scenario: str | None = None,
) -> tuple[dict[str, float], dict[str, bool | None]]:
    """Read configured species targets and national met values fail-closed."""

    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {
            "feature",
            "feature_type",
            "relative_target",
            "relative_held",
            "met",
            "evaluated",
        }
        if expected_scenario is not None:
            required.add("scenario")
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise SpeciesGoalsContractError(f"{path} has an invalid summary schema")
        targets: dict[str, float] = {}
        national_met: dict[str, bool | None] = {}
        for index, row in enumerate(reader, start=2):
            scenario = str(row.get("scenario") or "").strip()
            if expected_scenario is not None and scenario != expected_scenario:
                raise SpeciesGoalsContractError(
                    f"{path}:{index} scenario {scenario!r} does not match "
                    f"{expected_scenario!r}"
                )
            feature_type = str(
                row.get("feature_type") or row.get("type") or ""
            ).strip().lower()
            if "species" not in feature_type:
                continue
            evaluated = str(row.get("evaluated") or "").strip()
            if evaluated not in SUPPORTED_EVALUATIONS:
                raise SpeciesGoalsContractError(
                    f"{path}:{index} has unsupported evaluated value {evaluated!r}"
                )
            target = _number(row.get("relative_target"))
            if target is None:
                continue
            target_pct = target * 100 if abs(target) <= 1 else target
            if not 0 <= target_pct <= 100:
                raise SpeciesGoalsContractError(
                    f"{path}:{index} has invalid species target {target!r}"
                )
            feature_id = normalize_species_feature_id(str(row.get("feature") or ""))
            if not feature_id:
                raise SpeciesGoalsContractError(f"{path}:{index} has no species feature")
            if feature_id in targets:
                conflict = targets[feature_id] != target_pct
                qualifier = "conflicting " if conflict else ""
                raise SpeciesGoalsContractError(
                    f"{path}:{index} has {qualifier}duplicate species target "
                    f"{feature_id!r}"
                )
            met = _boolean(row.get("met"))
            relative_held = _number(row.get("relative_held"))
            if met is not None and relative_held is not None:
                comparable_met = relative_held + 1e-12 >= target
                if met != comparable_met:
                    raise SpeciesGoalsContractError(
                        f"{path}:{index} met disagrees with relative held/target"
                    )
            targets[feature_id] = round(target_pct, 6)
            national_met[feature_id] = met
    return targets, national_met


def repair_compact_document(
    document: dict[str, Any],
    *,
    catalog: dict[str, Any],
    targets_by_feature_id: dict[str, float],
    national_met_by_feature_id: dict[str, bool | None],
    target_policy_sha256: str,
    generated_at: str | None = None,
    in_place: bool = False,
) -> dict[str, Any]:
    """Return a metadata-only repair while preserving every area and 17/30 bit."""

    validate_compact(document, catalog=catalog)
    if document["rowLayout"] != list(COMPACT_ROW_LAYOUT):
        raise SpeciesGoalsContractError("compact row layout is unsupported")
    known_ids = {
        normalize_species_feature_id(row[1]) for row in catalog["rows"]
    }
    unknown = sorted(set(targets_by_feature_id) - known_ids)
    if unknown:
        raise SpeciesGoalsContractError(
            f"summary targets do not bind to catalog species: {unknown[:8]}"
        )

    # Retained in the function contract because the verified source result is part
    # of repair provenance, even though compact flags are derived from compact areas.
    _ = national_met_by_feature_id
    rows: list[list[Any]] = document["rows"] if in_place else []
    for original in document["rows"]:
        original_measures = tuple(original[:6])
        original_non_target_flags = original[7] & ~(
            FLAG_TARGET_CONFIGURED | FLAG_CONFIGURED_TARGET_MET
        )
        row = original if in_place else list(original)
        catalog_row = catalog["rows"][row[1]]
        feature_id = normalize_species_feature_id(catalog_row[1])
        target = targets_by_feature_id.get(feature_id)
        old_non_target_flags = row[7] & ~(
            FLAG_TARGET_CONFIGURED | FLAG_CONFIGURED_TARGET_MET
        )
        if row[7] & FLAG_UNAVAILABLE:
            # The summary remains authoritative for national goal reporting, but an
            # unavailable species has no exact-overlap measures to carry a target in
            # the compact contract. Leave that row explicitly unavailable.
            row[6] = None
            row[7] = old_non_target_flags
            if not in_place:
                rows.append(row)
            continue

        row[6] = target
        row[7] = old_non_target_flags
        if target is not None:
            row[7] |= FLAG_TARGET_CONFIGURED
            range_km2, covered_km2 = row[2], row[3]
            exact_met = bool(
                range_km2 > 0
                and covered_km2 / range_km2 * 100 + 1e-9 >= target
            )
            # Goals documents use the summary CSV's national `met` result. Compact
            # sidecars use their own exact-overlap measures at every geography, so
            # their configured-target flag must remain internally derivable from
            # those measures instead of copying a potentially different national
            # solver result into AOI data.
            if range_km2 > 0 and exact_met:
                row[7] |= FLAG_CONFIGURED_TARGET_MET

        if tuple(row[:6]) != original_measures:
            raise SpeciesGoalsContractError("repair changed immutable compact areas")
        if (row[7] & ~(FLAG_TARGET_CONFIGURED | FLAG_CONFIGURED_TARGET_MET)) != (
            original_non_target_flags
        ):
            raise SpeciesGoalsContractError("repair changed immutable compact flags")
        if not in_place:
            rows.append(row)

    if in_place:
        repaired = document
        repaired["generatedAt"] = (
            generated_at or datetime.now(timezone.utc).isoformat()
        )
        repaired["provenance"]["targetPolicySha256"] = target_policy_sha256
    else:
        repaired = {
            **document,
            "generatedAt": generated_at or datetime.now(timezone.utc).isoformat(),
            "provenance": {
                **document["provenance"],
                "targetPolicySha256": target_policy_sha256,
            },
            "rows": rows,
        }
    body = {key: value for key, value in repaired.items() if key != "completion"}
    repaired["completion"] = {
        "format": COMPLETION_FORMAT,
        "status": "complete",
        "rowCount": len(rows),
        "payloadSha256": canonical_sha256(body),
    }
    validate_compact(repaired, catalog=catalog)
    return repaired


def _target_policy(
    targets: dict[str, float], summary_sha256: str
) -> tuple[dict[str, Any], str]:
    descriptor = {
        "format": "species-target-policy-v1",
        "kind": "per_species",
        "source": "summary_csv:final",
        "summaryCsvSha256": summary_sha256,
        "targets": dict(sorted(targets.items())),
    }
    return descriptor, canonical_sha256(descriptor)


def _immutable_rows_sha256(rows: list[list[Any]]) -> str:
    digest = hashlib.sha256()
    encoder = json.JSONEncoder(
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    digest.update(b"[")
    for index, row in enumerate(rows):
        if index:
            digest.update(b",")
        immutable = [
            *row[:6],
            row[7] & ~(FLAG_TARGET_CONFIGURED | FLAG_CONFIGURED_TARGET_MET),
        ]
        for chunk in encoder.iterencode(immutable):
            digest.update(chunk.encode("utf-8"))
    digest.update(b"]")
    return digest.hexdigest()


def _expected_partition_sha256(
    report: dict[str, Any], solution_id: str, level: str
) -> str:
    try:
        generation = report["solutions"][solution_id]["generation"]["partitions"][level]
        validation = report["solutions"][solution_id]["validation"]["partitions"][level]
        if generation["artifactSha256"] != validation["artifactSha256"]:
            raise SpeciesGoalsContractError(
                f"build report generation/validation hash mismatch for "
                f"{solution_id}/{level}"
            )
        return validation["artifactSha256"]
    except KeyError as error:
        raise SpeciesGoalsContractError(
            f"build report lacks partition evidence for {solution_id}/{level}"
        ) from error


def _load_repaired_document(
    path: Path,
    *,
    catalog: dict[str, Any],
    targets: dict[str, float],
    national_met: dict[str, bool | None],
    target_policy_sha256: str,
) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    expected = repair_compact_document(
        document,
        catalog=catalog,
        targets_by_feature_id=targets,
        national_met_by_feature_id=national_met,
        target_policy_sha256=target_policy_sha256,
        generated_at=document.get("generatedAt"),
    )
    if expected != document:
        raise SpeciesGoalsContractError(
            f"existing artifact does not match the exact repaired content: {path}"
        )
    return document


def _solution_summary_path(summaries_dir: Path, solution_basename: str) -> Path:
    return summaries_dir / f"{Path(solution_basename).stem}_summary.csv"


def preflight_repair(
    *,
    output_root: Path,
    catalog_path_value: Path,
    source_solution_catalog_path: Path,
    build_report_path: Path,
    summaries_dir: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Verify all mappings and hashes before the caller performs any write."""

    catalog = validate_catalog(
        json.loads(catalog_path_value.read_text(encoding="utf-8"))
    )
    source_catalog = json.loads(
        source_solution_catalog_path.read_text(encoding="utf-8")
    )
    report = json.loads(build_report_path.read_text(encoding="utf-8"))
    if (
        report.get("phase") != "complete"
        or report.get("generationCounts", {}).get("completed") != 168
        or report.get("validationCounts", {}).get("completed") != 168
        or report.get("errors")
        or report.get("blockers")
    ):
        raise SpeciesGoalsContractError("full-build report is not a clean 168-land build")
    if report.get("catalog", {}).get("catalogSha256") != catalog["catalogSha256"]:
        raise SpeciesGoalsContractError("build report and catalog hashes differ")

    land_entries = sorted(
        (
            entry
            for entry in source_catalog.get("solutions", [])
            if entry.get("domain") == "land"
        ),
        key=lambda entry: entry["solutionId"],
    )
    targeted = [
        entry
        for entry in land_entries
        if any(marker in entry["solutionBasename"] for marker in SPECIES_SOLUTION_MARKERS)
    ]
    untargeted = [entry for entry in land_entries if entry not in targeted]
    if (
        len(land_entries) != 168
        or len(targeted) != EXPECTED_SPECIES_SOLUTION_COUNT
        or len(untargeted) != EXPECTED_UNTARGETED_LAND_SOLUTION_COUNT
    ):
        raise SpeciesGoalsContractError("source solution catalog species counts are invalid")

    catalog_by_feature_id = {
        normalize_species_feature_id(row[1]): row for row in catalog["rows"]
    }
    plan: dict[str, Any] = {
        "format": REPAIR_INVENTORY_FORMAT,
        "releaseId": report["releaseId"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "preflight-complete",
        "catalog": {
            "path": str(catalog_path_value),
            "catalogSha256": catalog["catalogSha256"],
            "artifactSha256": _file_sha256(catalog_path_value),
        },
        "sourceSolutionCatalog": {
            "path": str(source_solution_catalog_path),
            "artifactSha256": _file_sha256(source_solution_catalog_path),
        },
        "preRepairBuildReport": {
            "path": str(build_report_path),
            "artifactSha256": _file_sha256(build_report_path),
            "preserved": True,
        },
        "preflight": {
            "completedAt": datetime.now(timezone.utc).isoformat(),
            "speciesSolutionCount": len(targeted),
            "artifactCount": len(targeted) * len(GEOGRAPHY_LEVELS),
            "untargetedLandSolutionCount": len(untargeted),
        },
        "solutions": {},
        "untargetedLandSolutions": {},
    }

    for entry in targeted:
        solution_id = entry["solutionId"]
        scenario = Path(entry["solutionBasename"]).stem
        summary_path = _solution_summary_path(summaries_dir, entry["solutionBasename"])
        if not summary_path.is_file():
            raise SpeciesGoalsContractError(
                f"catalog-selected summary is missing: {summary_path}"
            )
        targets, national_met = load_summary_targets(
            summary_path, expected_scenario=scenario
        )
        unknown = sorted(set(targets) - set(catalog_by_feature_id))
        if unknown:
            raise SpeciesGoalsContractError(
                f"{summary_path} targets unknown catalog species: {unknown[:8]}"
            )
        summary_sha256 = _file_sha256(summary_path)
        _, target_policy_sha256 = _target_policy(targets, summary_sha256)
        unavailable_targets = sum(
            catalog_by_feature_id[feature_id][5] == "unavailable"
            for feature_id in targets
        )
        partitions: dict[str, Any] = {}
        for level in GEOGRAPHY_LEVELS:
            path = compact_partition_path(output_root, solution_id, level)
            if not path.is_file():
                raise SpeciesGoalsContractError(f"missing compact artifact: {path}")
            expected_sha256 = _expected_partition_sha256(report, solution_id, level)
            observed_sha256 = _file_sha256(path)
            state = "pre-repair"
            if observed_sha256 != expected_sha256:
                repaired = _load_repaired_document(
                    path,
                    catalog=catalog,
                    targets=targets,
                    national_met=national_met,
                    target_policy_sha256=target_policy_sha256,
                )
                state = "repaired"
                del repaired
            partitions[level] = {
                "relativePath": path.relative_to(output_root).as_posix(),
                "preRepairSha256": expected_sha256,
                "observedSha256": observed_sha256,
                "state": state,
            }
        plan["solutions"][solution_id] = {
            "solutionBasename": entry["solutionBasename"],
            "summaryCsv": str(summary_path),
            "summaryCsvSha256": summary_sha256,
            "targetPolicySha256": target_policy_sha256,
            "configuredTargetCount": len(targets),
            "unavailableTargetSkipCount": unavailable_targets,
            "status": (
                "repaired"
                if all(item["state"] == "repaired" for item in partitions.values())
                else "pending"
            ),
            "partitions": partitions,
        }

    for entry in untargeted:
        solution_id = entry["solutionId"]
        hashes: dict[str, str] = {}
        for level in GEOGRAPHY_LEVELS:
            path = compact_partition_path(output_root, solution_id, level)
            expected_sha256 = _expected_partition_sha256(report, solution_id, level)
            observed_sha256 = _file_sha256(path)
            if observed_sha256 != expected_sha256:
                raise SpeciesGoalsContractError(
                    f"untargeted artifact changed: {solution_id}/{level}"
                )
            hashes[level] = observed_sha256
        plan["untargetedLandSolutions"][solution_id] = hashes

    if plan["preflight"]["artifactCount"] != EXPECTED_REPAIRED_ARTIFACT_COUNT:
        raise SpeciesGoalsContractError("preflight did not cover 864 repair artifacts")
    return plan, catalog, report


def _national_discrepancies(
    document: dict[str, Any],
    *,
    catalog: dict[str, Any],
    targets: dict[str, float],
    national_met: dict[str, bool | None],
) -> dict[str, int]:
    counts = {
        "comparable": 0,
        "different": 0,
        "summaryMetExactNotMet": 0,
        "exactMetSummaryNotMet": 0,
    }
    for row in document["rows"]:
        feature_id = normalize_species_feature_id(catalog["rows"][row[1]][1])
        if feature_id not in targets or national_met.get(feature_id) is None:
            continue
        if row[7] & FLAG_UNAVAILABLE or row[2] <= 0:
            continue
        exact_met = bool(row[7] & FLAG_CONFIGURED_TARGET_MET)
        summary_met = bool(national_met[feature_id])
        counts["comparable"] += 1
        if exact_met != summary_met:
            counts["different"] += 1
            if summary_met:
                counts["summaryMetExactNotMet"] += 1
            else:
                counts["exactMetSummaryNotMet"] += 1
    return counts


def _write_completion(
    path: Path,
    document: dict[str, Any],
    *,
    artifact_sha256: str,
) -> None:
    _atomic_json_write(
        _completion_path(path),
        {
            **document["completion"],
            "artifactSha256": artifact_sha256,
            "solutionId": document["solutionId"],
            "geographyLevel": document["geographyLevel"],
            "catalogSha256": document["catalogSha256"],
            "provenance": document["provenance"],
        },
    )


def repair_partition(
    *,
    path: Path,
    expected_pre_repair_sha256: str,
    catalog: dict[str, Any],
    targets: dict[str, float],
    national_met: dict[str, bool | None],
    target_policy_sha256: str,
) -> tuple[dict[str, Any], dict[str, int] | None]:
    """Repair one partition, release its JSON, then let the caller continue."""

    before_sha256 = _file_sha256(path)
    resumed = before_sha256 != expected_pre_repair_sha256
    if resumed:
        document = _load_repaired_document(
            path,
            catalog=catalog,
            targets=targets,
            national_met=national_met,
            target_policy_sha256=target_policy_sha256,
        )
        old_target_count = None
    else:
        document = json.loads(path.read_text(encoding="utf-8"))
        validate_compact(document, catalog=catalog)
        old_target_count = sum(
            bool(row[7] & FLAG_TARGET_CONFIGURED) for row in document["rows"]
        )
        immutable_before = _immutable_rows_sha256(document["rows"])
        repair_compact_document(
            document,
            catalog=catalog,
            targets_by_feature_id=targets,
            national_met_by_feature_id=national_met,
            target_policy_sha256=target_policy_sha256,
            generated_at=datetime.now(timezone.utc).isoformat(),
            in_place=True,
        )
        immutable_after = _immutable_rows_sha256(document["rows"])
        if immutable_after != immutable_before:
            raise SpeciesGoalsContractError(f"immutable measurements changed: {path}")
        _atomic_json_write(path, document)

    after_sha256 = _file_sha256(path)
    _write_completion(path, document, artifact_sha256=after_sha256)
    configured_count = sum(
        bool(row[7] & FLAG_TARGET_CONFIGURED) for row in document["rows"]
    )
    unavailable_count = sum(bool(row[7] & FLAG_UNAVAILABLE) for row in document["rows"])
    discrepancies = (
        _national_discrepancies(
            document,
            catalog=catalog,
            targets=targets,
            national_met=national_met,
        )
        if document["geographyLevel"] == "national"
        else None
    )
    evidence = {
        "preRepairSha256": expected_pre_repair_sha256,
        "beforeSha256": before_sha256,
        "afterSha256": after_sha256,
        "bytes": path.stat().st_size,
        "rowCount": len(document["rows"]),
        "configuredTargetCount": configured_count,
        "unavailableRowCount": unavailable_count,
        "oldConfiguredTargetCount": old_target_count,
        "resumed": resumed,
        "immutableMeasurementsSha256": _immutable_rows_sha256(document["rows"]),
    }
    return evidence, discrepancies


def _post_validate(
    *,
    plan: dict[str, Any],
    output_root: Path,
    catalog: dict[str, Any],
    summaries_dir: Path,
) -> dict[str, Any]:
    totals = {
        "solutionCount": 0,
        "artifactCount": 0,
        "bytes": 0,
        "configuredTargetsAcrossArtifacts": 0,
        "unavailableTargetSkipsAcrossSolutions": 0,
        "nationalComparableStatuses": 0,
        "nationalStatusDifferences": 0,
        "summaryMetExactNotMet": 0,
        "exactMetSummaryNotMet": 0,
    }
    for solution_id, solution in sorted(plan["solutions"].items()):
        summary_path = Path(solution["summaryCsv"])
        targets, national_met = load_summary_targets(
            summary_path,
            expected_scenario=Path(solution["solutionBasename"]).stem,
        )
        _, policy_sha256 = _target_policy(targets, solution["summaryCsvSha256"])
        if policy_sha256 != solution["targetPolicySha256"]:
            raise SpeciesGoalsContractError(
                f"target policy changed during run for {solution_id}"
            )
        totals["solutionCount"] += 1
        totals["unavailableTargetSkipsAcrossSolutions"] += solution[
            "unavailableTargetSkipCount"
        ]
        for level in GEOGRAPHY_LEVELS:
            path = compact_partition_path(output_root, solution_id, level)
            document = _load_repaired_document(
                path,
                catalog=catalog,
                targets=targets,
                national_met=national_met,
                target_policy_sha256=policy_sha256,
            )
            completion = json.loads(
                _completion_path(path).read_text(encoding="utf-8")
            )
            artifact_sha256 = _file_sha256(path)
            if (
                completion.get("artifactSha256") != artifact_sha256
                or completion.get("payloadSha256")
                != document["completion"]["payloadSha256"]
                or completion.get("provenance") != document["provenance"]
            ):
                raise SpeciesGoalsContractError(
                    f"completion evidence is invalid: {solution_id}/{level}"
                )
            configured_count = sum(
                bool(row[7] & FLAG_TARGET_CONFIGURED) for row in document["rows"]
            )
            partition = solution["partitions"][level]
            partition.update(
                {
                    "state": "validated",
                    "afterSha256": artifact_sha256,
                    "payloadSha256": document["completion"]["payloadSha256"],
                    "bytes": path.stat().st_size,
                    "rowCount": len(document["rows"]),
                    "configuredTargetCount": configured_count,
                }
            )
            totals["artifactCount"] += 1
            totals["bytes"] += path.stat().st_size
            totals["configuredTargetsAcrossArtifacts"] += configured_count
            if level == "national":
                discrepancies = _national_discrepancies(
                    document,
                    catalog=catalog,
                    targets=targets,
                    national_met=national_met,
                )
                solution["nationalSummaryVsExact"] = discrepancies
                totals["nationalComparableStatuses"] += discrepancies["comparable"]
                totals["nationalStatusDifferences"] += discrepancies["different"]
                totals["summaryMetExactNotMet"] += discrepancies[
                    "summaryMetExactNotMet"
                ]
                totals["exactMetSummaryNotMet"] += discrepancies[
                    "exactMetSummaryNotMet"
                ]
            del document
        solution["status"] = "validated"

    for solution_id, expected_hashes in plan["untargetedLandSolutions"].items():
        for level, expected_sha256 in expected_hashes.items():
            path = compact_partition_path(output_root, solution_id, level)
            if _file_sha256(path) != expected_sha256:
                raise SpeciesGoalsContractError(
                    f"untargeted artifact changed during repair: {solution_id}/{level}"
                )
    totals["untargetedArtifactCount"] = (
        len(plan["untargetedLandSolutions"]) * len(GEOGRAPHY_LEVELS)
    )
    return totals


def _write_release_inventory(
    *,
    output_root: Path,
    release_id: str,
    catalog: dict[str, Any],
    solution_ids: list[str],
) -> dict[str, Any]:
    document = {
        "format": "species-goals-release-inventory-index-v1",
        "releaseId": release_id,
        "catalogSha256": catalog["catalogSha256"],
        "solutions": {
            solution_id: {
                "format": "species-goals-release-inventory-v1",
                "validated": True,
                "solutionId": solution_id,
                "releaseId": release_id,
                "catalogValidated": True,
                "validatedGeographyLevels": list(GEOGRAPHY_LEVELS),
            }
            for solution_id in sorted(solution_ids)
        },
    }
    path = output_root / "species-goals/release-inventory-v1.json"
    _atomic_json_write(path, document)
    return {
        "relativePath": path.relative_to(output_root).as_posix(),
        "artifactSha256": _file_sha256(path),
        "solutionCount": len(document["solutions"]),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--source-solution-catalog", type=Path, required=True)
    parser.add_argument("--build-report", type=Path)
    parser.add_argument("--summaries-dir", type=Path, required=True)
    parser.add_argument(
        "--repair-solution-id",
        action="append",
        default=[],
        help="Repair only this solution after globally preflighting all 144.",
    )
    parser.add_argument("--preflight-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    started = time.monotonic()
    catalog_file = args.catalog or (
        args.output_root / "species-goals/catalog/v1/catalog.json"
    )
    build_report = args.build_report or (
        args.output_root / "species-goals-full-build-report.json"
    )
    plan, catalog, report = preflight_repair(
        output_root=args.output_root,
        catalog_path_value=catalog_file,
        source_solution_catalog_path=args.source_solution_catalog,
        build_report_path=build_report,
        summaries_dir=args.summaries_dir,
    )
    if args.preflight_only:
        print(
            "[species-target-repair] preflight passed: "
            f"{plan['preflight']['speciesSolutionCount']} solutions, "
            f"{plan['preflight']['artifactCount']} artifacts"
        )
        return 0

    selected_ids = (
        sorted(set(args.repair_solution_id))
        if args.repair_solution_id
        else sorted(plan["solutions"])
    )
    unknown = sorted(set(selected_ids) - set(plan["solutions"]))
    if unknown:
        raise SystemExit(f"[species-target-repair] unknown repair IDs: {unknown}")
    inventory_path = args.output_root / "species-goals/target-repair-v1.json"
    plan["status"] = "repairing"
    _atomic_json_write(inventory_path, plan)

    for solution_id in selected_ids:
        solution = plan["solutions"][solution_id]
        targets, national_met = load_summary_targets(
            Path(solution["summaryCsv"]),
            expected_scenario=Path(solution["solutionBasename"]).stem,
        )
        for level in GEOGRAPHY_LEVELS:
            path = compact_partition_path(args.output_root, solution_id, level)
            evidence, discrepancies = repair_partition(
                path=path,
                expected_pre_repair_sha256=solution["partitions"][level][
                    "preRepairSha256"
                ],
                catalog=catalog,
                targets=targets,
                national_met=national_met,
                target_policy_sha256=solution["targetPolicySha256"],
            )
            solution["partitions"][level].update(evidence)
            solution["partitions"][level]["state"] = "repaired"
            if discrepancies is not None:
                solution["nationalSummaryVsExact"] = discrepancies
            plan["updatedAt"] = datetime.now(timezone.utc).isoformat()
            _atomic_json_write(inventory_path, plan)
        solution["status"] = "repaired"
        _atomic_json_write(inventory_path, plan)
        print(f"[species-target-repair] repaired {solution_id}")

    all_repaired = len(selected_ids) == EXPECTED_SPECIES_SOLUTION_COUNT or all(
        all(
            partition["state"] == "repaired"
            for partition in solution["partitions"].values()
        )
        for solution in plan["solutions"].values()
    )
    if all_repaired:
        plan["status"] = "validating"
        _atomic_json_write(inventory_path, plan)
        plan["totals"] = _post_validate(
            plan=plan,
            output_root=args.output_root,
            catalog=catalog,
            summaries_dir=args.summaries_dir,
        )
        solution_ids = list(report["solutions"])
        plan["releaseInventory"] = _write_release_inventory(
            output_root=args.output_root,
            release_id=report["releaseId"],
            catalog=catalog,
            solution_ids=solution_ids,
        )
        plan["status"] = "complete"
    else:
        plan["status"] = "probe-complete"
    plan["elapsedSeconds"] = round(time.monotonic() - started, 2)
    plan["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _atomic_json_write(inventory_path, plan)
    print(
        f"[species-target-repair] {plan['status']}: {len(selected_ids)} selected "
        f"solution(s), {plan['elapsedSeconds']} seconds"
    )
    return 0


def _number(value: Any) -> float | None:
    try:
        result = float(str(value or "").strip())
    except ValueError:
        return None
    return result if math.isfinite(result) else None


def _boolean(value: Any) -> bool | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    return None


if __name__ == "__main__":
    raise SystemExit(main())
