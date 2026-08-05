"""Fail-closed merge of disjoint regular-metrics worker outputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from path_contracts import solution_artifact_name
from solution_catalog import (
    SolutionCatalogError,
    bind_release_output,
    load_release_plan,
    load_solution_catalog,
)


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _write_immutable(path: Path, content: bytes) -> None:
    if path.exists():
        if _sha256(path.read_bytes()) != _sha256(content):
            raise SolutionCatalogError(f"merge destination already differs: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def merge_workers(
    *,
    catalog_path: Path,
    release_plan_path: Path,
    worker_output_dirs: list[Path],
    output_dir: Path,
) -> dict[str, Any]:
    catalog = load_solution_catalog(catalog_path)
    expected_ids = set(
        load_release_plan(release_plan_path, catalog=catalog, action="recompute")
    )
    if not worker_output_dirs:
        raise SolutionCatalogError("at least one worker output is required.")
    bind_release_output(output_dir, catalog=catalog, component="regular-verbose")
    reports = []
    partition_indexes: set[int] = set()
    entries_by_id: dict[str, dict[str, Any]] = {}
    partition_count: int | None = None
    shared_contract: dict[str, Any] | None = None

    for worker_dir in worker_output_dirs:
        report_path = worker_dir / "publish-report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report.get("failures"):
            raise SolutionCatalogError(f"worker report contains failures: {report_path}")
        binding = report.get("solutionCatalog")
        if (
            not isinstance(binding, dict)
            or binding.get("releaseId") != catalog.release_id
            or binding.get("sha256") != catalog.sha256
        ):
            raise SolutionCatalogError(f"worker catalog binding mismatch: {report_path}")
        chunk = report.get("chunk")
        if not isinstance(chunk, dict):
            raise SolutionCatalogError(f"worker report has no chunk contract: {report_path}")
        index = chunk.get("index")
        count = chunk.get("count")
        if (
            isinstance(index, bool)
            or not isinstance(index, int)
            or isinstance(count, bool)
            or not isinstance(count, int)
            or index < 0
            or index >= count
            or index in partition_indexes
        ):
            raise SolutionCatalogError(f"worker chunk contract is invalid: {report_path}")
        if partition_count is None:
            partition_count = count
        if count != partition_count:
            raise SolutionCatalogError("worker chunk counts disagree.")
        partition_indexes.add(index)

        contract = {
            key: report.get(key)
            for key in (
                "manifestUrl",
                "manifestGeneratedAt",
                "publicBlobHost",
                "cacheDir",
                "cacheBlobDirectory",
                "metricsSchemaVersion",
                "metricCatalog",
                "deferredMetricIds",
                "speciesMetricIds",
                "speciesPoolSizes",
                "speciesSkipped",
                "speciesBoundaryLevelsSkipped",
                "cachePolicy",
                "inputAlignment",
                "solutionCatalog",
            )
        }
        if shared_contract is None:
            shared_contract = contract
        elif contract != shared_contract:
            raise SolutionCatalogError("worker generation contracts disagree.")

        entries = report.get("entries")
        if not isinstance(entries, list):
            raise SolutionCatalogError(f"worker entries are invalid: {report_path}")
        if chunk.get("selectedForChunk") != len(entries):
            raise SolutionCatalogError(f"worker chunk count does not match entries: {report_path}")
        for entry in entries:
            solution_id = entry.get("solutionId") if isinstance(entry, dict) else None
            if (
                not isinstance(solution_id, str)
                or solution_id not in expected_ids
                or solution_id in entries_by_id
                or not isinstance(entry.get("cachePath"), str)
            ):
                raise SolutionCatalogError(
                    f"worker entries overlap or contain an unexpected solution: {report_path}"
                )
            source = Path(entry["cachePath"])
            if not source.is_absolute():
                source = worker_dir / source
            if not source.is_file():
                raise SolutionCatalogError(f"worker cache artifact is missing: {source}")
            content = source.read_bytes()
            document = json.loads(content)
            binding = document.get("solutionCatalogBinding")
            if (
                document.get("solutionId") != solution_id
                or not isinstance(binding, dict)
                or binding.get("releaseId") != catalog.release_id
                or binding.get("catalogSha256") != catalog.sha256
            ):
                raise SolutionCatalogError(
                    f"worker artifact provenance mismatch: {source}"
                )
            destination = output_dir / "cache" / solution_artifact_name(
                solution_id,
                suffix=".metrics.json",
            )
            _write_immutable(destination, content)
            entries_by_id[solution_id] = {
                **entry,
                "cachePath": str(destination),
                "artifactSha256": _sha256(content),
            }
        reports.append(report)

    if partition_count != len(worker_output_dirs) or partition_indexes != set(
        range(partition_count or 0)
    ):
        raise SolutionCatalogError("worker partitions do not form one complete disjoint set.")
    if set(entries_by_id) != expected_ids:
        missing = sorted(expected_ids - set(entries_by_id))
        raise SolutionCatalogError(
            f"worker union does not exactly cover the release plan; missing={missing[:8]}"
        )
    assert shared_contract is not None
    merged = {
        **reports[0],
        **shared_contract,
        "outputDir": str(output_dir),
        "chunk": {
            "index": 0,
            "count": 1,
            "selectedBeforeChunk": len(expected_ids),
            "selectedForChunk": len(expected_ids),
            "mergedWorkerCount": len(worker_output_dirs),
        },
        "entries": [entries_by_id[solution_id] for solution_id in sorted(entries_by_id)],
        "failures": [],
    }
    content = (
        json.dumps(merged, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    ).encode()
    _write_immutable(output_dir / "publish-report.json", content)
    return merged


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--release-plan", type=Path, required=True)
    parser.add_argument("--worker-output", type=Path, action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        report = merge_workers(
            catalog_path=args.catalog,
            release_plan_path=args.release_plan,
            worker_output_dirs=args.worker_output,
            output_dir=args.output_dir,
        )
    except (OSError, json.JSONDecodeError, SolutionCatalogError) as exc:
        print(f"[merge-release-workers] ERROR: {exc}", file=sys.stderr)
        return 2
    print(
        f"[merge-release-workers] merged {report['chunk']['mergedWorkerCount']} workers "
        f"and {len(report['entries'])} solutions into {args.output_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
