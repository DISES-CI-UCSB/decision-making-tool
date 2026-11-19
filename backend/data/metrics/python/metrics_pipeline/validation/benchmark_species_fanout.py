"""Profile legacy CSR expansion against hybrid sparse species fan-out."""

from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from boundaries.boundary_loader import load_all_boundaries
from boundaries.boundary_topology import (
    AnyBoundaryIndex,
    BoundaryChannelAggregates,
    BoundaryTopologyCache,
    OverlapBoundaryIndex,
    aggregate_prepared_sparse_boundary_weighted_sums,
    prepare_sparse_boundary_weighted_channels,
)
from raster_metrics import RasterFingerprint
from species_overlap import read_species_overlap


_DEFAULT_CACHE = Path(
    "data/metrics/cache/releases/solutions-v0-2-0-20260805"
)
_FULL_GRID = RasterFingerprint(
    width=1353,
    height=1838,
    transform=(
        1000.0,
        0.0,
        4331309.911856957,
        0.0,
        -999.9999999999999,
        2933186.9308051495,
    ),
    crs="EPSG:9377",
)


def _timed(callable_: Any) -> tuple[Any, float]:
    started = time.perf_counter()
    value = callable_()
    return value, time.perf_counter() - started


def _baseline_profile(
    index: AnyBoundaryIndex,
    pixels: np.ndarray,
    weights: np.ndarray,
    selectors: tuple[np.ndarray, np.ndarray, np.ndarray],
) -> tuple[BoundaryChannelAggregates, dict[str, float]]:
    timings: dict[str, float] = defaultdict(float)
    if not isinstance(index, OverlapBoundaryIndex):
        prepared = prepare_sparse_boundary_weighted_channels(
            pixels,
            weights,
            selected=selectors[0],
            pre_existing=selectors[1],
            new_prioritizr=selectors[2],
            num_pixels=index.num_pixels,
        )
        result, timings["exclusiveLookupAndReductions"] = _timed(
            lambda: aggregate_prepared_sparse_boundary_weighted_sums(index, prepared)
        )
        return result, dict(timings)

    def membership() -> np.ndarray:
        return index.offsets[pixels + 1] - index.offsets[pixels]

    multiplicities, timings["membershipLookup"] = _timed(membership)

    def expand_sources() -> np.ndarray:
        return np.repeat(
            np.arange(pixels.size, dtype=np.int64),
            multiplicities,
        )

    source_positions, timings["allClaimSourceExpansion"] = _timed(expand_sources)

    def lookup_owners() -> np.ndarray:
        if source_positions.size == 0:
            return np.empty(0, dtype=np.int32)
        group_starts = np.cumsum(multiplicities, dtype=np.int64) - multiplicities
        claim_positions = (
            np.repeat(index.offsets[pixels], multiplicities)
            + np.arange(source_positions.size, dtype=np.int64)
            - np.repeat(group_starts, multiplicities)
        )
        return index.boundary_indices[claim_positions]

    owners, timings["allClaimOwnerLookup"] = _timed(lookup_owners)

    def reduce_channels() -> BoundaryChannelAggregates:
        results = []
        for selector in (np.ones(pixels.size, dtype=bool), *selectors):
            active = selector[source_positions]
            results.append(
                np.bincount(
                    owners[active],
                    weights=weights[source_positions[active]],
                    minlength=index.num_boundaries,
                )
            )
        return BoundaryChannelAggregates(*results)

    result, timings["channelReductions"] = _timed(reduce_channels)
    return result, dict(timings)


def _hybrid_profile(
    index: AnyBoundaryIndex,
    pixels: np.ndarray,
    weights: np.ndarray,
    selectors: tuple[np.ndarray, np.ndarray, np.ndarray],
) -> tuple[BoundaryChannelAggregates, dict[str, float]]:
    prepared = prepare_sparse_boundary_weighted_channels(
        pixels,
        weights,
        selected=selectors[0],
        pre_existing=selectors[1],
        new_prioritizr=selectors[2],
        num_pixels=index.num_pixels,
    )
    timings: dict[str, float] = defaultdict(float)
    if not isinstance(index, OverlapBoundaryIndex):
        result, timings["exclusiveLookupAndReductions"] = _timed(
            lambda: aggregate_prepared_sparse_boundary_weighted_sums(index, prepared)
        )
        return result, dict(timings)

    def membership() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        starts = index.offsets[pixels]
        stops = index.offsets[pixels + 1]
        return starts, stops, stops - starts

    (starts, _stops, multiplicities), timings["membershipLookup"] = _timed(
        membership
    )

    def primary_lookup() -> tuple[np.ndarray, np.ndarray]:
        positions = np.flatnonzero(multiplicities > 0)
        return positions, index.boundary_indices[starts[positions]]

    (primary_positions, primary_owners), timings["primaryOwnerLookup"] = _timed(
        primary_lookup
    )

    def extra_lookup() -> tuple[np.ndarray, np.ndarray]:
        overlap_positions = np.flatnonzero(multiplicities > 1)
        if overlap_positions.size == 0:
            return (
                np.empty(0, dtype=np.int64),
                np.empty(0, dtype=np.int32),
            )
        extra_counts = multiplicities[overlap_positions] - 1
        extra_source_positions = np.repeat(overlap_positions, extra_counts)
        group_starts = np.cumsum(extra_counts, dtype=np.int64) - extra_counts
        extra_claim_positions = (
            np.repeat(starts[overlap_positions] + 1, extra_counts)
            + np.arange(extra_source_positions.size, dtype=np.int64)
            - np.repeat(group_starts, extra_counts)
        )
        return (
            extra_source_positions,
            index.boundary_indices[extra_claim_positions],
        )

    (extra_positions, extra_owners), timings["extraOwnerExpansion"] = _timed(
        extra_lookup
    )

    def reduce_channels() -> BoundaryChannelAggregates:
        results = [
            np.zeros(index.num_boundaries, dtype=np.float64)
            for _ in range(4)
        ]
        for owners, source_positions in (
            (primary_owners, primary_positions),
            (extra_owners, extra_positions),
        ):
            for result, selector in zip(
                results,
                (np.ones(pixels.size, dtype=bool), *selectors),
                strict=True,
            ):
                active = selector[source_positions]
                if active.any():
                    result += np.bincount(
                        owners[active],
                        weights=weights[source_positions[active]],
                        minlength=index.num_boundaries,
                    )
        return BoundaryChannelAggregates(*results)

    result, timings["channelReductions"] = _timed(reduce_channels)
    return result, dict(timings)


def _selectors(pixels: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    selected = (pixels % 5) < 2
    pre_existing = selected & ((pixels % 11) < 3)
    return selected, pre_existing, selected & ~pre_existing


def run(cache_dir: Path, sample_count: int) -> dict[str, Any]:
    boundaries, errors = load_all_boundaries(cache_dir / "mec-v2")
    if errors:
        raise RuntimeError(f"Boundary cache errors: {errors}")
    indexes, _ = BoundaryTopologyCache().get(boundaries, _FULL_GRID)
    overlap_paths = sorted((cache_dir / "species-overlap").glob("*/*.npz"))
    if not overlap_paths:
        raise RuntimeError(f"No species overlap artifacts found under {cache_dir}")
    sample_paths = overlap_paths[:sample_count]
    totals: dict[str, dict[str, Any]] = {}

    for level, index in indexes.items():
        baseline_seconds: dict[str, float] = defaultdict(float)
        hybrid_seconds: dict[str, float] = defaultdict(float)
        range_cells = 0
        range_overlap_cells = 0
        for path in sample_paths:
            overlap = read_species_overlap(path, _FULL_GRID)
            pixels = overlap.flat_indices
            weights = overlap.areas_m2
            selectors = _selectors(pixels)
            baseline, baseline_parts = _baseline_profile(
                index, pixels, weights, selectors
            )
            hybrid, hybrid_parts = _hybrid_profile(index, pixels, weights, selectors)
            for name, seconds in baseline_parts.items():
                baseline_seconds[name] += seconds
            for name, seconds in hybrid_parts.items():
                hybrid_seconds[name] += seconds
            for channel in (
                "total",
                "selected",
                "pre_existing",
                "new_prioritizr",
            ):
                np.testing.assert_allclose(
                    getattr(hybrid, channel),
                    getattr(baseline, channel),
                    rtol=1e-12,
                    atol=1e-6,
                )
            range_cells += pixels.size
            if isinstance(index, OverlapBoundaryIndex):
                multiplicity = index.offsets[pixels + 1] - index.offsets[pixels]
                range_overlap_cells += int(np.count_nonzero(multiplicity > 1))

        baseline_total = sum(baseline_seconds.values())
        hybrid_total = sum(hybrid_seconds.values())
        totals[level] = {
            "speciesSampleCount": len(sample_paths),
            "rangeCells": range_cells,
            "rangeOverlapCells": range_overlap_cells,
            "baselineSeconds": dict(baseline_seconds),
            "hybridSeconds": dict(hybrid_seconds),
            "baselineTotalSeconds": baseline_total,
            "hybridTotalSeconds": hybrid_total,
            "hybridChangePercent": (
                ((hybrid_total / baseline_total) - 1.0) * 100.0
                if baseline_total
                else 0.0
            ),
        }
    return {
        "format": "species-fanout-kernel-profile-v1",
        "sampleCount": len(sample_paths),
        "cache": str(cache_dir),
        "levels": totals,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=_DEFAULT_CACHE)
    parser.add_argument("--sample-count", type=int, default=250)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = run(args.cache_dir, args.sample_count)
    serialized = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
