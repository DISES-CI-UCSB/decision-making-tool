from __future__ import annotations

import math

import pytest

from app.coverage_target_validation import (
    CoverageTargetValidationError,
    normalize_feature_name,
    validate_coverage_targets,
)


def _row(
    feature: str = "Bosque seco",
    *,
    feature_type: str = "ecosystem",
    relative_target: float = 0.0,
) -> dict[str, object]:
    return {
        "feature": feature,
        "feature_type": feature_type,
        "class": None,
        "relative_target": relative_target,
        "evaluated": None,
    }


def test_target_validation_accepts_zero_and_sparse_species_inventory() -> None:
    rows = validate_coverage_targets(
        [
            _row(relative_target=0.0),
            _row("Panthera onca", feature_type="species", relative_target=1.0),
        ],
        solution_id="sparse",
        expected_ecosystem_count=1,
    )

    assert [row.relative_target for row in rows] == [0.0, 1.0]
    assert normalize_feature_name("  BOSQUE_seco  ") == "bosque seco"


@pytest.mark.parametrize(
    "invalid_rows",
    [
        [_row("Forest"), _row("Forest")],
        [_row("Forest"), _row("forest")],
        [_row("Dry_forest"), _row(" dry   forest ")],
        [_row(" \t ")],
        [_row(relative_target=math.nan)],
        [_row(relative_target=math.inf)],
        [_row(relative_target=-0.01)],
        [_row(relative_target=1.01)],
        [_row(relative_target=True)],
        [_row(feature_type="unknown")],
        [{**_row(), "class": []}],
        [{**_row(), "evaluated": {}}],
    ],
)
def test_target_validation_rejects_malformed_rows(
    invalid_rows: list[dict[str, object]],
) -> None:
    with pytest.raises(CoverageTargetValidationError):
        validate_coverage_targets(invalid_rows, solution_id="invalid")
