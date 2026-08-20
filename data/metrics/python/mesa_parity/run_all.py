"""Run Mesa parity for every paired national solution and summary."""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any


def _has_species(path: Path) -> bool:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return any(row.get("feature_type") == "species" for row in csv.DictReader(handle))


def _run_one(payload: dict[str, Any]) -> dict[str, Any]:
    summary = Path(payload["summary"])
    solution = Path(payload["solution"])
    output = Path(payload["output"])
    started = time.perf_counter()
    command = [
        sys.executable,
        payload["script"],
        "--allow-non-golden",
        "--contract",
        payload["contract"],
        "--summary",
        str(summary),
        "--solution",
        str(solution),
        "--template",
        payload["template"],
        "--ecosystem-raster",
        payload["ecosystem_raster"],
        "--ecosystem-catalog",
        payload["ecosystem_catalog"],
        "--report",
        str(output),
    ]
    if _has_species(summary):
        for matrix in payload["species_matrices"]:
            command.extend(["--species-matrix", matrix])
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    result: dict[str, Any] = {
        "scenario": solution.stem,
        "summary": str(summary),
        "solution": str(solution),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "exitCode": completed.returncode,
    }
    if completed.stdout:
        try:
            result.update(json.loads(completed.stdout.strip().splitlines()[-1]))
        except json.JSONDecodeError:
            result["stdout"] = completed.stdout[-2000:]
    if completed.stderr:
        result["stderr"] = completed.stderr[-4000:]
    return result


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--solutions-dir", type=Path, required=True)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--ecosystem-raster", type=Path, required=True)
    parser.add_argument("--ecosystem-catalog", type=Path, required=True)
    parser.add_argument("--species-matrix", type=Path, action="append", default=[])
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=3)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if args.workers < 1:
        raise SystemExit("--workers must be positive")
    summaries = sorted(args.solutions_dir.glob("*_summary.csv"))
    pairs = [
        (summary, summary.with_name(summary.name[:-12] + ".tif"))
        for summary in summaries
        if summary.name != "master_eval_summary.csv"
        and summary.with_name(summary.name[:-12] + ".tif").is_file()
    ]
    if not pairs:
        raise SystemExit("No paired national solution/summary files found.")
    reports_dir = args.output_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    script = Path(__file__).with_name("main.py")
    common = {
        "script": str(script),
        "contract": str(args.contract),
        "template": str(args.template),
        "ecosystem_raster": str(args.ecosystem_raster),
        "ecosystem_catalog": str(args.ecosystem_catalog),
        "species_matrices": [str(path) for path in args.species_matrix],
    }
    payloads = [
        {
            **common,
            "summary": str(summary),
            "solution": str(solution),
            "output": str(reports_dir / f"{solution.stem}.json"),
        }
        for summary, solution in pairs
    ]

    started = time.perf_counter()
    results: list[dict[str, Any]] = []
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(_run_one, payload): payload for payload in payloads}
        for completed_count, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            print(
                f"[{completed_count}/{len(payloads)}] {result['scenario']} "
                f"exit={result['exitCode']} mismatches={result.get('mismatchCount')} "
                f"elapsed={result['elapsedSeconds']}s",
                flush=True,
            )

    results.sort(key=lambda item: item["scenario"])
    failures = [
        result
        for result in results
        if result["exitCode"] != 0 or not result.get("passed", False)
    ]
    aggregate = {
        "format": "coverage-parity-all-solutions-report-v1",
        "solutionCount": len(results),
        "passedCount": len(results) - len(failures),
        "failedCount": len(failures),
        "mismatchCount": sum(int(result.get("mismatchCount", 0)) for result in results),
        "workerCount": args.workers,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "results": results,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / "coverage-parity-all-solutions.json"
    temporary = report_path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(aggregate, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(report_path)
    print(
        json.dumps(
            {
                "solutionCount": aggregate["solutionCount"],
                "passedCount": aggregate["passedCount"],
                "failedCount": aggregate["failedCount"],
                "mismatchCount": aggregate["mismatchCount"],
                "elapsedSeconds": aggregate["elapsedSeconds"],
                "report": str(report_path),
            },
            sort_keys=True,
        )
    )
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
