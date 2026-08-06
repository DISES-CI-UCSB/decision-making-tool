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
from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS
from metrics_contract import build_scope_state

FIXTURES_DIR = Path(__file__).parents[2] / "fixtures"
EXAMPLES_DIR = Path(__file__).parents[2] / "generated" / "examples"
EXAMPLE_FILE = EXAMPLES_DIR / "ecos17_estr30_runap_hf.metrics.json"

_DUMMY_PATH = Path("/dev/null")
TEST_RASTER_SHA256 = "a" * 64
TEST_GRID_SHA256 = "b" * 64
TEST_VALIDITY_MASK_SHA256 = "c" * 64


def scope_state(
    geography_level: str,
    scope_id: str,
    *,
    valid_cells: int = 1,
    selected_cells: int = 0,
    solution_raster_sha256: str = TEST_RASTER_SHA256,
) -> dict:
    """Return deterministic valid scope evidence for artifact contract tests."""

    return build_scope_state(
        geography_level=geography_level,
        scope_id=scope_id,
        solution_valid_cell_count=valid_cells,
        selected_cell_count=selected_cells,
        boundary_grid_cell_count=max(1, valid_cells),
        target_grid_sha256=TEST_GRID_SHA256,
        solution_raster_sha256=solution_raster_sha256,
        solution_validity_mask_sha256=TEST_VALIDITY_MASK_SHA256,
        boundary_source_sha256=(
            None
            if geography_level == "national"
            else BOUNDARY_SOURCE_SPECS[geography_level].expected_sha256
        ),
        boundary_geometry_sha256=None if geography_level == "national" else "e" * 64,
    )


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
