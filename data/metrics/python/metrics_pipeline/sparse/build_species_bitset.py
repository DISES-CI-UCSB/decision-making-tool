"""Build the runtime cell-major species bitset from taxonomic matrix bundles."""

from __future__ import annotations

import argparse
from pathlib import Path

from species_data import CLASS_BUCKETS
from sparse.species_bitset import build_species_bitset


DEFAULT_MATRIX_DIR = Path("data/metrics/cache/sparse/matrices")
DEFAULT_OUTPUT_DIR = Path("data/metrics/cache/sparse/bitset")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix-dir", type=Path, default=DEFAULT_MATRIX_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    matrix_paths = {
        group: args.matrix_dir / f"species_{group}.smtx.gz"
        for group in CLASS_BUCKETS
    }
    missing = [str(path) for path in matrix_paths.values() if not path.is_file()]
    if missing:
        raise SystemExit("Missing species matrices:\n" + "\n".join(missing))

    data_path = args.output_dir / "species.cells.bits"
    metadata_path = args.output_dir / "species.cells.json"
    metadata = build_species_bitset(matrix_paths, data_path, metadata_path)
    print(f"Wrote {data_path} ({metadata.expected_data_bytes:,} bytes)")
    print(f"Wrote {metadata_path} ({metadata.species_count:,} species)")


if __name__ == "__main__":
    main()
