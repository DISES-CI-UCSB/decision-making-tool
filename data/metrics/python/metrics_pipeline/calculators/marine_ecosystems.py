"""Marine ecosystem coverage metrics derived from categorical class IDs."""

from __future__ import annotations

import numpy as np

from raster_metrics import SolutionRaster, categorical_overlap_km2

CORAL_REEF_CLASS_IDS = frozenset({23, 32, 89, 108, 118, 140})
SEAGRASS_CLASS_IDS = frozenset({86, 88, 117})
MARINE_MANGROVE_CLASS_IDS = frozenset({55, 56, 72, 80})


def _coverage_km2(
    raster: SolutionRaster,
    category_values: np.ndarray,
    class_ids: frozenset[int],
) -> float:
    return categorical_overlap_km2(
        raster.selected_mask,
        category_values,
        class_ids,
        raster.pixel_area_km2_per_row,
    )


def coral_reef_coverage_km2(
    raster: SolutionRaster,
    category_values: np.ndarray,
) -> float:
    """#35 — selected km² classified as coral formations."""
    return _coverage_km2(raster, category_values, CORAL_REEF_CLASS_IDS)


def marine_mangrove_coverage_km2(
    raster: SolutionRaster,
    category_values: np.ndarray,
) -> float:
    """#36 — selected km² classified as mangroves in marine ecosystems."""
    return _coverage_km2(raster, category_values, MARINE_MANGROVE_CLASS_IDS)


def seagrass_coverage_km2(
    raster: SolutionRaster,
    category_values: np.ndarray,
) -> float:
    """#37 — selected km² classified as seagrass beds."""
    return _coverage_km2(raster, category_values, SEAGRASS_CLASS_IDS)
