"""Rasterize vector boundary polygons to grid-aligned numpy bool masks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from rasterio.crs import CRS
import rasterio.features
import rasterio.transform
import rasterio.warp

from boundaries.boundary_loader import canonical_geometry_sha256
from raster_metrics import RasterFingerprint


DEFAULT_BOUNDARY_CRS = "EPSG:4326"


class BoundaryRasterizationError(RuntimeError):
    """Raised when a boundary cannot be safely aligned to a reference grid."""


@dataclass(frozen=True)
class ReferenceGridKey:
    """Stable identity for a reference grid and its rasterization semantics."""

    crs: str
    transform: tuple[float, float, float, float, float, float]
    width: int
    height: int
    all_touched: bool = False
    invert: bool = True


@dataclass(frozen=True)
class _BoundaryMaskKey:
    geo_level: str
    boundary_id: str
    source_crs: str
    source_sha256: str
    geometry_sha256: str
    grid: ReferenceGridKey


def _validated_crs(value: Any, *, label: str) -> CRS:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise BoundaryRasterizationError(f"{label} CRS is missing.")
    try:
        return CRS.from_user_input(value)
    except Exception as exc:
        raise BoundaryRasterizationError(f"{label} CRS is invalid: {value!r}.") from exc


def reference_grid_key(fingerprint: RasterFingerprint) -> ReferenceGridKey:
    """Return the canonical cache identity for a raster reference grid."""
    crs = _validated_crs(fingerprint.crs, label="Reference raster")
    if fingerprint.width <= 0 or fingerprint.height <= 0:
        raise BoundaryRasterizationError(
            "Reference raster dimensions must be positive; "
            f"got {fingerprint.width}×{fingerprint.height}."
        )
    try:
        transform_is_valid = (
            len(fingerprint.transform) == 6
            and all(np.isfinite(fingerprint.transform))
        )
    except (TypeError, ValueError):
        transform_is_valid = False
    if not transform_is_valid:
        raise BoundaryRasterizationError(
            f"Reference raster transform is invalid: {fingerprint.transform!r}."
        )
    return ReferenceGridKey(
        crs=crs.to_wkt(),
        transform=fingerprint.transform,
        width=fingerprint.width,
        height=fingerprint.height,
    )


def _validated_geometry(geometry: dict, *, label: str) -> dict:
    try:
        is_valid = isinstance(geometry, dict) and rasterio.features.is_valid_geom(geometry)
    except (KeyError, TypeError, ValueError):
        is_valid = False
    if not is_valid:
        raise BoundaryRasterizationError(
            f"{label} geometry is not a valid GeoJSON geometry."
        )
    return geometry


def rasterize_boundary(
    geometry: dict,
    fingerprint: RasterFingerprint,
    *,
    source_crs: Any = DEFAULT_BOUNDARY_CRS,
) -> np.ndarray:
    """Rasterize a GeoJSON geometry dict to a bool mask aligned with the raster.

    Returns a 2D bool array (height × width) where True = inside the boundary.
    GeoJSON inputs default to WGS84 and are reprojected when the raster uses a
    different CRS.
    """
    geometry = _validated_geometry(geometry, label="Source boundary")
    source = _validated_crs(source_crs, label="Boundary source")
    target = _validated_crs(fingerprint.crs, label="Reference raster")
    reference_grid_key(fingerprint)

    if source != target:
        try:
            geometry = rasterio.warp.transform_geom(source, target, geometry)
        except Exception as exc:
            raise BoundaryRasterizationError(
                f"Failed to reproject boundary geometry from {source} to {target}: {exc}"
            ) from exc
        geometry = _validated_geometry(geometry, label="Reprojected boundary")

    transform = rasterio.transform.Affine(*fingerprint.transform)
    try:
        # geometry_mask returns True outside geometries; invert=True means inside.
        return rasterio.features.geometry_mask(
            [geometry],
            out_shape=(fingerprint.height, fingerprint.width),
            transform=transform,
            all_touched=False,
            invert=True,
        )
    except Exception as exc:
        raise BoundaryRasterizationError(
            f"Failed to rasterize boundary geometry on {target}: {exc}"
        ) from exc


class BoundaryMaskCache:
    """Caches rasterized boundary masks in memory.

    Boundaries are cached once per distinct reference grid. Solutions sharing a
    grid reuse masks, while land and marine grids remain isolated.
    """

    def __init__(self) -> None:
        self._cache: dict[_BoundaryMaskKey, np.ndarray] = {}

    def get(
        self,
        geo_level: str,
        boundary_id: str,
        geometry: dict,
        fingerprint: RasterFingerprint,
        *,
        source_crs: Any = DEFAULT_BOUNDARY_CRS,
        source_sha256: str = "",
        geometry_sha256: str | None = None,
    ) -> np.ndarray:
        normalized_source_crs = _validated_crs(
            source_crs, label="Boundary source"
        ).to_wkt()
        actual_geometry_sha256 = canonical_geometry_sha256(geometry)
        if geometry_sha256 and geometry_sha256 != actual_geometry_sha256:
            raise BoundaryRasterizationError(
                f"Boundary {geo_level}/{boundary_id} geometry changed after loading."
            )
        key = _BoundaryMaskKey(
            geo_level=geo_level,
            boundary_id=boundary_id,
            source_crs=normalized_source_crs,
            source_sha256=source_sha256,
            geometry_sha256=actual_geometry_sha256,
            grid=reference_grid_key(fingerprint),
        )
        if key not in self._cache:
            self._cache[key] = rasterize_boundary(
                geometry,
                fingerprint,
                source_crs=source_crs,
            )
        return self._cache[key]

    def precompute_all(self, boundaries_by_level: dict, fingerprint: RasterFingerprint) -> None:
        """Rasterize all boundaries upfront so the first solution pays the full cost."""
        for geo_level, features in boundaries_by_level.items():
            for feat in features:
                self.get(
                    geo_level,
                    feat.boundary_id,
                    feat.geometry,
                    fingerprint,
                    source_crs=getattr(feat, "source_crs", DEFAULT_BOUNDARY_CRS),
                    source_sha256=getattr(feat, "source_sha256", ""),
                    geometry_sha256=getattr(feat, "geometry_sha256", None),
                )
