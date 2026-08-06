from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import main as pipeline
import pytest
from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS
from helpers import TEST_RASTER_SHA256, raster_from_fixture, scope_state
from metric_definitions import computable_metrics, is_species_metric_kind
from metrics_contract import (
    PROVENANCE_KEY,
    build_metrics_provenance,
    regular_artifact_completeness_issues,
)
from raster_metrics import RasterError


def _metric(definition, *, domain: str, level: str, empty: bool, exception=None):
    if domain not in definition.applicable_domains:
        status = "not_applicable"
    elif empty:
        status = "empty"
    elif level == "national" and definition.kind == "aoi_percent":
        status = "not_applicable"
    elif level != "national" and definition.kind in {
        "metadata_summary",
        "metadata_coverage",
    }:
        status = "not_applicable"
    elif exception is not None and is_species_metric_kind(definition.kind):
        status = "partial"
    else:
        status = "ready"
    metric = {
        "metricId": definition.metric_id,
        "value": 0.0 if status in {"ready", "partial"} else None,
        "unit": definition.unit,
        "status": status,
        "source": "n/a" if status == "not_applicable" else "test",
        "notes": None,
        "labelKey": definition.label_key,
        "formatHint": definition.format_hint,
    }
    if status == "partial":
        metric["details"] = {"speciesException": exception}
    return metric


def _document(*, domain: str = "marine", empty_department: bool = True, exception=None):
    levels = {
        "national": "colombia",
        "departments": "05",
        "municipalities": "05001",
        "siraps": "sirap-1",
        "runaps": "runap-1",
        "omecs": "omec-1",
    }
    geographies = {}
    for level, scope_id in levels.items():
        empty = level == "departments" and empty_department
        geographies[level] = {
            scope_id: {
                "scopeState": scope_state(
                    level,
                    scope_id,
                    valid_cells=0 if empty else 1,
                ),
                "metrics": [
                    _metric(
                        definition,
                        domain=domain,
                        level=level,
                        empty=empty,
                        exception=exception,
                    )
                    for definition in computable_metrics()
                ],
            }
        }
    document = {
        "solutionId": "demo",
        "generatedAt": "2026-08-05T00:00:00Z",
        "solutionRaster": {
            "solutionBasename": "demo.tif",
            "sha256": TEST_RASTER_SHA256,
        },
        PROVENANCE_KEY: build_metrics_provenance(
            domain,
            species_exception_binding=exception,
        ),
        "geographies": geographies,
    }
    if domain == "land":
        document["speciesCompleteness"] = {
            "catalogTotal": exception["catalogTotal"] if exception else 1,
            "availableExpected": exception["availableExpected"] if exception else 1,
            "excluded": exception["excluded"] if exception else 0,
            "expected": exception["availableExpected"] if exception else 1,
            "aligned": exception["availableExpected"] if exception else 1,
            "processed": exception["availableExpected"] if exception else 1,
            "missing": 0,
            "missingUnexpected": 0,
            "exception": exception,
            "complete": True,
        }
    return document


def _issues(document, *, domain: str):
    return regular_artifact_completeness_issues(
        document,
        national_only=False,
        domain=domain,
    )


def test_supported_ready_zero_and_proven_empty_null_are_release_complete():
    document = _document()

    assert _issues(document, domain="marine") == []
    empty_scope = document["geographies"]["departments"]["05"]
    applicable = [
        metric
        for definition, metric in zip(
            computable_metrics(),
            empty_scope["metrics"],
            strict=True,
        )
        if "marine" in definition.applicable_domains
    ]
    assert applicable
    assert all(metric["status"] == "empty" and metric["value"] is None for metric in applicable)


def test_empty_status_requires_zero_support_and_null_value():
    document = _document(empty_department=False)
    metric = document["geographies"]["departments"]["05"]["metrics"][0]
    metric.update(status="empty", value=0)

    issues = _issues(document, domain="marine")

    assert any("empty value must be null" in issue for issue in issues)
    assert any("cannot be empty without zero-support" in issue for issue in issues)


@pytest.mark.parametrize("status", ["blocked", "pending", "derivation_needed"])
def test_positive_supported_scope_rejects_nonterminal_failure_statuses(status):
    document = _document(empty_department=False)
    metric = next(
        metric
        for metric in document["geographies"]["departments"]["05"]["metrics"]
        if metric["status"] == "ready"
    )
    metric.update(status=status, value=None)

    assert any(
        f"{metric['metricId']} must be ready" in issue
        for issue in _issues(document, domain="marine")
    )


def test_national_zero_support_is_fatal():
    document = _document()
    document["geographies"]["national"]["colombia"]["scopeState"] = scope_state(
        "national",
        "colombia",
        valid_cells=0,
    )

    assert any(
        "national/colombia has zero solution-valid support" in issue
        for issue in _issues(document, domain="marine")
    )


def test_scope_identity_swaps_and_missing_boundary_source_are_fatal():
    document = _document()
    state = document["geographies"]["departments"]["05"]["scopeState"]
    state["targetGridSha256"] = "f" * 64
    state["solutionValidityMaskSha256"] = "1" * 64
    state["boundary"]["sourceSha256"] = BOUNDARY_SOURCE_SPECS[
        "municipalities"
    ].expected_sha256

    issues = _issues(document, domain="marine")

    assert any("target grid SHA does not match" in issue for issue in issues)
    assert any("validity-mask SHA does not match" in issue for issue in issues)
    assert any("boundary source SHA does not match" in issue for issue in issues)

    missing = deepcopy(document)
    missing["geographies"]["departments"]["05"]["scopeState"]["boundary"][
        "sourceSha256"
    ] = None
    assert any(
        "boundary.sourceSha256 must be" in issue
        for issue in _issues(missing, domain="marine")
    )


def test_species_exception_is_partial_only_for_supported_scopes():
    exception = {
        "format": "species-exception-binding-v1",
        "sha256": "9" * 64,
        "catalogTotal": 3,
        "availableExpected": 1,
        "excluded": 2,
    }
    document = _document(domain="land", exception=exception)

    assert _issues(document, domain="land") == []
    national = document["geographies"]["national"]["colombia"]["metrics"]
    department = document["geographies"]["departments"]["05"]["metrics"]
    species_pairs = [
        (national_metric, department_metric)
        for definition, national_metric, department_metric in zip(
            computable_metrics(),
            national,
            department,
            strict=True,
        )
        if is_species_metric_kind(definition.kind)
    ]
    assert species_pairs
    assert all(national_metric["status"] == "partial" for national_metric, _ in species_pairs)
    assert all(department_metric["status"] == "empty" for _, department_metric in species_pairs)
    assert document[PROVENANCE_KEY]["generationConfig"]["speciesException"] == exception


def test_generator_emits_empty_null_before_layer_calculators():
    raster = raster_from_fixture(
        {
            "shape": [1, 1],
            "pixel_area_km2": 1,
            "selected": [[0]],
            "valid": [[0]],
        }
    )
    metrics = pipeline._build_metrics(
        raster,
        {"id": "demo", "domain": "marine"},
        SimpleNamespace(),
        SimpleNamespace(),
        SimpleNamespace(),
        Path("."),
        False,
        subnational=True,
    )

    for definition, metric in zip(computable_metrics(), metrics, strict=True):
        expected = (
            "empty" if "marine" in definition.applicable_domains else "not_applicable"
        )
        assert metric["status"] == expected
        assert metric["value"] is None


def test_generator_rejects_national_zero_support_before_metric_work(
    tmp_path,
    monkeypatch,
):
    raster = raster_from_fixture(
        {
            "shape": [1, 1],
            "pixel_area_km2": 1,
            "selected": [[0]],
            "valid": [[0]],
        }
    )
    monkeypatch.setattr(
        pipeline,
        "cached_download",
        lambda *args, **kwargs: SimpleNamespace(
            path=tmp_path / "demo.tif",
            sha256=TEST_RASTER_SHA256,
        ),
    )
    monkeypatch.setattr(pipeline, "read_solution_raster", lambda path: raster)

    with pytest.raises(RasterError, match="zero valid cells at national scope"):
        pipeline._process_solution(
            {
                "id": "demo",
                "domain": "land",
                "scope": "land",
                "displayUrl": "https://example.test/demo.tif",
                "blobPath": "solutions/demo.tif",
            },
            SimpleNamespace(),
            tmp_path,
            tmp_path,
            False,
            SimpleNamespace(),
            SimpleNamespace(),
            SimpleNamespace(),
            {},
        )
