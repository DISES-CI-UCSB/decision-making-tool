"""Boundary-id-per-pixel grids for fast multi-boundary fan-out.

The Tier 1 species metrics need to ask, for each of ~8,300 species and each
of ~1,140 sub-national scopes, "did the species's range overlap the
solution-selected pixels inside this boundary?".  Iterating over boundaries
inside the species loop costs ~1,140 boolean-AND operations per species per
solution, which doesn't fit the 18-solution budget.

This module replaces that inner loop with a single ``np.bincount`` call per
species per level.  We precompute, for each geography level, a flat
``int32`` array the same length as the solution raster (``height × width``)
where each cell holds the index (into the level's boundary list) of the
boundary that owns that pixel — or ``-1`` if no boundary covers it.

A species's contribution to every boundary at a level is then::

    bids_at_range = grid.flat[species_range_indices]
    sel_at_selected = grid.flat[species_range_selected_indices]
    total_per = np.bincount(bids_at_range[bids_at_range >= 0], minlength=N)
    sel_per = np.bincount(sel_at_selected[sel_at_selected >= 0], minlength=N)

Boundaries can overlap (rarely, in this dataset, mostly at SIRAP edges); we
keep the *first* boundary encountered per pixel to make the inversion
deterministic.  The species metrics treat each boundary independently, so
the only effect is that the rare overlapping pixel is counted once in the
boundary that wins.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json

import numpy as np

from boundaries.boundary_loader import BoundaryFeature, canonical_geometry_sha256
from boundaries.boundary_mask import (
    BoundaryMaskCache,
    ReferenceGridKey,
    reference_grid_key,
)
from raster_metrics import RasterFingerprint


@dataclass(frozen=True)
class BoundaryIdGrid:
    """Per-level mapping from pixel index → boundary index (or -1).

    ``flat`` is a 1-D int32 array with length ``height × width`` matching the
    solution raster, suitable for direct indexing with flat pixel indices.
    ``boundary_ids`` is the parallel list of boundary IDs; index ``i`` of the
    grid corresponds to ``boundary_ids[i]``.
    """
    level: str
    flat: np.ndarray         # int32, shape (height * width,)
    boundary_ids: tuple[str, ...]
    boundary_names: tuple[str, ...]

    @property
    def num_boundaries(self) -> int:
        return len(self.boundary_ids)


@dataclass(frozen=True)
class BoundaryIdGridCacheKey:
    grid: ReferenceGridKey
    boundary_collection_sha256: str


def boundary_collection_sha256(
    boundaries_by_level: dict[str, list[BoundaryFeature]],
) -> str:
    """Hash IDs, order, source versions, and geometry for all grid inputs."""
    signature = []
    for level in sorted(boundaries_by_level):
        features = boundaries_by_level[level]
        signature.append(
            (
                level,
                [
                    (
                        feature.boundary_id,
                        feature.name,
                        feature.source_crs,
                        feature.source_sha256,
                        feature.geometry_sha256
                        or canonical_geometry_sha256(feature.geometry),
                    )
                    for feature in features
                ],
            )
        )
    encoded = json.dumps(signature, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_boundary_id_grid(
    level: str,
    features: list[BoundaryFeature],
    fingerprint: RasterFingerprint,
    mask_cache: BoundaryMaskCache,
) -> BoundaryIdGrid:
    """Build a BoundaryIdGrid for one geography level.

    Reuses the existing ``BoundaryMaskCache`` to rasterize each boundary
    polygon (so a previous pipeline pass that already cached the masks pays
    no extra rasterization cost here).  Pixels not covered by any boundary
    are marked ``-1``.
    """
    n_pixels = fingerprint.height * fingerprint.width
    flat = np.full(n_pixels, -1, dtype=np.int32)
    ids: list[str] = []
    names: list[str] = []
    for idx, feat in enumerate(features):
        ids.append(feat.boundary_id)
        names.append(feat.name)
        bool_mask = mask_cache.get(
            level,
            feat.boundary_id,
            feat.geometry,
            fingerprint,
            source_crs=feat.source_crs,
            source_sha256=feat.source_sha256,
            geometry_sha256=feat.geometry_sha256,
        )
        flat_mask = bool_mask.ravel()
        # Assign this boundary's index only to pixels not already claimed.
        unclaimed = (flat == -1) & flat_mask
        flat[unclaimed] = idx

    return BoundaryIdGrid(
        level=level,
        flat=flat,
        boundary_ids=tuple(ids),
        boundary_names=tuple(names),
    )


def build_grids_for_levels(
    boundaries_by_level: dict[str, list[BoundaryFeature]],
    fingerprint: RasterFingerprint,
    mask_cache: BoundaryMaskCache,
) -> dict[str, BoundaryIdGrid]:
    """Build a BoundaryIdGrid for each provided level."""
    grids: dict[str, BoundaryIdGrid] = {}
    for level, features in boundaries_by_level.items():
        grids[level] = build_boundary_id_grid(level, features, fingerprint, mask_cache)
    return grids


class BoundaryIdGridCache:
    """Caches per-level boundary-ID grids independently for each raster grid."""

    def __init__(self) -> None:
        self._cache: dict[BoundaryIdGridCacheKey, dict[str, BoundaryIdGrid]] = {}

    def get(
        self,
        boundaries_by_level: dict[str, list[BoundaryFeature]],
        fingerprint: RasterFingerprint,
        mask_cache: BoundaryMaskCache,
    ) -> dict[str, BoundaryIdGrid]:
        key = BoundaryIdGridCacheKey(
            grid=reference_grid_key(fingerprint),
            boundary_collection_sha256=boundary_collection_sha256(
                boundaries_by_level
            ),
        )
        if key not in self._cache:
            self._cache[key] = build_grids_for_levels(
                boundaries_by_level,
                fingerprint,
                mask_cache,
            )
        return self._cache[key]
