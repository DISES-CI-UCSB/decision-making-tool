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


def _canonical_sha256(value: Any) -> str:
    content = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return _sha256(content)


def _expected_release_plan_binding(
    release_plan_path: Path,
    *,
    catalog: Any,
    recompute_count: int,
) -> dict[str, Any]:
    return {
        "format": "solution-release-plan-binding-v1",
        "releaseId": catalog.release_id,
        "catalogSha256": catalog.sha256,
        "sha256": _sha256(release_plan_path.read_bytes()),
        "recomputeCount": recompute_count,
    }


def _merge_domain_alignment(
    reports: list[dict[str, Any]],
) -> dict[str, Any]:
    domains: dict[str, dict[str, Any]] = {}
    configured_max_bytes: int | None = None
    complete_pair_bytes = 0

    for report in reports:
        domain = report["domainSelection"]["domain"]
        alignment = report.get("inputAlignment")
        alignment_domains = (
            alignment.get("domains") if isinstance(alignment, dict) else None
        )
        if (
            alignment.get("format") != "metrics-alignment-inventory-v4"
            if isinstance(alignment, dict)
            else True
        ) or not isinstance(alignment_domains, dict) or set(alignment_domains) != {
            domain
        }:
            raise SolutionCatalogError(
                f"worker alignment inventory does not exactly match domain={domain}."
            )
        inventory = alignment_domains[domain]
        if not isinstance(inventory, dict) or inventory.get("domain") != domain:
            raise SolutionCatalogError(
                f"worker alignment inventory is invalid for domain={domain}."
            )
        if domain in domains and domains[domain] != inventory:
            raise SolutionCatalogError(
                f"worker alignment inventories conflict for domain={domain}."
            )
        domains[domain] = inventory

        cache_storage = alignment.get("cacheStorage")
        if not isinstance(cache_storage, dict):
            raise SolutionCatalogError("worker alignment cache metadata is invalid.")
        worker_limit = cache_storage.get("configuredMaxBytes")
        worker_usage = cache_storage.get("completePairBytes")
        if (
            isinstance(worker_limit, bool)
            or not isinstance(worker_limit, int)
            or isinstance(worker_usage, bool)
            or not isinstance(worker_usage, int)
        ):
            raise SolutionCatalogError("worker alignment cache metadata is invalid.")
        if configured_max_bytes is None:
            configured_max_bytes = worker_limit
        elif worker_limit != configured_max_bytes:
            raise SolutionCatalogError("worker alignment cache limits disagree.")
        complete_pair_bytes = max(complete_pair_bytes, worker_usage)

    merged = {
        "format": "metrics-alignment-inventory-v4",
        "domains": {domain: domains[domain] for domain in sorted(domains)},
        "cacheStorage": {
            "completePairBytes": complete_pair_bytes,
            "configuredMaxBytes": configured_max_bytes,
            "estimatedReleaseBytes": sum(
                inventory["estimatedReleaseBytes"] for inventory in domains.values()
            ),
        },
    }
    merged["sha256"] = _canonical_sha256(merged)
    return merged


def _write_immutable(path: Path, content: bytes) -> None:
    if path.exists():
        if _sha256(path.read_bytes()) != _sha256(content):
            raise SolutionCatalogError(f"merge destination already differs: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def _resolve_worker_cache_path(
    worker_dir: Path,
    *,
    solution_id: str,
    cache_path: str,
) -> Path:
    """Resolve the exact repo-relative cache path emitted by metrics main."""

    reported = Path(cache_path)
    if (
        not cache_path
        or reported.is_absolute()
        or cache_path != reported.as_posix()
        or any(part in {".", ".."} for part in reported.parts)
    ):
        raise SolutionCatalogError(
            f"worker cachePath must be canonical and repo-relative: {cache_path!r}"
        )

    repo_root = Path.cwd().resolve()
    worker_root = worker_dir.resolve()
    try:
        worker_relative = worker_root.relative_to(repo_root)
    except ValueError as exc:
        raise SolutionCatalogError(
            f"worker output must be inside the repository root: {worker_dir}"
        ) from exc

    expected_relative = (
        worker_relative
        / "cache"
        / solution_artifact_name(solution_id, suffix=".metrics.json")
    )
    if reported != expected_relative:
        raise SolutionCatalogError(
            f"worker cachePath does not match its worker output: {cache_path!r}"
        )

    source = repo_root / reported
    if not source.is_file():
        raise SolutionCatalogError(f"worker cache artifact is missing: {source}")
    if source.is_symlink():
        raise SolutionCatalogError(f"worker cache artifact cannot be a symlink: {source}")
    try:
        source.resolve().relative_to(worker_root)
    except ValueError as exc:
        raise SolutionCatalogError(
            f"worker cache artifact escapes its worker output: {source}"
        ) from exc
    return source


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
    if expected_ids != set(catalog.solution_ids):
        missing = sorted(set(catalog.solution_ids) - expected_ids)
        raise SolutionCatalogError(
            "worker merge requires all catalog solutions to be marked recompute; "
            f"missing={missing[:8]}"
        )
    expected_plan_binding = _expected_release_plan_binding(
        release_plan_path,
        catalog=catalog,
        recompute_count=len(expected_ids),
    )
    expected_catalog_binding = {
        "format": "solution-catalog-v1",
        "catalogVersion": catalog.catalog_version,
        "releaseId": catalog.release_id,
        "sha256": catalog.sha256,
        "expectedCounts": {
            "total": catalog.expected_total_count,
            "land": catalog.expected_land_count,
            "marine": catalog.expected_marine_count,
        },
    }
    expected_domain_ids = {
        domain: {
            entry.solution_id
            for entry in catalog.solutions
            if entry.domain == domain and entry.solution_id in expected_ids
        }
        for domain in ("land", "marine")
    }
    if not worker_output_dirs:
        raise SolutionCatalogError("at least one worker output is required.")
    reports = []
    partition_indexes: dict[str, set[int]] = {}
    partition_counts: dict[str, int] = {}
    entries_by_id: dict[str, dict[str, Any]] = {}
    shared_contract: dict[str, Any] | None = None
    worker_mode: str | None = None

    for worker_dir in worker_output_dirs:
        report_path = worker_dir / "publish-report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report.get("failures"):
            raise SolutionCatalogError(f"worker report contains failures: {report_path}")
        binding = report.get("solutionCatalog")
        if binding != expected_catalog_binding:
            raise SolutionCatalogError(f"worker catalog binding mismatch: {report_path}")
        if report.get("releasePlan") != expected_plan_binding:
            raise SolutionCatalogError(
                f"worker release plan binding mismatch: {report_path}"
            )
        chunk = report.get("chunk")
        if not isinstance(chunk, dict):
            raise SolutionCatalogError(f"worker report has no chunk contract: {report_path}")
        index = chunk.get("index")
        count = chunk.get("count")
        domain_selection = report.get("domainSelection")
        domain = (
            domain_selection.get("domain")
            if isinstance(domain_selection, dict)
            else None
        )
        mode = "domain" if domain is not None else "global"
        if worker_mode is None:
            worker_mode = mode
        elif mode != worker_mode:
            raise SolutionCatalogError("cannot mix global and domain worker reports.")
        if mode == "domain":
            if (
                domain not in {"land", "marine"}
                or chunk.get("scope") != "domain"
                or chunk.get("domain") != domain
                or domain_selection.get("catalogDomainCount")
                != catalog.count_for_domain(domain)
                or domain_selection.get("selectedRecomputeCount")
                != len(expected_domain_ids[domain])
            ):
                raise SolutionCatalogError(
                    f"worker domain contract is invalid: {report_path}"
                )
            partition_key = domain
        else:
            if chunk.get("scope") not in {None, "global"} or chunk.get("domain") is not None:
                raise SolutionCatalogError(
                    f"worker global chunk contract is invalid: {report_path}"
                )
            partition_key = "global"
        indexes = partition_indexes.setdefault(partition_key, set())
        if (
            isinstance(index, bool)
            or not isinstance(index, int)
            or isinstance(count, bool)
            or not isinstance(count, int)
            or index < 0
            or index >= count
            or index in indexes
        ):
            raise SolutionCatalogError(f"worker chunk contract is invalid: {report_path}")
        prior_count = partition_counts.setdefault(partition_key, count)
        if count != prior_count:
            raise SolutionCatalogError(
                f"worker chunk counts disagree for {partition_key}."
            )
        indexes.add(index)

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
                "solutionCatalog",
                "releasePlan",
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
                or (
                    domain is not None
                    and catalog.by_id[solution_id].domain != domain
                )
            ):
                raise SolutionCatalogError(
                    f"worker entries overlap or contain an unexpected solution: {report_path}"
                )
            source = _resolve_worker_cache_path(
                worker_dir,
                solution_id=solution_id,
                cache_path=entry["cachePath"],
            )
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
            entries_by_id[solution_id] = {
                **entry,
                "artifactSha256": _sha256(content),
                "_sourcePath": str(source),
            }
        reports.append(report)

    for partition_key, count in partition_counts.items():
        if partition_indexes[partition_key] != set(range(count)):
            raise SolutionCatalogError(
                f"worker partitions do not form one complete disjoint set for "
                f"{partition_key}."
            )
    if worker_mode == "domain":
        required_domains = {
            domain for domain, solution_ids in expected_domain_ids.items() if solution_ids
        }
        if set(partition_counts) != required_domains:
            raise SolutionCatalogError(
                "domain workers do not cover every recompute domain."
            )
        alignment = _merge_domain_alignment(reports)
    else:
        if len(partition_counts) != 1:
            raise SolutionCatalogError(
                "global workers do not form one partition set."
            )
        alignment = reports[0].get("inputAlignment")
        if any(report.get("inputAlignment") != alignment for report in reports[1:]):
            raise SolutionCatalogError("worker generation contracts disagree.")
    if set(entries_by_id) != expected_ids:
        missing = sorted(expected_ids - set(entries_by_id))
        unexpected = sorted(set(entries_by_id) - expected_ids)
        raise SolutionCatalogError(
            "worker union does not exactly cover the release plan; "
            f"missing={missing[:8]}, unexpected={unexpected[:8]}"
        )
    assert shared_contract is not None
    bind_release_output(output_dir, catalog=catalog, component="regular-verbose")
    merged_entries = []
    for solution_id in sorted(entries_by_id):
        entry = entries_by_id[solution_id]
        source = Path(entry["_sourcePath"])
        content = source.read_bytes()
        if _sha256(content) != entry["artifactSha256"]:
            raise SolutionCatalogError(
                f"worker cache artifact changed during merge: {source}"
            )
        destination = output_dir / "cache" / solution_artifact_name(
            solution_id,
            suffix=".metrics.json",
        )
        _write_immutable(destination, content)
        merged_entries.append(
            {
                key: value
                for key, value in {
                    **entry,
                    "cachePath": str(destination),
                }.items()
                if key != "_sourcePath"
            }
        )
    merged = {
        **reports[0],
        **shared_contract,
        "outputDir": str(output_dir),
        "domainSelection": None,
        "inputAlignment": alignment,
        "chunk": {
            "index": 0,
            "count": 1,
            "scope": "global",
            "domain": None,
            "selectedBeforeChunk": len(expected_ids),
            "selectedForChunk": len(expected_ids),
            "mergedWorkerCount": len(worker_output_dirs),
            "workerMode": worker_mode,
        },
        "entries": merged_entries,
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
