"""Validate local cached metric JSON before publishing to Vercel."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from compact_metrics import to_verbose_document

_METRIC_KEYS = frozenset({
    "metricId",
    "value",
    "unit",
    "status",
    "source",
    "notes",
    "labelKey",
    "formatHint",
})

_VALID_STATUSES = frozenset({
    "ready",
    "blocked",
    "pending",
    "derivation_needed",
    "not_applicable",
    "empty",
})


@dataclass(frozen=True)
class InspectIssue:
    solution_id: str
    message: str


@dataclass
class InspectResult:
    report_path: Path
    repo_root: Path
    entries_checked: int = 0
    entries_ok: int = 0
    issues: list[InspectIssue] = field(default_factory=list)
    national_status_totals: dict[str, int] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.issues


def _resolve_path(repo_root: Path, raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path
    return repo_root / path


def _inspect_doc(solution_id: str, doc: dict[str, Any]) -> list[InspectIssue]:
    issues: list[InspectIssue] = []

    if doc.get("solutionId") != solution_id:
        issues.append(InspectIssue(
            solution_id,
            f"solutionId mismatch: file has {doc.get('solutionId')!r}, report expects {solution_id!r}",
        ))

    for key in ("generatedAt", "geographies"):
        if key not in doc:
            issues.append(InspectIssue(solution_id, f"missing top-level key '{key}'"))

    geographies = doc.get("geographies")
    if not isinstance(geographies, dict):
        issues.append(InspectIssue(solution_id, "geographies must be an object"))
        return issues

    national = geographies.get("national")
    if not isinstance(national, dict) or "colombia" not in national:
        issues.append(InspectIssue(solution_id, "geographies.national.colombia is required"))
        return issues

    colombia = national.get("colombia")
    if not isinstance(colombia, dict):
        issues.append(InspectIssue(solution_id, "geographies.national.colombia must be an object"))
        return issues

    metrics = colombia.get("metrics")
    if not isinstance(metrics, list) or not metrics:
        issues.append(InspectIssue(solution_id, "national metrics must be a non-empty list"))
        return issues

    seen_ids: set[str] = set()
    for metric in metrics:
        if not isinstance(metric, dict):
            issues.append(InspectIssue(solution_id, "national metric entry must be an object"))
            continue
        missing = _METRIC_KEYS - metric.keys()
        if missing:
            issues.append(InspectIssue(
                solution_id,
                f"metric missing keys {sorted(missing)}",
            ))
            continue
        metric_id = metric.get("metricId")
        if not isinstance(metric_id, str) or not metric_id:
            issues.append(InspectIssue(solution_id, "metricId must be a non-empty string"))
            continue
        if metric_id in seen_ids:
            issues.append(InspectIssue(solution_id, f"duplicate metricId '{metric_id}'"))
        seen_ids.add(metric_id)
        status = metric.get("status")
        if status not in _VALID_STATUSES:
            issues.append(InspectIssue(
                solution_id,
                f"metric '{metric_id}' has unknown status '{status}'",
            ))

    return issues


def inspect_publish_report(
    report_path: Path,
    *,
    repo_root: Path,
    solution_ids: set[str] | None = None,
) -> InspectResult:
    """Validate cache files referenced by a generate-step publish report."""
    result = InspectResult(report_path=report_path, repo_root=repo_root)

    if not report_path.exists():
        result.issues.append(InspectIssue("report", f"publish report not found: {report_path}"))
        return result

    report = json.loads(report_path.read_text(encoding="utf-8"))
    entries = report.get("entries") or []
    if not entries:
        result.issues.append(InspectIssue("report", "publish report has no entries"))
        return result

    for entry in entries:
        solution_id = str(entry.get("solutionId") or "")
        if solution_ids and solution_id not in solution_ids:
            continue

        result.entries_checked += 1
        cache_raw = entry.get("cachePath")
        blob_path = entry.get("expectedBlobPath")
        if not cache_raw:
            result.issues.append(InspectIssue(solution_id, "entry missing cachePath"))
            continue
        if not blob_path:
            result.issues.append(InspectIssue(solution_id, "entry missing expectedBlobPath"))
            continue

        cache_path = _resolve_path(repo_root, cache_raw)
        if not cache_path.exists():
            result.issues.append(InspectIssue(solution_id, f"cache file missing: {cache_path}"))
            continue

        try:
            doc = to_verbose_document(json.loads(cache_path.read_text(encoding="utf-8")))
        except json.JSONDecodeError as exc:
            result.issues.append(InspectIssue(solution_id, f"invalid JSON: {exc}"))
            continue

        entry_issues = _inspect_doc(solution_id, doc)
        if entry_issues:
            result.issues.extend(entry_issues)
            continue

        result.entries_ok += 1
        for metric in doc["geographies"]["national"]["colombia"]["metrics"]:
            status = metric.get("status")
            if isinstance(status, str):
                result.national_status_totals[status] = (
                    result.national_status_totals.get(status, 0) + 1
                )

    return result
