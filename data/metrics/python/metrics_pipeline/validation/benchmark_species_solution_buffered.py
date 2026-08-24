"""Fresh-process A/B harness for v1 and buffered v2 species accumulation."""

from __future__ import annotations

import argparse
import hashlib
import json
import resource
import sqlite3
import sys
import tempfile
import time
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from boundaries.boundary_loader import load_all_boundaries
from boundaries.boundary_topology import BoundaryTopologyCache
from calculators.species import SpeciesAccumulator
from local_io import cached_download
from raster_align import grid_sha256
from species_data import compute_pool_sizes, load_species_records
from species_solution_batch import (
    ExactOverlapInput,
    load_category_matrix,
    process_exact_species_batch,
)
from species_solution_buffered import process_exact_species_batch_buffered
from species_target_policy import resolve_species_target_policy

from validation.benchmark_species_solution_batch import (
    DEFAULT_SOLUTION_IDS,
    _discover_sources,
    _read_json,
    _stratified_catalog_subset,
)


class BenchmarkDetailSink:
    """SQLite detail sink exposing both legacy and contiguous chunk writes."""

    def __init__(self, path: Path, policy) -> None:
        self.policy = policy
        self.connection = sqlite3.connect(path)
        self.connection.execute(
            "CREATE TABLE rows(level TEXT, scope INTEGER, species TEXT, "
            "total REAL, selected REAL, existing REAL, new REAL, target REAL, "
            "PRIMARY KEY(level, scope, species)) WITHOUT ROWID"
        )

    def _row(self, level, scope, species, selected, total, existing, new):
        return (
            level,
            scope,
            species.scientific_name,
            float(total),
            float(selected),
            float(existing),
            float(new),
            self.policy.target_for(species.scientific_name),
        )

    def record_national(
        self,
        species,
        selected_area_m2,
        total_area_m2,
        *,
        pre_existing_area_m2=0.0,
        new_prioritizr_area_m2=None,
    ):
        self.connection.execute(
            "INSERT INTO rows VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            self._row(
                "national",
                0,
                species,
                selected_area_m2,
                total_area_m2,
                pre_existing_area_m2,
                selected_area_m2
                if new_prioritizr_area_m2 is None
                else new_prioritizr_area_m2,
            ),
        )

    def record_sub_level(
        self,
        species,
        level,
        selected_per_boundary,
        total_per_boundary,
        *,
        pre_existing_per_boundary=None,
        new_prioritizr_per_boundary=None,
    ):
        existing = (
            selected_per_boundary * 0
            if pre_existing_per_boundary is None
            else pre_existing_per_boundary
        )
        new = (
            selected_per_boundary
            if new_prioritizr_per_boundary is None
            else new_prioritizr_per_boundary
        )
        for scope in (total_per_boundary > 0).nonzero()[0].tolist():
            self.connection.execute(
                "INSERT INTO rows VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                self._row(
                    level,
                    scope,
                    species,
                    selected_per_boundary[scope],
                    total_per_boundary[scope],
                    existing[scope],
                    new[scope],
                ),
            )

    def record_species_chunk(
        self,
        species_records,
        national_selected,
        national_total,
        national_pre_existing,
        national_new,
        boundary_channels,
    ):
        rows = [
            self._row(
                "national",
                0,
                species,
                national_selected[index],
                national_total[index],
                national_pre_existing[index],
                national_new[index],
            )
            for index, species in enumerate(species_records)
        ]
        for level, (selected, total, existing, new) in boundary_channels.items():
            for index, species in enumerate(species_records):
                rows.extend(
                    self._row(
                        level,
                        scope,
                        species,
                        selected[index, scope],
                        total[index, scope],
                        existing[index, scope],
                        new[index, scope],
                    )
                    for scope in (total[index] > 0).nonzero()[0].tolist()
                )
        self.connection.executemany(
            "INSERT INTO rows VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows
        )

    def digest(self) -> tuple[str, int]:
        self.connection.commit()
        digest = hashlib.sha256()
        count = 0
        for row in self.connection.execute(
            "SELECT * FROM rows ORDER BY level, scope, species"
        ):
            digest.update(
                json.dumps(row, separators=(",", ":"), ensure_ascii=False).encode()
            )
            count += 1
        return digest.hexdigest(), count

    def close(self) -> None:
        self.connection.close()


def run(args: argparse.Namespace) -> dict:
    setup_started = time.perf_counter()
    manifest = _read_json(args.manifest)
    by_id = {
        str(solution["id"]): solution
        for solution in manifest["solutions"]
        if solution.get("domain") == "land"
    }
    solutions = [by_id[value] for value in DEFAULT_SOLUTION_IDS]
    downloads = [
        cached_download(solution["displayUrl"], args.cache_dir) for solution in solutions
    ]
    matrix = load_category_matrix([download.path for download in downloads])
    all_records = load_species_records(args.species_csv)
    all_sources, _ = _discover_sources(
        args.cache_dir,
        all_records,
        target_grid_sha256=grid_sha256(matrix.fingerprint),
    )
    sources = _stratified_catalog_subset(all_sources, args.limit)
    records = [value[1] for value in sources]
    overlaps = [
        ExactOverlapInput(
            path=value[2],
            expected_sha256=_sha256(value[2]),
            expected_bytes=value[2].stat().st_size,
        )
        for value in sources
    ]
    boundaries, failures = load_all_boundaries(args.cache_dir)
    if failures:
        raise RuntimeError(f"boundary failures: {failures}")
    indexes, _ = BoundaryTopologyCache().get(boundaries, matrix.fingerprint)
    policies = [
        resolve_species_target_policy(
            solution,
            catalog_records=all_records,
            available_records=[value[1] for value in all_sources],
        )
        for solution in solutions
    ]
    setup_seconds = time.perf_counter() - setup_started

    warm_started = time.perf_counter()
    for overlap in overlaps:
        overlap.path.read_bytes()
    warm_seconds = time.perf_counter() - warm_started

    with tempfile.TemporaryDirectory(prefix=f"species-{args.mode}-") as directory:
        sinks = [
            BenchmarkDetailSink(Path(directory) / f"{index}.sqlite3", policy)
            for index, policy in enumerate(policies)
        ]
        pool = compute_pool_sizes([value[1] for value in all_sources])
        accumulators = [
            SpeciesAccumulator(
                target_pct=policy.scalar_target_pct,
                pool_sizes=pool,
                target_policy=policy,
                species_expected=len(records),
                detail_sink=sink,
            )
            for policy, sink in zip(policies, sinks, strict=True)
        ]
        sizes = {level: index.num_boundaries for level, index in indexes.items()}
        for accumulator in accumulators:
            accumulator.init_sub(sizes)

        usage_before = resource.getrusage(resource.RUSAGE_SELF)
        started = time.perf_counter()
        if args.mode == "v1":
            stats = process_exact_species_batch(
                species_records=records,
                overlap_paths=overlaps,
                categories=matrix.values,
                fingerprint=matrix.fingerprint,
                boundary_indexes=indexes,
                accumulators=accumulators,
            )
        else:
            stats = process_exact_species_batch_buffered(
                species_records=records,
                overlap_paths=overlaps,
                categories=matrix.values,
                fingerprint=matrix.fingerprint,
                boundary_indexes=indexes,
                accumulators=accumulators,
                species_chunk_size=args.species_chunk_size,
            )
        wall_seconds = time.perf_counter() - started
        usage_after = resource.getrusage(resource.RUSAGE_SELF)

        output_started = time.perf_counter()
        detail_results = [sink.digest() for sink in sinks]
        counter_sha256 = hashlib.sha256(
            json.dumps(
                [
                    {
                        "national": asdict(value.national),
                        "sub": {
                            level: [asdict(scope) for scope in scopes]
                            for level, scopes in value.sub.items()
                        },
                        "processed": value.species_processed,
                        "withRange": value.species_with_range,
                    }
                    for value in accumulators
                ],
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        output_seconds = time.perf_counter() - output_started
        for sink in sinks:
            sink.close()

    return {
        "format": "species-solution-buffered-fresh-process-run-v1",
        "mode": args.mode,
        "speciesCount": len(records),
        "solutionCount": len(solutions),
        "allGeographyLevels": sorted(indexes),
        "setupSeconds": setup_seconds,
        "warmInputSeconds": warm_seconds,
        "wallSeconds": wall_seconds,
        "userSeconds": usage_after.ru_utime - usage_before.ru_utime,
        "systemSeconds": usage_after.ru_stime - usage_before.ru_stime,
        "peakRssBytes": _peak_rss_bytes(),
        "phaseSeconds": {
            "exactRead": stats.exact_read_seconds,
            "evaluation": stats.evaluation_seconds,
            "accumulator": stats.accumulator_seconds,
            "output": output_seconds,
        },
        "npzOpens": stats.npz_opens,
        "npzBytes": stats.npz_bytes,
        "solutionFailures": [asdict(value) for value in stats.solution_failures],
        "counterSha256": counter_sha256,
        "detailSha256s": [value[0] for value in detail_results],
        "detailRowCounts": [value[1] for value in detail_results],
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _peak_rss_bytes() -> int:
    value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return value if sys.platform == "darwin" else value * 1024


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--species-csv", type=Path, required=True)
    parser.add_argument("--mode", choices=("v1", "v2"), required=True)
    parser.add_argument("--limit", type=int, default=128)
    parser.add_argument("--species-chunk-size", type=int, default=128)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.limit <= 0 or args.species_chunk_size <= 0:
        parser.error("limits must be positive")
    return args


if __name__ == "__main__":
    parsed = _parse_args()
    report = run(parsed)
    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if parsed.report:
        parsed.report.parent.mkdir(parents=True, exist_ok=True)
        parsed.report.write_text(payload, encoding="utf-8")
    print(payload, end="")
