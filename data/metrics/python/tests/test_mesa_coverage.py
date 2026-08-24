from __future__ import annotations

import numpy as np
import pytest

from mesa_coverage import (
    SparseBinaryFeatureIndex,
    evaluate_categorical_aoi,
    evaluate_categorical_coverage,
    evaluate_sparse_binary_aoi,
    evaluate_sparse_binary_coverage,
    grouped_categorical_coverage,
    grouped_sparse_binary_coverage,
    mesa_coverage_row,
    sparse_index_from_feature_cells,
)


def test_mesa_coverage_row_matches_post_hoc_formulas():
    row = mesa_coverage_row(
        feature="Forest",
        total_amount=10,
        absolute_held=2,
        relative_target=0.17,
        evaluated="post-hoc",
    )

    assert row.met is True
    assert row.absolute_target == pytest.approx(1.7)
    assert row.absolute_shortfall == 0
    assert row.relative_held == pytest.approx(0.2)
    assert row.relative_shortfall == 0


def test_mesa_coverage_row_supports_prioritizr_shortfall_fraction():
    row = mesa_coverage_row(
        feature="Forest",
        total_amount=100,
        absolute_held=10,
        relative_target=0.2,
        evaluated="prioritizr_model",
        relative_shortfall_mode="target_fraction",
    )

    assert row.met is False
    assert row.absolute_shortfall == 10
    assert row.relative_shortfall == pytest.approx(0.5)


def test_zero_amount_zero_target_matches_prioritizr_summary_semantics():
    row = mesa_coverage_row(
        feature="Zero-range feature",
        total_amount=0,
        absolute_held=0,
        relative_target=0,
        evaluated="prioritizr_model",
        relative_shortfall_mode="target_fraction",
    )

    assert row.met is True
    assert row.relative_held == 0
    assert row.relative_shortfall == 0


def test_categorical_and_sparse_binary_evaluation_are_equivalent():
    values = np.array([[1, 1, 2], [2, np.nan, 1]])
    selected = np.array([[True, False, True], [False, False, True]])
    scope = np.array([[True, True, True], [True, False, True]])

    categorical = evaluate_categorical_coverage(
        category_values=values,
        selected_mask=selected,
        scope_mask=scope,
        feature_ids=[1, 2],
        feature_names=["One", "Two"],
        relative_targets=0.5,
    )
    sparse = evaluate_sparse_binary_coverage(
        features=sparse_index_from_feature_cells(
            [
                ("One", [0, 1, 5]),
                ("Two", [2, 3]),
            ]
        ),
        selected_mask=selected,
        scope_mask=scope,
        relative_targets=0.5,
    )

    assert categorical == sparse
    assert [(row.total_amount, row.absolute_held, row.met) for row in sparse] == [
        (3, 2, True),
        (2, 1, True),
    ]


def test_sparse_aoi_returns_both_approved_denominators():
    features = sparse_index_from_feature_cells(
        [
            ("Forest", [0, 1, 2, 3]),
            ("Wetland", [2, 4]),
        ]
    )
    selected = np.array([True, False, True, False, True])
    aoi = np.array([True, True, True, False, False])

    rows = evaluate_sparse_binary_aoi(
        features=features,
        selected_mask=selected,
        aoi_mask=aoi,
        national_totals=[4, 2],
        national_targets=[0.5, 0.5],
    )

    assert rows[0].total_amount_aoi == 3
    assert rows[0].absolute_held_aoi == 2
    assert rows[0].coverage_within_aoi == pytest.approx(2 / 3)
    assert rows[0].contribution_to_national_coverage == pytest.approx(0.5)
    assert rows[0].contribution_to_national_target == pytest.approx(1.0)
    assert rows[1].coverage_within_aoi == pytest.approx(1.0)
    assert rows[1].contribution_to_national_coverage == pytest.approx(0.5)


def test_categorical_aoi_returns_same_approved_denominators():
    rows = evaluate_categorical_aoi(
        category_values=np.array([[1, 2], [1, 2]]),
        selected_mask=np.array([[True, False], [True, False]]),
        aoi_mask=np.array([[True, True], [False, False]]),
        feature_ids=[1, 2],
        feature_names=["Forest", "Wetland"],
        national_targets=[0.5, 0.5],
    )

    assert rows[0].total_amount_aoi == 1
    assert rows[0].absolute_held_aoi == 1
    assert rows[0].coverage_within_aoi == pytest.approx(1.0)
    assert rows[0].contribution_to_national_coverage == pytest.approx(0.5)
    assert rows[0].contribution_to_national_target == pytest.approx(1.0)


def test_categorical_aoi_splits_held_categories_and_presence_denominators():
    rows = evaluate_categorical_aoi(
        category_values=np.array([[1, 2], [1, np.nan]]),
        selected_mask=np.array([[True, True], [True, False]]),
        pre_existing_mask=np.array([[True, False], [False, False]]),
        new_prioritizr_mask=np.array([[False, True], [True, False]]),
        aoi_mask=np.array([[True, True], [False, False]]),
        feature_ids=[1, 2],
        feature_names=["Forest", "Wetland"],
        national_targets=[0.5, 0.5],
    )

    forest = rows[0]
    assert forest.total_amount_aoi == 1
    assert forest.national_total_amount == 2
    assert forest.classified_total_amount_aoi == 2
    assert forest.share_of_national_amount == pytest.approx(0.5)
    assert forest.share_of_classified_aoi == pytest.approx(0.5)
    assert forest.absolute_held_aoi == 1
    assert forest.absolute_pre_existing_aoi == 1
    assert forest.absolute_new_prioritizr_aoi == 0
    assert forest.absolute_held_aoi == (
        forest.absolute_pre_existing_aoi + forest.absolute_new_prioritizr_aoi
    )
    assert forest.pre_existing_contribution_to_national_coverage == pytest.approx(0.5)
    assert forest.new_prioritizr_contribution_to_national_coverage == pytest.approx(0)


def test_categorical_aoi_keeps_zero_denominators_null():
    row = evaluate_categorical_aoi(
        category_values=np.array([[1, np.nan]]),
        selected_mask=np.array([[False, False]]),
        pre_existing_mask=np.array([[False, False]]),
        new_prioritizr_mask=np.array([[False, False]]),
        aoi_mask=np.array([[False, True]]),
        feature_ids=[2],
        feature_names=["Absent"],
        national_targets=[0.5],
    )[0]

    assert row.total_amount_aoi == 0
    assert row.national_total_amount == 0
    assert row.classified_total_amount_aoi == 0
    assert row.coverage_within_aoi is None
    assert row.share_of_national_amount is None
    assert row.share_of_classified_aoi is None
    assert row.pre_existing_coverage_within_aoi is None
    assert row.new_prioritizr_coverage_within_aoi is None


def test_grouped_sparse_coverage_fans_out_in_one_feature_pass():
    features = sparse_index_from_feature_cells(
        [
            ("Forest", [0, 1, 2, 4]),
            ("Wetland", [1, 3]),
        ]
    )
    selected = np.array([True, False, True, True, False])
    boundary_ids = np.array([0, 0, 1, 1, -1])

    totals, held = grouped_sparse_binary_coverage(
        features=features,
        selected_mask=selected,
        boundary_ids=boundary_ids,
        boundary_count=2,
    )

    np.testing.assert_array_equal(totals, [[2, 1], [1, 1]])
    np.testing.assert_array_equal(held, [[1, 1], [0, 1]])


def test_grouped_categorical_and_sparse_fan_out_are_equivalent():
    values = np.array([1, 2, 1, 2, np.nan])
    selected = np.array([True, False, True, True, False])
    boundary_ids = np.array([0, 0, 1, 1, -1])
    features = sparse_index_from_feature_cells(
        [
            ("One", [0, 2]),
            ("Two", [1, 3]),
        ]
    )

    categorical = grouped_categorical_coverage(
        category_values=values,
        selected_mask=selected,
        boundary_ids=boundary_ids,
        feature_ids=[1, 2],
        boundary_count=2,
    )
    sparse = grouped_sparse_binary_coverage(
        features=features,
        selected_mask=selected,
        boundary_ids=boundary_ids,
        boundary_count=2,
    )

    np.testing.assert_array_equal(categorical[0], sparse[0])
    np.testing.assert_array_equal(categorical[1], sparse[1])


def test_sparse_index_rejects_invalid_offsets():
    with pytest.raises(ValueError, match="feature_count"):
        SparseBinaryFeatureIndex(
            feature_names=("Forest",),
            offsets=np.array([0]),
            cell_ids=np.array([], dtype=np.int64),
        )
