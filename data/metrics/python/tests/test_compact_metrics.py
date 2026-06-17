from __future__ import annotations

import json
from pathlib import Path

from compact_metrics import (
    COMPACT_METRICS_FORMAT,
    convert_publish_report,
    expected_compact_blob_path,
    to_compact_document,
    to_verbose_document,
)


def _verbose_doc(solution_id: str = "demo_solution") -> dict:
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-05-28T00:00:00Z",
        "geographies": {
            "national": {
                "colombia": {
                    "name": "Colombia",
                    "metrics": [
                        {
                            "metricId": "national_contribution",
                            "value": 12.5,
                            "unit": "%",
                            "status": "ready",
                            "source": "raster:solution",
                            "notes": "selectedArea / totalValidArea × 100.",
                            "labelKey": "metrics.tier1.national_contribution",
                            "formatHint": "percent",
                        },
                        {
                            "metricId": "species_groups_protected",
                            "value": 245,
                            "unit": "count",
                            "status": "ready",
                            "source": "solution:metadataUrl:summary_csv",
                            "notes": "See details.groups for per-group ratios.",
                            "labelKey": "metrics.tier1.species_groups_protected",
                            "formatHint": "number",
                            "details": {
                                "summary": {"metSpeciesCount": 245, "totalSpeciesCount": 251},
                                "groups": {
                                    "mammals": {
                                        "label": "Mammals",
                                        "metSpeciesCount": 245,
                                        "totalSpeciesCount": 251,
                                    }
                                },
                            },
                        },
                    ],
                }
            },
            "departments": {
                "05": {
                    "name": "Antioquia",
                    "subtype": "Departamento",
                    "metrics": [
                        {
                            "metricId": "priority_area_in_region",
                            "value": 1000,
                            "unit": "km2",
                            "status": "ready",
                            "source": "raster:solution",
                            "notes": "selected cells within boundary.",
                            "labelKey": "metrics.tier1.priority_area_total",
                            "formatHint": "number",
                        }
                    ],
                }
            },
        },
    }


def test_compact_document_round_trips_to_verbose_shape():
    verbose = _verbose_doc()

    compact = to_compact_document(verbose)
    expanded = to_verbose_document(compact)

    assert compact["format"] == COMPACT_METRICS_FORMAT
    assert expanded == verbose


def test_compact_document_is_smaller_than_pretty_verbose_json():
    verbose = _verbose_doc()
    compact = to_compact_document(verbose)

    verbose_bytes = len(json.dumps(verbose, indent=2, ensure_ascii=False).encode("utf-8"))
    compact_bytes = len(json.dumps(compact, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))

    assert compact_bytes < verbose_bytes


def test_expected_compact_blob_path_uses_compact_suffix():
    assert (
        expected_compact_blob_path("demo solution")
        == "metrics/nick-runs/2026-05-27/compact-cache/demo_solution.metrics.compact.json"
    )


def test_convert_publish_report_writes_compact_cache_and_report(tmp_path: Path):
    repo_root = tmp_path
    input_dir = repo_root / "generated" / "verbose"
    input_cache = input_dir / "cache"
    input_cache.mkdir(parents=True)
    verbose_path = input_cache / "demo_solution.metrics.json"
    verbose_path.write_text(json.dumps(_verbose_doc(), indent=2) + "\n", encoding="utf-8")
    report = {
        "generatedAt": "2026-05-28T00:00:00Z",
        "publicBlobHost": "https://example.test",
        "entries": [
            {
                "solutionId": "demo_solution",
                "cachePath": str(verbose_path.relative_to(repo_root)),
                "expectedBlobPath": "metrics/cache/demo_solution.metrics.json",
                "geographyLevels": ["national", "departments"],
                "nationalMetricStatusCounts": {"ready": 1},
            }
        ],
        "failures": [],
    }
    (input_dir / "publish-report.json").write_text(
        json.dumps(report, indent=2) + "\n",
        encoding="utf-8",
    )

    output_dir = repo_root / "generated" / "compact"
    compact_report = convert_publish_report(
        input_dir=input_dir,
        output_dir=output_dir,
        repo_root=repo_root,
        cache_blob_directory="metrics/staged/compact",
    )

    entry = compact_report["entries"][0]
    compact_path = repo_root / entry["cachePath"]
    assert compact_report["metricsFormat"] == COMPACT_METRICS_FORMAT
    assert compact_path.exists()
    assert entry["expectedBlobPath"] == "metrics/staged/compact/demo_solution.metrics.compact.json"
    assert to_verbose_document(json.loads(compact_path.read_text(encoding="utf-8"))) == _verbose_doc()
