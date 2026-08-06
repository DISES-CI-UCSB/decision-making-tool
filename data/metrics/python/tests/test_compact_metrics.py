from __future__ import annotations

import json
from pathlib import Path

import pytest
from compact_metrics import (
    COMPACT_METRICS_FORMAT,
    ReleaseSelection,
    _validate_release_selection,
    convert_publish_report,
    expected_compact_blob_path,
    load_release_selection,
    reconcile_release_selections,
    to_compact_document,
    to_verbose_document,
)
from metrics_contract import PROVENANCE_KEY, build_metrics_provenance
from metric_definitions import computable_metrics
from solution_catalog import load_solution_catalog
from helpers import scope_state

TEST_SOLUTION_COUNT = 108


def _verbose_doc(solution_id: str = "demo_solution") -> dict:
    return {
        "solutionId": solution_id,
        "generatedAt": "2026-05-28T00:00:00Z",
        "solutionRaster": {
            "solutionBasename": f"{solution_id}.tif",
            "sha256": "a" * 64,
        },
        PROVENANCE_KEY: build_metrics_provenance("land"),
        "geographies": {
            "national": {
                "colombia": {
                    "name": "Colombia",
                    "scopeState": scope_state("national", "colombia"),
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
                    "scopeState": scope_state("departments", "05"),
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
        for index in range(TEST_SOLUTION_COUNT)
    ]


def _write_release_input(
    repo_root: Path,
    solution_ids: list[str],
    *,
    release_id: str = "test-release",
) -> Path:
    catalog_path = repo_root / "solution-catalog.json"
    if not catalog_path.exists():
        catalog_path.write_text(
            json.dumps(
                {
                    "format": "solution-catalog-v1",
                    "catalogVersion": "0.1.0",
                    "releaseId": release_id,
                    "expectedSolutionCount": TEST_SOLUTION_COUNT,
                    "expectedLandSolutionCount": TEST_SOLUTION_COUNT,
                    "expectedMarineSolutionCount": 0,
                    "solutions": [
                        {
                            "solutionId": solution_id,
                            "solutionBasename": f"{solution_id}.tif",
                            "domain": "land",
                            "rasterSha256": "a" * 64,
                        }
                        for solution_id in _release_solution_ids()
                    ],
                }
            ),
            encoding="utf-8",
        )
    catalog = load_solution_catalog(catalog_path)
    binding = {
        "format": "solution-catalog-binding-v1",
        "releaseId": catalog.release_id,
        "catalogVersion": catalog.catalog_version,
        "catalogSha256": catalog.sha256,
    }
    input_dir = repo_root / "generated" / "verbose"
    input_cache = input_dir / "cache"
    input_cache.mkdir(parents=True)
    entries = []
    for solution_id in solution_ids:
        verbose = _verbose_doc(solution_id)
        def metrics_for(level: str) -> list[dict]:
            metrics = []
            for definition in computable_metrics():
                not_applicable = (
                    "land" not in definition.applicable_domains
                    or (
                        level == "national"
                        and definition.kind == "aoi_percent"
                    )
                    or (
                        level != "national"
                        and definition.kind
                        in {"metadata_summary", "metadata_coverage"}
                    )
                )
                metrics.append({
                    "metricId": definition.metric_id,
                    "value": None if not_applicable else 1.0,
                    "unit": definition.unit,
                    "status": "not_applicable" if not_applicable else "ready",
                    "source": "n/a" if not_applicable else "test",
                    "notes": "test",
                    "labelKey": definition.label_key,
                    "formatHint": definition.format_hint,
                })
            return metrics
        levels = {
            "national": "colombia",
            "departments": "01",
            "municipalities": "001",
            "siraps": "sirap-1",
            "runaps": "runap-1",
            "omecs": "omec-1",
        }
        verbose["geographies"] = {
            level: {
                scope_id: {
                    "scopeState": scope_state(level, scope_id),
                    "metrics": metrics_for(level),
                }
            }
            for level, scope_id in levels.items()
        }
        verbose[PROVENANCE_KEY] = build_metrics_provenance(
            "land",
            release_id=release_id,
        )
        verbose["solutionInputSignature"] = {
            "format": "solution-input-signature-v1",
            "sha256": "b" * 64,
        }
        verbose["solutionCatalogBinding"] = binding
        verbose["speciesCompleteness"] = {
            "expected": 1,
            "aligned": 1,
            "processed": 1,
            "missing": 0,
            "complete": True,
        }
        verbose_path = input_cache / f"{solution_id}.metrics.json"
        verbose_path.write_text(json.dumps(verbose), encoding="utf-8")
        entries.append({
            "solutionId": solution_id,
            "cachePath": str(verbose_path.relative_to(repo_root)),
        })
    (input_dir / "publish-report.json").write_text(
        json.dumps({
            "publicBlobHost": "https://example.test",
            "solutionCatalog": {
                "releaseId": catalog.release_id,
                "sha256": catalog.sha256,
            },
            "entries": entries,
        }),
        encoding="utf-8",
    )
    return input_dir


def _test_catalog(repo_root: Path):
    return load_solution_catalog(repo_root / "solution-catalog.json")


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
        expected_compact_blob_path("demo-solution")
        == "metrics/nick-runs/2026-05-27/compact-cache/demo-solution.metrics.compact.json"
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

    resumed = convert_publish_report(
        input_dir=input_dir,
        output_dir=output_dir,
        repo_root=repo_root,
        cache_blob_directory="metrics/staged/compact",
        cache_policy="use-cache",
    )
    rebuilt = convert_publish_report(
        input_dir=input_dir,
        output_dir=output_dir,
        repo_root=repo_root,
        cache_blob_directory="metrics/staged/compact",
        cache_policy="recompute-all",
    )
    assert resumed["entries"][0]["resumeSkipped"] is True
    assert rebuilt["entries"][0]["resumeSkipped"] is False


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
        solution_catalog=_test_catalog(tmp_path),
    )

    assert len(report["entries"]) == 27
    assert report["releaseSelection"]["mode"] == "partial"
    assert report["releaseSelection"]["selectedSolutionIds"] == sorted(selected_ids)
    assert len(report["releaseSelection"]["selectedSolutionIdsSha256"]) == 64


@pytest.mark.parametrize(
    "selected_ids",
    [_release_solution_ids()[:27], _release_solution_ids()],
)
def test_release_selection_accepts_exact_plan_recompute_ids(
    selected_ids: list[str],
):
    catalog_ids = _release_solution_ids()
    selection = _release_selection(catalog_ids, selected_ids, mode="recompute")

    _validate_release_selection(selection)

    assert selection.as_report_metadata()["mode"] == "recompute"
    assert selection.as_report_metadata()["selectedSolutionIds"] == sorted(selected_ids)


def test_release_selection_rejects_recompute_ids_outside_catalog():
    catalog_ids = _release_solution_ids()
    selection = _release_selection(
        catalog_ids,
        [catalog_ids[0], "unknown_solution"],
        mode="recompute",
    )

    with pytest.raises(ValueError, match="outside the release catalog"):
        _validate_release_selection(selection)


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
            solution_catalog=_test_catalog(tmp_path),
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
            solution_catalog=_test_catalog(tmp_path),
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

    assert result["solutionCount"] == TEST_SOLUTION_COUNT
    assert len(result["solutionIdsSha256"]) == 64


def test_final_release_compaction_requires_complete_catalog(tmp_path: Path):
    catalog_ids = _release_solution_ids()
    input_dir = _write_release_input(tmp_path, catalog_ids)

    report = convert_publish_report(
        input_dir=input_dir,
        output_dir=tmp_path / "generated" / "compact",
        repo_root=tmp_path,
        cache_blob_directory="releases/test-release/regular/compact",
        release_id="test-release",
        catalog_solution_ids=catalog_ids,
        solution_catalog=_test_catalog(tmp_path),
    )

    assert len(report["entries"]) == TEST_SOLUTION_COUNT
    assert report["releaseSelection"]["mode"] == "final"


def test_release_compaction_rejects_input_missing_catalog_solutions(tmp_path: Path):
    catalog_ids = _release_solution_ids()
    input_dir = _write_release_input(tmp_path, catalog_ids[:27])

    with pytest.raises(ValueError, match="do not exactly match"):
        convert_publish_report(
            input_dir=input_dir,
            output_dir=tmp_path / "generated" / "compact",
            repo_root=tmp_path,
            cache_blob_directory="releases/test-release/regular/compact",
            release_id="test-release",
            catalog_solution_ids=catalog_ids,
            solution_catalog=_test_catalog(tmp_path),
        )


def test_release_compaction_rejects_provenance_before_binding_output(tmp_path: Path):
    catalog_ids = _release_solution_ids()
    selected_ids = catalog_ids[:1]
    input_dir = _write_release_input(tmp_path, selected_ids)
    verbose_path = input_dir / "cache" / f"{selected_ids[0]}.metrics.json"
    document = json.loads(verbose_path.read_text(encoding="utf-8"))
    document[PROVENANCE_KEY]["boundaryProvenance"]["sha256"] = "0" * 64
    verbose_path.write_text(json.dumps(document), encoding="utf-8")
    output_dir = tmp_path / "generated" / "compact"

    with pytest.raises(ValueError, match="invalid provenance"):
        convert_publish_report(
            input_dir=input_dir,
            output_dir=output_dir,
            repo_root=tmp_path,
            cache_blob_directory="releases/test-release/regular/compact",
            release_id="test-release",
            release_selection=_release_selection(catalog_ids, selected_ids),
            solution_catalog=_test_catalog(tmp_path),
        )

    assert not (output_dir / ".solution-release.json").exists()
