from __future__ import annotations

import json
from pathlib import Path

import pytest
from compact_metrics import (
    COMPACT_METRICS_FORMAT,
    RELEASE_SOLUTION_COUNT,
    ReleaseSelection,
    convert_publish_report,
    expected_compact_blob_path,
    load_release_selection,
    reconcile_release_selections,
    to_compact_document,
    to_verbose_document,
)
from metrics_contract import PROVENANCE_KEY, build_metrics_provenance


def _verbose_doc(solution_id: str = "demo_solution") -> dict:
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-05-28T00:00:00Z",
        PROVENANCE_KEY: build_metrics_provenance("land"),
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


def _release_solution_ids() -> list[str]:
    return [
        f"solution_{index:03d}"
        for index in range(RELEASE_SOLUTION_COUNT)
    ]


def _write_release_input(
    repo_root: Path,
    solution_ids: list[str],
    *,
    release_id: str = "test-release",
) -> Path:
    input_dir = repo_root / "generated" / "verbose"
    input_cache = input_dir / "cache"
    input_cache.mkdir(parents=True)
    entries = []
    for solution_id in solution_ids:
        verbose = _verbose_doc(solution_id)
        verbose[PROVENANCE_KEY] = build_metrics_provenance(
            "land",
            release_id=release_id,
        )
        verbose_path = input_cache / f"{solution_id}.metrics.json"
        verbose_path.write_text(json.dumps(verbose), encoding="utf-8")
        entries.append({
            "solutionId": solution_id,
            "cachePath": str(verbose_path.relative_to(repo_root)),
        })
    (input_dir / "publish-report.json").write_text(
        json.dumps({
            "publicBlobHost": "https://example.test",
            "entries": entries,
        }),
        encoding="utf-8",
    )
    return input_dir


def _release_selection(
    catalog_ids: list[str],
    selected_ids: list[str],
    *,
    mode: str = "partial",
) -> ReleaseSelection:
    return ReleaseSelection(
        release_id="test-release",
        catalog_solution_ids=tuple(catalog_ids),
        selected_solution_ids=tuple(selected_ids),
        mode=mode,
    )


def test_compact_document_round_trips_to_verbose_shape():
    verbose = _verbose_doc()

    compact = to_compact_document(verbose)
    expanded = to_verbose_document(compact)

    assert compact["format"] == COMPACT_METRICS_FORMAT
    assert compact[PROVENANCE_KEY] == verbose[PROVENANCE_KEY]
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


def test_release_compaction_accepts_declared_27_solution_chunk(tmp_path: Path):
    catalog_ids = _release_solution_ids()
    selected_ids = catalog_ids[:27]
    input_dir = _write_release_input(tmp_path, selected_ids)

    report = convert_publish_report(
        input_dir=input_dir,
        output_dir=tmp_path / "generated" / "compact",
        repo_root=tmp_path,
        cache_blob_directory="releases/test-release/regular/compact",
        release_id="test-release",
        release_selection=_release_selection(catalog_ids, selected_ids),
    )

    assert len(report["entries"]) == 27
    assert report["releaseSelection"]["mode"] == "partial"
    assert report["releaseSelection"]["selectedSolutionIds"] == sorted(selected_ids)
    assert len(report["releaseSelection"]["selectedSolutionIdsSha256"]) == 64


@pytest.mark.parametrize(
    ("input_ids", "selected_ids", "error"),
    [
        (
            _release_solution_ids()[:26],
            _release_solution_ids()[:27],
            "missing=['solution_026']",
        ),
        (
            _release_solution_ids()[:27] + ["unknown_solution"],
            _release_solution_ids()[:27],
            "unknown=['unknown_solution']",
        ),
        (
            _release_solution_ids()[:26] + ["solution_025"],
            _release_solution_ids()[:27],
            "duplicate solution ids",
        ),
    ],
)
def test_release_compaction_rejects_missing_unknown_and_duplicate_input_ids(
    tmp_path: Path,
    input_ids: list[str],
    selected_ids: list[str],
    error: str,
):
    catalog_ids = _release_solution_ids()
    input_dir = _write_release_input(tmp_path, input_ids)

    with pytest.raises(ValueError, match=error.replace("[", r"\[").replace("]", r"\]")):
        convert_publish_report(
            input_dir=input_dir,
            output_dir=tmp_path / "generated" / "compact",
            repo_root=tmp_path,
            cache_blob_directory="releases/test-release/regular/compact",
            release_id="test-release",
            release_selection=_release_selection(catalog_ids, selected_ids),
        )


def test_release_selection_rejects_duplicate_and_unknown_declared_ids(tmp_path: Path):
    catalog_ids = _release_solution_ids()
    contract_path = tmp_path / "selection.json"
    contract_path.write_text(json.dumps({
        "releaseId": "test-release",
        "catalogSolutionIds": catalog_ids,
        "selectedSolutionIds": [catalog_ids[0], catalog_ids[0]],
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="duplicate solution ids"):
        load_release_selection(
            contract_path,
            expected_release_id="test-release",
            partial=True,
        )

    contract_path.write_text(json.dumps({
        "releaseId": "test-release",
        "catalogSolutionIds": catalog_ids,
        "selectedSolutionIds": ["unknown_solution"],
    }), encoding="utf-8")
    with pytest.raises(ValueError, match="outside the release catalog"):
        load_release_selection(
            contract_path,
            expected_release_id="test-release",
            partial=True,
        )


def test_regular_release_selection_hashes_are_order_independent_and_remain_compatible(
    tmp_path: Path,
):
    catalog_ids = _release_solution_ids()
    selected_ids = catalog_ids[::4]
    contract_path = tmp_path / "selection.json"
    contract_path.write_text(
        json.dumps(
            {
                "releaseId": "test-release",
                "catalogSolutionIds": list(reversed(catalog_ids)),
                "selectedSolutionIds": list(reversed(selected_ids)),
            }
        ),
        encoding="utf-8",
    )

    loaded = load_release_selection(
        contract_path,
        expected_release_id="test-release",
        partial=True,
    ).as_report_metadata()
    canonical = _release_selection(
        catalog_ids,
        selected_ids,
    ).as_report_metadata()

    assert loaded == canonical
    assert loaded["catalogSolutionIds"] == sorted(catalog_ids)
    assert loaded["selectedSolutionIds"] == sorted(selected_ids)


def test_release_compaction_rejects_wrong_document_release(tmp_path: Path):
    catalog_ids = _release_solution_ids()
    selected_ids = catalog_ids[:27]
    input_dir = _write_release_input(
        tmp_path,
        selected_ids,
        release_id="wrong-release",
    )

    with pytest.raises(ValueError, match="has releaseId 'wrong-release'"):
        convert_publish_report(
            input_dir=input_dir,
            output_dir=tmp_path / "generated" / "compact",
            repo_root=tmp_path,
            cache_blob_directory="releases/test-release/regular/compact",
            release_id="test-release",
            release_selection=_release_selection(catalog_ids, selected_ids),
        )


def test_four_release_chunks_reconcile_to_complete_catalog():
    catalog_ids = _release_solution_ids()
    reports = []
    for chunk_index in range(4):
        selected_ids = catalog_ids[chunk_index::4]
        reports.append({
            "releaseSelection": _release_selection(
                catalog_ids,
                selected_ids,
            ).as_report_metadata(),
        })

    result = reconcile_release_selections(
        reports,
        expected_release_id="test-release",
    )

    assert result["solutionCount"] == RELEASE_SOLUTION_COUNT
    assert len(result["solutionIdsSha256"]) == 64


def test_final_release_compaction_still_requires_all_108_solutions(tmp_path: Path):
    catalog_ids = _release_solution_ids()
    input_dir = _write_release_input(tmp_path, catalog_ids)

    report = convert_publish_report(
        input_dir=input_dir,
        output_dir=tmp_path / "generated" / "compact",
        repo_root=tmp_path,
        cache_blob_directory="releases/test-release/regular/compact",
        release_id="test-release",
    )

    assert len(report["entries"]) == RELEASE_SOLUTION_COUNT
    assert report["releaseSelection"]["mode"] == "final"


def test_release_compaction_without_selection_rejects_partial_input(tmp_path: Path):
    input_dir = _write_release_input(tmp_path, _release_solution_ids()[:27])

    with pytest.raises(ValueError, match="requires exactly 108 verbose inputs"):
        convert_publish_report(
            input_dir=input_dir,
            output_dir=tmp_path / "generated" / "compact",
            repo_root=tmp_path,
            cache_blob_directory="releases/test-release/regular/compact",
            release_id="test-release",
        )
