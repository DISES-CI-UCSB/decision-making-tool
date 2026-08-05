"""Tests for local cache inspection before publish."""

from __future__ import annotations

import json
from pathlib import Path

from compact_metrics import to_compact_document
from metric_definitions import computable_metrics
from metrics_contract import PROVENANCE_KEY, build_metrics_provenance
from validation.inspect_cache import inspect_publish_report


def _write_cache(cache_dir: Path, solution_id: str, doc: dict) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{solution_id}.metrics.json"
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return path


def _minimal_doc(solution_id: str, *, domain: str = "land") -> dict:
    metrics = []
    for definition in computable_metrics():
        not_applicable = (
            domain not in definition.applicable_domains
            or definition.kind == "aoi_percent"
        )
        metrics.append({
            "metricId": definition.metric_id,
            "value": None if not_applicable else 1.0,
            "unit": definition.unit,
            "status": "not_applicable" if not_applicable else "ready",
            "source": "n/a" if not_applicable else "test",
            "notes": None,
            "labelKey": definition.label_key,
            "formatHint": definition.format_hint,
        })
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-05-22T00:00:00Z",
        PROVENANCE_KEY: build_metrics_provenance(domain, national_only=True),
        "speciesCompleteness": {
            "expected": 1,
            "aligned": 1,
            "processed": 1,
            "missing": 0,
            "complete": True,
        },
        "geographies": {
            "national": {
                "colombia": {
                    "metrics": metrics,
                }
            }
        },
    }


def test_inspect_publish_report_passes_valid_entry(tmp_path: Path):
    repo_root = tmp_path
    output_dir = repo_root / "generated" / "tier1"
    cache_path = _write_cache(output_dir / "cache", "demo_solution", _minimal_doc("demo_solution"))
    report = {
        "entries": [
            {
                "solutionId": "demo_solution",
                "cachePath": str(cache_path.relative_to(repo_root)),
                "expectedBlobPath": "metrics/cache/demo_solution.metrics.json",
            }
        ]
    }
    report_path = output_dir / "publish-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    result = inspect_publish_report(report_path, repo_root=repo_root)

    assert result.ok
    assert result.entries_checked == 1
    assert result.entries_ok == 1
    assert result.national_status_totals["ready"] > 0


def test_inspect_publish_report_flags_missing_cache(tmp_path: Path):
    repo_root = tmp_path
    output_dir = repo_root / "generated" / "tier1"
    report = {
        "entries": [
            {
                "solutionId": "demo_solution",
                "cachePath": "generated/tier1/cache/demo_solution.metrics.json",
                "expectedBlobPath": "metrics/cache/demo_solution.metrics.json",
            }
        ]
    }
    report_path = output_dir / "publish-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    result = inspect_publish_report(report_path, repo_root=repo_root)

    assert not result.ok
    assert result.entries_checked == 1
    assert result.entries_ok == 0
    assert any("missing" in issue.message for issue in result.issues)


def test_inspect_publish_report_honors_solution_filter(tmp_path: Path):
    repo_root = tmp_path
    output_dir = repo_root / "generated" / "tier1"
    cache_a = _write_cache(output_dir / "cache", "solution_a", _minimal_doc("solution_a"))
    cache_b = _write_cache(output_dir / "cache", "solution_b", _minimal_doc("solution_b"))
    report = {
        "entries": [
            {
                "solutionId": "solution_a",
                "cachePath": str(cache_a.relative_to(repo_root)),
                "expectedBlobPath": "metrics/cache/solution_a.metrics.json",
            },
            {
                "solutionId": "solution_b",
                "cachePath": str(cache_b.relative_to(repo_root)),
                "expectedBlobPath": "metrics/cache/solution_b.metrics.json",
            },
        ]
    }
    report_path = output_dir / "publish-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    result = inspect_publish_report(
        report_path,
        repo_root=repo_root,
        solution_ids={"solution_a"},
    )

    assert result.ok
    assert result.entries_checked == 1
    assert result.entries_ok == 1


def test_inspect_publish_report_accepts_compact_metrics_doc(tmp_path: Path):
    repo_root = tmp_path
    output_dir = repo_root / "generated" / "compact"
    compact_path = output_dir / "cache" / "demo_solution.metrics.compact.json"
    compact_path.parent.mkdir(parents=True)
    compact_path.write_text(
        json.dumps(to_compact_document(_minimal_doc("demo_solution")), separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    report = {
        "entries": [
            {
                "solutionId": "demo_solution",
                "cachePath": str(compact_path.relative_to(repo_root)),
                "expectedBlobPath": "metrics/staged/demo_solution.metrics.compact.json",
            }
        ]
    }
    report_path = output_dir / "publish-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    result = inspect_publish_report(report_path, repo_root=repo_root)

    assert result.ok
    assert result.entries_checked == 1
    assert result.entries_ok == 1


def test_inspect_publish_report_rejects_missing_signature(tmp_path: Path):
    repo_root = tmp_path
    output_dir = repo_root / "generated" / "tier1"
    document = _minimal_doc("demo_solution")
    document.pop(PROVENANCE_KEY)
    cache_path = _write_cache(output_dir / "cache", "demo_solution", document)
    report_path = output_dir / "publish-report.json"
    report_path.write_text(json.dumps({
        "entries": [{
            "solutionId": "demo_solution",
            "cachePath": str(cache_path.relative_to(repo_root)),
            "expectedBlobPath": "metrics/cache/demo_solution.metrics.json",
        }],
    }), encoding="utf-8")

    result = inspect_publish_report(report_path, repo_root=repo_root)

    assert not result.ok
    assert any("metricsProvenance" in issue.message for issue in result.issues)


def test_inspect_publish_report_rejects_mismatched_signature(tmp_path: Path):
    repo_root = tmp_path
    output_dir = repo_root / "generated" / "tier1"
    document = _minimal_doc("demo_solution")
    document[PROVENANCE_KEY]["catalogSignature"] = "metrics-catalog-v1:stale"
    cache_path = _write_cache(output_dir / "cache", "demo_solution", document)
    report_path = output_dir / "publish-report.json"
    report_path.write_text(json.dumps({
        "entries": [{
            "solutionId": "demo_solution",
            "cachePath": str(cache_path.relative_to(repo_root)),
            "expectedBlobPath": "metrics/cache/demo_solution.metrics.json",
        }],
    }), encoding="utf-8")

    result = inspect_publish_report(report_path, repo_root=repo_root)

    assert not result.ok
    assert any("catalog signature mismatch" in issue.message for issue in result.issues)


def test_inspect_publish_report_rejects_metric_coverage_or_order_change(tmp_path: Path):
    repo_root = tmp_path
    output_dir = repo_root / "generated" / "tier1"
    document = _minimal_doc("demo_solution")
    document["geographies"]["national"]["colombia"]["metrics"].reverse()
    cache_path = _write_cache(output_dir / "cache", "demo_solution", document)
    report_path = output_dir / "publish-report.json"
    report_path.write_text(json.dumps({
        "entries": [{
            "solutionId": "demo_solution",
            "cachePath": str(cache_path.relative_to(repo_root)),
            "expectedBlobPath": "metrics/cache/demo_solution.metrics.json",
        }],
    }), encoding="utf-8")

    result = inspect_publish_report(report_path, repo_root=repo_root)

    assert not result.ok
    assert any("coverage/order mismatch" in issue.message for issue in result.issues)


def test_inspect_publish_report_rejects_wrong_domain_status(tmp_path: Path):
    repo_root = tmp_path
    output_dir = repo_root / "generated" / "tier1"
    document = _minimal_doc("marine_solution", domain="marine")
    metrics = document["geographies"]["national"]["colombia"]["metrics"]
    land_metric = next(
        metric for metric in metrics if metric["metricId"] == "ecosystem_coverage"
    )
    land_metric.update(value=1.0, status="ready", source="test")
    cache_path = _write_cache(
        output_dir / "cache",
        "marine_solution",
        document,
    )
    report_path = output_dir / "publish-report.json"
    report_path.write_text(json.dumps({
        "entries": [{
            "solutionId": "marine_solution",
            "cachePath": str(cache_path.relative_to(repo_root)),
            "expectedBlobPath": "metrics/cache/marine_solution.metrics.json",
        }],
    }), encoding="utf-8")

    result = inspect_publish_report(report_path, repo_root=repo_root)

    assert not result.ok
    assert any(
        "ecosystem_coverage" in issue.message
        and "must be not_applicable" in issue.message
        for issue in result.issues
    )
