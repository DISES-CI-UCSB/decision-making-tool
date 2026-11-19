import pytest
from validation.validate_weighted_integration_ab import (
    PROMOTION_GATE,
    _pair_performance,
)


def _run(
    *,
    wall: float,
    boundary_output: float,
    weighted_preparation: float = 0.0,
    weighted_aggregation: float = 0.0,
    complete_boundary: float,
    rss: int,
) -> dict:
    return {
        "wallSeconds": wall,
        "boundaryOutputSeconds": boundary_output,
        "weightedAggregationSeconds": weighted_aggregation,
        "weightedPhaseIncludingPreparationSeconds": (
            weighted_preparation + weighted_aggregation + boundary_output
        ),
        "completeBoundaryPhaseSeconds": complete_boundary,
        "maximumResidentSetBytes": rss,
    }


def test_performance_distinguishes_equivalent_work_from_post_preparation():
    scalar = _run(
        wall=4_500.0,
        boundary_output=506.88,
        complete_boundary=597.05,
        rss=3_500_000_000,
    )
    grouped = _run(
        wall=3_800.0,
        boundary_output=2.37,
        weighted_preparation=11.46,
        weighted_aggregation=0.85,
        complete_boundary=103.23,
        rss=3_900_000_000,
    )

    performance = _pair_performance(scalar, grouped)

    assert performance[
        "weightedEquivalentWorkSpeedupIncludingPreparation"
    ] == pytest.approx(506.88 / (11.46 + 0.85 + 2.37))
    assert performance[
        "postPreparationWeightedAggregationAndOutputSpeedup"
    ] == pytest.approx(506.88 / (0.85 + 2.37))
    assert performance[
        "weightedEquivalentWorkSpeedupIncludingPreparation"
    ] == pytest.approx(34.5286103542)
    assert performance[
        "postPreparationWeightedAggregationAndOutputSpeedup"
    ] == pytest.approx(157.4161490683)
    assert performance["completeBoundaryPhaseSpeedup"] == pytest.approx(
        597.05 / 103.23
    )


def test_promotion_gate_is_predeclared_with_requested_thresholds():
    assert PROMOTION_GATE == {
        "zeroParityDrift": True,
        "weightedEquivalentWorkMinimumSpeedup": 1.5,
        "completeBoundaryPhaseMinimumSpeedup": 1.5,
        "medianOrderAdjustedWallMinimumReductionPercent": 8.0,
        "groupedRssMaximumScalarRatio": 1.15,
        "maximumResidentSetBytes": 5_000_000_000,
    }
