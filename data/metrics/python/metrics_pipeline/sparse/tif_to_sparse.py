"""CLI: encode one ``.tif`` to a ``.sparse.gz`` sidecar.

Usage::

    python -m metrics_pipeline.sparse.tif_to_sparse \\
        --input <path/to/layer.tif> \\
        --type binary \\
        [--output path/to/layer.sparse.gz] \\
        [--selected-value 1] \\
        [--selected-values 3 4 5]

The tool is intentionally narrow — it does one TIF.  The batch CLIs
(``build_layer_sparse.py``, ``build_species_sparse.py``) call into the same
encoder for the multi-file case.

Default output path is ``<input>.sparse.gz`` (replaces ``.tif`` with
``.sparse.gz``), placed next to the source TIF.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .format import (
    LAYER_TYPE_BINARY,
    encode_sparse_artifact,
)
from .tif_io import encode_tif_to_artifact, parse_layer_type


def _default_output(tif_path: Path) -> Path:
    if tif_path.suffix.lower() in (".tif", ".tiff"):
        return tif_path.with_suffix(".sparse.gz")
    return tif_path.with_name(tif_path.name + ".sparse.gz")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path,
                        help="Source .tif path.")
    parser.add_argument("--output", type=Path, default=None,
                        help="Output .sparse.gz path (default: alongside the input).")
    parser.add_argument("--type", required=True,
                        help="Layer type: binary | categorical | continuous.")
    parser.add_argument("--selected-value", type=int, default=None,
                        help="For binary layers: the raster value treated as 'present'.")
    parser.add_argument("--selected-values", type=int, nargs="+", default=None,
                        help="For binary layers: a set of raster values treated as 'present'.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    layer_type = parse_layer_type(args.type)

    if args.input.suffix.lower() not in (".tif", ".tiff"):
        print(
            f"[tif-to-sparse] WARNING: input '{args.input}' is not a .tif file; "
            "encoding will continue but verify the file is a single-band raster.",
            file=sys.stderr,
        )

    artifact = encode_tif_to_artifact(
        args.input,
        layer_type=layer_type,
        selected_value=args.selected_value,
        selected_values=args.selected_values,
    )
    encoded = encode_sparse_artifact(artifact)

    output_path = args.output or _default_output(args.input)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(encoded)

    src_bytes = args.input.stat().st_size if args.input.exists() else 0
    dst_bytes = output_path.stat().st_size
    ratio = (dst_bytes / src_bytes) if src_bytes else float("inf")
    occupancy = (
        100.0 * artifact.metadata.count
        / max(artifact.metadata.width * artifact.metadata.height, 1)
    )

    print(
        f"[tif-to-sparse] {args.input.name} → {output_path.name} "
        f"(occupied={artifact.metadata.count:,} / {artifact.metadata.width * artifact.metadata.height:,} "
        f"= {occupancy:.2f}%; src={src_bytes:,} B; dst={dst_bytes:,} B; ratio={ratio:.3f})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
