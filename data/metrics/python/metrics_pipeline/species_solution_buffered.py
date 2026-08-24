"""Experimental buffered cross-solution species accumulation.

The evaluator remains the exact v1 kernel.  This module changes only how its
catalog-ordered outputs reach counters and detail sinks: bounded species chunks
are converted to structure-of-arrays buffers, then flushed solution-major.
"""

from __future__ import annotations

import hashlib
import io
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from boundaries.boundary_topology import AnyBoundaryIndex
from calculators.species import (
    IUCN_STATUS_ORDER,
    SpeciesAccumulator,
    SpeciesCoverageCounts,
    SpeciesScopeCounts,
)
from raster_metrics import RasterFingerprint
from species_data import SpeciesRecord
from species_overlap import SpeciesOverlap, read_species_overlap
from species_solution_batch import (
    BatchRunStats,
    BatchSolutionFailure,
    BatchSpeciesAreas,
    ExactOverlapInput,
    SpeciesSolutionBatchCancelled,
    SpeciesSolutionBatchError,
    build_checkpoint_metadata,
    evaluate_species_batch,
    validate_category_matrix,
)
from species_taxonomy import CLASS_BUCKETS

DEFAULT_SPECIES_CHUNK_SIZE = 128
OverlapLoader = Callable[[Path | io.BytesIO, RasterFingerprint], SpeciesOverlap]


@dataclass(frozen=True)
class BufferedSpeciesAreas:
    """Chunk-major area channels with source species order on axis zero."""

    national_total: np.ndarray
    national_selected: np.ndarray
    national_pre_existing: np.ndarray
    national_new_prioritizr: np.ndarray
    boundary_total: dict[str, np.ndarray]
    boundary_selected: dict[str, np.ndarray]
    boundary_pre_existing: dict[str, np.ndarray]
    boundary_new_prioritizr: dict[str, np.ndarray]


def process_exact_species_batch_buffered(
    *,
    species_records: Sequence[SpeciesRecord],
    overlap_paths: Sequence[Path | ExactOverlapInput],
    categories: np.ndarray,
    fingerprint: RasterFingerprint,
    boundary_indexes: Mapping[str, AnyBoundaryIndex],
    accumulators: Sequence[SpeciesAccumulator | None] | None = None,
    overlap_loader: OverlapLoader = read_species_overlap,
    species_chunk_size: int = DEFAULT_SPECIES_CHUNK_SIZE,
    binding: Mapping[str, object] | None = None,
    checkpoint_interval: int = 0,
    checkpoint: Callable[[dict[str, object]], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> BatchRunStats:
    """Evaluate exact overlaps once and flush bounded columnar species chunks."""

    if len(species_records) != len(overlap_paths):
        raise SpeciesSolutionBatchError(
            "Species records and overlap paths must have equal catalog length."
        )
    if species_chunk_size <= 0:
        raise SpeciesSolutionBatchError("species_chunk_size must be positive.")
    values = validate_category_matrix(
        categories,
        num_cells=fingerprint.width * fingerprint.height,
    )
    if accumulators is not None and len(accumulators) != values.shape[1]:
        raise SpeciesSolutionBatchError(
            "Accumulator count must match the number of solutions."
        )
    if checkpoint_interval < 0:
        raise SpeciesSolutionBatchError("checkpoint_interval cannot be negative.")
    if checkpoint is not None and binding is None:
        raise SpeciesSolutionBatchError("Checkpoint output requires a batch binding.")

    npz_bytes = 0
    exact_read_seconds = 0.0
    evaluation_seconds = 0.0
    accumulator_seconds = 0.0
    active = (
        {index for index, value in enumerate(accumulators) if value is not None}
        if accumulators is not None
        else set()
    )
    failures: list[BatchSolutionFailure] = []
    chunk_records: list[SpeciesRecord] = []
    chunk_areas: list[BatchSpeciesAreas] = []
    chunk_start = 0

    def flush() -> None:
        nonlocal accumulator_seconds
        if not chunk_records or accumulators is None:
            chunk_records.clear()
            chunk_areas.clear()
            return
        started = time.perf_counter()
        buffered = _columnar_areas(chunk_areas)
        for solution_index in sorted(active):
            accumulator = accumulators[solution_index]
            assert accumulator is not None
            try:
                _flush_solution(
                    accumulator,
                    chunk_records,
                    buffered,
                    solution_index=solution_index,
                )
            except Exception as exc:  # noqa: BLE001 - isolate one solution member
                failures.append(
                    BatchSolutionFailure(
                        solution_index=solution_index,
                        species_index=chunk_start,
                        species_name=chunk_records[0].scientific_name,
                        error_type=type(exc).__name__,
                        error=str(exc),
                    )
                )
                active.remove(solution_index)
        accumulator_seconds += time.perf_counter() - started
        chunk_records.clear()
        chunk_areas.clear()

    for species_index, (record, overlap_input) in enumerate(
        zip(species_records, overlap_paths, strict=True)
    ):
        if cancel_check is not None and cancel_check():
            flush()
            raise SpeciesSolutionBatchCancelled(
                f"Cancelled before catalog species index {species_index}."
            )
        started = time.perf_counter()
        if isinstance(overlap_input, ExactOverlapInput):
            path = overlap_input.path
            consumed = path.read_bytes()
            if (
                len(consumed) != overlap_input.expected_bytes
                or hashlib.sha256(consumed).hexdigest() != overlap_input.expected_sha256
            ):
                raise SpeciesSolutionBatchError(
                    f"Exact overlap changed after discovery for {path.name!r}."
                )
            overlap = overlap_loader(io.BytesIO(consumed), fingerprint)
            npz_bytes += len(consumed)
        else:
            path = overlap_input
            overlap = overlap_loader(path, fingerprint)
            npz_bytes += path.stat().st_size
        exact_read_seconds += time.perf_counter() - started

        started = time.perf_counter()
        areas = evaluate_species_batch(overlap, values, boundary_indexes)
        evaluation_seconds += time.perf_counter() - started
        if not chunk_records:
            chunk_start = species_index
        chunk_records.append(record)
        chunk_areas.append(areas)
        if len(chunk_records) == species_chunk_size:
            flush()

        completed = species_index + 1
        if (
            checkpoint is not None
            and checkpoint_interval > 0
            and completed % checkpoint_interval == 0
        ):
            flush()
            checkpoint(
                build_checkpoint_metadata(
                    binding=binding,
                    completed_species_count=completed,
                    species_count=len(species_records),
                )
            )
    flush()
    return BatchRunStats(
        species_processed=len(species_records),
        npz_opens=len(overlap_paths),
        npz_bytes=npz_bytes,
        exact_read_seconds=exact_read_seconds,
        evaluation_seconds=evaluation_seconds,
        accumulator_seconds=accumulator_seconds,
        solution_failures=tuple(failures),
    )


def _columnar_areas(values: Sequence[BatchSpeciesAreas]) -> BufferedSpeciesAreas:
    levels = tuple(values[0].boundaries) if values else ()
    return BufferedSpeciesAreas(
        national_total=np.asarray(
            [value.national.total for value in values], dtype=np.float64
        ),
        national_selected=np.stack([value.national.selected for value in values]),
        national_pre_existing=np.stack(
            [value.national.pre_existing for value in values]
        ),
        national_new_prioritizr=np.stack(
            [value.national.new_prioritizr for value in values]
        ),
        boundary_total={
            level: np.stack([value.boundaries[level].total for value in values])
            for level in levels
        },
        boundary_selected={
            level: np.stack([value.boundaries[level].selected for value in values])
            for level in levels
        },
        boundary_pre_existing={
            level: np.stack(
                [value.boundaries[level].pre_existing for value in values]
            )
            for level in levels
        },
        boundary_new_prioritizr={
            level: np.stack(
                [value.boundaries[level].new_prioritizr for value in values]
            )
            for level in levels
        },
    )


def _flush_solution(
    accumulator: SpeciesAccumulator,
    records: Sequence[SpeciesRecord],
    areas: BufferedSpeciesAreas,
    *,
    solution_index: int,
) -> None:
    selected = areas.national_selected[:, solution_index]
    pre_existing = areas.national_pre_existing[:, solution_index]
    new_prioritizr = areas.national_new_prioritizr[:, solution_index]
    boundary_channels = {
        level: (
            areas.boundary_selected[level][:, solution_index, :],
            areas.boundary_total[level],
            areas.boundary_pre_existing[level][:, solution_index, :],
            areas.boundary_new_prioritizr[level][:, solution_index, :],
        )
        for level in areas.boundary_total
    }
    sink = accumulator.detail_sink
    if sink is not None:
        bulk = getattr(sink, "record_species_chunk", None)
        if bulk is None:
            for row, species in enumerate(records):
                sink.record_national(
                    species,
                    float(selected[row]),
                    float(areas.national_total[row]),
                    pre_existing_area_m2=float(pre_existing[row]),
                    new_prioritizr_area_m2=float(new_prioritizr[row]),
                )
                for level, channels in boundary_channels.items():
                    sink.record_sub_level(
                        species,
                        level,
                        channels[0][row],
                        channels[1][row],
                        pre_existing_per_boundary=channels[2][row],
                        new_prioritizr_per_boundary=channels[3][row],
                    )
        else:
            bulk(
                records,
                selected,
                areas.national_total,
                pre_existing,
                new_prioritizr,
                boundary_channels,
            )

    count = len(records)
    accumulator.species_aligned += count
    accumulator.species_processed += count
    accumulator.species_with_range += int(np.count_nonzero(areas.national_total > 0))
    targets = np.asarray(
        [
            np.nan
            if (target := accumulator._target_for(species)) is None
            else target
            for species in records
        ],
        dtype=np.float64,
    )
    buckets = np.asarray([species.bucket for species in records], dtype=object)
    statuses = np.asarray(
        [_normalized_status(species.iucn_status) for species in records], dtype=object
    )
    threatened = np.asarray([species.threatened for species in records], dtype=bool)
    dual_reference = bool(
        accumulator.target_policy is not None
        and accumulator.target_policy.kind == "dual_reference"
    )
    _update_scope_batch(
        [accumulator.national],
        selected[:, None],
        areas.national_total[:, None],
        targets=targets,
        buckets=buckets,
        statuses=statuses,
        threatened=threatened,
        dual_reference=dual_reference,
        national=True,
    )
    for level, channels in boundary_channels.items():
        _update_scope_batch(
            accumulator.sub[level],
            channels[0],
            channels[1],
            targets=targets,
            buckets=buckets,
            statuses=statuses,
            threatened=threatened,
            dual_reference=dual_reference,
            national=False,
        )


def _update_scope_batch(
    scopes: Sequence[SpeciesScopeCounts],
    selected: np.ndarray,
    total: np.ndarray,
    *,
    targets: np.ndarray,
    buckets: np.ndarray,
    statuses: np.ndarray,
    threatened: np.ndarray,
    dual_reference: bool,
    national: bool,
) -> None:
    positive_total = total > 0
    present = selected > 0
    ratio = np.divide(
        selected,
        total,
        out=np.zeros_like(selected),
        where=positive_total,
    ) * 100.0
    target_applicable = np.isfinite(targets)[:, None]
    coverage_applicable = target_applicable & (True if national else positive_total)
    target_met = coverage_applicable & positive_total & (ratio >= targets[:, None])

    _add_scope_values(scopes, "all_present", present.sum(axis=0))
    _add_scope_values(
        scopes,
        "threatened_present",
        (present & threatened[:, None]).sum(axis=0),
    )
    _add_scope_values(
        scopes,
        "threatened_secured",
        (present & threatened[:, None] & target_met).sum(axis=0),
    )
    for bucket in CLASS_BUCKETS:
        in_bucket = buckets == bucket
        _add_bucket_values(scopes, bucket, (present & in_bucket[:, None]).sum(axis=0))
        applicable = coverage_applicable & in_bucket[:, None]
        _add_coverage_values(
            scopes,
            bucket,
            applicable,
            target_met & in_bucket[:, None],
            statuses,
            reference_threshold=None,
        )
        if dual_reference:
            reference_applicable = in_bucket[:, None] & (
                True if national else positive_total
            )
            for threshold in (17.0, 30.0):
                reference_met = reference_applicable & (ratio >= threshold)
                _add_coverage_values(
                    scopes,
                    bucket,
                    reference_applicable,
                    reference_met,
                    statuses,
                    reference_threshold=threshold,
                )
    if dual_reference:
        for threshold in (17.0, 30.0):
            _add_reference_threatened(
                scopes,
                threshold,
                (present & threatened[:, None] & (ratio >= threshold)).sum(axis=0),
            )


def _add_scope_values(
    scopes: Sequence[SpeciesScopeCounts], attribute: str, values: np.ndarray
) -> None:
    for index in np.flatnonzero(values).tolist():
        setattr(scopes[index], attribute, getattr(scopes[index], attribute) + int(values[index]))


def _add_bucket_values(
    scopes: Sequence[SpeciesScopeCounts], bucket: str, values: np.ndarray
) -> None:
    for index in np.flatnonzero(values).tolist():
        scopes[index].by_bucket[bucket] += int(values[index])


def _add_coverage_values(
    scopes: Sequence[SpeciesScopeCounts],
    bucket: str,
    applicable: np.ndarray,
    met: np.ndarray,
    statuses: np.ndarray,
    *,
    reference_threshold: float | None,
) -> None:
    totals = applicable.sum(axis=0)
    mets = met.sum(axis=0)
    for index in np.flatnonzero(totals).tolist():
        coverage = _coverage(scopes[index], bucket, reference_threshold)
        coverage.total += int(totals[index])
        coverage.met += int(mets[index])
    for status in IUCN_STATUS_ORDER:
        status_rows = statuses == status
        status_totals = (applicable & status_rows[:, None]).sum(axis=0)
        status_mets = (met & status_rows[:, None]).sum(axis=0)
        for index in np.flatnonzero(status_totals).tolist():
            coverage = _coverage(scopes[index], bucket, reference_threshold)
            status_count = coverage.by_status.setdefault(status, SpeciesCoverageCounts())
            status_count.total += int(status_totals[index])
            status_count.met += int(status_mets[index])


def _coverage(
    scope: SpeciesScopeCounts,
    bucket: str,
    reference_threshold: float | None,
) -> SpeciesCoverageCounts:
    if reference_threshold is None:
        return scope.coverage_by_bucket[bucket]
    return scope.reference_coverage_by_threshold[reference_threshold][bucket]


def _add_reference_threatened(
    scopes: Sequence[SpeciesScopeCounts], threshold: float, values: np.ndarray
) -> None:
    for index in np.flatnonzero(values).tolist():
        scopes[index].reference_threatened_secured[threshold] += int(values[index])


def _normalized_status(value: str) -> str:
    status = value.strip().upper()
    if status in {"CR", "EN", "VU", "NT", "LC", "DD"}:
        return status
    return "other" if status else "unknown"
