from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from mesa_coverage import evaluate_categorical_aoi, evaluate_categorical_coverage
from mesa_ecosystem_coverage import (
    FORMAT,
    MesaEcosystemCoverageError,
    build_aoi_document,
    build_national_document,
    compare_national_to_summary,
    evaluate_aoi_rows,
    evaluate_national_rows,
    write_document,
)


VALUES = np.array([[1.0, 1.0, 2.0], [1.0, np.nan, 2.0]])
SELECTED = np.array([[True, False, True], [True, False, False]])
FEATURE_IDS = [1, 2]
FEATURE_NAMES = ["Forest", "Wetland"]
TARGETS = [0.5, 0.5]
EVALUATED = ["prioritizr_model", "post-hoc"]


def test_national_relative_held_matches_mesa_calculator():
    rows = evaluate_national_rows(
        category_values=VALUES,
        selected_mask=SELECTED,
        feature_ids=FEATURE_IDS,
        feature_names=FEATURE_NAMES,
        relative_targets=TARGETS,
        evaluated=EVALUATED,
    )
    expected = evaluate_categorical_coverage(
        category_values=VALUES,
        selected_mask=SELECTED,
        feature_ids=FEATURE_IDS,
        feature_names=FEATURE_NAMES,
        relative_targets=TARGETS,
        evaluated=EVALUATED,
    )

    assert rows == expected
    assert rows[0].relative_held == pytest.approx(2 / 3)
    assert rows[1].relative_held == pytest.approx(0.5)


def test_aoi_relative_held_is_coverage_within_aoi():
    aoi = np.array([[True, True, False], [False, False, False]])
    rows = evaluate_aoi_rows(
        category_values=VALUES,
        selected_mask=SELECTED,
        aoi_mask=aoi,
        feature_ids=FEATURE_IDS,
        feature_names=FEATURE_NAMES,
        relative_targets=TARGETS,
    )
    expected = evaluate_categorical_aoi(
        category_values=VALUES,
        selected_mask=SELECTED,
        aoi_mask=aoi,
        feature_ids=FEATURE_IDS,
        feature_names=FEATURE_NAMES,
        national_targets=TARGETS,
    )

    assert rows == expected
    document = build_aoi_document(
        solution_id="fixture",
        geography_level="siraps",
        geography_id="eje-cafetero",
        rows=rows,
        feature_ids=FEATURE_IDS,
        relative_targets=TARGETS,
        evaluated=EVALUATED,
        source_paths={"aoiMask": "fixture.tif"},
    )
    forest = document["rows"][0]
    assert document["format"] == FORMAT
    assert forest["relativeHeld"] == pytest.approx(rows[0].coverage_within_aoi)
    assert forest["relativeHeldAlias"] == "coverage_within_aoi"
    assert forest["relativeHeld"] == pytest.approx(0.5)


def test_refuses_selected_mask_as_aoi_denominator():
    with pytest.raises(MesaEcosystemCoverageError, match="tautological"):
        evaluate_aoi_rows(
            category_values=VALUES,
            selected_mask=SELECTED,
            aoi_mask=SELECTED,
            feature_ids=FEATURE_IDS,
            feature_names=FEATURE_NAMES,
            relative_targets=TARGETS,
        )


def test_national_document_exams_matching_summary(tmp_path: Path):
    rows = evaluate_national_rows(
        category_values=VALUES,
        selected_mask=SELECTED,
        feature_ids=FEATURE_IDS,
        feature_names=FEATURE_NAMES,
        relative_targets=TARGETS,
        evaluated=EVALUATED,
    )
    summary = [
        {
            "feature": "Forest",
            "met": "TRUE",
            "total_amount": "3",
            "absolute_held": "2",
            "relative_target": "0.5",
            "relative_held": str(2 / 3),
        },
        {
            "feature": "Wetland",
            "met": "TRUE",
            "total_amount": "2",
            "absolute_held": "1",
            "relative_target": "0.5",
            "relative_held": "0.5",
        },
    ]

    assert compare_national_to_summary(rows, summary) == []
    document = build_national_document(
        solution_id="fixture",
        rows=rows,
        feature_ids=FEATURE_IDS,
        source_paths={"summary": "fixture.csv"},
    )
    output = tmp_path / "national.mesa-ecosystem-coverage.json"
    write_document(output, document)
    saved = json.loads(output.read_text(encoding="utf-8"))
    assert saved["geographyId"] == "colombia"
    assert saved["rows"][0]["relativeHeld"] == pytest.approx(2 / 3)
