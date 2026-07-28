"""Validate local cached metric JSON before publishing to Vercel."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from compact_metrics import to_verbose_document
from metrics_contract import (
    PROVENANCE_KEY,
    VALID_METRIC_STATUSES,
    expected_metric_definitions,
    provenance_issues,
)
from solution_domain import SolutionDomain, normalize_domain

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
_NULL_VALUE_STATUSES = frozenset({
    "blocked",
    "pending",
    "derivation_needed",
    "not_applicable",
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


def _not_applicable_at_scope(
    *,
    definition: Any,
    domain: SolutionDomain,
    geography_level: str,
) -> bool:
    if domain not in definition.applicable_domains:
        return True
    if geography_level == "national":
        return definition.kind == "aoi_percent"
    return definition.kind in {"metadata_summary", "metadata_coverage"}


def _inspect_metric_list(
    solution_id: str,
    *,
    geography_level: str,
    scope_id: str,
    metrics: Any,
    domain: SolutionDomain | None,
) -> list[InspectIssue]:
    issues: list[InspectIssue] = []
    location = f"geographies.{geography_level}.{scope_id}.metrics"
    if not isinstance(metrics, list) or not metrics:
        return [InspectIssue(solution_id, f"{location} must be a non-empty list")]

    definitions = expected_metric_definitions()
    expected_ids = [definition.metric_id for definition in definitions]
    observed_ids = [
        metric.get("metricId") if isinstance(metric, dict) else None
        for metric in metrics
    ]
    if observed_ids != expected_ids:
        issues.append(InspectIssue(
            solution_id,
            f"{location} metric ID coverage/order mismatch: "
            f"found {observed_ids!r}, expected {expected_ids!r}",
        ))

    definitions_by_id = {
        definition.metric_id: definition for definition in definitions
    }
    seen_ids: set[str] = set()
    for index, metric in enumerate(metrics):
        if not isinstance(metric, dict):
            issues.append(InspectIssue(
                solution_id,
                f"{location}[{index}] must be an object",
            ))
            continue
        missing = _METRIC_KEYS - metric.keys()
        if missing:
            issues.append(InspectIssue(
                solution_id,
                f"{location}[{index}] missing keys {sorted(missing)}",
            ))
            continue
        metric_id = metric.get("metricId")
        if not isinstance(metric_id, str) or not metric_id:
            issues.append(InspectIssue(
                solution_id,
                f"{location}[{index}].metricId must be a non-empty string",
            ))
            continue
        if metric_id in seen_ids:
            issues.append(InspectIssue(
                solution_id,
                f"{location} has duplicate metricId '{metric_id}'",
            ))
        seen_ids.add(metric_id)

        status = metric.get("status")
        if status not in VALID_METRIC_STATUSES:
            issues.append(InspectIssue(
                solution_id,
                f"{location} metric '{metric_id}' has unknown status '{status}'",
            ))
            continue

        value = metric.get("value")
        if status == "ready":
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
            ):
                issues.append(InspectIssue(
                    solution_id,
                    f"{location} ready metric '{metric_id}' must have a finite numeric value",
                ))
        elif status in _NULL_VALUE_STATUSES and value is not None:
            issues.append(InspectIssue(
                solution_id,
                f"{location} metric '{metric_id}' with status '{status}' must have null value",
            ))

        if status == "not_applicable" and metric.get("source") != "n/a":
            issues.append(InspectIssue(
                solution_id,
                f"{location} not_applicable metric '{metric_id}' must use source 'n/a'",
            ))

        definition = definitions_by_id.get(metric_id)
        if definition is None or domain is None:
            continue
        wrong_domain = domain not in definition.applicable_domains
        expected_not_applicable = _not_applicable_at_scope(
            definition=definition,
            domain=domain,
            geography_level=geography_level,
        )
        must_be_not_applicable = wrong_domain or (
            status != "empty" and expected_not_applicable
        )
        if must_be_not_applicable and status != "not_applicable":
            issues.append(InspectIssue(
                solution_id,
                f"{location} metric '{metric_id}' must be not_applicable "
                f"for {domain}/{geography_level}",
            ))
        elif not expected_not_applicable and status == "not_applicable":
            issues.append(InspectIssue(
                solution_id,
                f"{location} metric '{metric_id}' is unexpectedly not_applicable "
                f"for {domain}/{geography_level}",
            ))

    return issues


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

    issues.extend(
        InspectIssue(solution_id, message)
        for message in provenance_issues(doc)
    )
    provenance = doc.get(PROVENANCE_KEY)
    domain: SolutionDomain | None = None
    if isinstance(provenance, dict):
        try:
            domain = normalize_domain(provenance.get("solutionDomain"))
        except ValueError:
            pass

    geographies = doc.get("geographies")
    if not isinstance(geographies, dict):
        issues.append(InspectIssue(solution_id, "geographies must be an object"))
        return issues

    national = geographies.get("national")
    if not isinstance(national, dict) or "colombia" not in national:
        issues.append(InspectIssue(solution_id, "geographies.national.colombia is required"))
        return issues

    if (
        isinstance(provenance, dict)
        and isinstance(provenance.get("generationConfig"), dict)
        and provenance["generationConfig"].get("nationalOnly") is True
        and set(geographies) != {"national"}
    ):
        issues.append(InspectIssue(
            solution_id,
            "national-only cache must not contain non-national geography levels",
        ))

    for geography_level, scopes in geographies.items():
        if not isinstance(scopes, dict):
            issues.append(InspectIssue(
                solution_id,
                f"geographies.{geography_level} must be an object",
            ))
            continue
        for scope_id, scope in scopes.items():
            if not isinstance(scope, dict):
                issues.append(InspectIssue(
                    solution_id,
                    f"geographies.{geography_level}.{scope_id} must be an object",
                ))
                continue
            issues.extend(_inspect_metric_list(
                solution_id,
                geography_level=geography_level,
                scope_id=scope_id,
                metrics=scope.get("metrics"),
                domain=domain,
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
