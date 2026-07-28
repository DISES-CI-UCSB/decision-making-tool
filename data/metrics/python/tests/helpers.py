"""Shared test helper functions.

Importable from any test module. Pytest fixtures in conftest.py call these
helpers so both fixtures and test code share the same logic without relying on
conftest being importable as a regular module.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from raster_metrics import RasterFingerprint, SolutionRaster

FIXTURES_DIR = Path(__file__).parents[2] / "fixtures"
EXAMPLES_DIR = Path(__file__).parents[2] / "generated" / "examples"
EXAMPLE_FILE = EXAMPLES_DIR / "ecos17_estr30_runap_hf.metrics.json"

_DUMMY_PATH = Path("/dev/null")


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text())


def load_example_output() -> dict:
    """Load the integration example or build a deterministic clean-checkout fixture."""
    if EXAMPLE_FILE.exists():
        return json.loads(EXAMPLE_FILE.read_text(encoding="utf-8"))

    def metric(metric_id: str, value: float, unit: str) -> dict:
        return {
            "metricId": metric_id,
            "value": value,
            "unit": unit,
            "status": "ready",
            "source": "test:deterministic-clean-checkout-fixture",
            "notes": None,
            "labelKey": f"metrics.{metric_id}",
            "formatHint": "number",
        }

    return {
        "solutionId": "clean_checkout_example",
        "generatedAt": "2026-07-27T00:00:00Z",
        "geographies": {
            "national": {
                "colombia": {
                    "metrics": [
                        metric("national_contribution", 1.0, "%"),
                        metric("priority_area_in_region", 100.0, "km2"),
                        metric("ecosystem_coverage", 50.0, "km2"),
                    ]
                }
            }
        },
    }


def raster_from_fixture(fixture: dict) -> SolutionRaster:
    """Build a SolutionRaster from a tiny JSON fixture without rasterio.

    The fixture must have keys: shape, pixel_area_km2, selected, valid.
    """
    h, w = fixture["shape"]
    selected = np.array(fixture["selected"], dtype=bool)
    valid = np.array(fixture["valid"], dtype=bool)
    pixel_area_km2 = float(fixture["pixel_area_km2"])
    pixel_area_per_row = np.full(h, pixel_area_km2, dtype=np.float64)
    px = pixel_area_km2 ** 0.5
    fingerprint = RasterFingerprint(
        width=w,
        height=h,
        transform=(px, 0.0, 0.0, 0.0, -px, h * px),
        crs="EPSG:32618",
    )
    return SolutionRaster(
        path=_DUMMY_PATH,
        selected_mask=selected,
        valid_mask=valid,
        pixel_area_km2_per_row=pixel_area_per_row,
        fingerprint=fingerprint,
        selected_cells=int(selected.sum()),
        valid_cells=int(valid.sum()),
    )


def layer_mask(fixture: dict, layer_name: str) -> np.ndarray:
    """Return the boolean layer mask array for a named layer in a fixture."""
    return np.array(fixture["layers"][layer_name]["mask"], dtype=bool)
