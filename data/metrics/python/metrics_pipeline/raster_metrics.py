"""Readable raster overlap helpers using rasterio + numpy.

Conventions:
- Solution rasters follow the frontend GeoTiffLoaderService rule:
    * skip GDAL nodata cells when present
    * cells equal to 1 are 'selected'
    * all other valid cells are 'not selected'
- Feature/include layer rasters used here are binary masks. We treat any
  finite, non-nodata, non-zero value as 'present' to be lenient across layer
  conventions while still failing clearly when alignment differs.

Pixel area in km^2:
- Projected CRS in meters or kilometers: derive directly from the raster
  transform.
- Geographic CRS (EPSG:4326 etc.): use a spherical Earth approximation per
  row, since longitudinal degree length depends on latitude. Adequate for
  national 1 km Colombian rasters; not appropriate for global or polar work.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio

EARTH_RADIUS_KM = 6371.0088


# Tolerance ~ 1e-7 degrees (~1 cm) absorbs author-time float precision drift
# without masking a real grid offset. Sibling layers in this dataset commonly
# differ by ~1e-12, so this is comfortably above that and well below 1 pixel.
_TRANSFORM_ABS_TOL = 1e-7


@dataclass(frozen=True)
class RasterFingerprint:
    width: int
    height: int
    transform: tuple[float, float, float, float, float, float]
    crs: str | None

    def matches(self, other: "RasterFingerprint") -> bool:
        if self.width != other.width or self.height != other.height:
            return False
        if self.crs != other.crs:
            return False
        return all(
            math.isclose(a, b, abs_tol=_TRANSFORM_ABS_TOL)
            for a, b in zip(self.transform, other.transform)
        )


@dataclass(frozen=True)
class SolutionRaster:
    path: Path
    selected_mask: np.ndarray  # bool, True where cell is selected
    valid_mask: np.ndarray  # bool, True where cell is valid (not nodata)
    pixel_area_km2_per_row: np.ndarray  # shape (height,) in km^2/cell
    fingerprint: RasterFingerprint
    selected_cells: int
    valid_cells: int

    @property
    def selected_area_km2(self) -> float:
        return _area_km2(self.selected_mask, self.pixel_area_km2_per_row)

    @property
    def valid_area_km2(self) -> float:
        return _area_km2(self.valid_mask, self.pixel_area_km2_per_row)

    def with_boundary_mask(self, boundary: np.ndarray) -> "SolutionRaster":
        """Return a new SolutionRaster with both masks AND'd with a boundary pixel mask.

        The boundary array must be a 2D bool array with the same shape as the
        solution raster. Typically produced by boundaries.boundary_mask.rasterize_boundary().
        """
        new_selected = self.selected_mask & boundary
        new_valid = self.valid_mask & boundary
        return SolutionRaster(
            path=self.path,
            selected_mask=new_selected,
            valid_mask=new_valid,
            pixel_area_km2_per_row=self.pixel_area_km2_per_row,
            fingerprint=self.fingerprint,
            selected_cells=int(new_selected.sum()),
            valid_cells=int(new_valid.sum()),
        )


class RasterError(RuntimeError):
    pass


def _fingerprint(dataset: rasterio.io.DatasetReader) -> RasterFingerprint:
    transform = dataset.transform
    return RasterFingerprint(
        width=dataset.width,
        height=dataset.height,
        transform=(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f),
        crs=str(dataset.crs) if dataset.crs else None,
    )


def _pixel_area_km2_per_row(dataset: rasterio.io.DatasetReader) -> np.ndarray:
    """Return one km^2/pixel value per row of the raster."""

    crs = dataset.crs
    if crs is None:
        raise RasterError(f"Raster {dataset.name} has no CRS; cannot compute area.")

    transform = dataset.transform
    px_w = abs(transform.a)
    px_h = abs(transform.e)
    height = dataset.height

    if crs.is_geographic:
        # Spherical Earth: km per degree latitude is constant; km per degree
        # longitude scales with cos(latitude). Use pixel-center latitudes.
        km_per_deg_lat = (math.pi / 180.0) * EARTH_RADIUS_KM
        row_indices = np.arange(height)
        lat_centers_deg = transform.f + transform.e * (row_indices + 0.5)
        lat_rad = np.deg2rad(lat_centers_deg)
        km_per_deg_lon = km_per_deg_lat * np.cos(lat_rad)
        return (px_w * km_per_deg_lon) * (px_h * km_per_deg_lat)

    units = (crs.linear_units or "").lower()
    if units in ("metre", "meter", "m"):
        constant = (px_w * px_h) / 1_000_000.0
    elif units in ("kilometre", "kilometer", "km"):
        constant = px_w * px_h
    else:
        raise RasterError(
            f"Raster {dataset.name} uses unsupported linear unit '{crs.linear_units}'."
        )
    return np.full(height, constant, dtype=np.float64)


def _area_km2(mask: np.ndarray, pixel_area_per_row: np.ndarray) -> float:
    counts_per_row = mask.sum(axis=1)
    return float((counts_per_row * pixel_area_per_row).sum())


def read_solution_raster(path: Path) -> SolutionRaster:
    with rasterio.open(path) as dataset:
        if dataset.count < 1:
            raise RasterError(f"Solution raster {path} has no bands.")
        band = dataset.read(1, masked=False)
        nodata = dataset.nodata
        valid = (
            np.ones_like(band, dtype=bool) if nodata is None else (band != nodata)
        )
        if np.issubdtype(band.dtype, np.floating):
            valid &= np.isfinite(band)
        selected = valid & (band == 1)
        return SolutionRaster(
            path=path,
            selected_mask=selected,
            valid_mask=valid,
            pixel_area_km2_per_row=_pixel_area_km2_per_row(dataset),
            fingerprint=_fingerprint(dataset),
            selected_cells=int(selected.sum()),
            valid_cells=int(valid.sum()),
        )


def read_layer_mask(
    path: Path,
    expected: RasterFingerprint,
    *,
    rendering: dict | None = None,
) -> np.ndarray:
    """Read a feature/include layer and return a bool mask of 'present' cells.

    Uses the manifest's `rendering` block to decide what counts as present:
    - valueType == 'binary': cells equal to rendering.selectedValue (default 1).
      This matters because some 'binary' layers in this dataset encode
      1 = present and 2 = absent (with nodata = 255), so a `band != 0`
      heuristic over-counts.
    - valueType in ('continuous', 'categorical') or rendering is missing:
      every valid (non-nodata, finite) cell is treated as present.

    Fails clearly if the layer does not align with the solution raster — the
    MVP keeps reprojection/resampling out and surfaces alignment problems
    rather than silently guessing.
    """

    rendering = rendering or {}
    value_type = str(rendering.get("valueType") or "").lower()
    selected_value = rendering.get("selectedValue", 1)

    with rasterio.open(path) as dataset:
        observed = _fingerprint(dataset)
        if not observed.matches(expected):
            raise RasterError(
                f"Layer raster {path} does not align with the solution raster.\n"
                f"  expected: {expected}\n  observed: {observed}"
            )
        band = dataset.read(1, masked=False)
        nodata = dataset.nodata
        valid = (
            np.ones_like(band, dtype=bool) if nodata is None else (band != nodata)
        )
        if np.issubdtype(band.dtype, np.floating):
            valid &= np.isfinite(band)

        if value_type == "binary" and selected_value is not None:
            return valid & (band == selected_value)
        return valid


def overlap_km2(
    selected: np.ndarray,
    layer_mask: np.ndarray,
    pixel_area_per_row: np.ndarray,
) -> float:
    overlap = np.logical_and(selected, layer_mask)
    return _area_km2(overlap, pixel_area_per_row)
