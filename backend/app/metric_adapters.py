from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Sequence

import numpy as np


def _install_metrics_pipeline_path() -> Path:
    """Make the tracked metrics pipeline importable from backend code.

    The batch pipeline currently imports modules as top-level names from
    data/metrics/python/metrics_pipeline. Keep that layout intact and point the
    backend at the same source tree instead of copying metric definitions.
    """
    candidates: list[Path] = []
    configured_path = os.getenv("DMT_METRICS_PIPELINE_PATH")
    if configured_path:
        candidates.append(Path(configured_path))

    repo_root = Path(__file__).resolve().parents[2]
    candidates.append(repo_root / "data" / "metrics" / "python" / "metrics_pipeline")

    for candidate in candidates:
        if (candidate / "calculators" / "area.py").exists():
            candidate_text = str(candidate)
            if candidate_text not in sys.path:
                sys.path.insert(0, candidate_text)
            return candidate

    searched = ", ".join(str(path) for path in candidates)
    raise RuntimeError(f"Unable to locate metrics pipeline source. Searched: {searched}")


METRICS_PIPELINE_PATH = _install_metrics_pipeline_path()

from calculators.area import national_contribution_pct, selected_area_km2  # noqa: E402
from metric_definitions import METRIC_CATALOG, MetricDefinition  # noqa: E402
from raster_metrics import RasterFingerprint, SolutionRaster  # noqa: E402

AREA_METRIC_IDS = ("national_contribution", "priority_area_in_region")
_DUMMY_PATH = Path("/virtual/backend-shared-solution-raster")


def area_metric_catalog() -> tuple[MetricDefinition, ...]:
    """Return shared catalog entries for area metrics used by the backend."""
    return tuple(
        metric for metric in METRIC_CATALOG if metric.metric_id in AREA_METRIC_IDS
    )


def build_solution_raster_from_masks(
    selected_mask: Sequence[Sequence[object]],
    valid_mask: Sequence[Sequence[object]],
    *,
    pixel_area_km2: float,
) -> SolutionRaster:
    """Build the pipeline's SolutionRaster from in-memory masks.

    This is intentionally fixture-scale glue for parity tests and future API
    metadata work. It does not read polygons, rasters, or runtime artifacts.
    """
    selected = np.asarray(selected_mask, dtype=bool)
    valid = np.asarray(valid_mask, dtype=bool)

    if selected.ndim != 2 or valid.ndim != 2:
        raise ValueError("selected_mask and valid_mask must be 2D arrays.")
    if selected.shape != valid.shape:
        raise ValueError("selected_mask and valid_mask must have matching shapes.")
    if pixel_area_km2 <= 0:
        raise ValueError("pixel_area_km2 must be positive.")

    height, width = selected.shape
    selected &= valid
    pixel_area_per_row = np.full(height, float(pixel_area_km2), dtype=np.float64)
    pixel_width_km = float(pixel_area_km2) ** 0.5

    return SolutionRaster(
        path=_DUMMY_PATH,
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=pixel_area_per_row,
        fingerprint=RasterFingerprint(
            width=width,
            height=height,
            transform=(pixel_width_km, 0.0, 0.0, 0.0, -pixel_width_km, height * pixel_width_km),
            crs="EPSG:32618",
        ),
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
    )


def calculate_area_metrics_from_masks(
    selected_mask: Sequence[Sequence[object]],
    valid_mask: Sequence[Sequence[object]],
    *,
    pixel_area_km2: float,
) -> dict[str, float | None]:
    """Calculate backend area metrics through the shared pipeline functions."""
    raster = build_solution_raster_from_masks(
        selected_mask,
        valid_mask,
        pixel_area_km2=pixel_area_km2,
    )
    return {
        "priority_area_in_region": selected_area_km2(raster),
        "national_contribution": national_contribution_pct(raster),
    }
