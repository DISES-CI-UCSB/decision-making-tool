"""Inspect local cached metric JSON before publishing to Vercel.

Usage (from repo root):

    python data/metrics/python/metrics_pipeline/inspect_metrics.py

    python data/metrics/python/metrics_pipeline/inspect_metrics.py \\
        --output-dir data/metrics/generated/tier1 \\
        --solution-id ecos17_estr30_runap_hf
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from cli_utils import (
    default_output_dir,
    default_report_path,
    find_repo_root,
    print_inspect_summary,
)
from validation.inspect_cache import inspect_publish_report


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_output_dir(),
        help="Directory containing publish-report.json and cache/ (default: data/metrics/generated/tier1).",
    )
    parser.add_argument(
        "--solution-id",
        action="append",
        default=None,
        help="Restrict inspection to one or more solution ids (repeatable).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    repo_root = find_repo_root()
    report_path = default_report_path(repo_root, args.output_dir)
    solution_ids = set(args.solution_id) if args.solution_id else None

    result = inspect_publish_report(
        report_path,
        repo_root=repo_root,
        solution_ids=solution_ids,
    )
    print_inspect_summary(result)
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
