"""Verify the EPSG:9377 species matrices against the cache, catalogue, and 4326 artifact.

Four independent questions are answered, in increasing order of how much they
would hurt to get wrong:

1. Do the built matrices reproduce the overlap cache exactly? A sample of
   species is decoded out of the ``.smtx.gz`` bundles and compared cell for cell
   against the ``.npz`` they came from.
2. Is area conserved? The overlap cache stores exact fractional areas, so their
   sum is compared against the species catalogue's ``authoritativeAreaKm2``.
3. How far does the new grid diverge from the published 4326 matrices? Counts
   cannot match, because 1 km² cells replace ~0.86 km² cells and binary
   treatment of partially covered cells differs at range edges, so the whole
   distribution is reported rather than checked against a guessed threshold.
4. Did any species flip between empty and non-empty? Those are the cases that
   would silently change a richness metric.
"""

from __future__ import annotations

import argparse
import gzip
import json
import struct
import sys
from pathlib import Path
from typing import Any, Iterator

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
METRICS_PIPELINE = REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"
if str(METRICS_PIPELINE) not in sys.path:
    sys.path.insert(0, str(METRICS_PIPELINE))

from scripts.build_species_matrices_from_overlap import (  # noqa: E402
    CACHE_POSITIVE_AREA_EPSILON_M2,
    SPECIES_MATRIX_GROUPS,
    index_overlap_cache,
    read_overlap_cells,
)
from sparse.format import SMSP_MAGIC  # noqa: E402

TAXONOMIC_GROUPS = tuple(group for group in SPECIES_MATRIX_GROUPS if group != "threatened")
WATCHLIST = ("Haematopus palliatus",)


def read_matrix_header(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    with gzip.open(path, "rb") as handle:
        if handle.read(4) != SMSP_MAGIC:
            raise SystemExit(f"Bad species matrix magic: {path}")
        toc_length = struct.unpack("<I", handle.read(4))[0]
        toc = json.loads(handle.read(toc_length).decode("utf-8"))
    return toc["grid"], list(toc.get("species") or [])


def iter_matrix_species(
    path: Path,
    wanted: set[str] | None = None,
) -> Iterator[tuple[dict[str, Any], np.ndarray]]:
    """Stream species out of a bundle, stopping once every wanted name is seen."""
    _, entries = read_matrix_header(path)
    remaining = set(wanted) if wanted is not None else None
    with gzip.open(path, "rb") as handle:
        handle.read(4)
        toc_length = struct.unpack("<I", handle.read(4))[0]
        handle.read(toc_length)
        for entry in entries:
            count = int(entry["count"])
            chunk = handle.read(4 * count)
            if len(chunk) != 4 * count:
                raise SystemExit(f"{path} ended before {entry['name']!r}")
            if remaining is not None and entry["name"] not in remaining:
                continue
            yield entry, np.cumsum(np.frombuffer(chunk, dtype=np.uint32), dtype=np.uint32)
            if remaining is not None:
                remaining.discard(entry["name"])
                if not remaining:
                    return


def percentiles(values: np.ndarray, points: tuple[int, ...]) -> str:
    if values.size == 0:
        return "n/a"
    return "  ".join(f"p{point}={np.percentile(values, point):+.2f}%" for point in points)


def verify(
    *,
    matrix_dir: Path,
    cache_dir: Path,
    report_path: Path,
    blob_counts_path: Path,
    bitset_path: Path | None,
    bitset_metadata_path: Path | None,
    sample_per_group: int,
) -> int:
    failures: list[str] = []
    report = json.loads(report_path.read_text(encoding="utf-8"))
    by_name = {item["scientific_name"]: item for item in report["species"]}

    grids: dict[str, str] = {}
    new_counts: dict[str, int] = {}
    group_of: dict[str, str] = {}
    for group in SPECIES_MATRIX_GROUPS:
        grid, entries = read_matrix_header(matrix_dir / f"species_{group}.smtx.gz")
        grids[group] = json.dumps(grid, sort_keys=True)
        for entry in entries:
            if group != "threatened":
                new_counts[str(entry["name"])] = int(entry["count"])
                group_of[str(entry["name"])] = group

    print("=" * 78)
    print("1. GRID AND INVENTORY")
    print("=" * 78)
    if len(set(grids.values())) != 1:
        failures.append("species matrices do not share one grid block")
    print(f"distinct grid blocks across six bundles: {len(set(grids.values()))}")
    print(f"grid: {next(iter(grids.values()))}")
    print(f"species in taxonomic bundles: {len(new_counts):,}")
    if len(new_counts) != report["species_available"]:
        failures.append("taxonomic bundle species count disagrees with the conversion report")

    _, threatened_entries = read_matrix_header(matrix_dir / "species_threatened.smtx.gz")
    print(f"species in threatened bundle: {len(threatened_entries):,}")

    print()
    print("=" * 78)
    print("2. MATRIX VS OVERLAP CACHE (end-to-end, sampled)")
    print("=" * 78)
    overlap_index = index_overlap_cache(cache_dir)
    grid_block = json.loads(next(iter(grids.values())))
    grid_shape = (int(grid_block["height"]), int(grid_block["width"]))
    cell_area_m2 = abs(float(grid_block["xScale"]) * float(grid_block["yScale"]))

    checked = 0
    for group in TAXONOMIC_GROUPS:
        names = sorted(
            (name for name, mapped in group_of.items() if mapped == group),
            key=lambda name: new_counts[name],
        )
        if not names:
            continue
        picks = {names[int(q * (len(names) - 1))] for q in np.linspace(0, 1, sample_per_group)}
        picks.update(name for name in WATCHLIST if group_of.get(name) == group)
        matched = 0
        for entry, cell_ids in iter_matrix_species(matrix_dir / f"species_{group}.smtx.gz", picks):
            name = str(entry["name"])
            blob_filename = name.replace(" ", "_") + "_10_MAXENT.tif"
            expected, _ = read_overlap_cells(
                overlap_index[blob_filename].artifact_path,
                grid_shape=grid_shape,
                min_overlap_m2=report["threshold_m2"],
                cell_area_m2=cell_area_m2,
            )
            if not np.array_equal(cell_ids, expected):
                failures.append(f"{name}: matrix cells differ from the overlap cache")
            matched += 1
            checked += 1
        print(f"  {group:>11}: {matched:>3} sampled species reproduce the cache exactly")
    print(f"total sampled: {checked}")

    print()
    print("=" * 78)
    print("3. AREA CONSERVATION VS SPECIES CATALOGUE")
    print("=" * 78)
    exact = np.array(
        [
            item["exact_area_km2"]
            for item in report["species"]
            if item["authoritative_area_km2"]
        ],
        dtype=np.float64,
    )
    authoritative = np.array(
        [
            item["authoritative_area_km2"]
            for item in report["species"]
            if item["authoritative_area_km2"]
        ],
        dtype=np.float64,
    )
    area_error = (exact - authoritative) / authoritative * 100.0
    print(f"species with a positive catalogue area: {exact.size:,}")
    print(f"  exact-vs-catalogue error: {percentiles(area_error, (1, 5, 50, 95, 99))}")
    print(f"  mean abs error: {np.abs(area_error).mean():.4f}%")
    print(f"  worst abs error: {np.abs(area_error).max():.4f}%")
    if np.abs(area_error).max() > 5.0:
        failures.append("a species exact overlap area diverges from the catalogue by over 5%")

    cell_count_error = np.array(
        [
            (item["cell_count"] - item["exact_area_km2"]) / item["exact_area_km2"] * 100.0
            for item in report["species"]
            if item["exact_area_km2"] > 0
        ],
        dtype=np.float64,
    )
    print()
    print("binary cell count as an area proxy (inflation from partially covered cells):")
    print(f"  {percentiles(cell_count_error, (1, 25, 50, 75, 95, 99))}")
    print(f"  mean: {cell_count_error.mean():+.3f}%   max: {cell_count_error.max():+.1f}%")

    print()
    print("=" * 78)
    print("4. DIVERGENCE FROM THE PUBLISHED 4326 MATRICES")
    print("=" * 78)
    blob_counts = json.loads(blob_counts_path.read_text(encoding="utf-8"))
    old_counts: dict[str, int] = {}
    for group in TAXONOMIC_GROUPS:
        old_counts.update(blob_counts[group]["species"])

    only_new = sorted(set(new_counts) - set(old_counts))
    only_old = sorted(set(old_counts) - set(new_counts))
    if only_new or only_old:
        failures.append(
            f"species membership changed: {len(only_new)} new-only, {len(only_old)} old-only"
        )
    print(f"species only in new: {len(only_new)}   species only in old: {len(only_old)}")

    shared = sorted(set(new_counts) & set(old_counts))
    both_positive = [n for n in shared if new_counts[n] > 0 and old_counts[n] > 0]
    ratio = np.array(
        [new_counts[n] / old_counts[n] for n in both_positive], dtype=np.float64
    )
    divergence = (ratio - 1.0) * 100.0
    print(f"species positive in both: {len(both_positive):,}")
    print(f"  new/old count ratio: {percentiles(divergence, (1, 5, 25, 50, 75, 95, 99))}")
    print(f"  mean: {divergence.mean():+.2f}%   min: {divergence.min():+.2f}%   max: {divergence.max():+.2f}%")
    print()
    print("  expected baseline: a 4326 cell is ~0.86 km2 at Colombian latitudes, so an")
    print("  area-preserving conversion to 1 km2 cells should land near -14%, before")
    print("  edge inflation pushes it back up.")

    order = np.argsort(-np.abs(divergence))
    print()
    print("  20 largest divergences:")
    for position in order[:20]:
        name = both_positive[position]
        print(
            f"    {name:<38} {group_of[name]:<11} new={new_counts[name]:>8,} "
            f"old={old_counts[name]:>8,} {divergence[position]:>+9.1f}% "
            f"exact={by_name[name]['exact_area_km2']:>11,.2f} km2"
        )

    print()
    print("=" * 78)
    print("5. EMPTY/NON-EMPTY FLIPS")
    print("=" * 78)
    lost = [n for n in shared if new_counts[n] == 0 and old_counts[n] > 0]
    gained = [n for n in shared if new_counts[n] > 0 and old_counts[n] == 0]
    still_empty = [n for n in shared if new_counts[n] == 0 and old_counts[n] == 0]
    print(f"became empty (new=0, old>0): {len(lost)}")
    for name in lost:
        print(f"    LOST {name} ({group_of[name]}) old={old_counts[name]:,}")
    print(f"became non-empty (new>0, old=0): {len(gained)}")
    for name in gained:
        print(f"    GAINED {name} ({group_of[name]}) new={new_counts[name]:,}")
    print(f"empty in both: {len(still_empty)}")
    if lost:
        failures.append(f"{len(lost)} species lost all range cells")
    if gained:
        failures.append(f"{len(gained)} species gained range cells from an empty old range")

    print()
    print("=" * 78)
    print("6. WATCHLIST")
    print("=" * 78)
    for name in WATCHLIST:
        if name not in new_counts:
            print(f"  {name}: ABSENT from the new matrices")
            failures.append(f"watchlist species {name} is absent")
            continue
        item = by_name[name]
        print(
            f"  {name} ({group_of[name]}): new={new_counts[name]:,} old={old_counts.get(name)} "
            f"exact={item['exact_area_km2']:.4f} km2 catalogue={item['authoritative_area_km2']:.4f} km2"
        )

    if bitset_path is not None and bitset_metadata_path is not None:
        print()
        print("=" * 78)
        print("7. BITSET SIZE ARITHMETIC")
        print("=" * 78)
        metadata = json.loads(bitset_metadata_path.read_text(encoding="utf-8"))
        width = int(metadata["grid"]["width"])
        height = int(metadata["grid"]["height"])
        species_count = int(metadata["species_count"])
        bytes_per_cell = int(metadata["bytes_per_cell"])
        expected_bytes_per_cell = -(-species_count // 8)
        expected_bytes = width * height * bytes_per_cell
        actual_bytes = bitset_path.stat().st_size
        print(f"grid: {width} x {height} = {width * height:,} cells")
        print(f"species_count: {species_count:,}  bytes_per_cell: {bytes_per_cell} "
              f"(ceil({species_count}/8) = {expected_bytes_per_cell})")
        print(f"expected bytes: {expected_bytes:,}")
        print(f"actual bytes:   {actual_bytes:,}")
        print(f"match: {expected_bytes == actual_bytes}")
        if bytes_per_cell != expected_bytes_per_cell:
            failures.append("bitset bytes_per_cell does not match ceil(species_count/8)")
        if expected_bytes != actual_bytes:
            failures.append("bitset file size does not match the grid arithmetic")

        print()
        print("=" * 78)
        print("8. BITSET RANGE AREAS")
        print("=" * 78)
        print(f"range_area_source: {metadata.get('range_area_source')}")
        if metadata.get("range_area_source") != "matrix-exact-area":
            failures.append("bitset range areas are not the exact overlap areas")
        drifted = [
            entry["scientific_name"]
            for entry in metadata["species"]
            if abs(entry["range_area_km2"] - by_name[entry["scientific_name"]]["exact_area_km2"])
            > 1e-9 * max(1.0, by_name[entry["scientific_name"]]["exact_area_km2"])
        ]
        inflation = np.array(
            [
                entry["range_cell_area_km2"] / entry["range_area_km2"]
                for entry in metadata["species"]
                if entry["range_area_km2"] > 0
            ],
            dtype=np.float64,
        )
        print(f"entries disagreeing with the conversion report: {len(drifted)}")
        print(
            f"cell area / true range area: median {np.median(inflation):.4f} "
            f"max {inflation.max():.3f}"
        )
        if drifted:
            failures.append(
                f"{len(drifted)} bitset range areas disagree with the conversion report"
            )

    print()
    print("=" * 78)
    if failures:
        print(f"FAILED with {len(failures)} problem(s):")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("All verification checks passed.")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    default_validation = REPO_ROOT / "data" / "metrics" / "cache" / "sparse" / "validation-9377"
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--overlap-cache-dir", type=Path, required=True)
    parser.add_argument(
        "--matrix-dir",
        type=Path,
        default=REPO_ROOT / "data" / "metrics" / "cache" / "sparse" / "matrices-9377",
    )
    parser.add_argument(
        "--report", type=Path, default=default_validation / "conversion-report.json"
    )
    parser.add_argument(
        "--blob-4326-counts", type=Path, default=default_validation / "blob_4326_toc_counts.json"
    )
    parser.add_argument("--bitset", type=Path, default=None)
    parser.add_argument("--bitset-metadata", type=Path, default=None)
    parser.add_argument("--sample-per-group", type=int, default=12)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    return verify(
        matrix_dir=args.matrix_dir,
        cache_dir=args.overlap_cache_dir,
        report_path=args.report,
        blob_counts_path=args.blob_4326_counts,
        bitset_path=args.bitset,
        bitset_metadata_path=args.bitset_metadata,
        sample_per_group=args.sample_per_group,
    )


if __name__ == "__main__":
    raise SystemExit(main())
