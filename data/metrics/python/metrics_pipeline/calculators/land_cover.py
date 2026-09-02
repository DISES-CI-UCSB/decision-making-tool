"""Land-cover metric calculators (#9 and CORINE Level 1 percentages).

Source layer: coberturas.tif (CORINE Land Cover Level 1, 5 classes).

Authoritative class-ID mapping (TIF values 1-5):
    1 = Territorios Artificializados    (urban / artificial)
    2 = Territorios Agrícolas           (agriculture)
    3 = Bosques y Áreas Seminaturales  (forest / semi-natural)
    4 = Áreas Húmedas                   (wetlands)
    5 = Superficies de Agua             (water)
"""

from __future__ import annotations

import numpy as np

from raster_metrics import SolutionRaster, overlap_km2


def _pct_of_selected(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    sel = raster.selected_area_km2
    if sel == 0.0:
        return None
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row) / sel * 100.0


# --- #9 — Conservation Area on Agricultural Land (km²) ---

def agricultural_area_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """km² of selected area classified as Territorios Agrícolas (class 2)."""
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


# --- CORINE Land Cover Level 1 (% of selected) ---

def corine_level_1_pct(raster: SolutionRaster, layer_mask: np.ndarray) -> float | None:
    """Return the selected-area percentage for one verified CORINE class mask."""
    return _pct_of_selected(raster, layer_mask)
