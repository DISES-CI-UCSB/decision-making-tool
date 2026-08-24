"""Compare fresh scalar and grouped-weighted full-pipeline outputs."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

WEIGHTED_IDS = {
    "carbon_storage_biomass",
    "carbon_biomass_total",
    "soil_organic_carbon",
    "carbon_pct_of_national",
}
DROP_SIDECAR_KEYS = {"generatedAt", "artifactSha256", "payloadSha256"}
RTOL = 1e-12
ATOL = 1e-6
PROMOTION_GATE = {
    "zeroParityDrift": True,
    "weightedEquivalentWorkMinimumSpeedup": 1.5,
    "completeBoundaryPhaseMinimumSpeedup": 1.5,
    "medianOrderAdjustedWallMinimumReductionPercent": 8.0,
    "groupedRssMaximumScalarRatio": 1.15,
    "maximumResidentSetBytes": 5_000_000_000,
}


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sidecar(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _canonical_sidecar(child)
            for key, child in value.items()
            if key not in DROP_SIDECAR_KEYS
        }
    if isinstance(value, list):
        return [_canonical_sidecar(child) for child in value]
    return value


def _normalize_regular(document: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(document)
    normalized["generatedAt"] = "<timestamp>"
    normalized["solutionInputSignature"]["sha256"] = "<execution-signature>"
    provenance = normalized["metricsProvenance"]
    provenance["catalogSignature"] = "<execution-signature>"
    provenance["generationConfig"]["weightedBoundaryExecution"] = (
        "<weighted-execution>"
    )
    for scopes in normalized["geographies"].values():
        for scope in scopes.values():
            for metric in scope["metrics"]:
                if metric["metricId"] in WEIGHTED_IDS:
                    metric["value"] = "<weighted-value>"
    return normalized


def _compare_regular(
    scalar_dir: Path,
    grouped_dir: Path,
) -> dict[str, Any]:
    scalar_paths = sorted((scalar_dir / "cache").glob("*.metrics.json"))
    grouped_paths = sorted((grouped_dir / "cache").glob("*.metrics.json"))
    if [path.name for path in scalar_paths] != [path.name for path in grouped_paths]:
        raise ValueError("Regular output path sets differ.")

    structural_mismatches = 0
    tolerance_mismatches = 0
    nonzero_deltas = 0
    national_mismatches = 0
    comparison_count = 0
    max_absolute_delta = 0.0
    max_relative_delta = 0.0
    per_solution = []
    for scalar_path, grouped_path in zip(scalar_paths, grouped_paths, strict=True):
        scalar = _read(scalar_path)
        grouped = _read(grouped_path)
        structural_equal = _normalize_regular(scalar) == _normalize_regular(grouped)
        structural_mismatches += int(not structural_equal)
        solution_tolerance_mismatches = 0
        for level, scalar_scopes in scalar["geographies"].items():
            grouped_scopes = grouped["geographies"][level]
            if list(scalar_scopes) != list(grouped_scopes):
                structural_mismatches += 1
                continue
            for scope_id, scalar_scope in scalar_scopes.items():
                grouped_scope = grouped_scopes[scope_id]
                scalar_metrics = scalar_scope["metrics"]
                grouped_metrics = grouped_scope["metrics"]
                if [metric["metricId"] for metric in scalar_metrics] != [
                    metric["metricId"] for metric in grouped_metrics
                ]:
                    structural_mismatches += 1
                    continue
                for scalar_metric, grouped_metric in zip(
                    scalar_metrics, grouped_metrics, strict=True
                ):
                    if scalar_metric["metricId"] not in WEIGHTED_IDS:
                        continue
                    scalar_value = scalar_metric["value"]
                    grouped_value = grouped_metric["value"]
                    comparison_count += 1
                    if level == "national" and scalar_value != grouped_value:
                        national_mismatches += 1
                    if scalar_value is None or grouped_value is None:
                        if scalar_value != grouped_value:
                            solution_tolerance_mismatches += 1
                        continue
                    delta = abs(float(grouped_value) - float(scalar_value))
                    relative = delta / max(abs(float(scalar_value)), ATOL)
                    max_absolute_delta = max(max_absolute_delta, delta)
                    max_relative_delta = max(max_relative_delta, relative)
                    nonzero_deltas += int(delta != 0.0)
                    if not math.isclose(
                        float(grouped_value),
                        float(scalar_value),
                        rel_tol=RTOL,
                        abs_tol=ATOL,
                    ):
                        solution_tolerance_mismatches += 1
        tolerance_mismatches += solution_tolerance_mismatches
        per_solution.append(
            {
                "solutionId": scalar["solutionId"],
                "structuralEqualAfterDeclaredNormalization": structural_equal,
                "weightedToleranceMismatchCount": solution_tolerance_mismatches,
                "scalarSha256": _sha256(scalar_path),
                "groupedSha256": _sha256(grouped_path),
            }
        )
    return {
        "solutionCount": len(scalar_paths),
        "structuralMismatchCount": structural_mismatches,
        "weightedComparisonCount": comparison_count,
        "weightedToleranceMismatchCount": tolerance_mismatches,
        "weightedNonzeroDeltaCount": nonzero_deltas,
        "weightedMaxAbsoluteDelta": max_absolute_delta,
        "weightedMaxRelativeDelta": max_relative_delta,
        "nationalWeightedMismatchCount": national_mismatches,
        "rtol": RTOL,
        "atol": ATOL,
        "perSolution": per_solution,
    }


def _compare_species_goals(scalar_dir: Path, grouped_dir: Path) -> dict[str, Any]:
    scalar_root = scalar_dir / "species-goals"
    grouped_root = grouped_dir / "species-goals"
    scalar_paths = sorted(
        path.relative_to(scalar_root) for path in scalar_root.rglob("*.json")
    )
    grouped_paths = sorted(
        path.relative_to(grouped_root) for path in grouped_root.rglob("*.json")
    )
    if scalar_paths != grouped_paths:
        return {"pathSetsEqual": False, "fileCount": 0, "mismatchCount": 1}
    mismatches = 0
    for relative in scalar_paths:
        scalar = _canonical_sidecar(_read(scalar_root / relative))
        grouped = _canonical_sidecar(_read(grouped_root / relative))
        mismatches += int(scalar != grouped)
    return {
        "pathSetsEqual": True,
        "fileCount": len(scalar_paths),
        "mismatchCount": mismatches,
        "excludedKeys": sorted(DROP_SIDECAR_KEYS),
    }


def _time_metrics(path: Path) -> dict[str, float | int]:
    text = path.read_text(encoding="utf-8")
    values = {}
    for key in ("real", "user", "sys"):
        match = re.search(rf"^{key} ([0-9.]+)$", text, re.MULTILINE)
        if match is None:
            raise ValueError(f"Missing {key!r} measurement in {path}.")
        values[f"{key}Seconds"] = float(match.group(1))
    rss = re.search(
        r"^\s*([0-9]+)\s+maximum resident set size$", text, re.MULTILINE
    )
    if rss is None:
        raise ValueError(f"Missing RSS measurement in {path}.")
    values["maximumResidentSetBytes"] = int(rss.group(1))
    return values


def _phase_totals(report: dict[str, Any]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for entry in report["entries"]:
        for key, value in entry["boundaryFanout"]["phaseSeconds"].items():
            totals[key] = totals.get(key, 0.0) + float(value)
    return dict(sorted(totals.items()))


def _log_binding(root: Path) -> dict[str, Any]:
    return {
        name: {"path": str(root / name), "sha256": _sha256(root / name)}
        for name in ("stdout.log", "stderr-time.log", "publish-report.json")
    }


def _output_binding(root: Path) -> dict[str, Any]:
    paths = sorted(
        [
            *(root / "cache").glob("*.metrics.json"),
            *(root / "species-goals").rglob("*.json"),
        ],
        key=lambda path: path.relative_to(root).as_posix(),
    )
    digest = hashlib.sha256()
    total_bytes = 0
    for path in paths:
        relative = path.relative_to(root).as_posix()
        file_sha256 = _sha256(path)
        size = path.stat().st_size
        digest.update(f"{relative}\0{size}\0{file_sha256}\n".encode())
        total_bytes += size
    return {
        "root": str(root),
        "fileCount": len(paths),
        "totalBytes": total_bytes,
        "canonicalTreeSha256": digest.hexdigest(),
        "algorithm": "sha256(relative-path NUL size NUL file-sha256 LF)",
    }


def _run_evidence(
    root: Path,
    *,
    mode: str,
    pair: int,
    order: int,
) -> dict[str, Any]:
    report = _read(root / "publish-report.json")
    time = _time_metrics(root / "stderr-time.log")
    phases = _phase_totals(report)
    weighted_preparation = phases.get("weightedLayerPreparation", 0.0)
    weighted_aggregation = phases.get("weightedAggregation", 0.0)
    boundary_output = phases.get("boundaryOutput", 0.0)
    species = phases.get("species", 0.0)
    complete_boundary = sum(
        value for key, value in phases.items() if key != "species"
    )
    return {
        "pair": pair,
        "orderWithinPair": order,
        "weightedBoundaryFanout": mode,
        "cacheState": "fresh recompute-all; isolated output",
        "wallSeconds": time["realSeconds"],
        "speciesSeconds": species,
        "weightedPreparationSeconds": weighted_preparation,
        "weightedAggregationSeconds": weighted_aggregation,
        "weightedPhaseIncludingPreparationSeconds": (
            weighted_preparation + weighted_aggregation + boundary_output
        ),
        "boundaryOutputSeconds": boundary_output,
        "completeBoundaryPhaseSeconds": complete_boundary,
        "outputSeconds": phases.get("output", 0.0),
        "maximumResidentSetBytes": time["maximumResidentSetBytes"],
        "time": time,
        "phaseSeconds": phases,
        "failures": len(report["failures"]),
        "bindings": {
            **_log_binding(root),
            "outputs": _output_binding(root),
        },
    }


def _speedup(numerator: float, denominator: float) -> float:
    if denominator <= 0.0:
        raise ValueError("Measured denominator must be positive.")
    return numerator / denominator


def _pair_performance(
    scalar: dict[str, Any],
    grouped: dict[str, Any],
) -> dict[str, float]:
    wall_speedup = _speedup(scalar["wallSeconds"], grouped["wallSeconds"])
    return {
        "wallSpeedup": wall_speedup,
        "wallReductionPercent": (1.0 - 1.0 / wall_speedup) * 100.0,
        "weightedEquivalentWorkSpeedupIncludingPreparation": _speedup(
            scalar["boundaryOutputSeconds"],
            grouped["weightedPhaseIncludingPreparationSeconds"],
        ),
        "postPreparationWeightedAggregationAndOutputSpeedup": _speedup(
            scalar["boundaryOutputSeconds"],
            grouped["weightedAggregationSeconds"]
            + grouped["boundaryOutputSeconds"],
        ),
        "completeBoundaryPhaseSpeedup": _speedup(
            scalar["completeBoundaryPhaseSeconds"],
            grouped["completeBoundaryPhaseSeconds"],
        ),
        "groupedToScalarRssRatio": _speedup(
            grouped["maximumResidentSetBytes"],
            scalar["maximumResidentSetBytes"],
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--first-scalar-dir", type=Path, required=True)
    parser.add_argument("--first-grouped-dir", type=Path, required=True)
    parser.add_argument("--second-grouped-dir", type=Path, required=True)
    parser.add_argument("--second-scalar-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--checksum-output", type=Path, required=True)
    args = parser.parse_args()

    # The promotion contract above is intentionally declared before any second-pair
    # artifact is read. Results can satisfy or fail it, but cannot redefine it.
    first_scalar = _run_evidence(
        args.first_scalar_dir,
        mode="scalar",
        pair=1,
        order=1,
    )
    first_grouped = _run_evidence(
        args.first_grouped_dir,
        mode="grouped-weighted-v1",
        pair=1,
        order=2,
    )
    second_grouped = _run_evidence(
        args.second_grouped_dir,
        mode="grouped-weighted-v1",
        pair=2,
        order=1,
    )
    second_scalar = _run_evidence(
        args.second_scalar_dir,
        mode="scalar",
        pair=2,
        order=2,
    )
    runs = {
        "pair1ScalarFirst": first_scalar,
        "pair1GroupedSecond": first_grouped,
        "pair2GroupedFirst": second_grouped,
        "pair2ScalarSecond": second_scalar,
    }
    comparisons = {
        "pair1ScalarVsGrouped": {
            "regular": _compare_regular(
                args.first_scalar_dir, args.first_grouped_dir
            ),
            "speciesGoals": _compare_species_goals(
                args.first_scalar_dir, args.first_grouped_dir
            ),
        },
        "pair2ScalarVsGrouped": {
            "regular": _compare_regular(
                args.second_scalar_dir, args.second_grouped_dir
            ),
            "speciesGoals": _compare_species_goals(
                args.second_scalar_dir, args.second_grouped_dir
            ),
        },
        "repeatedScalar": {
            "regular": _compare_regular(
                args.first_scalar_dir, args.second_scalar_dir
            ),
            "speciesGoals": _compare_species_goals(
                args.first_scalar_dir, args.second_scalar_dir
            ),
        },
        "repeatedGrouped": {
            "regular": _compare_regular(
                args.first_grouped_dir, args.second_grouped_dir
            ),
            "speciesGoals": _compare_species_goals(
                args.first_grouped_dir, args.second_grouped_dir
            ),
        },
    }
    pair_performance = [
        _pair_performance(first_scalar, first_grouped),
        _pair_performance(second_scalar, second_grouped),
    ]
    wall_speedups = [item["wallSpeedup"] for item in pair_performance]
    wall_reductions = [item["wallReductionPercent"] for item in pair_performance]
    weighted_speedups = [
        item["weightedEquivalentWorkSpeedupIncludingPreparation"]
        for item in pair_performance
    ]
    post_preparation_speedups = [
        item["postPreparationWeightedAggregationAndOutputSpeedup"]
        for item in pair_performance
    ]
    complete_boundary_speedups = [
        item["completeBoundaryPhaseSpeedup"] for item in pair_performance
    ]
    rss_ratios = [
        item["groupedToScalarRssRatio"] for item in pair_performance
    ]
    order_adjusted_wall_speedup = math.prod(wall_speedups) ** (
        1.0 / len(wall_speedups)
    )
    order_adjusted_wall_reduction = (
        1.0 - 1.0 / order_adjusted_wall_speedup
    ) * 100.0
    median_wall_reduction = sum(sorted(wall_reductions)[0:2]) / 2.0

    pair_parity = all(
        comparison["regular"]["solutionCount"] == 8
        and comparison["regular"]["structuralMismatchCount"] == 0
        and comparison["regular"]["weightedToleranceMismatchCount"] == 0
        and comparison["regular"]["nationalWeightedMismatchCount"] == 0
        and comparison["speciesGoals"]["pathSetsEqual"]
        and comparison["speciesGoals"]["fileCount"] == 99
        and comparison["speciesGoals"]["mismatchCount"] == 0
        for name, comparison in comparisons.items()
        if name.startswith("pair")
    )
    repeat_parity = all(
        comparison["regular"]["solutionCount"] == 8
        and comparison["regular"]["structuralMismatchCount"] == 0
        and comparison["regular"]["weightedNonzeroDeltaCount"] == 0
        and comparison["regular"]["nationalWeightedMismatchCount"] == 0
        and comparison["speciesGoals"]["pathSetsEqual"]
        and comparison["speciesGoals"]["fileCount"] == 99
        and comparison["speciesGoals"]["mismatchCount"] == 0
        for name, comparison in comparisons.items()
        if name.startswith("repeated")
    )
    gates = {
        "zeroParityDrift": pair_parity and repeat_parity,
        "weightedEquivalentWorkAtLeast1_5xFaster": min(weighted_speedups) >= 1.5,
        "completeBoundaryPhaseAtLeast1_5xFaster": (
            min(complete_boundary_speedups) >= 1.5
        ),
        "medianAndOrderAdjustedFullWallAtLeast8PercentFaster": (
            median_wall_reduction >= 8.0
            and order_adjusted_wall_reduction >= 8.0
        ),
        "rssNoMoreThan15PercentAboveScalar": max(rss_ratios) <= 1.15,
        "rssBelow5GB": max(
            run["maximumResidentSetBytes"] for run in runs.values()
        )
        < 5_000_000_000,
        "zeroPipelineFailures": all(run["failures"] == 0 for run in runs.values()),
    }
    first_report = _read(args.first_scalar_dir / "publish-report.json")
    solution_args = " ".join(
        f"--solution-id {item['solutionId']}"
        for item in comparisons["pair1ScalarVsGrouped"]["regular"]["perSolution"]
    )
    common_command = (
        "data/metrics/python/.venv/bin/python "
        "data/metrics/python/metrics_pipeline/main.py "
        f"--manifest-url {first_report['manifestUrl']} "
        "--cache-dir data/metrics/cache/releases/solutions-v0-2-0-20260805 "
        "--release-id solutions-v0-2-0-20260805 "
        "--solution-catalog data/metrics/generated/releases/"
        "solutions-v0-2-0-20260805/solution-catalog.json "
        "--species-exception-contract data/metrics/release-specs/"
        "solutions-v0-2-0-20260805/species-exception.json "
        "--cache-policy recompute-all "
        f"{solution_args}"
    )
    def command(mode: str, output_dir: Path) -> str:
        return (
            "env PYTHONUNBUFFERED=1 "
            "METRICS_SPECIES_EXECUTION=solution-microbatch-v2 "
            "METRICS_SPECIES_BATCH_SIZE=8 METRICS_BOUNDARY_FANOUT=grouped "
            f"METRICS_WEIGHTED_BOUNDARY_FANOUT={mode} "
            "METRICS_LAYER_SOURCE=dense /usr/bin/time -lp "
            f"{common_command} --output-dir {output_dir} "
            f"--species-goals-output-dir {output_dir / 'species-goals'} "
            f"> {output_dir / 'stdout.log'} 2> {output_dir / 'stderr-time.log'}"
        )

    evidence = {
        "format": "weighted-boundary-fanout-counterbalanced-ab-v2",
        "classification": (
            "four fresh processes; counterbalanced eight-solution full-pipeline A/B"
        ),
        "predeclaredPromotionGate": PROMOTION_GATE,
        "passed": all(gates.values()),
        "recommendation": (
            "Eligible for independent review as explicit grouped-weighted-v1 opt-in; "
            "retain scalar default."
            if all(gates.values())
            else "NO-GO for promotion gate; retain scalar default and explicit opt-in only."
        ),
        "gates": gates,
        "execution": {
            "common": {
                "speciesExecution": "solution-microbatch-v2",
                "speciesBatchSize": 8,
                "boundaryFanout": "grouped",
                "layerSource": "dense",
                "cachePolicy": "recompute-all",
            },
            "order": [
                "pair1 scalar",
                "pair1 grouped-weighted-v1",
                "pair2 grouped-weighted-v1",
                "pair2 scalar",
            ],
            "reproducibleCommands": {
                "pair1ScalarFirst": command("scalar", args.first_scalar_dir),
                "pair1GroupedSecond": command(
                    "grouped-weighted-v1", args.first_grouped_dir
                ),
                "pair2GroupedFirst": command(
                    "grouped-weighted-v1", args.second_grouped_dir
                ),
                "pair2ScalarSecond": command("scalar", args.second_scalar_dir),
            },
            "runs": runs,
        },
        "performance": {
            "paired": pair_performance,
            "orderAdjusted": {
                "fullWallSpeedupGeometricMean": order_adjusted_wall_speedup,
                "fullWallReductionPercent": order_adjusted_wall_reduction,
                "medianPairedWallReductionPercent": median_wall_reduction,
                "weightedEquivalentWorkSpeedupGeometricMean": (
                    math.prod(weighted_speedups) ** (1.0 / len(weighted_speedups))
                ),
                "postPreparationSpeedupGeometricMean": (
                    math.prod(post_preparation_speedups)
                    ** (1.0 / len(post_preparation_speedups))
                ),
                "completeBoundaryPhaseSpeedupGeometricMean": (
                    math.prod(complete_boundary_speedups)
                    ** (1.0 / len(complete_boundary_speedups))
                ),
            },
            "twoOrderingRange": {
                "fullWallReductionPercent": [
                    min(wall_reductions),
                    max(wall_reductions),
                ],
                "weightedEquivalentWorkSpeedupIncludingPreparation": [
                    min(weighted_speedups),
                    max(weighted_speedups),
                ],
                "postPreparationWeightedAggregationAndOutputSpeedup": [
                    min(post_preparation_speedups),
                    max(post_preparation_speedups),
                ],
                "completeBoundaryPhaseSpeedup": [
                    min(complete_boundary_speedups),
                    max(complete_boundary_speedups),
                ],
            },
            "measurementNote": (
                "The primary weighted claim includes grouped weighted-layer preparation, "
                "weighted aggregation, and weighted boundary output. The much larger "
                "post-preparation ratio is retained only under that explicit label. "
                "Complete boundary phase excludes species and includes setup, ordinary "
                "layer preparation, grouped aggregation, weighted work, boundary output, "
                "and output serialization. Full-wall differences include unrelated "
                "species runtime variation and are not attributed to weighted fanout."
            ),
        },
        "parity": comparisons,
        "declaredNormalization": {
            "regular": [
                "generatedAt",
                "solutionInputSignature.sha256",
                "metricsProvenance.catalogSignature",
                "metricsProvenance.generationConfig.weightedBoundaryExecution",
                "weighted metric values (compared separately with tolerance)",
            ],
            "speciesGoals": sorted(DROP_SIDECAR_KEYS),
        },
    }
    args.output.write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    checksum = {
        "format": "weighted-boundary-fanout-counterbalanced-ab-checksum-v2",
        "path": str(args.output),
        "sha256": _sha256(args.output),
    }
    args.checksum_output.write_text(
        json.dumps(checksum, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "passed": evidence["passed"],
                "gates": gates,
                "orderAdjusted": evidence["performance"]["orderAdjusted"],
            }
        )
    )
    return 0 if evidence["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
