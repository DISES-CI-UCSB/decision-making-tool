from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
from affine import Affine
from fastapi.testclient import TestClient
from rasterio.warp import transform_geom

from app import main as main_module
from app.artifacts import ArtifactState, RuntimeArtifact
from app.main import app
from app.metric_adapters import build_custom_aoi_raster
from app.solution_coverage import (
    RuntimeMesaCoverage,
    calculate_ecosystem_aoi_coverage,
    calculate_ecosystem_national_coverage,
    load_runtime_mesa_coverage,
)
from mesa_coverage import evaluate_categorical_aoi
from raster_metrics import read_solution_raster


GRID = Affine(
    1000.0,
    0.0,
    4331309.911856957,
    0.0,
    -1000.0,
    2933186.9308051495,
)
SOLUTION_ID = "fixture_solution"


def _write_raster(path: Path, values: np.ndarray, *, nodata: int) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype=values.dtype,
        crs="EPSG:9377",
        transform=GRID,
        nodata=nodata,
    ) as dataset:
        dataset.write(values, 1)
    return path


def _coverage_fixture(tmp_path: Path) -> tuple[RuntimeMesaCoverage, Path]:
    ecosystem_path = _write_raster(
        tmp_path / "mesa-ecosystems.tif",
        np.array([[1, 2], [1, 2]], dtype=np.uint16),
        nodata=0,
    )
    solution_path = _write_raster(
        tmp_path / "solution.tif",
        np.array([[2, 0], [1, 0]], dtype=np.uint8),
        nodata=255,
    )
    catalog_path = tmp_path / "ecosystems.csv"
    catalog_path.write_text(
        "biome,biome_id\nForest,1\nWetland,2\n",
        encoding="utf-8",
    )
    targets_path = tmp_path / "targets.json"
    targets_path.write_text(
        json.dumps(
            {
                "format": "mesa-solution-targets-v1",
                "solutions": {
                    SOLUTION_ID: [
                        {
                            "feature": "Forest",
                            "feature_type": "ecosystem",
                            "class": None,
                            "relative_target": 0.5,
                            "evaluated": "post-hoc",
                        },
                        {
                            "feature": "Wetland",
                            "feature_type": "ecosystem",
                            "class": None,
                            "relative_target": 0.5,
                            "evaluated": "post-hoc",
                        },
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    return (
        load_runtime_mesa_coverage(
            ecosystem_path,
            catalog_path,
            targets_path,
            ["mammals"],
        ),
        solution_path,
    )


def test_core_national_coverage_matches_mesa_cell_counts(tmp_path: Path) -> None:
    coverage, solution_path = _coverage_fixture(tmp_path)
    rows = calculate_ecosystem_national_coverage(
        coverage,
        SOLUTION_ID,
        read_solution_raster(solution_path),
    )

    assert [
        (row.feature, row.total_amount, row.absolute_held, row.relative_held)
        for row in rows
    ] == [
        ("Forest", 2.0, 2.0, 1.0),
        ("Wetland", 2.0, 0.0, 0.0),
    ]


def test_boundary_coverage_preserves_both_denominators() -> None:
    ecosystems = np.array([[1, 2], [1, 2]], dtype=np.uint16)
    selected = np.array([[True, False], [True, False]])
    top_boundary = np.array([[True, True], [False, False]])

    rows = evaluate_categorical_aoi(
        category_values=ecosystems,
        selected_mask=selected,
        aoi_mask=top_boundary,
        feature_ids=[1, 2],
        feature_names=["Forest", "Wetland"],
        national_targets=[0.5, 0.5],
    )

    assert rows[0].coverage_within_aoi == pytest.approx(1.0)
    assert rows[0].contribution_to_national_coverage == pytest.approx(0.5)
    assert rows[0].contribution_to_national_target == pytest.approx(1.0)
    assert rows[1].coverage_within_aoi == pytest.approx(0.0)


def test_area_profile_api_matches_shared_coverage_calculation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    coverage, solution_path = _coverage_fixture(tmp_path)
    solution = read_solution_raster(solution_path)
    polygon_9377 = {
        "type": "Polygon",
        "coordinates": [[
            [GRID.c, GRID.f - 1000],
            [GRID.c + 2000, GRID.f - 1000],
            [GRID.c + 2000, GRID.f],
            [GRID.c, GRID.f],
            [GRID.c, GRID.f - 1000],
        ]],
    }
    geometry = transform_geom("EPSG:9377", "EPSG:4326", polygon_9377)
    artifact = RuntimeArtifact(
        manifest={},
        reference_raster_path=coverage.ecosystem_raster_path,
        mesa_coverage=coverage,
        solution_registry=SimpleNamespace(
            load=lambda _solution_id: (solution, "fixture-checksum")
        ),
    )
    state = ArtifactState(
        required=True,
        available=True,
        manifest_path="fixture-manifest.json",
        artifact_version="fixture-v3",
        message="ready",
    )
    monkeypatch.setattr(main_module, "get_artifact_state", lambda settings: state)
    monkeypatch.setattr(main_module, "get_runtime_artifact", lambda settings: artifact)

    response = TestClient(app).post(
        "/area-profile/custom-polygon",
        json={
            "geometry": geometry,
            "sections": ["ecosystems"],
            "solution_id": SOLUTION_ID,
        },
    )

    assert response.status_code == 200
    records = response.json()["sections"]["ecosystems"]["solution_coverage"]
    expected = calculate_ecosystem_aoi_coverage(
        coverage,
        SOLUTION_ID,
        build_custom_aoi_raster(coverage.ecosystem_raster_path, geometry),
        solution,
    )
    assert records[0]["coverage_within_aoi"] == pytest.approx(
        expected["forest"].coverage_within_aoi
    )
    assert records[0]["contribution_to_national_target"] == pytest.approx(
        expected["forest"].contribution_to_national_target
    )
