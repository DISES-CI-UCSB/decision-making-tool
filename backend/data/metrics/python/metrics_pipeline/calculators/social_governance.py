"""Social and governance territory overlap metrics.

Each function answers: "how many km² of the selected planning units fall
inside this legally recognised territory?"  Both metrics use a binary-overlap
calculation and are documented separately to make their distinct governance
contexts searchable and reviewable.

The layer mask parameter is a boolean numpy array aligned to the solution
raster (same shape, CRS, and transform).  Use raster_metrics.read_layer_mask
to produce it from a downloaded layer TIF.

Metrics implemented here
------------------------
  #59 — Indigenous Reservations Area (resguardos indígenas)
  #60 — Community Councils Area (consejos comunitarios)
"""

from __future__ import annotations

import numpy as np

from raster_metrics import SolutionRaster, overlap_km2


def indigenous_reservations_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """#59 — km² of selected area overlapping indigenous reservations (resguardos indígenas).

    Resguardos are legally recognised collective territories of indigenous
    communities in Colombia.  Overlap with the selected planning units
    captures how much indigenous territory is included in the conservation
    solution.
    """
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)


def community_councils_km2(raster: SolutionRaster, layer_mask: np.ndarray) -> float:
    """#60 — km² of selected area overlapping Afro-Colombian community councils (consejos comunitarios).

    Consejos comunitarios are the collective land governance bodies for
    Afro-Colombian communities, primarily along the Pacific and Atlantic
    coasts.  This metric tracks how much of those territories intersects the
    selected planning units.
    """
    return overlap_km2(raster.selected_mask, layer_mask, raster.pixel_area_km2_per_row)
