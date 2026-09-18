from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.polygon_metrics import PolygonMetricError, validate_polygon_geometry
from tests.conftest import use_tiny_artifact


def _box(
    west: float,
    south: float,
    east: float,
    north: float,
    extra_vertices: int = 0,
) -> dict:
    south_edge = [[west, south]]
    for index in range(1, extra_vertices + 1):
        fraction = index / (extra_vertices + 1)
        south_edge.append([west + (east - west) * fraction, south])
    ring = [
        *south_edge,
        [east, south],
        [east, north],
        [west, north],
        [west, south],
    ]
    return {"type": "Polygon", "coordinates": [ring]}


def test_validate_polygon_rejects_too_many_vertices(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DMT_MAX_POLYGON_VERTICES", "8")
    geometry = _box(0.0, 0.0, 1.0, 1.0, extra_vertices=4)

    with pytest.raises(PolygonMetricError, match="too_many_vertices"):
        validate_polygon_geometry(geometry)


def test_validate_polygon_rejects_area_above_national_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DMT_MAX_POLYGON_AREA_KM2", "1000000")
    geometry = _box(-80.0, -5.0, -60.0, 15.0)

    with pytest.raises(PolygonMetricError, match="area_exceeds_national_territory"):
        validate_polygon_geometry(geometry)


def test_validate_polygon_accepts_small_drawn_aoi() -> None:
    geometry = _box(-74.1, 4.6, -74.0, 4.7)

    assert validate_polygon_geometry(geometry)


def test_default_vertex_cap_rejects_5001_positions() -> None:
    geometry = _box(0.0, 0.0, 1.0, 1.0, extra_vertices=4996)

    with pytest.raises(PolygonMetricError, match="too_many_vertices"):
        validate_polygon_geometry(geometry)


def test_custom_polygon_api_rejects_oversized_vertex_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_tiny_artifact(required=True)
    monkeypatch.setenv("DMT_MAX_POLYGON_VERTICES", "8")
    client = TestClient(app)
    request = {
        "geometry": _box(0.0, 0.0, 2.0, 1.0, extra_vertices=4),
        "metrics": ["area"],
    }

    response = client.post("/metrics/custom-polygon", json=request)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["status"] == "invalid_request"
    assert "too_many_vertices" in detail["message"]


def test_species_job_rejects_oversized_geometry_before_enqueue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DMT_MAX_POLYGON_AREA_KM2", "1000")
    client = TestClient(app)

    response = client.post(
        "/area-profile/custom-polygon/species-coverage/jobs",
        json={
            "geometry": _box(-80.0, -5.0, -60.0, 15.0),
            "solution_id": "solution-1",
        },
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["status"] == "invalid_request"
    assert "area_exceeds_national_territory" in detail["message"]
