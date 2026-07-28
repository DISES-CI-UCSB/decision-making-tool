"""Compact cached metric documents for Blob delivery.

The verbose app-facing metrics shape is intentionally readable, but it repeats
the same metric keys and metadata thousands of times across boundary scopes.
This module provides a compact wire format plus a round-trip expander so the
frontend can keep consuming the existing verbose shape after download.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cli_utils import find_repo_root, resolve_output_dir
from metrics_contract import PROVENANCE_KEY
from path_contracts import (
    solution_artifact_name,
    solution_blob_path,
    solution_public_url,
)
from release_config import load_release_config

COMPACT_METRICS_FORMAT = "metrics-compact-v1"
COMPACT_CACHE_SUFFIX = ".metrics.compact.json"
RELEASE_SOLUTION_COUNT = 108
DEFAULT_COMPACT_OUTPUT_DIR = Path("data/metrics/generated/nick-runs-2026-05-27-compact")
DEFAULT_COMPACT_BLOB_DIRECTORY = "metrics/nick-runs/2026-05-27/compact-cache"

MetricCatalogEntry = list[Any]
CompactMetricRow = list[Any]


@dataclass(frozen=True)
class ReleaseSelection:
    release_id: str
    catalog_solution_ids: tuple[str, ...]
    selected_solution_ids: tuple[str, ...]
    mode: str

    def as_report_metadata(self) -> dict[str, Any]:
        catalog_ids = sorted(self.catalog_solution_ids)
        selected_ids = sorted(self.selected_solution_ids)
        return {
            "releaseId": self.release_id,
            "mode": self.mode,
            "catalogSolutionIds": catalog_ids,
            "catalogSolutionIdsSha256": _solution_ids_sha256(catalog_ids),
            "selectedSolutionIds": selected_ids,
            "selectedSolutionIdsSha256": _solution_ids_sha256(selected_ids),
        }


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _solution_ids_sha256(solution_ids: list[str] | tuple[str, ...]) -> str:
    return hashlib.sha256(
        json.dumps(
            sorted(solution_ids),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _validated_solution_ids(value: Any, *, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field} must be a non-empty JSON array")
    solution_ids = tuple(str(item).strip() for item in value)
    if any(not solution_id for solution_id in solution_ids):
        raise ValueError(f"{field} must not contain empty solution ids")
    duplicates = sorted({
        solution_id for solution_id in solution_ids
        if solution_ids.count(solution_id) > 1
    })
    if duplicates:
        raise ValueError(f"{field} contains duplicate solution ids: {duplicates}")
    return solution_ids


def _validate_release_selection(selection: ReleaseSelection) -> None:
    catalog_ids = _validated_solution_ids(
        list(selection.catalog_solution_ids),
        field="catalogSolutionIds",
    )
    selected_ids = _validated_solution_ids(
        list(selection.selected_solution_ids),
        field="selectedSolutionIds",
    )
    if len(catalog_ids) != RELEASE_SOLUTION_COUNT:
        raise ValueError(
            "release selection catalog must contain exactly "
            f"{RELEASE_SOLUTION_COUNT} solution ids; got {len(catalog_ids)}"
        )
    unknown_ids = sorted(set(selected_ids) - set(catalog_ids))
    if unknown_ids:
        raise ValueError(
            f"selectedSolutionIds contains ids outside the release catalog: {unknown_ids}"
        )
    if selection.mode == "partial" and len(selected_ids) >= RELEASE_SOLUTION_COUNT:
        raise ValueError(
            "partial release selection must contain fewer than "
            f"{RELEASE_SOLUTION_COUNT} solution ids"
        )
    if selection.mode == "final" and set(selected_ids) != set(catalog_ids):
        raise ValueError(
            "final release selection must select the complete 108-solution catalog"
        )
    if selection.mode not in {"partial", "final"}:
        raise ValueError(f"unknown release selection mode {selection.mode!r}")


def load_release_selection(
    path: Path,
    *,
    expected_release_id: str,
    partial: bool,
) -> ReleaseSelection:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise TypeError("release selection contract must be a JSON object")
    release_id = raw.get("releaseId")
    if release_id != expected_release_id:
        raise ValueError(
            f"release selection has releaseId {release_id!r}; "
            f"expected {expected_release_id!r}"
        )
    catalog_ids = _validated_solution_ids(
        raw.get("catalogSolutionIds"),
        field="catalogSolutionIds",
    )
    selected_ids = _validated_solution_ids(
        raw.get("selectedSolutionIds"),
        field="selectedSolutionIds",
    )
    selection = ReleaseSelection(
        release_id=expected_release_id,
        catalog_solution_ids=catalog_ids,
        selected_solution_ids=selected_ids,
        mode="partial" if partial else "final",
    )
    _validate_release_selection(selection)
    return selection


def reconcile_release_selections(
    reports: list[dict[str, Any]],
    *,
    expected_release_id: str,
) -> dict[str, Any]:
    """Validate that partial reports form one complete 108-solution release."""
    if not reports:
        raise ValueError("at least one compact publish report is required")

    selections = [report.get("releaseSelection") for report in reports]
    if any(not isinstance(selection, dict) for selection in selections):
        raise ValueError("every report must contain releaseSelection metadata")
    first = selections[0]
    assert isinstance(first, dict)
    catalog_ids = _validated_solution_ids(
        first.get("catalogSolutionIds"),
        field="catalogSolutionIds",
    )
    if len(catalog_ids) != RELEASE_SOLUTION_COUNT:
        raise ValueError(
            f"final release requires exactly {RELEASE_SOLUTION_COUNT} catalog ids"
        )

    combined: list[str] = []
    for selection in selections:
        assert isinstance(selection, dict)
        if selection.get("releaseId") != expected_release_id:
            raise ValueError("compact report release id mismatch")
        report_catalog = _validated_solution_ids(
            selection.get("catalogSolutionIds"),
            field="catalogSolutionIds",
        )
        if selection.get("catalogSolutionIdsSha256") != _solution_ids_sha256(
            report_catalog
        ):
            raise ValueError("compact report catalog solution id hash mismatch")
        if set(report_catalog) != set(catalog_ids):
            raise ValueError("compact reports do not declare the same release catalog")
        selected_ids = _validated_solution_ids(
            selection.get("selectedSolutionIds"),
            field="selectedSolutionIds",
        )
        if selection.get("selectedSolutionIdsSha256") != _solution_ids_sha256(
            selected_ids
        ):
            raise ValueError("compact report selected solution id hash mismatch")
        combined.extend(selected_ids)

    duplicate_ids = sorted({
        solution_id for solution_id in combined
        if combined.count(solution_id) > 1
    })
    if duplicate_ids:
        raise ValueError(f"solution ids occur in multiple compact reports: {duplicate_ids}")
    missing_ids = sorted(set(catalog_ids) - set(combined))
    unknown_ids = sorted(set(combined) - set(catalog_ids))
    if missing_ids or unknown_ids:
        raise ValueError(
            "compact report union does not match the complete release catalog; "
            f"missing={missing_ids}, unknown={unknown_ids}"
        )
    return {
        "releaseId": expected_release_id,
        "solutionCount": len(combined),
        "solutionIdsSha256": _solution_ids_sha256(combined),
    }


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

    compact_document = {
        "format": COMPACT_METRICS_FORMAT,
        "solutionId": doc.get("solutionId"),
        "generatedAt": doc.get("generatedAt"),
        "metricCatalog": metric_catalog.values,
        "statusCatalog": status_catalog.values,
        "sourceCatalog": source_catalog.values,
        "notesCatalog": notes_catalog.values,
        "geographies": geographies,
    }
    if PROVENANCE_KEY in doc:
        compact_document[PROVENANCE_KEY] = doc[PROVENANCE_KEY]
        compact_document["metricsProvenanceSha256"] = hashlib.sha256(
            json.dumps(
                doc[PROVENANCE_KEY],
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
    return compact_document


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

    verbose_document = {
        "solutionId": doc.get("solutionId"),
        "generatedAt": doc.get("generatedAt"),
        "geographies": geographies,
    }
    if PROVENANCE_KEY in doc:
        verbose_document[PROVENANCE_KEY] = doc[PROVENANCE_KEY]
    return verbose_document


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("data/metrics/generated/nick-runs-2026-05-27"),
        help="Directory containing verbose publish-report.json and cache/.",
    )
    parser.add_argument(
        "--release-id",
        default=None,
        help="Use the immutable regular compact prefix for this explicit release id.",
    )
    parser.add_argument(
        "--release-selection",
        type=Path,
        default=None,
        help=(
            "JSON contract declaring releaseId, the complete catalogSolutionIds, "
            "and selectedSolutionIds."
        ),
    )
    parser.add_argument(
        "--partial-release",
        action="store_true",
        help=(
            "Compact an explicitly declared release subset. Requires --release-id "
            "and --release-selection."
        ),
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
    args = parser.parse_args(argv)
    if args.partial_release and not args.release_id:
        parser.error("--partial-release requires --release-id")
    if args.partial_release and args.release_selection is None:
        parser.error("--partial-release requires --release-selection")
    if args.release_selection is not None and not args.release_id:
        parser.error("--release-selection requires --release-id")
    return args


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
    release_id: str | None = None,
    release_selection: ReleaseSelection | None = None,
) -> dict[str, Any]:
    input_report_path = input_dir / "publish-report.json"
    input_report = json.loads(input_report_path.read_text(encoding="utf-8"))
    input_entries = input_report.get("entries") or []
    input_ids = [str(entry.get("solutionId") or "").strip() for entry in input_entries]
    if release_id:
        if any(not solution_id for solution_id in input_ids):
            raise ValueError("release publish report contains an entry without a solutionId")
        duplicate_ids = sorted({
            solution_id for solution_id in input_ids
            if input_ids.count(solution_id) > 1
        })
        if duplicate_ids:
            raise ValueError(
                f"release publish report contains duplicate solution ids: {duplicate_ids}"
            )
        if release_selection is None:
            if len(input_ids) != RELEASE_SOLUTION_COUNT:
                raise ValueError(
                    "final release compact conversion requires exactly "
                    f"{RELEASE_SOLUTION_COUNT} verbose inputs; got {len(input_ids)}"
                )
            release_selection = ReleaseSelection(
                release_id=release_id,
                catalog_solution_ids=tuple(input_ids),
                selected_solution_ids=tuple(input_ids),
                mode="final",
            )
        else:
            if release_selection.release_id != release_id:
                raise ValueError(
                    f"release selection has releaseId {release_selection.release_id!r}; "
                    f"expected {release_id!r}"
                )
            _validate_release_selection(release_selection)
            missing_ids = sorted(set(release_selection.selected_solution_ids) - set(input_ids))
            unknown_ids = sorted(set(input_ids) - set(release_selection.selected_solution_ids))
            if missing_ids or unknown_ids:
                raise ValueError(
                    "release publish report does not match selectedSolutionIds; "
                    f"missing={missing_ids}, unknown={unknown_ids}"
                )

        for entry in input_entries:
            solution_id = str(entry["solutionId"])
            verbose_path = _resolve_path(repo_root, str(entry.get("cachePath")))
            verbose_doc = json.loads(verbose_path.read_text(encoding="utf-8"))
            if verbose_doc.get("solutionId") != solution_id:
                raise ValueError(
                    f"verbose document solutionId mismatch for {solution_id!r}"
                )
            provenance = verbose_doc.get(PROVENANCE_KEY)
            document_release_id = (
                provenance.get("releaseId") if isinstance(provenance, dict) else None
            )
            if document_release_id != release_id:
                raise ValueError(
                    f"verbose document {solution_id!r} has releaseId "
                    f"{document_release_id!r}; expected {release_id!r}"
                )

    output_cache_dir = output_dir / "cache"
    output_cache_dir.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = []
    total_verbose_bytes = 0
    total_compact_bytes = 0

    for entry in input_entries:
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

    output_report = {
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
    if release_selection is not None:
        output_report["releaseSelection"] = release_selection.as_report_metadata()
    return output_report


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    release_selection = None
    if args.release_id:
        args.cache_blob_directory = load_release_config(
            args.release_id
        ).regular_compact_directory
    repo_root = find_repo_root()
    if args.release_selection is not None:
        selection_path = _resolve_path(repo_root, str(args.release_selection))
        release_selection = load_release_selection(
            selection_path,
            expected_release_id=args.release_id,
            partial=args.partial_release,
        )
    input_dir = resolve_output_dir(repo_root, args.input_dir)
    output_dir = resolve_output_dir(repo_root, args.output_dir)
    started = time.time()

    report = convert_publish_report(
        input_dir=input_dir,
        output_dir=output_dir,
        repo_root=repo_root,
        cache_blob_directory=args.cache_blob_directory,
        release_id=args.release_id,
        release_selection=release_selection,
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
