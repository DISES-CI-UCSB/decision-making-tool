"""Canonical full-output parity evidence for species execution candidates."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any

RUNTIME_TIMESTAMP_KEYS = frozenset({"generatedAt"})
RUNTIME_DERIVED_CHECKSUM_KEYS = frozenset({"artifactSha256", "payloadSha256"})
EXECUTION_DERIVED_SIGNATURE_FIELDS = (
    "solutionInputSignature.sha256",
    "metricsProvenance.catalogSignature.digest",
    "metricsProvenance.generationConfig.speciesExecution",
)
BUFFERED_V2_ACCUMULATOR_GATE = 1.5
PROCESS_TIME_PATTERN = re.compile(
    r"^\s*(?P<real>[0-9.]+) real\s+(?P<user>[0-9.]+) user\s+"
    r"(?P<system>[0-9.]+) sys$",
    re.MULTILINE,
)
RSS_PATTERN = re.compile(
    r"^\s*(?P<rss>[0-9]+)\s+maximum resident set size$",
    re.MULTILINE,
)


class CandidateEvidenceError(RuntimeError):
    """Raised when candidate outputs cannot be compared completely."""


def canonical_json_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def canonical_metrics_document(document: dict[str, Any]) -> dict[str, Any]:
    """Remove only runtime timestamps and execution-mode-derived provenance."""

    value = _without_runtime_timestamps(copy.deepcopy(document))
    solution_signature = value.get("solutionInputSignature")
    if isinstance(solution_signature, dict) and "sha256" in solution_signature:
        solution_signature["sha256"] = "<execution-derived>"
    provenance = value.get("metricsProvenance")
    if isinstance(provenance, dict):
        catalog_signature = provenance.get("catalogSignature")
        if isinstance(catalog_signature, str):
            prefix, separator, _digest = catalog_signature.rpartition(":")
            provenance["catalogSignature"] = (
                f"{prefix}:<execution-derived>" if separator else catalog_signature
            )
        generation = provenance.get("generationConfig")
        if isinstance(generation, dict):
            generation.pop("speciesExecution", None)
    return value


def canonical_species_goal_document(document: dict[str, Any]) -> dict[str, Any]:
    return _without_runtime_fields(copy.deepcopy(document))


def compare_candidate_outputs(
    independent_root: Path,
    microbatch_root: Path,
) -> dict[str, Any]:
    independent_report = _read_json(independent_root / "publish-report.json")
    microbatch_report = _read_json(microbatch_root / "publish-report.json")
    independent_ids = [
        str(entry["solutionId"]) for entry in independent_report.get("entries", [])
    ]
    microbatch_ids = [
        str(entry["solutionId"]) for entry in microbatch_report.get("entries", [])
    ]
    expected_ids = independent_ids
    order_matches = independent_ids == microbatch_ids
    metric_status_mismatches = 0
    metric_document_mismatches = 0
    details_mismatches = 0
    completeness_mismatches = 0
    per_solution: list[dict[str, Any]] = []
    for solution_id in expected_ids:
        independent = _read_json(
            independent_root / "cache" / f"{solution_id}.metrics.json"
        )
        microbatch = _read_json(
            microbatch_root / "cache" / f"{solution_id}.metrics.json"
        )
        independent_metrics = canonical_metrics_document(independent)
        microbatch_metrics = canonical_metrics_document(microbatch)
        metric_equal = independent_metrics == microbatch_metrics
        status_count = _metric_status_mismatch_count(independent, microbatch)
        detail_count = _metric_details_mismatch_count(independent, microbatch)
        completeness_equal = (
            independent.get("speciesCompleteness")
            == microbatch.get("speciesCompleteness")
        )
        metric_document_mismatches += int(not metric_equal)
        metric_status_mismatches += status_count
        details_mismatches += detail_count
        completeness_mismatches += int(not completeness_equal)
        per_solution.append(
            {
                "solutionId": solution_id,
                "canonicalIndependentSha256": canonical_json_sha256(
                    independent_metrics
                ),
                "canonicalMicrobatchSha256": canonical_json_sha256(
                    microbatch_metrics
                ),
                "canonicalDocumentEqual": metric_equal,
                "metricStatusMismatchCount": status_count,
                "metricDetailsMismatchCount": detail_count,
                "speciesCompletenessEqual": completeness_equal,
            }
        )

    species_goals = _compare_species_goal_trees(
        independent_root / "species-goals",
        microbatch_root / "species-goals",
    )
    return {
        "orderedSolutionIds": expected_ids,
        "outputOrderEqual": order_matches,
        "solutionCount": len(expected_ids),
        "canonicalDocumentMismatchCount": metric_document_mismatches,
        "metricStatusMismatchCount": metric_status_mismatches,
        "metricDetailsMismatchCount": details_mismatches,
        "speciesCompletenessMismatchCount": completeness_mismatches,
        "speciesGoals": species_goals,
        "perSolution": per_solution,
    }


def parse_process_metrics(log_path: Path) -> dict[str, float | int]:
    text = log_path.read_text(encoding="utf-8")
    timing = PROCESS_TIME_PATTERN.search(text)
    rss = RSS_PATTERN.search(text)
    if timing is None or rss is None:
        raise CandidateEvidenceError(f"Process metrics are missing from {log_path}.")
    return {
        "wallSeconds": float(timing.group("real")),
        "userSeconds": float(timing.group("user")),
        "systemSeconds": float(timing.group("system")),
        "peakRssBytes": int(rss.group("rss")),
    }


def execution_metrics(report: dict[str, Any]) -> dict[str, Any]:
    runtimes: list[dict[str, Any]] = []
    seen_batches: set[int] = set()
    output_seconds = 0.0
    for entry in report.get("entries", []):
        output_seconds += float(
            entry.get("boundaryFanout", {})
            .get("phaseSeconds", {})
            .get("output", 0.0)
        )
        execution = entry.get("speciesExecution")
        runtime = execution.get("runtime") if isinstance(execution, dict) else None
        if not isinstance(runtime, dict):
            raise CandidateEvidenceError("An entry lacks species execution runtime.")
        batch_ordinal = runtime.get("batchOrdinal")
        if isinstance(batch_ordinal, int):
            if batch_ordinal in seen_batches:
                continue
            seen_batches.add(batch_ordinal)
        runtimes.append(runtime)
    phase_names = ("exactRead", "evaluation", "accumulator")
    return {
        "npzOpens": sum(int(runtime.get("npzOpens", 0)) for runtime in runtimes),
        "npzBytes": sum(int(runtime.get("npzBytes", 0)) for runtime in runtimes),
        "phaseSeconds": {
            phase: sum(
                float(runtime.get("phaseSeconds", {}).get(phase, 0.0))
                for runtime in runtimes
            )
            for phase in phase_names
        }
        | {"output": output_seconds},
    }


def build_evidence(
    *,
    independent_root: Path,
    microbatch_root: Path,
    independent_log: Path,
    microbatch_log: Path | None = None,
    microbatch_process_metrics: dict[str, float | int] | None = None,
    candidate_schema: str = "microbatch-v1",
) -> dict[str, Any]:
    parity = compare_candidate_outputs(independent_root, microbatch_root)
    independent_report = _read_json(independent_root / "publish-report.json")
    microbatch_report = _read_json(microbatch_root / "publish-report.json")
    independent = {
        **parse_process_metrics(independent_log),
        **execution_metrics(independent_report),
    }
    microbatch = {
        **(
            parse_process_metrics(microbatch_log)
            if microbatch_log is not None
            else microbatch_process_metrics or {}
        ),
        **execution_metrics(microbatch_report),
    }
    if not {"wallSeconds", "userSeconds", "systemSeconds", "peakRssBytes"} <= set(
        microbatch
    ):
        raise CandidateEvidenceError("Microbatch process metrics are incomplete.")
    species_speedup = (
        independent["phaseSeconds"]["evaluation"]
        + independent["phaseSeconds"]["exactRead"]
        + independent["phaseSeconds"]["accumulator"]
    ) / (
        microbatch["phaseSeconds"]["evaluation"]
        + microbatch["phaseSeconds"]["exactRead"]
        + microbatch["phaseSeconds"]["accumulator"]
    )
    parity_gates = {
        "microbatchPeakRssBelow16GiB": microbatch["peakRssBytes"] < 16 * 1024**3,
        "metricStatusMismatchCountZero": parity["metricStatusMismatchCount"] == 0,
        "metricDetailsMismatchCountZero": parity["metricDetailsMismatchCount"] == 0,
        "canonicalDocumentsEqual": parity["canonicalDocumentMismatchCount"] == 0,
        "speciesCompletenessEqual": (
            parity["speciesCompletenessMismatchCount"] == 0
        ),
        "speciesGoalsEqual": parity["speciesGoals"]["mismatchCount"] == 0,
        "outputOrderEqual": parity["outputOrderEqual"],
    }
    declared_exclusions = {
        "runtimeTimestampKeys": sorted(RUNTIME_TIMESTAMP_KEYS),
        "runtimeTimestampDerivedChecksumKeys": sorted(
            RUNTIME_DERIVED_CHECKSUM_KEYS
        ),
        "executionModeProvenance": list(EXECUTION_DERIVED_SIGNATURE_FIELDS),
    }
    if candidate_schema == "buffered-v2":
        accumulator_speedup = (
            independent["phaseSeconds"]["accumulator"]
            / microbatch["phaseSeconds"]["accumulator"]
        )
        wall_speedup = independent["wallSeconds"] / microbatch["wallSeconds"]
        gates = {
            "accumulatorSpeedupAtLeast1_5x": (
                accumulator_speedup >= BUFFERED_V2_ACCUMULATOR_GATE
            ),
            **parity_gates,
        }
        return {
            "format": "species-solution-buffered-full-catalog-candidate-v2",
            "classification": (
                "fresh-process full-catalog eight-solution v1-vs-buffered-v2 "
                "candidate"
            ),
            "declaredCanonicalExclusions": declared_exclusions,
            "performanceGate": {
                "metric": "accumulatorSpeedup",
                "operator": ">=",
                "threshold": BUFFERED_V2_ACCUMULATOR_GATE,
                "predeclaredExperimentTarget": True,
                "rationale": (
                    "Buffered v2 changes only accumulator delivery, so its "
                    "predeclared >=1.5x accumulator target is the hard performance "
                    "gate. End-to-end wall and combined species speedups are reported "
                    "separately; this does not move or reinterpret the v1 >=2x "
                    "species-throughput gate."
                ),
            },
            "v1": independent,
            "bufferedV2": microbatch,
            "accumulatorSpeedup": accumulator_speedup,
            "endToEndWallSpeedup": wall_speedup,
            "speciesSpeedup": species_speedup,
            "parity": parity,
            "gates": gates,
            "passed": all(gates.values()),
            "recommendation": (
                "RETAIN as a guarded default-off v2 candidate; evidence supports "
                "continued use and evaluation, not a default flip."
                if all(gates.values())
                else "NO-GO until every hard gate passes."
            ),
        }
    if candidate_schema != "microbatch-v1":
        raise CandidateEvidenceError(
            f"Unsupported candidate evidence schema {candidate_schema!r}."
        )
    gates = {
        "speciesThroughputAtLeast2x": species_speedup >= 2.0,
        **parity_gates,
    }
    return {
        "format": "species-solution-microbatch-full-catalog-candidate-v1",
        "classification": "fresh-process full-catalog eight-solution candidate",
        "declaredCanonicalExclusions": declared_exclusions,
        "independent": independent,
        "microbatch": microbatch,
        "speciesSpeedup": species_speedup,
        "parity": parity,
        "gates": gates,
        "passed": all(gates.values()),
        "recommendation": (
            "GO for continued default-off candidate use; do not flip the default."
            if all(gates.values())
            else "NO-GO until every hard gate passes."
        ),
    }


def _compare_species_goal_trees(
    independent_root: Path,
    microbatch_root: Path,
) -> dict[str, Any]:
    independent_files = _species_goal_files(independent_root)
    microbatch_files = _species_goal_files(microbatch_root)
    paths_equal = independent_files.keys() == microbatch_files.keys()
    mismatches = 0
    for relative_path in independent_files.keys() & microbatch_files.keys():
        independent = canonical_species_goal_document(
            _read_json(independent_files[relative_path])
        )
        microbatch = canonical_species_goal_document(
            _read_json(microbatch_files[relative_path])
        )
        mismatches += int(independent != microbatch)
    mismatches += len(independent_files.keys() ^ microbatch_files.keys())
    return {
        "fileCount": len(independent_files),
        "pathSetsEqual": paths_equal,
        "mismatchCount": mismatches,
    }


def _species_goal_files(root: Path) -> dict[str, Path]:
    return {
        str(path.relative_to(root)): path
        for path in root.rglob("*.json")
        if "/.spool/" not in path.as_posix()
    }


def _metric_status_mismatch_count(
    independent: dict[str, Any],
    microbatch: dict[str, Any],
) -> int:
    return _metric_field_mismatch_count(independent, microbatch, "status")


def _metric_details_mismatch_count(
    independent: dict[str, Any],
    microbatch: dict[str, Any],
) -> int:
    return _metric_field_mismatch_count(independent, microbatch, "details")


def _metric_field_mismatch_count(
    independent: dict[str, Any],
    microbatch: dict[str, Any],
    field: str,
) -> int:
    left = _metric_field_map(independent, field)
    right = _metric_field_map(microbatch, field)
    return sum(left.get(key) != right.get(key) for key in left.keys() | right.keys())


def _metric_field_map(document: dict[str, Any], field: str) -> dict[str, Any]:
    values = {}
    for level, scopes in document.get("geographies", {}).items():
        for scope_id, scope in scopes.items():
            for metric in scope.get("metrics", []):
                values[(level, scope_id, metric.get("metricId"))] = metric.get(field)
    return values


def _without_runtime_timestamps(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _without_runtime_timestamps(item)
            for key, item in value.items()
            if key not in RUNTIME_TIMESTAMP_KEYS
        }
    if isinstance(value, list):
        return [_without_runtime_timestamps(item) for item in value]
    return value


def _without_runtime_fields(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _without_runtime_fields(item)
            for key, item in value.items()
            if key not in RUNTIME_TIMESTAMP_KEYS
            and key not in RUNTIME_DERIVED_CHECKSUM_KEYS
        }
    if isinstance(value, list):
        return [_without_runtime_fields(item) for item in value]
    return value


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CandidateEvidenceError(f"Cannot read JSON evidence {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise CandidateEvidenceError(f"JSON evidence is not an object: {path}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--independent-root", type=Path, required=True)
    parser.add_argument("--microbatch-root", type=Path, required=True)
    parser.add_argument("--independent-log", type=Path, required=True)
    parser.add_argument("--microbatch-log", type=Path)
    parser.add_argument("--microbatch-wall-seconds", type=float)
    parser.add_argument("--microbatch-user-seconds", type=float)
    parser.add_argument("--microbatch-system-seconds", type=float)
    parser.add_argument("--microbatch-peak-rss-bytes", type=int)
    parser.add_argument(
        "--candidate-schema",
        choices=("microbatch-v1", "buffered-v2"),
        default="microbatch-v1",
        help=(
            "Evidence contract to emit. buffered-v2 predeclares the accumulator "
            "gate and reports wall speed separately."
        ),
    )
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    evidence = build_evidence(
        independent_root=args.independent_root,
        microbatch_root=args.microbatch_root,
        independent_log=args.independent_log,
        microbatch_log=args.microbatch_log,
        microbatch_process_metrics=(
            {
                "wallSeconds": args.microbatch_wall_seconds,
                "userSeconds": args.microbatch_user_seconds,
                "systemSeconds": args.microbatch_system_seconds,
                "peakRssBytes": args.microbatch_peak_rss_bytes,
            }
            if args.microbatch_log is None
            else None
        ),
        candidate_schema=args.candidate_schema,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(evidence["gates"], sort_keys=True))
    return 0 if evidence["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
