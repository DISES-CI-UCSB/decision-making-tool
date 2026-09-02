"""Mesa-compatible feature coverage calculations.

The Mesa Nacional summaries evaluate binary feature amounts on the shared
EPSG:9377 planning grid. Each represented feature cell contributes exactly one
unit. This module ports only that evaluation behavior; it does not generate or
solve Prioritizr problems.

The public API deliberately separates mathematical operations from storage.
Callers may decode categorical rasters, sparse matrices, or compact cell-index
artifacts before invoking these functions, provided the decoded cell membership
is identical to the pinned Mesa inputs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, Sequence

import numpy as np

RelativeShortfallMode = Literal["target_difference", "target_fraction"]


@dataclass(frozen=True)
class MesaCoverageRow:
    """One feature row using the Mesa summary field semantics."""

    feature: str
    met: bool | None
    total_amount: float
    absolute_target: float | None
    absolute_held: float | None
    absolute_shortfall: float | None
    relative_target: float | None
    relative_held: float | None
    relative_shortfall: float | None
    evaluated: str | None = None

    @property
    def coverage_within_scope(self) -> float | None:
        return self.relative_held


@dataclass(frozen=True)
class MesaAoiCoverageRow:
    """Mesa-compatible AOI coverage with explicit planning-cell denominators."""

    feature: str
    total_amount_aoi: float
    absolute_held_aoi: float
    coverage_within_aoi: float | None
    contribution_to_national_coverage: float | None
    contribution_to_national_target: float | None
    national_total_amount: float
    classified_total_amount_aoi: float | None = None
    share_of_national_amount: float | None = None
    share_of_classified_aoi: float | None = None
    absolute_pre_existing_aoi: float | None = None
    absolute_new_prioritizr_aoi: float | None = None
    pre_existing_coverage_within_aoi: float | None = None
    new_prioritizr_coverage_within_aoi: float | None = None
    pre_existing_contribution_to_national_coverage: float | None = None
    new_prioritizr_contribution_to_national_coverage: float | None = None


@dataclass(frozen=True)
class SparseBinaryFeatureIndex:
    """Feature-major sparse binary cell membership.

    ``cell_ids[offsets[i]:offsets[i + 1]]`` contains the flat planning-grid
    indexes occupied by ``feature_names[i]``. Cell IDs must be sorted and unique
    within each feature.
    """

    feature_names: tuple[str, ...]
    offsets: np.ndarray
    cell_ids: np.ndarray

    def __post_init__(self) -> None:
        offsets = np.asarray(self.offsets)
        cell_ids = np.asarray(self.cell_ids)
        if offsets.ndim != 1 or cell_ids.ndim != 1:
            raise ValueError("Sparse feature offsets and cell_ids must be one-dimensional.")
        if offsets.size != len(self.feature_names) + 1:
            raise ValueError("Sparse feature offsets must contain feature_count + 1 values.")
        if offsets.size == 0 or int(offsets[0]) != 0:
            raise ValueError("Sparse feature offsets must start at zero.")
        if np.any(offsets[1:] < offsets[:-1]) or int(offsets[-1]) != cell_ids.size:
            raise ValueError("Sparse feature offsets are not monotonic or complete.")
        if np.any(cell_ids < 0):
            raise ValueError("Sparse feature cell IDs must be nonnegative.")
        for start, end in zip(offsets[:-1], offsets[1:], strict=True):
            cells = cell_ids[int(start):int(end)]
            if cells.size > 1 and np.any(cells[1:] <= cells[:-1]):
                raise ValueError("Sparse feature cell IDs must be sorted and unique.")

    @property
    def feature_count(self) -> int:
        return len(self.feature_names)


def mesa_coverage_row(
    *,
    feature: str,
    total_amount: float,
    absolute_held: float,
    relative_target: float | None,
    evaluated: str | None = None,
    relative_shortfall_mode: RelativeShortfallMode = "target_difference",
    tolerance: float = 1e-12,
) -> MesaCoverageRow:
    """Build one Mesa-compatible coverage row.

    Post-hoc Mesa rows store relative shortfall as ``target - held_fraction``.
    Prioritizr rows can instead use ``absolute_shortfall / absolute_target``;
    callers select that behavior with ``relative_shortfall_mode``.
    """

    total = _finite_nonnegative(total_amount, "total_amount")
    held = _finite_nonnegative(absolute_held, "absolute_held")
    if held > total + tolerance:
        raise ValueError("absolute_held cannot exceed total_amount.")
    if relative_target is None:
        return MesaCoverageRow(
            feature=feature,
            met=None,
            total_amount=total,
            absolute_target=None,
            absolute_held=held,
            absolute_shortfall=None,
            relative_target=None,
            relative_held=(held / total) if total > 0 else None,
            relative_shortfall=None,
            evaluated=evaluated,
        )

    target = _finite_nonnegative(relative_target, "relative_target")
    absolute_target = total * target
    relative_held = (held / total) if total > 0 else None
    if relative_held is None:
        if target == 0:
            return MesaCoverageRow(
                feature=feature,
                met=True,
                total_amount=total,
                absolute_target=0.0,
                absolute_held=held,
                absolute_shortfall=0.0,
                relative_target=0.0,
                relative_held=0.0,
                relative_shortfall=0.0,
                evaluated=evaluated,
            )
        return MesaCoverageRow(
            feature=feature,
            met=None,
            total_amount=total,
            absolute_target=absolute_target,
            absolute_held=held,
            absolute_shortfall=absolute_target,
            relative_target=target,
            relative_held=None,
            relative_shortfall=None,
            evaluated=evaluated,
        )

    absolute_shortfall = max(0.0, absolute_target - held)
    met = held + tolerance >= absolute_target
    relative_shortfall = _relative_shortfall(
        target=target,
        relative_held=relative_held,
        absolute_target=absolute_target,
        absolute_shortfall=absolute_shortfall,
        mode=relative_shortfall_mode,
    )
    return MesaCoverageRow(
        feature=feature,
        met=met,
        total_amount=total,
        absolute_target=absolute_target,
        absolute_held=held,
        absolute_shortfall=absolute_shortfall,
        relative_target=target,
        relative_held=relative_held,
        relative_shortfall=relative_shortfall,
        evaluated=evaluated,
    )


def evaluate_categorical_coverage(
    *,
    category_values: np.ndarray,
    selected_mask: np.ndarray,
    feature_ids: Sequence[int],
    feature_names: Sequence[str],
    relative_targets: float | None | Sequence[float | None],
    scope_mask: np.ndarray | None = None,
    evaluated: str | Sequence[str | None] | None = None,
    relative_shortfall_mode: RelativeShortfallMode = "target_difference",
) -> list[MesaCoverageRow]:
    """Evaluate categorical Mesa features with one grouped pass."""

    values = np.asarray(category_values)
    selected = _boolean_mask(selected_mask, values.shape, "selected_mask")
    scope = (
        np.ones(values.shape, dtype=bool)
        if scope_mask is None
        else _boolean_mask(scope_mask, values.shape, "scope_mask")
    )
    if len(feature_ids) != len(feature_names):
        raise ValueError("feature_ids and feature_names must have equal lengths.")
    targets = _expand_optional_values(
        relative_targets, len(feature_ids), "relative_targets"
    )
    evaluation_sources = _expand_optional_strings(evaluated, len(feature_ids))

    flat_values = values.ravel()
    flat_scope = scope.ravel() & np.isfinite(flat_values)
    flat_selected = selected.ravel() & flat_scope
    id_to_index = {int(feature_id): index for index, feature_id in enumerate(feature_ids)}
    if len(id_to_index) != len(feature_ids):
        raise ValueError("feature_ids must be unique.")

    scoped_ids = flat_values[flat_scope].astype(np.int64, copy=False)
    selected_ids = flat_values[flat_selected].astype(np.int64, copy=False)
    totals = _counts_for_ids(scoped_ids, id_to_index, len(feature_ids))
    held = _counts_for_ids(selected_ids, id_to_index, len(feature_ids))

    return [
        mesa_coverage_row(
            feature=name,
            total_amount=float(totals[index]),
            absolute_held=float(held[index]),
            relative_target=targets[index],
            evaluated=evaluation_sources[index],
            relative_shortfall_mode=relative_shortfall_mode,
        )
        for index, name in enumerate(feature_names)
    ]


def evaluate_sparse_binary_coverage(
    *,
    features: SparseBinaryFeatureIndex,
    selected_mask: np.ndarray,
    relative_targets: float | None | Sequence[float | None],
    scope_mask: np.ndarray | None = None,
    evaluated: str | Sequence[str | None] | None = None,
    relative_shortfall_mode: RelativeShortfallMode = "target_difference",
) -> list[MesaCoverageRow]:
    """Evaluate sparse binary features without expanding a dense matrix."""

    selected = np.asarray(selected_mask, dtype=bool).ravel()
    scope = (
        np.ones(selected.size, dtype=bool)
        if scope_mask is None
        else np.asarray(scope_mask, dtype=bool).ravel()
    )
    if selected.size != scope.size:
        raise ValueError("selected_mask and scope_mask must have equal sizes.")
    if features.cell_ids.size and int(features.cell_ids.max()) >= selected.size:
        raise ValueError("Sparse feature cell ID is outside the planning grid.")

    targets = _expand_optional_values(
        relative_targets, features.feature_count, "relative_targets"
    )
    evaluation_sources = _expand_optional_strings(evaluated, features.feature_count)
    rows: list[MesaCoverageRow] = []
    for index, feature in enumerate(features.feature_names):
        start = int(features.offsets[index])
        end = int(features.offsets[index + 1])
        cells = features.cell_ids[start:end]
        cells_in_scope = cells[scope[cells]]
        rows.append(
            mesa_coverage_row(
                feature=feature,
                total_amount=float(cells_in_scope.size),
                absolute_held=float(np.count_nonzero(selected[cells_in_scope])),
                relative_target=targets[index],
                evaluated=evaluation_sources[index],
                relative_shortfall_mode=relative_shortfall_mode,
            )
        )
    return rows


def evaluate_sparse_binary_aoi(
    *,
    features: SparseBinaryFeatureIndex,
    selected_mask: np.ndarray,
    aoi_mask: np.ndarray,
    national_totals: Sequence[float],
    national_targets: Sequence[float],
) -> list[MesaAoiCoverageRow]:
    """Return both approved AOI coverage denominators for sparse features."""

    selected = np.asarray(selected_mask, dtype=bool).ravel()
    aoi = np.asarray(aoi_mask, dtype=bool).ravel()
    if selected.size != aoi.size:
        raise ValueError("selected_mask and aoi_mask must have equal sizes.")
    totals = _expand_values(national_totals, features.feature_count, "national_totals")
    targets = _expand_values(national_targets, features.feature_count, "national_targets")

    rows: list[MesaAoiCoverageRow] = []
    for index, feature in enumerate(features.feature_names):
        cells = features.cell_ids[
            int(features.offsets[index]):int(features.offsets[index + 1])
        ]
        aoi_cells = cells[aoi[cells]]
        held = float(np.count_nonzero(selected[aoi_cells]))
        total_aoi = float(aoi_cells.size)
        national_total = totals[index]
        rows.append(
            mesa_aoi_coverage_row(
                feature=feature,
                total_amount_aoi=total_aoi,
                absolute_held_aoi=held,
                national_total=national_total,
                national_target=targets[index],
            )
        )
    return rows


def evaluate_categorical_aoi(
    *,
    category_values: np.ndarray,
    selected_mask: np.ndarray,
    aoi_mask: np.ndarray,
    feature_ids: Sequence[int],
    feature_names: Sequence[str],
    national_targets: float | Sequence[float],
    pre_existing_mask: np.ndarray | None = None,
    new_prioritizr_mask: np.ndarray | None = None,
) -> list[MesaAoiCoverageRow]:
    """Evaluate AOI presence and category-split coverage in planning cells."""

    values = np.asarray(category_values)
    selected = _boolean_mask(selected_mask, values.shape, "selected_mask")
    aoi = _boolean_mask(aoi_mask, values.shape, "aoi_mask")
    pre_existing, new_prioritizr = _optional_category_masks(
        pre_existing_mask,
        new_prioritizr_mask,
        values.shape,
        selected,
    )
    if len(feature_ids) != len(feature_names):
        raise ValueError("feature_ids and feature_names must have equal lengths.")
    targets = _expand_values(national_targets, len(feature_ids), "national_targets")
    id_to_index = {int(feature_id): index for index, feature_id in enumerate(feature_ids)}
    if len(id_to_index) != len(feature_ids):
        raise ValueError("feature_ids must be unique.")

    flat_values = values.ravel()
    finite = np.isfinite(flat_values)
    national_ids = flat_values[finite].astype(np.int64, copy=False)
    aoi_scope = finite & aoi.ravel()
    aoi_ids = flat_values[aoi_scope].astype(np.int64, copy=False)
    held_ids = flat_values[aoi_scope & selected.ravel()].astype(np.int64, copy=False)
    pre_existing_ids = (
        flat_values[aoi_scope & pre_existing.ravel()].astype(np.int64, copy=False)
        if pre_existing is not None
        else None
    )
    new_prioritizr_ids = (
        flat_values[aoi_scope & new_prioritizr.ravel()].astype(np.int64, copy=False)
        if new_prioritizr is not None
        else None
    )
    national_totals = _counts_for_ids(national_ids, id_to_index, len(feature_ids))
    aoi_totals = _counts_for_ids(aoi_ids, id_to_index, len(feature_ids))
    held = _counts_for_ids(held_ids, id_to_index, len(feature_ids))
    pre_existing_held = (
        _counts_for_ids(pre_existing_ids, id_to_index, len(feature_ids))
        if pre_existing_ids is not None
        else None
    )
    new_prioritizr_held = (
        _counts_for_ids(new_prioritizr_ids, id_to_index, len(feature_ids))
        if new_prioritizr_ids is not None
        else None
    )
    classified_total_aoi = float(np.count_nonzero(aoi_scope))

    return [
        mesa_aoi_coverage_row(
            feature=name,
            total_amount_aoi=float(aoi_totals[index]),
            absolute_held_aoi=float(held[index]),
            national_total=float(national_totals[index]),
            national_target=targets[index],
            classified_total_amount_aoi=classified_total_aoi,
            absolute_pre_existing_aoi=(
                float(pre_existing_held[index])
                if pre_existing_held is not None
                else None
            ),
            absolute_new_prioritizr_aoi=(
                float(new_prioritizr_held[index])
                if new_prioritizr_held is not None
                else None
            ),
        )
        for index, name in enumerate(feature_names)
    ]


def mesa_aoi_coverage_row(
    *,
    feature: str,
    total_amount_aoi: float,
    absolute_held_aoi: float,
    national_total: float,
    national_target: float,
    classified_total_amount_aoi: float | None = None,
    absolute_pre_existing_aoi: float | None = None,
    absolute_new_prioritizr_aoi: float | None = None,
    tolerance: float = 1e-12,
) -> MesaAoiCoverageRow:
    """Build one AOI row using Mesa cell-count denominator semantics."""

    total_aoi = _finite_nonnegative(total_amount_aoi, "total_amount_aoi")
    held = _finite_nonnegative(absolute_held_aoi, "absolute_held_aoi")
    total_national = _finite_nonnegative(national_total, "national_total")
    target = _finite_nonnegative(national_target, "national_target")
    classified_total = (
        _finite_nonnegative(classified_total_amount_aoi, "classified_total_amount_aoi")
        if classified_total_amount_aoi is not None
        else None
    )
    pre_existing = (
        _finite_nonnegative(absolute_pre_existing_aoi, "absolute_pre_existing_aoi")
        if absolute_pre_existing_aoi is not None
        else None
    )
    new_prioritizr = (
        _finite_nonnegative(absolute_new_prioritizr_aoi, "absolute_new_prioritizr_aoi")
        if absolute_new_prioritizr_aoi is not None
        else None
    )
    if held > total_aoi + tolerance:
        raise ValueError("absolute_held_aoi cannot exceed total_amount_aoi.")
    if total_aoi > total_national + tolerance:
        raise ValueError("total_amount_aoi cannot exceed national_total.")
    if classified_total is not None and total_aoi > classified_total + tolerance:
        raise ValueError("total_amount_aoi cannot exceed classified_total_amount_aoi.")
    if (pre_existing is None) != (new_prioritizr is None):
        raise ValueError("Both AOI solution categories must be provided together.")
    if (
        pre_existing is not None
        and new_prioritizr is not None
        and abs((pre_existing + new_prioritizr) - held) > tolerance
    ):
        raise ValueError(
            "absolute_held_aoi must equal pre-existing plus new Prioritizr held amounts."
        )
    return MesaAoiCoverageRow(
        feature=feature,
        total_amount_aoi=total_aoi,
        absolute_held_aoi=held,
        coverage_within_aoi=_divide(held, total_aoi),
        contribution_to_national_coverage=_divide(held, total_national),
        contribution_to_national_target=_divide(held, total_national * target),
        national_total_amount=total_national,
        classified_total_amount_aoi=classified_total,
        share_of_national_amount=_divide(total_aoi, total_national),
        share_of_classified_aoi=(
            _divide(total_aoi, classified_total)
            if classified_total is not None
            else None
        ),
        absolute_pre_existing_aoi=pre_existing,
        absolute_new_prioritizr_aoi=new_prioritizr,
        pre_existing_coverage_within_aoi=(
            _divide(pre_existing, total_aoi) if pre_existing is not None else None
        ),
        new_prioritizr_coverage_within_aoi=(
            _divide(new_prioritizr, total_aoi) if new_prioritizr is not None else None
        ),
        pre_existing_contribution_to_national_coverage=(
            _divide(pre_existing, total_national) if pre_existing is not None else None
        ),
        new_prioritizr_contribution_to_national_coverage=(
            _divide(new_prioritizr, total_national)
            if new_prioritizr is not None
            else None
        ),
    )


def _optional_category_masks(
    pre_existing_mask: np.ndarray | None,
    new_prioritizr_mask: np.ndarray | None,
    shape: tuple[int, ...],
    selected_mask: np.ndarray,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    if pre_existing_mask is None and new_prioritizr_mask is None:
        return None, None
    if pre_existing_mask is None or new_prioritizr_mask is None:
        raise ValueError("Both pre-existing and new Prioritizr masks are required.")
    pre_existing = _boolean_mask(pre_existing_mask, shape, "pre_existing_mask")
    new_prioritizr = _boolean_mask(new_prioritizr_mask, shape, "new_prioritizr_mask")
    if np.any(pre_existing & new_prioritizr):
        raise ValueError("AOI solution category masks must be disjoint.")
    if not np.array_equal(pre_existing | new_prioritizr, selected_mask):
        raise ValueError(
            "selected_mask must equal pre-existing plus new Prioritizr masks."
        )
    return pre_existing, new_prioritizr


def grouped_sparse_binary_coverage(
    *,
    features: SparseBinaryFeatureIndex,
    selected_mask: np.ndarray,
    boundary_ids: np.ndarray,
    boundary_count: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Aggregate all feature totals and held counts across boundaries.

    Returns ``(totals, held)`` arrays shaped ``(feature_count, boundary_count)``.
    Negative boundary IDs are outside every boundary.
    """

    if boundary_count < 1:
        raise ValueError("boundary_count must be positive.")
    selected = np.asarray(selected_mask, dtype=bool).ravel()
    boundaries = np.asarray(boundary_ids, dtype=np.int64).ravel()
    if selected.size != boundaries.size:
        raise ValueError("selected_mask and boundary_ids must have equal sizes.")

    totals = np.zeros((features.feature_count, boundary_count), dtype=np.int64)
    held = np.zeros_like(totals)
    for index in range(features.feature_count):
        cells = features.cell_ids[
            int(features.offsets[index]):int(features.offsets[index + 1])
        ]
        feature_boundaries = boundaries[cells]
        in_boundary = feature_boundaries >= 0
        if np.any(feature_boundaries[in_boundary] >= boundary_count):
            raise ValueError("boundary_ids contains an index outside boundary_count.")
        totals[index] = np.bincount(
            feature_boundaries[in_boundary],
            minlength=boundary_count,
        )
        selected_boundaries = feature_boundaries[in_boundary & selected[cells]]
        held[index] = np.bincount(selected_boundaries, minlength=boundary_count)
    return totals, held


def grouped_categorical_coverage(
    *,
    category_values: np.ndarray,
    selected_mask: np.ndarray,
    boundary_ids: np.ndarray,
    feature_ids: Sequence[int],
    boundary_count: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Aggregate categorical feature totals and held counts for all boundaries."""

    values = np.asarray(category_values).ravel()
    selected = np.asarray(selected_mask, dtype=bool).ravel()
    boundaries = np.asarray(boundary_ids, dtype=np.int64).ravel()
    if not (values.size == selected.size == boundaries.size):
        raise ValueError("category_values, selected_mask, and boundary_ids must align.")
    if boundary_count < 1:
        raise ValueError("boundary_count must be positive.")
    feature_index = {int(feature_id): index for index, feature_id in enumerate(feature_ids)}
    if len(feature_index) != len(feature_ids):
        raise ValueError("feature_ids must be unique.")

    mapped = np.full(values.size, -1, dtype=np.int64)
    finite = np.isfinite(values)
    for feature_id, index in feature_index.items():
        mapped[finite & (values == feature_id)] = index
    included = (mapped >= 0) & (boundaries >= 0)
    if np.any(boundaries[included] >= boundary_count):
        raise ValueError("boundary_ids contains an index outside boundary_count.")

    flat_group = mapped[included] * boundary_count + boundaries[included]
    totals = np.bincount(
        flat_group,
        minlength=len(feature_ids) * boundary_count,
    ).reshape(len(feature_ids), boundary_count)
    selected_group = (
        mapped[included & selected] * boundary_count
        + boundaries[included & selected]
    )
    held = np.bincount(
        selected_group,
        minlength=len(feature_ids) * boundary_count,
    ).reshape(len(feature_ids), boundary_count)
    return totals, held


def sparse_index_from_feature_cells(
    feature_cells: Iterable[tuple[str, Sequence[int]]],
) -> SparseBinaryFeatureIndex:
    """Build a validated feature-major index from readable cell sequences."""

    names: list[str] = []
    offsets = [0]
    cell_parts: list[np.ndarray] = []
    for name, values in feature_cells:
        cells = np.asarray(values, dtype=np.int64)
        if cells.size:
            cells = np.unique(cells)
        names.append(name)
        cell_parts.append(cells)
        offsets.append(offsets[-1] + cells.size)
    return SparseBinaryFeatureIndex(
        feature_names=tuple(names),
        offsets=np.asarray(offsets, dtype=np.int64),
        cell_ids=(
            np.concatenate(cell_parts)
            if cell_parts
            else np.empty(0, dtype=np.int64)
        ),
    )


def _counts_for_ids(
    values: np.ndarray,
    id_to_index: dict[int, int],
    feature_count: int,
) -> np.ndarray:
    result = np.zeros(feature_count, dtype=np.int64)
    if values.size == 0:
        return result
    unique, counts = np.unique(values, return_counts=True)
    for feature_id, count in zip(unique, counts, strict=True):
        index = id_to_index.get(int(feature_id))
        if index is not None:
            result[index] = int(count)
    return result


def _relative_shortfall(
    *,
    target: float,
    relative_held: float,
    absolute_target: float,
    absolute_shortfall: float,
    mode: RelativeShortfallMode,
) -> float:
    if mode == "target_difference":
        return max(0.0, target - relative_held)
    if mode == "target_fraction":
        return (absolute_shortfall / absolute_target) if absolute_target > 0 else 0.0
    raise ValueError(f"Unsupported relative shortfall mode {mode!r}.")


def _boolean_mask(value: np.ndarray, shape: tuple[int, ...], label: str) -> np.ndarray:
    mask = np.asarray(value, dtype=bool)
    if mask.shape != shape:
        raise ValueError(f"{label} shape {mask.shape} does not match feature shape {shape}.")
    return mask


def _expand_values(
    value: float | Sequence[float],
    length: int,
    label: str,
) -> list[float]:
    if isinstance(value, (int, float, np.integer, np.floating)):
        return [_finite_nonnegative(float(value), label)] * length
    values = [_finite_nonnegative(item, label) for item in value]
    if len(values) != length:
        raise ValueError(f"{label} must contain {length} values.")
    return values


def _expand_optional_values(
    value: float | None | Sequence[float | None],
    length: int,
    label: str,
) -> list[float | None]:
    if value is None:
        return [None] * length
    if isinstance(value, (int, float, np.integer, np.floating)):
        return [_finite_nonnegative(float(value), label)] * length
    values = [
        None if item is None else _finite_nonnegative(item, label)
        for item in value
    ]
    if len(values) != length:
        raise ValueError(f"{label} must contain {length} values.")
    return values


def _expand_optional_strings(
    value: str | Sequence[str | None] | None,
    length: int,
) -> list[str | None]:
    if value is None or isinstance(value, str):
        return [value] * length
    values = list(value)
    if len(values) != length:
        raise ValueError(f"evaluated must contain {length} values.")
    return values


def _finite_nonnegative(value: float, label: str) -> float:
    result = float(value)
    if not np.isfinite(result) or result < 0:
        raise ValueError(f"{label} must be finite and nonnegative.")
    return result


def _divide(numerator: float, denominator: float) -> float | None:
    return (numerator / denominator) if denominator > 0 else None
