"""Tests for local cache inspection before publish."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from validation.inspect_cache import inspect_publish_report


def _write_cache(cache_dir: Path, solution_id: str, doc: dict) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{solution_id}.metrics.json"
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return path


def _minimal_doc(solution_id: str) -> dict:
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-05-22T00:00:00Z",
        "geographies": {
            "national": {
                "colombia": {
                    "metrics": [
                        {
                            "metricId": "national_contribution",
                            "value": 28.7,
                            "unit": "%",
                            "status": "ready",
                            "source": "raster:solution",
                            "notes": None,
                            "labelKey": "metrics.national_contribution.label",
                            "formatHint": "percent",
                        }
                    ],
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
    assert result.national_status_totals["ready"] == 1


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
