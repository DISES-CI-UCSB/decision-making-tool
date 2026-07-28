"""Readable raster overlap helpers using rasterio + numpy.

Conventions:
- Solution rasters use categorical values:
    * 0 = not selected
    * 1 = new Prioritizr coverage
    * 2 = authoritative pre-existing coverage for that run
    * GDAL nodata and non-finite cells contain no solution data
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
    # Legacy name for solution_data_valid_mask. This describes only where the
    # solution raster contains data; it is not an ecosystem denominator.
    valid_mask: np.ndarray
    pixel_area_km2_per_row: np.ndarray  # shape (height,) in km^2/cell
    fingerprint: RasterFingerprint
    selected_cells: int
    valid_cells: int
    category_values: np.ndarray | None = None  # float64; NaN where no solution data
    new_prioritizr_mask: np.ndarray | None = None
    pre_existing_mask: np.ndarray | None = None

    def __post_init__(self) -> None:
        """Validate masks and fill categorical defaults for legacy constructors."""

        shape = self.selected_mask.shape
        if self.valid_mask.shape != shape:
            raise ValueError("Solution selected_mask and valid_mask must have the same shape.")

        new_mask = self.new_prioritizr_mask
        pre_existing_mask = self.pre_existing_mask
        if new_mask is None and pre_existing_mask is None:
            # Older synthetic callers supplied only a binary selected mask.
            # Treat those selections as new coverage without changing their
            # selected-mask behavior.
            new_mask = self.selected_mask.copy()
            pre_existing_mask = np.zeros(shape, dtype=bool)
        elif new_mask is None or pre_existing_mask is None:
            raise ValueError(
                "Solution categorical masks must provide both new_prioritizr_mask "
                "and pre_existing_mask."
            )

        new_mask = np.asarray(new_mask, dtype=bool)
        pre_existing_mask = np.asarray(pre_existing_mask, dtype=bool)
        if new_mask.shape != shape or pre_existing_mask.shape != shape:
            raise ValueError("Solution categorical masks must match selected_mask shape.")
        if np.any(new_mask & pre_existing_mask):
            raise ValueError("Solution categorical masks must be disjoint.")
        if not np.array_equal(new_mask | pre_existing_mask, self.selected_mask):
            raise ValueError(
                "Solution selected_mask must equal the union of values 1 and 2."
            )
        if np.any(self.selected_mask & ~self.valid_mask):
            raise ValueError("Selected solution cells must contain valid solution data.")

        if self.category_values is not None:
            category_values = np.asarray(self.category_values, dtype=np.float64)
            if category_values.shape != shape:
                raise ValueError("Solution category_values must match selected_mask shape.")
            object.__setattr__(self, "category_values", category_values)

        object.__setattr__(self, "new_prioritizr_mask", new_mask)
        object.__setattr__(self, "pre_existing_mask", pre_existing_mask)

    @property
    def solution_data_valid_mask(self) -> np.ndarray:
        """Cells containing 0/1/2 solution data, never an availability denominator."""

        return self.valid_mask

    @property
    def grid_mask(self) -> np.ndarray:
        """All cells on the aligned raster grid, independent of solution data."""

        return np.ones(self.selected_mask.shape, dtype=bool)

    @property
    def selected_area_km2(self) -> float:
        return _area_km2(self.selected_mask, self.pixel_area_km2_per_row)

    @property
    def valid_area_km2(self) -> float:
        return _area_km2(self.valid_mask, self.pixel_area_km2_per_row)

    def with_boundary_mask(self, boundary: np.ndarray) -> "SolutionRaster":
        """Return a new SolutionRaster with all data masks clipped to a boundary.

        The boundary array must be a 2D bool array with the same shape as the
        solution raster. Typically produced by boundaries.boundary_mask.rasterize_boundary().
        """
        if boundary.shape != self.selected_mask.shape:
            raise ValueError("Boundary mask must match the solution raster shape.")

        new_selected = self.selected_mask & boundary
        new_valid = self.valid_mask & boundary
        category_values = (
            None
            if self.category_values is None
            else np.where(boundary, self.category_values, np.nan)
        )
        return SolutionRaster(
            path=self.path,
            selected_mask=new_selected,
            valid_mask=new_valid,
            pixel_area_km2_per_row=self.pixel_area_km2_per_row,
            fingerprint=self.fingerprint,
            selected_cells=int(new_selected.sum()),
            valid_cells=int(new_valid.sum()),
            category_values=category_values,
            new_prioritizr_mask=self.new_prioritizr_mask & boundary,
            pre_existing_mask=self.pre_existing_mask & boundary,
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
        band = dataset.read(1, masked=False).astype(np.float64)
        nodata = dataset.nodata
        solution_data_valid = (
            np.ones_like(band, dtype=bool) if nodata is None else (band != nodata)
        )
        solution_data_valid &= np.isfinite(band)

        unexpected = solution_data_valid & ~np.isin(band, (0.0, 1.0, 2.0))
        if unexpected.any():
            values = np.unique(band[unexpected])
            preview = ", ".join(f"{value:g}" for value in values[:10])
            suffix = "" if len(values) <= 10 else f", ... ({len(values)} unique)"
            raise RasterError(
                f"Solution raster {path} contains unsupported finite value(s): "
                f"{preview}{suffix}. Expected only 0 (not selected), "
                "1 (new Prioritizr), 2 (pre-existing), or nodata/NaN."
            )

        category_values = band.copy()
        category_values[~solution_data_valid] = np.nan
        new_prioritizr = solution_data_valid & (band == 1)
        pre_existing = solution_data_valid & (band == 2)
        selected = new_prioritizr | pre_existing
        return SolutionRaster(
            path=path,
            selected_mask=selected,
            valid_mask=solution_data_valid,
            pixel_area_km2_per_row=_pixel_area_km2_per_row(dataset),
            fingerprint=_fingerprint(dataset),
            selected_cells=int(selected.sum()),
            valid_cells=int(solution_data_valid.sum()),
            category_values=category_values,
            new_prioritizr_mask=new_prioritizr,
            pre_existing_mask=pre_existing,
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

        selected_values = rendering.get("selectedValues")
        if value_type == "binary":
            if selected_values is not None:
                return valid & np.isin(band, selected_values)
            if selected_value is not None:
                return valid & (band == selected_value)
        return valid


def overlap_km2(
    selected: np.ndarray,
    layer_mask: np.ndarray,
    pixel_area_per_row: np.ndarray,
) -> float:
    overlap = np.logical_and(selected, layer_mask)
    return _area_km2(overlap, pixel_area_per_row)


def categorical_overlap_km2(
    selected: np.ndarray,
    layer_values: np.ndarray,
    category_ids: frozenset[int],
    pixel_area_per_row: np.ndarray,
) -> float:
    """Return selected area whose finite layer value belongs to ``category_ids``."""
    category_mask = np.isfinite(layer_values) & np.isin(layer_values, tuple(category_ids))
    return overlap_km2(selected, category_mask, pixel_area_per_row)


def read_layer_values(
    path: Path,
    expected: RasterFingerprint,
) -> np.ndarray:
    """Read a numeric feature layer and return a float64 array (NaN for nodata).

    Used for weighted-sum metrics and categorical class-overlap metrics where
    raw pixel values are needed rather than a binary presence/absence mask.
    Raises RasterError if the layer does not align with the solution raster.
    """
    with rasterio.open(path) as dataset:
        observed = _fingerprint(dataset)
        if not observed.matches(expected):
            raise RasterError(
                f"Layer raster {path} does not align with the solution raster.\n"
                f"  expected: {expected}\n  observed: {observed}"
            )
        band = dataset.read(1, masked=False).astype(np.float64)
        nodata = dataset.nodata
        if nodata is not None:
            band[band == nodata] = np.nan
        # Guard against inf/non-finite values regardless of dtype.
        band[~np.isfinite(band)] = np.nan
        return band


def weighted_sum_km2(
    mask: np.ndarray,
    layer_values: np.ndarray,
    pixel_area_per_row: np.ndarray,
) -> float:
    """Sum (pixel_value × pixel_area_km²) over cells in *mask* with finite layer values.

    Args:
        mask: 2-D boolean array marking cells to include (e.g. selected_mask).
        layer_values: 2-D float64 array from read_layer_values (NaN = excluded).
        pixel_area_per_row: 1-D array of km²/pixel values, one per raster row.

    Returns:
        Scalar float sum.  Returns 0.0 for an empty or all-NaN selection.
    """
    valid = mask & np.isfinite(layer_values)
    if not valid.any():
        return 0.0
    area_2d = pixel_area_per_row[:, np.newaxis]  # (H,1) broadcasts to (H,W)
    return float((layer_values * area_2d)[valid].sum())


def weighted_percent_of_valid(
    selected: np.ndarray,
    valid: np.ndarray,
    layer_values: np.ndarray,
    pixel_area_per_row: np.ndarray,
) -> float | None:
    """(selected weighted_sum / valid weighted_sum) × 100.

    Used for #43 "% of national carbon": the denominator is the sum over ALL
    valid raster cells (not just the selected ones).

    Returns None when the denominator is zero (degenerate / empty raster).
    """
    national = weighted_sum_km2(valid, layer_values, pixel_area_per_row)
    if national == 0.0:
        return None
    sel = weighted_sum_km2(selected, layer_values, pixel_area_per_row)
    return (sel / national) * 100.0
