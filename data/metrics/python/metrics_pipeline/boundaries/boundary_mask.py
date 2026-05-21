"""Rasterize vector boundary polygons to numpy bool masks.

The raster grid is described by a RasterFingerprint (transform + dimensions).
The boundary geometry must be in the same CRS as the raster — the pipeline
requests WGS84 (EPSG:4326) from IGAC and the SIRAP GeoJSONs are in WGS84,
which matches the solution rasters used here.
"""

from __future__ import annotations

import numpy as np
import rasterio.features
import rasterio.transform

from raster_metrics import RasterFingerprint


def rasterize_boundary(geometry: dict, fingerprint: RasterFingerprint) -> np.ndarray:
    """Rasterize a GeoJSON geometry dict to a bool mask aligned with the raster.

    Returns a 2D bool array (height × width) where True = inside the boundary.
    Works with any GeoJSON geometry type (Polygon, MultiPolygon, etc.).
    """
    transform = rasterio.transform.Affine(*fingerprint.transform)
    # geometry_mask returns True *outside* geometries; invert=True gives True inside.
    return rasterio.features.geometry_mask(
        [geometry],
        out_shape=(fingerprint.height, fingerprint.width),
        transform=transform,
        invert=True,
    )


class BoundaryMaskCache:
    """Caches rasterized boundary masks in memory.

    All solutions in a single manifest run share the same raster grid, so each
    boundary polygon only needs to be rasterized once per pipeline run.
    """

    def __init__(self) -> None:
        self._cache: dict[tuple[str, str], np.ndarray] = {}

    def get(self, geo_level: str, boundary_id: str, geometry: dict, fingerprint: RasterFingerprint) -> np.ndarray:
        key = (geo_level, boundary_id)
        if key not in self._cache:
            self._cache[key] = rasterize_boundary(geometry, fingerprint)
        return self._cache[key]

    def precompute_all(self, boundaries_by_level: dict, fingerprint: RasterFingerprint) -> None:
        """Rasterize all boundaries upfront so the first solution pays the full cost."""
        for geo_level, features in boundaries_by_level.items():
            for feat in features:
                self.get(geo_level, feat.boundary_id, feat.geometry, fingerprint)
