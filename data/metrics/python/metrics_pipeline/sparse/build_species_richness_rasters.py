"""CLI: derive taxon-specific species richness GeoTIFFs from species bundles.

The published ``species_richness`` layer is the overall richness surface. This
builder creates matching richness rasters for the taxonomic buckets already used
by the metrics pipeline:

    inputs/features/species_richness/riqueza_especies_mammals.tif
    inputs/features/species_richness/riqueza_especies_birds.tif
    inputs/features/species_richness/riqueza_especies_amphibians.tif
    inputs/features/species_richness/riqueza_especies_reptiles.tif
    inputs/features/species_richness/riqueza_especies_plants.tif

Each output pixel stores the number of modeled species in that bucket whose
binary range includes the pixel. Zero is a valid richness value; nodata is 65535.
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine

_PIPELINE_ROOT = Path(__file__).resolve().parent.parent
if str(_PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PIPELINE_ROOT))

from sparse.format import decode_species_matrix_bytes  # noqa: E402
from sparse.vercel_blob import (  # noqa: E402
    BlobError,
    PUBLIC_BLOB_HOST,
    load_token_from_env_file,
    upload_blob,
)

SPECIES_RICHNESS_BLOB_DIRECTORY = "inputs/features/species_richness/"
SPECIES_MATRIX_BLOB_DIRECTORY = "inputs/features/species-sparse/"
DEFAULT_LOCAL_OUTPUT_DIR = Path("data/metrics/cache/species_richness")
NODATA_VALUE = np.uint16(65535)
TAXON_GROUPS: tuple[str, ...] = ("mammals", "birds", "amphibians", "reptiles", "plants")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--group",
        action="append",
        choices=TAXON_GROUPS,
        help="Restrict to one or more taxon groups. Repeatable. Default: all groups.",
    )
    parser.add_argument(
        "--local-output-dir",
        type=Path,
        default=DEFAULT_LOCAL_OUTPUT_DIR,
        help="Where to write generated GeoTIFFs locally.",
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Generate locally only; skip Vercel Blob upload.",
    )
    return parser.parse_args(argv)


def _matrix_url(group: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{SPECIES_MATRIX_BLOB_DIRECTORY}species_{group}.smtx.gz"


def _output_filename(group: str) -> str:
    return f"riqueza_especies_{group}.tif"


def _output_path(group: str, local_output_dir: Path) -> Path:
    return local_output_dir / _output_filename(group)


def _blob_pathname(group: str) -> str:
    return f"{SPECIES_RICHNESS_BLOB_DIRECTORY}{_output_filename(group)}"


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "species-richness-builder/0.1"})
    with urllib.request.urlopen(req, timeout=180) as response:
        return response.read()


def _richness_array(matrix_blob: bytes) -> tuple[np.ndarray, dict[str, object], int]:
    matrix = decode_species_matrix_bytes(matrix_blob)
    if matrix.grid is None:
        raise RuntimeError("Species matrix did not include usable grid metadata")

    grid = matrix.grid
    richness = np.zeros(grid.width * grid.height, dtype=np.uint16)
    for entry in matrix.entries:
        np.add.at(richness, entry.cell_ids, 1)

    max_value = int(richness.max(initial=0))
    if max_value >= int(NODATA_VALUE):
        raise RuntimeError(f"Richness max {max_value} collides with nodata {int(NODATA_VALUE)}")

    raster_values = richness.reshape((grid.height, grid.width))
    # Zero-richness cells are outside the visible species surface for map review.
    # Mark them nodata so the renderer does not draw a pale rectangular footprint.
    raster_values = np.where(raster_values == 0, NODATA_VALUE, raster_values).astype(np.uint16)

    profile = {
        "driver": "GTiff",
        "width": grid.width,
        "height": grid.height,
        "count": 1,
        "dtype": "uint16",
        "crs": grid.crs,
        "transform": Affine(grid.x_scale, 0.0, grid.x_origin, 0.0, grid.y_scale, grid.y_origin),
        "nodata": int(NODATA_VALUE),
        "compress": "deflate",
        "predictor": 2,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    return raster_values, profile, max_value


def _write_tif(group: str, local_output_dir: Path) -> tuple[Path, int, int]:
    started = time.time()
    print(f"[species-richness] downloading matrix for {group}: {_matrix_url(group)}")
    matrix_blob = _download(_matrix_url(group))
    array, profile, max_value = _richness_array(matrix_blob)

    out_path = _output_path(group, local_output_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", **profile) as dataset:
        dataset.write(array, 1)

    elapsed = time.time() - started
    print(
        f"[species-richness] wrote {out_path} "
        f"max={max_value:,} bytes={out_path.stat().st_size:,} elapsed={elapsed:.1f}s"
    )
    return out_path, max_value, out_path.stat().st_size


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    groups = tuple(args.group or TAXON_GROUPS)
    token = None
    if not args.no_upload:
        try:
            token = load_token_from_env_file()
        except BlobError as exc:
            raise RuntimeError(
                "BLOB_READ_WRITE_TOKEN is required unless --no-upload is passed"
            ) from exc

    for group in groups:
        out_path, max_value, _ = _write_tif(group, args.local_output_dir)
        if token:
            url = upload_blob(out_path, _blob_pathname(group), token=token)
            print(
                f"[species-richness] uploaded {group} richness "
                f"max={max_value:,} pathname={_blob_pathname(group)} url={url}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
