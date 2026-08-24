"""Benchmark the isolated exact-NPZ cross-solution microbatch prototype."""

from __future__ import annotations

import argparse
import json
import resource
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from boundaries.boundary_id_grid import boundary_collection_sha256
from boundaries.boundary_loader import load_all_boundaries
from boundaries.boundary_topology import (
    AnyBoundaryIndex,
    BoundaryTopologyCache,
    aggregate_prepared_sparse_boundary_weighted_sums,
    prepare_sparse_boundary_weighted_channels,
)
from calculators.species import SpeciesAccumulator, SpeciesScopeMetrics
from local_io import cached_download
from raster_align import canonical_sha256, grid_sha256
from species_data import (
    SpeciesRecord,
    compute_pool_sizes,
    load_species_records,
)
from species_overlap import read_species_overlap
from species_solution_batch import (
    AREA_ABSOLUTE_TOLERANCE_M2,
    AREA_RELATIVE_TOLERANCE,
    build_batch_binding,
    evaluate_species_batch,
    load_category_matrix,
    process_exact_species_batch,
)
from species_target_policy import SpeciesTargetPolicy, resolve_species_target_policy

DEFAULT_SOLUTION_IDS = (
    "eco17_estr17_esprep17_runap_iheh2022",
    "eco17_estr17_esprep30_runap_omec_iheh2030",
    "eco17_estr30_esprn_runap_iheh2022",
    "eco17_estr30_esprn_runap_omec_iheh2030",
    "eco30_estr17_runap_iheh2022",
    "eco30_estr17_runap_omec_iheh2030",
    "eco30_estr30_esprep17_runap_omec_iheh2022",
    "eco30_estr30_esprep30_runap_iheh2030",
)


class BenchmarkError(RuntimeError):
    pass


def run(args: argparse.Namespace) -> dict[str, Any]:
    setup_started = time.perf_counter()
    manifest = _read_json(args.manifest)
    solutions_by_id = {
        str(solution.get("id")): solution
        for solution in manifest.get("solutions", [])
        if solution.get("domain") == "land"
    }
    solution_ids = tuple(args.solution_id or DEFAULT_SOLUTION_IDS)
    missing_solutions = sorted(set(solution_ids) - solutions_by_id.keys())
    if missing_solutions:
        raise BenchmarkError(f"Solutions are absent from the manifest: {missing_solutions}")
    solutions = [solutions_by_id[solution_id] for solution_id in solution_ids]
    downloads = [
        cached_download(solution["displayUrl"], args.cache_dir)
        for solution in solutions
    ]
    category_started = time.perf_counter()
    category_matrix = load_category_matrix([download.path for download in downloads])
    category_seconds = time.perf_counter() - category_started

    species_records = load_species_records(args.species_csv)
    all_sources, inventory_sha256 = _discover_sources(
        args.cache_dir,
        species_records,
        target_grid_sha256=grid_sha256(category_matrix.fingerprint),
    )
    all_available_records = [record for _, record, _, _ in all_sources]
    sources = all_sources
    if args.limit is not None:
        sources = _stratified_catalog_subset(sources, args.limit)

    boundary_started = time.perf_counter()
    boundaries, failures = load_all_boundaries(args.cache_dir)
    if failures:
        raise BenchmarkError(f"Pinned boundary loading failed: {failures}")
    indexes, _ = BoundaryTopologyCache().get(
        boundaries,
        category_matrix.fingerprint,
    )
    boundary_seconds = time.perf_counter() - boundary_started
    if set(indexes) != {"departments", "municipalities", "siraps", "runaps", "omecs"}:
        raise BenchmarkError(f"All five boundary levels are required: {sorted(indexes)}")

    target_policies = [
        resolve_species_target_policy(
            solution,
            catalog_records=species_records,
            available_records=all_available_records,
        )
        for solution in solutions
    ]
    binding = build_batch_binding(
        exact_cache_inventory_sha256=inventory_sha256,
        ordered_solution_ids=solution_ids,
        solution_sha256s=[download.sha256 for download in downloads],
        topology_provenance_sha256=canonical_sha256(
            {
                "boundaryCollectionSha256": boundary_collection_sha256(boundaries),
                "levels": {
                    level: {
                        "boundaryIds": index.boundary_ids,
                        "totalClaims": index.total_claims,
                        "overlapPixels": index.overlap_pixels,
                    }
                    for level, index in sorted(indexes.items())
                },
            }
        ),
        target_policy_sha256s=[
            canonical_sha256(_policy_payload(policy)) for policy in target_policies
        ],
        species_catalog_sha256=canonical_sha256(
            [
                {
                    "catalogIndex": catalog_index,
                    "scientificName": record.scientific_name,
                }
                for catalog_index, record, _, _ in sources
            ]
        ),
    )
    setup_seconds = time.perf_counter() - setup_started

    # Warm every selected NPZ once before either timed path. This removes cold
    # filesystem cache placement as a source of apparent batch speedup.
    warm_started = time.perf_counter()
    for _, _, path, _ in sources:
        read_species_overlap(path, category_matrix.fingerprint)
    warm_seconds = time.perf_counter() - warm_started

    batch_results: dict[str, Any] = {}
    for batch_size in args.batch_size:
        if batch_size > len(solutions):
            continue
        selected_sources = sources
        selected_categories = category_matrix.values[:, :batch_size]
        selected_policies = target_policies[:batch_size]
        baseline_accumulators = _new_accumulators(
            all_available_records,
            selected_policies,
            indexes,
            species_expected=len(selected_sources),
        )
        batch_accumulators = _new_accumulators(
            all_available_records,
            selected_policies,
            indexes,
            species_expected=len(selected_sources),
        )
        baseline_profile: dict[str, float] = {}

        def run_baseline(
            baseline_profile=baseline_profile,
            selected_sources=selected_sources,
            selected_categories=selected_categories,
            baseline_accumulators=baseline_accumulators,
        ) -> None:
            baseline_profile.update(
                _process_independently(
                    selected_sources,
                    selected_categories,
                    category_matrix.fingerprint,
                    indexes,
                    baseline_accumulators,
                )
            )

        baseline_timing = _measure(run_baseline)
        batch_stats: dict[str, object] = {}

        def run_batch(
            selected_sources=selected_sources,
            selected_categories=selected_categories,
            batch_accumulators=batch_accumulators,
            batch_stats=batch_stats,
        ) -> None:
            stats = process_exact_species_batch(
                species_records=[record for _, record, _, _ in selected_sources],
                overlap_paths=[path for _, _, path, _ in selected_sources],
                categories=selected_categories,
                fingerprint=category_matrix.fingerprint,
                boundary_indexes=indexes,
                accumulators=batch_accumulators,
                binding=binding,
            )
            batch_stats.update(asdict(stats))

        batch_timing = _measure(run_batch)
        parity = _compare_accumulators(
            baseline_accumulators,
            batch_accumulators,
        )
        speedup = baseline_timing["wallSeconds"] / batch_timing["wallSeconds"]
        batch_results[str(batch_size)] = {
            "independent": {
                **baseline_timing,
                "phaseSeconds": baseline_profile,
                "npzOpens": len(selected_sources) * batch_size,
                "npzBytes": sum(path.stat().st_size for _, _, path, _ in selected_sources)
                * batch_size,
            },
            "batched": {
                **batch_timing,
                **batch_stats,
            },
            "speedup": speedup,
            "accumulatorParity": parity,
            "gate": {
                "throughputAtLeast2x": speedup >= 2.0,
                "peakRssBelow16GiB": batch_timing["peakRssBytes"] < 16 * 1024**3,
                "accumulatorParity": parity["mismatchCount"] == 0,
            },
        }
    raw_parity_started = time.perf_counter()
    raw_parity = _validate_raw_area_parity(
        sources,
        category_matrix.values,
        category_matrix.fingerprint,
        indexes,
    )
    raw_parity["seconds"] = time.perf_counter() - raw_parity_started
    eight = batch_results.get("8")
    hard_gate = bool(
        eight
        and all(eight["gate"].values())
        and raw_parity["withinTolerance"]
    )
    report = {
        "format": "species-solution-microbatch-real-benchmark-v1",
        "classification": "real exact-NPZ all-boundary stratified"
        if args.limit is not None
        else "real exact-NPZ all-boundary full-catalog",
        "inputs": {
            "manifest": str(args.manifest),
            "cacheDirectory": str(args.cache_dir),
            "speciesCsv": str(args.species_csv),
            "targetGridSha256": grid_sha256(category_matrix.fingerprint),
            "availableSpeciesCount": len(all_available_records),
            "benchmarkSpeciesCount": len(sources),
            "stratifiedSubset": args.limit is not None,
            "orderedSolutions": [
                {
                    "solutionId": solution_id,
                    "rasterSha256": download.sha256,
                    "targetPolicy": policy.kind,
                    "includes": solution.get("finderInputs", {}).get(
                        "includeLayerIds", []
                    ),
                    "costLayerId": solution.get("finderInputs", {}).get(
                        "costLayerId"
                    ),
                }
                for solution_id, solution, download, policy in zip(
                    solution_ids,
                    solutions,
                    downloads,
                    target_policies,
                    strict=True,
                )
            ],
            "binding": binding,
        },
        "setup": {
            "totalSeconds": setup_seconds,
            "categoryMatrixSeconds": category_seconds,
            "categoryMatrixBytes": category_matrix.values.nbytes,
            "boundaryTopologySeconds": boundary_seconds,
            "topologyBytes": sum(index.estimated_bytes for index in indexes.values()),
            "topologyEstimatedBuildPeakBytes": max(
                index.estimated_peak_build_bytes for index in indexes.values()
            ),
            "warmExactNpzSeconds": warm_seconds,
        },
        "batchSizes": batch_results,
        "rawAreaParity": raw_parity,
        "hardGate": {
            "requiredBatchSize": 8,
            "passed": hard_gate,
            "requirements": {
                "speedup": ">=2.0x",
                "peakRssBytes": f"<{16 * 1024**3}",
                "areaTolerance": {
                    "relative": AREA_RELATIVE_TOLERANCE,
                    "absoluteM2": AREA_ABSOLUTE_TOLERANCE_M2,
                },
                "unexplainedAccumulatorDrift": 0,
            },
        },
        "projection": _projection(batch_results, len(sources)),
        "processPeakRssBytes": _peak_rss_bytes(),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return report


def _discover_sources(
    cache_dir: Path,
    records: Sequence[SpeciesRecord],
    *,
    target_grid_sha256: str,
) -> tuple[list[tuple[int, SpeciesRecord, Path, int]], str]:
    by_filename: dict[str, tuple[Path, dict[str, Any]]] = {}
    for manifest_path in (cache_dir / "species-overlap").glob("*/*.json"):
        manifest = _read_json(manifest_path)
        if manifest.get("targetGridSha256") != target_grid_sha256:
            continue
        source_url = manifest.get("sourceUrl")
        artifact_path = manifest_path.with_suffix(".npz")
        if not isinstance(source_url, str) or not artifact_path.is_file():
            continue
        filename = unquote(Path(urlparse(source_url).path).name)
        if filename in by_filename:
            existing_path, existing_manifest = by_filename[filename]
            if (
                existing_manifest.get("sourceSha256") != manifest.get("sourceSha256")
                or existing_manifest.get("overlapSha256")
                != manifest.get("overlapSha256")
                or existing_manifest.get("policySha256")
                != manifest.get("policySha256")
                or existing_manifest.get("targetGridSha256")
                != manifest.get("targetGridSha256")
            ):
                raise BenchmarkError(f"Conflicting exact overlap for {filename!r}.")
            by_filename[filename] = min(
                ((existing_path, existing_manifest), (artifact_path, manifest)),
                key=lambda value: str(value[0]),
            )
            continue
        by_filename[filename] = (artifact_path, manifest)

    sources: list[tuple[int, SpeciesRecord, Path, int]] = []
    inventory = []
    for catalog_index, record in enumerate(records):
        found = by_filename.get(record.blob_filename)
        if found is None:
            continue
        path, manifest = found
        sources.append(
            (
                catalog_index,
                record,
                path,
                int(manifest["qa"]["positiveTargetCellCount"]),
            )
        )
        inventory.append(
            {
                "catalogIndex": catalog_index,
                "scientificName": record.scientific_name,
                "cacheKey": manifest["cacheKey"],
                "overlapSha256": manifest["overlapSha256"],
            }
        )
    if not sources:
        raise BenchmarkError("No exact overlap artifacts match the solution grid.")
    return sources, canonical_sha256(inventory)


def _stratified_catalog_subset(
    sources: Sequence[tuple[int, SpeciesRecord, Path, int]],
    limit: int,
) -> list[tuple[int, SpeciesRecord, Path, int]]:
    if limit <= 0:
        raise BenchmarkError("--limit must be positive.")
    if limit >= len(sources):
        return list(sources)
    by_size = sorted(sources, key=lambda item: (item[3], item[0]))
    positions = np.linspace(0, len(by_size) - 1, num=limit, dtype=np.int64)
    selected = {by_size[int(position)][0] for position in positions}
    return [source for source in sources if source[0] in selected]


def _new_accumulators(
    available_records: Sequence[SpeciesRecord],
    policies: Sequence[SpeciesTargetPolicy],
    indexes: Mapping[str, AnyBoundaryIndex],
    *,
    species_expected: int,
) -> list[SpeciesAccumulator]:
    pool_sizes = compute_pool_sizes(list(available_records))
    values = [
        SpeciesAccumulator(
            target_pct=policy.scalar_target_pct,
            pool_sizes=pool_sizes,
            target_policy=policy,
            species_expected=species_expected,
        )
        for policy in policies
    ]
    sizes = {level: index.num_boundaries for level, index in indexes.items()}
    for value in values:
        value.init_sub(sizes)
    return values


def _process_independently(
    sources: Sequence[tuple[int, SpeciesRecord, Path, int]],
    categories: np.ndarray,
    fingerprint,
    indexes: Mapping[str, AnyBoundaryIndex],
    accumulators: Sequence[SpeciesAccumulator],
) -> dict[str, float]:
    exact_read_seconds = 0.0
    evaluation_seconds = 0.0
    accumulator_seconds = 0.0
    for solution_index, accumulator in enumerate(accumulators):
        for _, record, path, _ in sources:
            phase_started = time.perf_counter()
            overlap = read_species_overlap(path, fingerprint)
            exact_read_seconds += time.perf_counter() - phase_started
            phase_started = time.perf_counter()
            at_range = categories[overlap.flat_indices, solution_index]
            total = float(overlap.areas_m2.sum(dtype=np.float64))
            selected = float(
                overlap.areas_m2[at_range != 0].sum(dtype=np.float64)
            )
            pre_existing = float(
                overlap.areas_m2[at_range == 2].sum(dtype=np.float64)
            )
            new_prioritizr = float(
                overlap.areas_m2[at_range == 1].sum(dtype=np.float64)
            )
            prepared = prepare_sparse_boundary_weighted_channels(
                overlap.flat_indices,
                overlap.areas_m2,
                selected=at_range != 0,
                pre_existing=at_range == 2,
                new_prioritizr=at_range == 1,
                num_pixels=categories.shape[0],
            )
            boundary_areas = {
                level: aggregate_prepared_sparse_boundary_weighted_sums(
                    index,
                    prepared,
                )
                for level, index in indexes.items()
            }
            evaluation_seconds += time.perf_counter() - phase_started
            phase_started = time.perf_counter()
            accumulator.species_aligned += 1
            accumulator.species_processed += 1
            accumulator.species_with_range += int(total > 0)
            accumulator.record_species_national(
                record,
                selected,
                total,
                pre_existing_range_area_m2=pre_existing,
                new_prioritizr_range_area_m2=new_prioritizr,
            )
            for level, areas in boundary_areas.items():
                accumulator.record_species_sub_level(
                    record,
                    level,
                    areas.selected,
                    areas.total,
                    pre_existing_per_boundary=areas.pre_existing,
                    new_prioritizr_per_boundary=areas.new_prioritizr,
                )
            accumulator_seconds += time.perf_counter() - phase_started
    return {
        "exactRead": exact_read_seconds,
        "evaluation": evaluation_seconds,
        "accumulator": accumulator_seconds,
    }


def _validate_raw_area_parity(
    sources: Sequence[tuple[int, SpeciesRecord, Path, int]],
    categories: np.ndarray,
    fingerprint,
    indexes: Mapping[str, AnyBoundaryIndex],
) -> dict[str, Any]:
    maximum_national_delta = 0.0
    maximum_boundary_delta = 0.0
    mismatch_count = 0
    comparisons = 0
    for _, _, path, _ in sources:
        overlap = read_species_overlap(path, fingerprint)
        observed = evaluate_species_batch(overlap, categories, indexes)
        for solution_index in range(categories.shape[1]):
            at_range = categories[overlap.flat_indices, solution_index]
            expected_national = (
                float(overlap.areas_m2.sum(dtype=np.float64)),
                float(overlap.areas_m2[at_range != 0].sum(dtype=np.float64)),
                float(overlap.areas_m2[at_range == 2].sum(dtype=np.float64)),
                float(overlap.areas_m2[at_range == 1].sum(dtype=np.float64)),
            )
            observed_national = (
                observed.national.total,
                float(observed.national.selected[solution_index]),
                float(observed.national.pre_existing[solution_index]),
                float(observed.national.new_prioritizr[solution_index]),
            )
            for expected, actual in zip(
                expected_national, observed_national, strict=True
            ):
                delta = abs(expected - actual)
                maximum_national_delta = max(maximum_national_delta, delta)
                mismatch_count += int(not _close(expected, actual))
                comparisons += 1
            prepared = prepare_sparse_boundary_weighted_channels(
                overlap.flat_indices,
                overlap.areas_m2,
                selected=at_range != 0,
                pre_existing=at_range == 2,
                new_prioritizr=at_range == 1,
                num_pixels=categories.shape[0],
            )
            for level, index in indexes.items():
                expected = aggregate_prepared_sparse_boundary_weighted_sums(
                    index,
                    prepared,
                )
                actual = observed.boundaries[level]
                for channel in ("total", "selected", "pre_existing", "new_prioritizr"):
                    expected_values = getattr(expected, channel)
                    actual_values = (
                        actual.total
                        if channel == "total"
                        else getattr(actual, channel)[solution_index]
                    )
                    delta = (
                        float(np.max(np.abs(expected_values - actual_values)))
                        if expected_values.size
                        else 0.0
                    )
                    maximum_boundary_delta = max(maximum_boundary_delta, delta)
                    close = np.allclose(
                        expected_values,
                        actual_values,
                        rtol=AREA_RELATIVE_TOLERANCE,
                        atol=AREA_ABSOLUTE_TOLERANCE_M2,
                    )
                    mismatch_count += int(not close)
                    comparisons += 1
    return {
        "speciesCount": len(sources),
        "solutionCount": categories.shape[1],
        "levels": list(indexes),
        "comparisons": comparisons,
        "maximumNationalDeltaM2": maximum_national_delta,
        "maximumBoundaryDeltaM2": maximum_boundary_delta,
        "mismatchCount": mismatch_count,
        "withinTolerance": mismatch_count == 0,
    }


def _compare_accumulators(
    expected: Sequence[SpeciesAccumulator],
    observed: Sequence[SpeciesAccumulator],
) -> dict[str, Any]:
    mismatch_count = 0
    scope_count = 0
    metric_mismatch_count = 0
    for expected_accumulator, observed_accumulator in zip(
        expected, observed, strict=True
    ):
        if expected_accumulator.national != observed_accumulator.national:
            mismatch_count += 1
        expected_metrics = SpeciesScopeMetrics.from_counts(
            expected_accumulator.national,
            expected_accumulator.pool_sizes,
        )
        observed_metrics = SpeciesScopeMetrics.from_counts(
            observed_accumulator.national,
            observed_accumulator.pool_sizes,
        )
        metric_mismatch_count += int(expected_metrics != observed_metrics)
        scope_count += 1
        for level in expected_accumulator.sub:
            for expected_scope, observed_scope in zip(
                expected_accumulator.sub[level],
                observed_accumulator.sub[level],
                strict=True,
            ):
                mismatch_count += int(expected_scope != observed_scope)
                expected_metrics = SpeciesScopeMetrics.from_counts(
                    expected_scope,
                    expected_accumulator.pool_sizes,
                )
                observed_metrics = SpeciesScopeMetrics.from_counts(
                    observed_scope,
                    observed_accumulator.pool_sizes,
                )
                metric_mismatch_count += int(expected_metrics != observed_metrics)
                scope_count += 1
    return {
        "solutionCount": len(expected),
        "scopeCount": scope_count,
        "mismatchCount": mismatch_count,
        "metricStatusMismatchCount": metric_mismatch_count,
    }


def _measure(function: Callable[[], None]) -> dict[str, Any]:
    before = resource.getrusage(resource.RUSAGE_SELF)
    started = time.perf_counter()
    function()
    elapsed = time.perf_counter() - started
    after = resource.getrusage(resource.RUSAGE_SELF)
    return {
        "wallSeconds": elapsed,
        "userSeconds": after.ru_utime - before.ru_utime,
        "systemSeconds": after.ru_stime - before.ru_stime,
        "peakRssBytes": _peak_rss_bytes(),
    }


def _projection(batch_results: Mapping[str, Any], species_count: int) -> dict[str, Any]:
    result = batch_results.get("8")
    if result is None or species_count == 0:
        return {}
    scale = 8_298 / species_count
    full_batch_seconds = result["batched"]["wallSeconds"] * scale
    independent_seconds = result["independent"]["wallSeconds"] * scale
    batches = 168 / 8
    return {
        "basis": "linear species-count extrapolation from the real stratified subset",
        "full8298SpeciesOneEightSolutionBatchSeconds": full_batch_seconds,
        "full8298SpeciesSameEightIndependentSeconds": independent_seconds,
        "full168SolutionsSequentialSpeciesHours": full_batch_seconds * batches / 3600,
        "twoWorkerSpeciesHours": full_batch_seconds * batches / 7200,
    }


def _policy_payload(policy: SpeciesTargetPolicy) -> dict[str, Any]:
    return {
        "kind": policy.kind,
        "scalarTargetPercent": policy.scalar_target_pct,
        "targetsBySpecies": policy.targets_by_species,
        "provenance": policy.provenance,
    }


def _close(expected: float, actual: float) -> bool:
    return bool(
        np.isclose(
            expected,
            actual,
            rtol=AREA_RELATIVE_TOLERANCE,
            atol=AREA_ABSOLUTE_TOLERANCE_M2,
        )
    )


def _peak_rss_bytes() -> int:
    value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return value if sys.platform == "darwin" else value * 1024


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise BenchmarkError(f"Expected a JSON object: {path}")
    return value


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--species-csv", type=Path, required=True)
    parser.add_argument("--solution-id", action="append")
    parser.add_argument("--batch-size", type=int, action="append", default=[])
    parser.add_argument("--limit", type=int)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if not args.batch_size:
        args.batch_size = [4, 8]
    if any(size <= 0 for size in args.batch_size):
        parser.error("--batch-size values must be positive")
    if args.solution_id and len(args.solution_id) < max(args.batch_size):
        parser.error("Provide at least as many --solution-id values as the largest batch")
    return args


if __name__ == "__main__":
    print(json.dumps(run(_parse_args()), indent=2, ensure_ascii=False, sort_keys=True))
