"""Pairwise solution comparison metrics.

These functions compute metrics that require TWO solution rasters.  They are
NOT called by the single-solution cached pipeline (main.py); their metric
definitions in the catalog are marked 'deferred_pairwise' and carry a status
of 'deferred' in the per-solution JSON output.

They are intended for:
  - A future comparison pipeline or API endpoint.
  - Live frontend calculations when two solutions are loaded side-by-side.

Both rasters must share the same fingerprint (grid, CRS, transform).
Call raster_metrics.RasterFingerprint.matches() to verify before use.

Metrics implemented here
------------------------
  #70 — Agreement Area      (A ∩ B)
  #71 — Unique to Solution A  (A − B)
  #72 — Unique to Solution B  (B − A)
"""

from __future__ import annotations

from raster_metrics import RasterError, SolutionRaster, _area_km2


def _require_same_grid(a: SolutionRaster, b: SolutionRaster) -> None:
    if not a.fingerprint.matches(b.fingerprint):
        raise RasterError(
            "Comparison metrics require both rasters to share the same grid.\n"
            f"  raster_a: {a.fingerprint}\n  raster_b: {b.fingerprint}"
        )


def agreement_area_km2(raster_a: SolutionRaster, raster_b: SolutionRaster) -> float:
    """#70 — km² selected in BOTH solution A and solution B (A ∩ B)."""
    _require_same_grid(raster_a, raster_b)
    both = raster_a.selected_mask & raster_b.selected_mask
    return _area_km2(both, raster_a.pixel_area_km2_per_row)


def unique_to_a_km2(raster_a: SolutionRaster, raster_b: SolutionRaster) -> float:
    """#71 — km² selected in solution A but NOT in solution B (A − B)."""
    _require_same_grid(raster_a, raster_b)
    only_a = raster_a.selected_mask & ~raster_b.selected_mask
    return _area_km2(only_a, raster_a.pixel_area_km2_per_row)


def unique_to_b_km2(raster_a: SolutionRaster, raster_b: SolutionRaster) -> float:
    """#72 — km² selected in solution B but NOT in solution A (B − A)."""
    _require_same_grid(raster_a, raster_b)
    only_b = raster_b.selected_mask & ~raster_a.selected_mask
    return _area_km2(only_b, raster_b.pixel_area_km2_per_row)
