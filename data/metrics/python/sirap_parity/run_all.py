"""Run SIRAP coverage parity for every paired TIFF and summary CSV."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from main import REGION_TEMPLATE_FILES, evaluate


def _pairs(directory: Path) -> list[tuple[Path, Path]]:
    summaries = {
        summary.name.removesuffix("_summary.csv"): summary
        for summary in directory.glob("*_summary.csv")
        if summary.name != "master_eval_summary.csv"
    }
    rasters = {raster.stem: raster for raster in directory.glob("*.tif")}
    missing_rasters = sorted(set(summaries) - set(rasters))
    missing_summaries = sorted(set(rasters) - set(summaries))
    if missing_rasters or missing_summaries:
        details = []
        if missing_rasters:
            details.append(f"missing TIFFs for: {missing_rasters}")
        if missing_summaries:
            details.append(f"missing summaries for: {missing_summaries}")
        raise ValueError("; ".join(details))
    return [(rasters[stem], summaries[stem]) for stem in sorted(rasters)]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--solutions-root", type=Path, required=True)
    parser.add_argument("--prepared-inputs-root", type=Path, required=True)
    parser.add_argument("--templates-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--numeric-tolerance", type=float, default=1e-9)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    started = time.perf_counter()
    results = []
    for region in ("eje_cafetero", "orinoquia"):
        pairs = _pairs(args.solutions_root / region)
        if not pairs:
            raise SystemExit(f"No TIFF/summary pairs found for {region}.")
        template = args.templates_root / region / REGION_TEMPLATE_FILES[region]
        if not template.is_file():
            raise SystemExit(f"Missing {region} planning-unit template: {template}")
        for solution, summary in pairs:
            report = evaluate(
                region=region,
                solution_path=solution,
                summary_path=summary,
                prepared_inputs_root=args.prepared_inputs_root,
                template_path=template,
                numeric_tolerance=args.numeric_tolerance,
            )
            report_path = args.output_dir / "reports" / region / f"{solution.stem}.json"
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            results.append(report)
            print(
                f"[{len(results)}] {region}/{solution.stem} "
                f"passed={report['passed']} mismatches={report['mismatchCount']}",
                flush=True,
            )

    failures = [result for result in results if not result["passed"]]
    aggregate = {
        "format": "sirap-coverage-parity-all-solutions-report-v1",
        "solutionCount": len(results),
        "passedCount": len(results) - len(failures),
        "failedCount": len(failures),
        "mismatchCount": sum(result["mismatchCount"] for result in results),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "results": [
            {
                "region": result["region"],
                "scenario": result["scenario"],
                "passed": result["passed"],
                "mismatchCount": result["mismatchCount"],
            }
            for result in results
        ],
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / "coverage-parity-all-solutions.json"
    output.write_text(json.dumps(aggregate, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({**aggregate, "results": None, "report": str(output)}, sort_keys=True))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
