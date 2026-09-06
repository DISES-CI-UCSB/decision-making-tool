"""Preflight an immutable solution release without running metric calculations."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from solution_catalog import (
    SOLUTION_RELEASE_PLAN_FORMAT,
    SolutionCatalog,
    SolutionCatalogError,
    load_solution_catalog,
)

DEFAULT_PLAN_PATH = Path("data/metrics/generated/solution-release-plan.json")
SOLUTION_SIGNATURES_FORMAT = "solution-input-signatures-v1"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--baseline-catalog", type=Path, default=None)
    parser.add_argument("--input-signatures", type=Path, default=None)
    parser.add_argument("--baseline-input-signatures", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=DEFAULT_PLAN_PATH)
    parser.add_argument(
        "--cache-policy",
        choices=("use-cache", "recompute-all"),
        default="use-cache",
        help=(
            "use-cache reuses checksum-identical baseline rasters; recompute-all "
            "marks every catalog entry for recomputation."
        ),
    )
    return parser.parse_args(argv)


def load_input_signatures(
    path: Path,
    *,
    catalog: SolutionCatalog,
) -> dict[str, dict[str, str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(raw, dict)
        or raw.get("format") != SOLUTION_SIGNATURES_FORMAT
        or raw.get("releaseId") != catalog.release_id
        or raw.get("catalogSha256") != catalog.sha256
    ):
        raise SolutionCatalogError(
            f"input signatures do not match catalog {catalog.release_id!r}."
        )
    signatures = raw.get("signatures")
    if not isinstance(signatures, dict) or tuple(sorted(signatures)) != catalog.solution_ids:
        raise SolutionCatalogError(
            "input signatures must exactly cover the catalog solution IDs."
        )
    for solution_id, signature in signatures.items():
        if (
            not isinstance(signature, dict)
            or signature.get("format")
            not in {
                "solution-input-signature-v1",
                "solution-input-signature-v2",
                "solution-input-signature-v3",
            }
            or not isinstance(signature.get("sha256"), str)
            or len(signature["sha256"]) != 64
        ):
            raise SolutionCatalogError(
                f"input signature for {solution_id!r} is invalid."
            )
    return signatures


def build_release_plan(
    catalog: SolutionCatalog,
    *,
    baseline: SolutionCatalog | None = None,
    cache_policy: str = "use-cache",
    input_signatures: dict[str, dict[str, str]] | None = None,
    baseline_input_signatures: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    if cache_policy not in {"use-cache", "recompute-all"}:
        raise SolutionCatalogError(f"unknown cache policy {cache_policy!r}")
    baseline_by_id = baseline.by_id if baseline is not None else {}

    entries: list[dict[str, Any]] = []
    for entry in catalog.solutions:
        baseline_entry = baseline_by_id.get(entry.solution_id)
        if cache_policy == "recompute-all":
            action, reason = "recompute", "cache-policy-recompute-all"
        elif baseline_entry is None:
            action, reason = "recompute", "not-in-baseline"
        elif baseline_entry.solution_basename != entry.solution_basename:
            action, reason = "recompute", "solution-basename-changed"
        elif baseline_entry.domain != entry.domain:
            action, reason = "recompute", "solution-domain-changed"
        elif baseline_entry.scope != entry.scope:
            action, reason = "recompute", "solution-scope-changed"
        elif baseline_entry.raster_sha256 != entry.raster_sha256:
            action, reason = "recompute", "raster-sha256-changed"
        elif (
            input_signatures is None
            or baseline_input_signatures is None
            or entry.solution_id not in input_signatures
            or entry.solution_id not in baseline_input_signatures
        ):
            action, reason = "recompute", "solution-input-signature-unavailable"
        elif (
            input_signatures[entry.solution_id]
            != baseline_input_signatures[entry.solution_id]
        ):
            action, reason = "recompute", "solution-input-signature-changed"
        else:
            action, reason = "reuse", "input-signature-and-raster-identity-match"
        entries.append(
            {
                "solutionId": entry.solution_id,
                "solutionBasename": entry.solution_basename,
                "domain": entry.domain,
                **({"scope": entry.scope} if entry.scope is not None else {}),
                "rasterSha256": entry.raster_sha256,
                "solutionInputSignature": (
                    input_signatures.get(entry.solution_id)
                    if input_signatures is not None
                    else None
                ),
                "action": action,
                "reason": reason,
                "baselineReleaseId": baseline.release_id if baseline_entry else None,
            }
        )

    recompute_count = sum(entry["action"] == "recompute" for entry in entries)
    return {
        "format": SOLUTION_RELEASE_PLAN_FORMAT,
        "releaseId": catalog.release_id,
        "catalogVersion": catalog.catalog_version,
        "catalogSha256": catalog.sha256,
        "speciesException": catalog.species_exception_binding,
        "baselineReleaseId": baseline.release_id if baseline else None,
        "baselineCatalogSha256": baseline.sha256 if baseline else None,
        "cachePolicy": cache_policy,
        "reuseValidation": {
            "solutionBasename": "exact",
            "rasterSha256": "exact",
            "solutionInputSignature": "exact",
            "runtimeProvenance": "required",
        },
        "counts": {
            "total": len(entries),
            "reuse": len(entries) - recompute_count,
            "recompute": recompute_count,
        },
        "entries": entries,
    }


def write_release_plan(path: Path, plan: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(plan, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        catalog = load_solution_catalog(args.catalog)
        baseline = (
            load_solution_catalog(args.baseline_catalog)
            if args.baseline_catalog is not None
            else None
        )
        if baseline is not None and baseline.release_id == catalog.release_id:
            raise SolutionCatalogError(
                "baseline and new catalogs must use different releaseId values."
            )
        input_signatures = (
            load_input_signatures(args.input_signatures, catalog=catalog)
            if args.input_signatures is not None
            else None
        )
        baseline_input_signatures = (
            load_input_signatures(
                args.baseline_input_signatures,
                catalog=baseline,
            )
            if args.baseline_input_signatures is not None and baseline is not None
            else None
        )
        plan = build_release_plan(
            catalog,
            baseline=baseline,
            cache_policy=args.cache_policy,
            input_signatures=input_signatures,
            baseline_input_signatures=baseline_input_signatures,
        )
        write_release_plan(args.output, plan)
    except (OSError, SolutionCatalogError) as exc:
        print(f"[solution-release-plan] ERROR: {exc}", file=sys.stderr)
        return 2
    counts = plan["counts"]
    print(
        f"[solution-release-plan] wrote {args.output}: "
        f"{counts['reuse']} reuse, {counts['recompute']} recompute"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
