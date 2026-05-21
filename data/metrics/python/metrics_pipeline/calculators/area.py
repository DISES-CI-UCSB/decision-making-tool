"""Area metrics derived purely from the solution raster.

These two metrics require only the solution raster (no feature layer overlay)
and form the baseline for all boundary-level comparisons.

Metrics implemented here
------------------------
  #17 — National Contribution (percent)
  #18 — Priority Area, Selected (km²)
"""

from __future__ import annotations

from raster_metrics import SolutionRaster


def selected_area_km2(raster: SolutionRaster) -> float:
    """#18 — Total area of all selected planning units, in km².

    Sums the per-row pixel area (km²/cell) across every cell where the
    solution raster equals 1.  Uses pre-computed per-row areas to account for
    geographic CRS where pixel size varies with latitude.
    """
    return raster.selected_area_km2


def national_contribution_pct(raster: SolutionRaster) -> float | None:
    """#17 — Selected area as a share of the total national planning surface, in %.

    Divides the selected area by the total valid (non-nodata) area in the
    national solution raster, then multiplies by 100.

    Returns None when the raster has no valid cells (degenerate raster), so
    the caller can emit a 'blocked' status rather than a divide-by-zero error.
    """
    if raster.valid_area_km2 == 0:
        return None
    return (raster.selected_area_km2 / raster.valid_area_km2) * 100.0
