"""Ecosystem-coverage overlap metrics.

Each function answers: "how many km² of the selected planning units fall
inside this ecosystem layer?" Strategic ecosystem functions use binary masks.
Total ecosystem coverage uses authoritative IAvH categorical biome IDs.

Layer arrays are aligned to the solution raster (same shape, CRS, and
transform). Use raster_metrics.read_layer_values for total categorical
coverage and raster_metrics.read_layer_mask for strategic ecosystem masks.

Metrics implemented here
------------------------
  #4  — Ecosystem Coverage (total native ecosystems)
  #30 — Ecosystem Coverage - Páramo
  #31 — Ecosystem Coverage - Dry Forest (bosque seco)
  #32 — Ecosystem Coverage - Wetlands (humedales)
  #36 — Mangrove Coverage (manglares)
"""

from __future__ import annotations

import numpy as np

from raster_metrics import SolutionRaster, categorical_overlap_km2, overlap_km2

IAVH_ECOSYSTEM_CLASS_IDS = frozenset(range(1, 431))


def ecosystem_total_km2(raster: SolutionRaster, layer_values: np.ndarray) -> float:
    """#4 — selected km² overlapping a valid IAvH 2024 ecosystem class.

    biome_id values 1–430 are valid. Zero, nodata (converted to NaN by the
    raster reader), and unknown values outside that range are excluded.
    """
    return categorical_overlap_km2(
        raster.selected_mask,
        layer_values,
        IAVH_ECOSYSTEM_CLASS_IDS,
        raster.pixel_area_km2_per_row,
    )


def paramo_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """#30 — km² of selected area overlapping the páramo layer (paramos).

    Páramos are high-altitude Andean wetland ecosystems critical for fresh
    water supply and endemic biodiversity.
    """
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


def dry_forest_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """#31 — km² of selected area overlapping the dry forest layer (bosque_seco).

    Tropical dry forests in Colombia are among the most threatened ecosystems
    in the country; this metric tracks how much is captured by the solution.
    """
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


def wetlands_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """#32 — km² of selected area overlapping the wetlands layer (wetlands).

    Wetlands (humedales) include floodplains, marshes, and other inland water
    bodies.  Overlap measures how much wetland area is protected by the
    selected planning units.
    """
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


def mangroves_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """#36 — km² of selected area overlapping the mangrove layer (mangroves).

    Mangroves are coastal ecosystems providing carbon storage, storm
    protection, and nursery habitat.  Colombia holds a significant share of
    the world's mangrove area.
    """
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)
