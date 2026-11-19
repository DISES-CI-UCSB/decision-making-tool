"""Build and validate the release-wide species target overlay.

The overlay is metadata-only. It reads the shared species catalog and the exact
catalog-selected summary CSV for every land solution; it never opens a raster.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any

from species_goals import (
    SpeciesGoalsContractError,
    _atomic_json_write,
    _file_sha256,
    canonical_sha256,
    validate_catalog,
)
from species_target_policy import normalize_species_feature_id

OVERLAY_FORMAT = "species-target-overlays-v1"
OVERLAY_ROW_LAYOUT = ["speciesIndex", "targetPercent"]
OVERLAY_RELATIVE_PATH = Path(
    "species-goals/targets/v1/species-target-overlays-v1.json"
)
SUPPORTED_EVALUATIONS = frozenset({"prioritizr_model", "post-hoc"})


def build_species_target_overlays(
    *,
    catalog_path: Path,
    solution_catalog_path: Path,
    summaries_dir: Path,
    full_build_report_path: Path,
    repair_inventory_path: Path | None = None,
) -> dict[str, Any]:
    catalog = validate_catalog(json.loads(catalog_path.read_text(encoding="utf-8")))
    solution_catalog = json.loads(solution_catalog_path.read_text(encoding="utf-8"))
    full_build_report = json.loads(
        full_build_report_path.read_text(encoding="utf-8")
    )
    release_id = solution_catalog.get("releaseId")
    if (
        solution_catalog.get("format") != "solution-catalog-v1"
        or not isinstance(release_id, str)
        or full_build_report.get("releaseId") != release_id
        or full_build_report.get("catalog", {}).get("catalogSha256")
        != catalog["catalogSha256"]
    ):
        raise SpeciesGoalsContractError("overlay input release/catalog provenance differs")

    land_solutions = sorted(
        (
            item
            for item in solution_catalog.get("solutions", [])
            if item.get("domain") == "land"
        ),
        key=lambda item: item["solutionId"],
    )
    if (
        len(land_solutions) != 168
        or solution_catalog.get("expectedLandSolutionCount") != 168
    ):
        raise SpeciesGoalsContractError("overlay requires exactly 168 land solutions")

    catalog_index = {
        normalize_species_feature_id(row[1]): index
        for index, row in enumerate(catalog["rows"])
    }
    target_maps_by_sha: dict[str, dict[str, Any]] = {}
    solution_map_sha: dict[str, str | None] = {}
    summary_rows: list[list[str]] = []
    source_target_counts: dict[str, int] = {}
    unavailable_target_ids: set[str] = set()
    explicit_zero_target_ids: set[str] = set()

    for solution in land_solutions:
        solution_id = solution["solutionId"]
        scenario = Path(solution["solutionBasename"]).stem
        summary_path = summaries_dir / f"{scenario}_summary.csv"
        if not summary_path.is_file():
            raise SpeciesGoalsContractError(
                f"catalog-selected summary is missing: {summary_path}"
            )
        summary_sha256 = _file_sha256(summary_path)
        summary_rows.append([solution_id, summary_sha256])
        targets = _load_summary_targets(
            summary_path, expected_scenario=scenario
        )
        unknown = sorted(set(targets) - set(catalog_index))
        if unknown:
            raise SpeciesGoalsContractError(
                f"{summary_path} targets unknown catalog species: {unknown[:8]}"
            )
        source_target_counts[solution_id] = len(targets)
        if not targets:
            solution_map_sha[solution_id] = None
            continue

        rows: list[list[int | float]] = []
        unavailable_rows: list[list[int | float]] = []
        for feature_id, target in sorted(
            targets.items(), key=lambda item: catalog_index[item[0]]
        ):
            target = int(target) if target.is_integer() else target
            species_index = catalog_index[feature_id]
            destination = (
                unavailable_rows
                if catalog["rows"][species_index][5] == "unavailable"
                else rows
            )
            destination.append([species_index, target])
            if target == 0:
                explicit_zero_target_ids.add(catalog["rows"][species_index][0])
            if destination is unavailable_rows:
                unavailable_target_ids.add(catalog["rows"][species_index][0])

        canonical_content = {
            "rows": rows,
            "unavailableRows": unavailable_rows,
        }
        map_sha256 = canonical_sha256(canonical_content)
        existing = target_maps_by_sha.get(map_sha256)
        if existing is not None and (
            existing["rows"] != rows
            or existing["unavailableRows"] != unavailable_rows
        ):
            raise SpeciesGoalsContractError("canonical target-map hash collision")
        target_maps_by_sha[map_sha256] = {
            "canonicalSha256": map_sha256,
            "sourceTargetCount": len(targets),
            "applicableTargetCount": len(rows),
            "unavailableTargetCount": len(unavailable_rows),
            "rows": rows,
            "unavailableRows": unavailable_rows,
        }
        solution_map_sha[solution_id] = map_sha256

    target_map_ids = {
        sha256: f"target-map-{index + 1}"
        for index, sha256 in enumerate(sorted(target_maps_by_sha))
    }
    target_maps = {
        target_map_ids[sha256]: target_maps_by_sha[sha256]
        for sha256 in sorted(target_maps_by_sha)
    }
    solutions = {
        solution_id: (
            target_map_ids[map_sha256] if map_sha256 is not None else None
        )
        for solution_id, map_sha256 in sorted(solution_map_sha.items())
    }
    targeted_count = sum(map_id is not None for map_id in solutions.values())

    document: dict[str, Any] = {
        "format": OVERLAY_FORMAT,
        "releaseId": release_id,
        "catalogSha256": catalog["catalogSha256"],
        "rowLayout": OVERLAY_ROW_LAYOUT,
        "provenance": {
            "catalogArtifactSha256": _file_sha256(catalog_path),
            "solutionCatalogArtifactSha256": _file_sha256(solution_catalog_path),
            "fullBuildReportArtifactSha256": _file_sha256(full_build_report_path),
            "sourceSummariesSha256": canonical_sha256(summary_rows),
            "sourceSummaries": summary_rows,
        },
        "inventory": {
            "solutionCount": len(solutions),
            "targetedSolutionCount": targeted_count,
            "untargetedSolutionCount": len(solutions) - targeted_count,
            "targetMapCount": len(target_maps),
            "sourceSummaryCount": len(summary_rows),
            "sourceTargetCountBySolution": source_target_counts,
            "unavailableTargetSpeciesIds": sorted(unavailable_target_ids),
            "explicitZeroTargetSpeciesIds": sorted(explicit_zero_target_ids),
        },
        "targetMaps": target_maps,
        "solutions": solutions,
        "legacyEmbeddedTargetRepairEvidence": _legacy_repair_evidence(
            repair_inventory_path
        ),
    }
    body_sha256 = canonical_sha256(document)
    document["completion"] = {
        "format": "species-target-overlays-completion-v1",
        "status": "complete",
        "payloadSha256": body_sha256,
    }
    return validate_species_target_overlays(document, catalog=catalog)


def validate_species_target_overlays(
    document: Any, *, catalog: dict[str, Any]
) -> dict[str, Any]:
    validate_catalog(catalog)
    if not isinstance(document, dict) or document.get("format") != OVERLAY_FORMAT:
        raise SpeciesGoalsContractError("unsupported species target overlay format")
    expected_keys = {
        "format",
        "releaseId",
        "catalogSha256",
        "rowLayout",
        "provenance",
        "inventory",
        "targetMaps",
        "solutions",
        "legacyEmbeddedTargetRepairEvidence",
        "completion",
    }
    if set(document) != expected_keys:
        raise SpeciesGoalsContractError("species target overlay fields are invalid")
    if (
        document["catalogSha256"] != catalog["catalogSha256"]
        or document["rowLayout"] != OVERLAY_ROW_LAYOUT
        or not isinstance(document["solutions"], dict)
        or len(document["solutions"]) != 168
        or not isinstance(document["targetMaps"], dict)
    ):
        raise SpeciesGoalsContractError("species target overlay catalog/inventory is invalid")

    map_ids = set(document["targetMaps"])
    for solution_id, map_id in document["solutions"].items():
        if not isinstance(solution_id, str) or (
            map_id is not None and map_id not in map_ids
        ):
            raise SpeciesGoalsContractError("species target solution mapping is invalid")

    seen_hashes: set[str] = set()
    for target_map in document["targetMaps"].values():
        if (
            not isinstance(target_map, dict)
            or set(target_map)
            != {
                "canonicalSha256",
                "sourceTargetCount",
                "applicableTargetCount",
                "unavailableTargetCount",
                "rows",
                "unavailableRows",
            }
        ):
            raise SpeciesGoalsContractError("species target map fields are invalid")
        rows = target_map["rows"]
        unavailable_rows = target_map["unavailableRows"]
        _validate_target_rows(rows, catalog, unavailable=False)
        _validate_target_rows(unavailable_rows, catalog, unavailable=True)
        canonical = canonical_sha256(
            {"rows": rows, "unavailableRows": unavailable_rows}
        )
        if canonical != target_map["canonicalSha256"] or canonical in seen_hashes:
            raise SpeciesGoalsContractError(
                "species target maps are not canonically deduplicated"
            )
        seen_hashes.add(canonical)
        if (
            target_map["applicableTargetCount"] != len(rows)
            or target_map["unavailableTargetCount"] != len(unavailable_rows)
            or target_map["sourceTargetCount"] != len(rows) + len(unavailable_rows)
        ):
            raise SpeciesGoalsContractError("species target map counts are invalid")

    inventory = document["inventory"]
    if (
        inventory.get("solutionCount") != 168
        or inventory.get("targetedSolutionCount")
        != sum(value is not None for value in document["solutions"].values())
        or inventory.get("untargetedSolutionCount")
        != sum(value is None for value in document["solutions"].values())
        or inventory.get("targetMapCount") != len(document["targetMaps"])
        or inventory.get("sourceSummaryCount") != 168
    ):
        raise SpeciesGoalsContractError("species target overlay inventory is invalid")
    completion = document["completion"]
    body = {key: value for key, value in document.items() if key != "completion"}
    if (
        not isinstance(completion, dict)
        or completion.get("format") != "species-target-overlays-completion-v1"
        or completion.get("status") != "complete"
        or completion.get("payloadSha256") != canonical_sha256(body)
    ):
        raise SpeciesGoalsContractError("species target overlay checksum is invalid")
    return document


def _validate_target_rows(
    rows: Any, catalog: dict[str, Any], *, unavailable: bool
) -> None:
    if not isinstance(rows, list):
        raise SpeciesGoalsContractError("species target rows must be an array")
    previous = -1
    for row in rows:
        if (
            not isinstance(row, list)
            or len(row) != 2
            or not isinstance(row[0], int)
            or isinstance(row[0], bool)
            or row[0] <= previous
            or row[0] >= len(catalog["rows"])
            or not isinstance(row[1], (int, float))
            or isinstance(row[1], bool)
            or not 0 <= row[1] <= 100
            or (catalog["rows"][row[0]][5] == "unavailable") != unavailable
        ):
            raise SpeciesGoalsContractError("species target row is invalid")
        previous = row[0]


def _load_summary_targets(
    path: Path, *, expected_scenario: str
) -> dict[str, float]:
    targets: dict[str, float] = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {
            "feature",
            "feature_type",
            "relative_target",
            "evaluated",
            "scenario",
        }
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise SpeciesGoalsContractError(f"{path} has an invalid summary schema")
        for index, row in enumerate(reader, start=2):
            scenario = str(row.get("scenario") or "").strip()
            if scenario != expected_scenario:
                raise SpeciesGoalsContractError(
                    f"{path}:{index} scenario {scenario!r} does not match "
                    f"{expected_scenario!r}"
                )
            feature_type = str(row.get("feature_type") or "").strip().lower()
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
            target_percent = target * 100 if abs(target) <= 1 else target
            if not 0 <= target_percent <= 100:
                raise SpeciesGoalsContractError(
                    f"{path}:{index} has invalid species target {target!r}"
                )
            feature_id = normalize_species_feature_id(str(row.get("feature") or ""))
            if not feature_id:
                raise SpeciesGoalsContractError(f"{path}:{index} has no species feature")
            if feature_id in targets:
                raise SpeciesGoalsContractError(
                    f"{path}:{index} has duplicate species target {feature_id!r}"
                )
            targets[feature_id] = round(target_percent, 6)
    return targets


def _number(value: Any) -> float | None:
    try:
        result = float(str(value or "").strip())
    except ValueError:
        return None
    return result if math.isfinite(result) else None


def _legacy_repair_evidence(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.is_file():
        return None
    inventory = json.loads(path.read_text(encoding="utf-8"))
    complete: list[str] = []
    partial: dict[str, list[str]] = {}
    modified_count = 0
    for solution_id, solution in sorted(inventory.get("solutions", {}).items()):
        levels = sorted(
            level
            for level, partition in solution.get("partitions", {}).items()
            if partition.get("state") == "repaired"
        )
        if not levels:
            continue
        modified_count += len(levels)
        if len(levels) == 6 and solution.get("status") == "repaired":
            complete.append(solution_id)
        else:
            partial[solution_id] = levels
    return {
        "repairInventoryArtifactSha256": _file_sha256(path),
        "completeSolutionIds": complete,
        "partialSolutionLevels": partial,
        "modifiedArtifactCount": modified_count,
        "legacyFieldsOverriddenByOverlay": True,
    }


def write_species_target_overlays(path: Path, document: dict[str, Any]) -> None:
    _atomic_json_write(path, document)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--solution-catalog", type=Path, required=True)
    parser.add_argument("--summaries-dir", type=Path, required=True)
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--full-build-report", type=Path)
    parser.add_argument("--repair-inventory", type=Path)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    output_path = args.output_root / OVERLAY_RELATIVE_PATH
    catalog_path = args.catalog or (
        args.output_root / "species-goals/catalog/v1/catalog.json"
    )
    if args.validate_only:
        catalog = validate_catalog(json.loads(catalog_path.read_text(encoding="utf-8")))
        validate_species_target_overlays(
            json.loads(output_path.read_text(encoding="utf-8")),
            catalog=catalog,
        )
        print(f"[species-target-overlays] validated {output_path}")
        return 0

    document = build_species_target_overlays(
        catalog_path=catalog_path,
        solution_catalog_path=args.solution_catalog,
        summaries_dir=args.summaries_dir,
        full_build_report_path=args.full_build_report
        or args.output_root / "species-goals-full-build-report.json",
        repair_inventory_path=args.repair_inventory
        or args.output_root / "species-goals/target-repair-v1.json",
    )
    write_species_target_overlays(output_path, document)
    print(
        f"[species-target-overlays] wrote {output_path} "
        f"({output_path.stat().st_size} bytes, "
        f"{document['inventory']['targetMapCount']} target maps)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
