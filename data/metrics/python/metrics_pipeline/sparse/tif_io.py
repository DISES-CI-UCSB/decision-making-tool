"""rasterio I/O glue used by the sparse encoders.

Reads a 2-D band off a GeoTIFF, picks an appropriate ``layer_type`` (when
not specified by the caller), and turns the band into a
:class:`SparseArtifact` with grid metadata copied off the source raster.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

import numpy as np
import rasterio

from .format import (
    LAYER_TYPE_BINARY,
    LAYER_TYPE_CATEGORICAL,
    LAYER_TYPE_CONTINUOUS,
    SparseArtifact,
    SparseFormatError,
    artifact_from_array,
)

_LAYER_TYPE_ALIASES: dict[str, int] = {
    "binary": LAYER_TYPE_BINARY,
    "bin": LAYER_TYPE_BINARY,
    "0": LAYER_TYPE_BINARY,
    "categorical": LAYER_TYPE_CATEGORICAL,
    "cat": LAYER_TYPE_CATEGORICAL,
    "1": LAYER_TYPE_CATEGORICAL,
    "continuous": LAYER_TYPE_CONTINUOUS,
    "cont": LAYER_TYPE_CONTINUOUS,
    "2": LAYER_TYPE_CONTINUOUS,
}


def parse_layer_type(value: str | int) -> int:
    """Coerce a CLI string / int into a layer_type integer."""
    if isinstance(value, int):
        if value in (LAYER_TYPE_BINARY, LAYER_TYPE_CATEGORICAL, LAYER_TYPE_CONTINUOUS):
            return value
        raise SparseFormatError(f"unknown layer_type integer: {value}")
    key = value.strip().lower()
    if key in _LAYER_TYPE_ALIASES:
        return _LAYER_TYPE_ALIASES[key]
    raise SparseFormatError(
        f"unknown layer_type '{value}'; expected binary/categorical/continuous"
    )


def _grid_dict_from_dataset(dataset: rasterio.io.DatasetReader) -> dict[str, Any]:
    transform = dataset.transform
    return {
        "width": int(dataset.width),
        "height": int(dataset.height),
        "xOrigin": float(transform.c),
        "yOrigin": float(transform.f),
        "xScale": float(transform.a),
        "yScale": float(transform.e),
        "crs": str(dataset.crs) if dataset.crs else None,
    }


def _coerce_band_to_uint16(band: np.ndarray, *, nodata: float | int | None) -> np.ndarray:
    """Cast a categorical band down to uint16 without losing valid values.

    Categorical sparse bodies pack 16-bit values; non-uint16 sources need a
    bounds check to fail loudly if a class id won't fit.
    """
    if band.dtype == np.uint16:
        return band

    if np.issubdtype(band.dtype, np.floating):
        finite = np.isfinite(band)
    else:
        finite = np.ones(band.shape, dtype=bool)
    if nodata is not None:
        finite &= band != nodata
    finite &= band != 0  # zero is treated as background; not stored.

    if finite.any():
        valid_min = float(band[finite].min())
        valid_max = float(band[finite].max())
        if valid_min < 0 or valid_max > 0xFFFF:
            raise SparseFormatError(
                "categorical layer has class ids outside uint16 range "
                f"[{valid_min}, {valid_max}]"
            )

    # Replace NaN/non-finite cells with 0 before casting; they're masked
    # out downstream but numpy emits a RuntimeWarning if NaN reaches the
    # uint16 cast.
    if np.issubdtype(band.dtype, np.floating):
        cleaned = np.where(np.isfinite(band), band, 0)
        return cleaned.astype(np.uint16, copy=False)
    return band.astype(np.uint16, copy=False)


def encode_tif_to_artifact(
    tif_path: Path,
    *,
    layer_type: int,
    selected_value: int | None = None,
    selected_values: Iterable[int] | None = None,
) -> SparseArtifact:
    """Read a single-band GeoTIFF and build a :class:`SparseArtifact`."""
    with rasterio.open(tif_path) as dataset:
        if dataset.count < 1:
            raise SparseFormatError(f"{tif_path} has no bands")
        band = dataset.read(1, masked=False)
        nodata = dataset.nodata
        grid = _grid_dict_from_dataset(dataset)

    if layer_type == LAYER_TYPE_CATEGORICAL:
        band = _coerce_band_to_uint16(band, nodata=nodata)

    return artifact_from_array(
        band,
        layer_type=layer_type,
        metadata_grid=grid,
        nodata=nodata,
        selected_value=selected_value,
        selected_values=list(selected_values) if selected_values is not None else None,
    )
