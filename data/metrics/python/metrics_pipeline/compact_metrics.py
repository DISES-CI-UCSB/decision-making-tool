"""Compact cached metric documents for Blob delivery.

The verbose app-facing metrics shape is intentionally readable, but it repeats
the same metric keys and metadata thousands of times across boundary scopes.
This module provides a compact wire format plus a round-trip expander so the
frontend can keep consuming the existing verbose shape after download.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cli_utils import find_repo_root, resolve_output_dir
from path_contracts import (
    solution_artifact_name,
    solution_blob_path,
    solution_public_url,
)

COMPACT_METRICS_FORMAT = "metrics-compact-v1"
COMPACT_CACHE_SUFFIX = ".metrics.compact.json"
DEFAULT_COMPACT_OUTPUT_DIR = Path("data/metrics/generated/nick-runs-2026-05-27-compact")
DEFAULT_COMPACT_BLOB_DIRECTORY = "metrics/nick-runs/2026-05-27/compact-cache"

MetricCatalogEntry = list[Any]
CompactMetricRow = list[Any]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def expected_compact_blob_path(
    solution_id: str,
    *,
    cache_blob_directory: str = DEFAULT_COMPACT_BLOB_DIRECTORY,
) -> str:
    return solution_blob_path(
        solution_id,
        blob_directory=cache_blob_directory,
        suffix=COMPACT_CACHE_SUFFIX,
    )


def expected_compact_public_url(
    public_blob_host: str,
    solution_id: str,
    *,
    cache_blob_directory: str = DEFAULT_COMPACT_BLOB_DIRECTORY,
) -> str:
    return solution_public_url(
        public_blob_host,
        solution_id,
        blob_directory=cache_blob_directory,
        suffix=COMPACT_CACHE_SUFFIX,
    )


class _Catalog:
    def __init__(self) -> None:
        self.values: list[Any] = []
        self.index_by_key: dict[str, int] = {}

    def index(self, value: Any) -> int:
        key = json.dumps(value, ensure_ascii=False, sort_keys=True)
        existing = self.index_by_key.get(key)
        if existing is not None:
            return existing
        index = len(self.values)
        self.values.append(value)
        self.index_by_key[key] = index
        return index


def _metric_catalog_entry(metric: dict[str, Any]) -> MetricCatalogEntry:
    return [
        metric.get("metricId"),
        metric.get("unit"),
        metric.get("labelKey"),
        metric.get("formatHint"),
    ]


def _metric_from_catalog(
    row: CompactMetricRow,
    *,
    metric_catalog: list[MetricCatalogEntry],
    status_catalog: list[str],
    source_catalog: list[str],
    notes_catalog: list[str | None],
) -> dict[str, Any]:
    metric_index, value, status_index, source_index, notes_index = row[:5]
    metric_id, unit, label_key, format_hint = metric_catalog[metric_index]
    metric = {
        "metricId": metric_id,
        "value": value,
        "unit": unit,
        "status": status_catalog[status_index],
        "source": source_catalog[source_index],
        "notes": notes_catalog[notes_index],
        "labelKey": label_key,
        "formatHint": format_hint,
    }
    if len(row) > 5:
        metric["details"] = row[5]
    return metric


def to_compact_document(doc: dict[str, Any]) -> dict[str, Any]:
    metric_catalog = _Catalog()
    status_catalog = _Catalog()
    source_catalog = _Catalog()
    notes_catalog = _Catalog()
    geographies: dict[str, Any] = {}

    for level, scopes in (doc.get("geographies") or {}).items():
        if not isinstance(scopes, dict):
            continue
        compact_scopes: dict[str, Any] = {}
        for scope_id, scope in scopes.items():
            if not isinstance(scope, dict):
                continue
            compact_scope = {
                key: value for key, value in scope.items()
                if key != "metrics"
            }
            compact_metrics: list[CompactMetricRow] = []
            for metric in scope.get("metrics") or []:
                if not isinstance(metric, dict):
                    continue
                compact_row = [
                    metric_catalog.index(_metric_catalog_entry(metric)),
                    metric.get("value"),
                    status_catalog.index(metric.get("status")),
                    source_catalog.index(metric.get("source")),
                    notes_catalog.index(metric.get("notes")),
                ]
                if "details" in metric:
                    compact_row.append(metric.get("details"))
                compact_metrics.append(compact_row)
            compact_scope["metrics"] = compact_metrics
            compact_scopes[scope_id] = compact_scope
        geographies[level] = compact_scopes

    return {
        "format": COMPACT_METRICS_FORMAT,
        "solutionId": doc.get("solutionId"),
        "generatedAt": doc.get("generatedAt"),
        "metricCatalog": metric_catalog.values,
        "statusCatalog": status_catalog.values,
        "sourceCatalog": source_catalog.values,
        "notesCatalog": notes_catalog.values,
        "geographies": geographies,
    }


def is_compact_document(doc: dict[str, Any]) -> bool:
    return doc.get("format") == COMPACT_METRICS_FORMAT


def to_verbose_document(doc: dict[str, Any]) -> dict[str, Any]:
    if not is_compact_document(doc):
        return doc

    metric_catalog = doc.get("metricCatalog") or []
    status_catalog = doc.get("statusCatalog") or []
    source_catalog = doc.get("sourceCatalog") or []
    notes_catalog = doc.get("notesCatalog") or []
    geographies: dict[str, Any] = {}

    for level, scopes in (doc.get("geographies") or {}).items():
        if not isinstance(scopes, dict):
            continue
        verbose_scopes: dict[str, Any] = {}
        for scope_id, scope in scopes.items():
            if not isinstance(scope, dict):
                continue
            verbose_scope = {
                key: value for key, value in scope.items()
                if key != "metrics"
            }
            verbose_scope["metrics"] = [
                _metric_from_catalog(
                    row,
                    metric_catalog=metric_catalog,
                    status_catalog=status_catalog,
                    source_catalog=source_catalog,
                    notes_catalog=notes_catalog,
                )
                for row in scope.get("metrics") or []
            ]
            verbose_scopes[scope_id] = verbose_scope
        geographies[level] = verbose_scopes

    return {
        "solutionId": doc.get("solutionId"),
        "generatedAt": doc.get("generatedAt"),
        "geographies": geographies,
    }


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("data/metrics/generated/nick-runs-2026-05-27"),
        help="Directory containing verbose publish-report.json and cache/.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_COMPACT_OUTPUT_DIR,
        help=f"Directory to write compact cache files into (default: {DEFAULT_COMPACT_OUTPUT_DIR}).",
    )
    parser.add_argument(
        "--cache-blob-directory",
        default=DEFAULT_COMPACT_BLOB_DIRECTORY,
        help=(
            "Vercel Blob prefix recorded in the compact publish report "
            f"(default: {DEFAULT_COMPACT_BLOB_DIRECTORY})."
        ),
    )
    return parser.parse_args(argv)


def _resolve_path(repo_root: Path, raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path
    return repo_root / path


def convert_publish_report(
    *,
    input_dir: Path,
    output_dir: Path,
    repo_root: Path,
    cache_blob_directory: str,
) -> dict[str, Any]:
    input_report_path = input_dir / "publish-report.json"
    input_report = json.loads(input_report_path.read_text(encoding="utf-8"))
    output_cache_dir = output_dir / "cache"
    output_cache_dir.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = []
    total_verbose_bytes = 0
    total_compact_bytes = 0

    for entry in input_report.get("entries") or []:
        solution_id = str(entry.get("solutionId"))
        verbose_path = _resolve_path(repo_root, str(entry.get("cachePath")))
        verbose_doc = json.loads(verbose_path.read_text(encoding="utf-8"))
        compact_doc = to_compact_document(verbose_doc)
        compact_path = output_cache_dir / solution_artifact_name(
            solution_id,
            suffix=COMPACT_CACHE_SUFFIX,
        )
        compact_path.write_text(
            json.dumps(compact_doc, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

        verbose_bytes = verbose_path.stat().st_size
        compact_bytes = compact_path.stat().st_size
        total_verbose_bytes += verbose_bytes
        total_compact_bytes += compact_bytes
        entries.append({
            **entry,
            "cachePath": str(compact_path.relative_to(repo_root)),
            "expectedBlobPath": expected_compact_blob_path(
                solution_id,
                cache_blob_directory=cache_blob_directory,
            ),
            "expectedPublicUrl": expected_compact_public_url(
                input_report.get("publicBlobHost", ""),
                solution_id,
                cache_blob_directory=cache_blob_directory,
            ),
            "metricsFormat": COMPACT_METRICS_FORMAT,
            "verboseCachePath": str(verbose_path.relative_to(repo_root)),
            "verboseBytes": verbose_bytes,
            "compactBytes": compact_bytes,
            "compactRatio": round(compact_bytes / verbose_bytes, 4) if verbose_bytes else None,
        })

    return {
        **input_report,
        "generatedAt": _utc_now_iso(),
        "sourcePublishReport": str(input_report_path.relative_to(repo_root)),
        "outputDir": str(output_dir),
        "cacheBlobDirectory": cache_blob_directory,
        "metricsFormat": COMPACT_METRICS_FORMAT,
        "compactSummary": {
            "verboseBytes": total_verbose_bytes,
            "compactBytes": total_compact_bytes,
            "compactRatio": round(total_compact_bytes / total_verbose_bytes, 4)
            if total_verbose_bytes else None,
        },
        "entries": entries,
    }


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    repo_root = find_repo_root()
    input_dir = resolve_output_dir(repo_root, args.input_dir)
    output_dir = resolve_output_dir(repo_root, args.output_dir)
    started = time.time()

    report = convert_publish_report(
        input_dir=input_dir,
        output_dir=output_dir,
        repo_root=repo_root,
        cache_blob_directory=args.cache_blob_directory,
    )
    report_path = output_dir / "publish-report.json"
    report_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    summary = report.get("compactSummary") or {}
    print(f"[compact-metrics] wrote {len(report.get('entries') or [])} compact file(s)")
    print(f"[compact-metrics] report -> {report_path}")
    print(
        "[compact-metrics] bytes: "
        f"{summary.get('verboseBytes', 0):,} verbose -> "
        f"{summary.get('compactBytes', 0):,} compact "
        f"(ratio={summary.get('compactRatio')})"
    )
    print(f"[compact-metrics] done in {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
