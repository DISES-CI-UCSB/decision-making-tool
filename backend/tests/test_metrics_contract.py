from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import clear_artifact_env, use_tiny_artifact


POLYGON_REQUEST = {
    "geometry": {
        "type": "Polygon",
        "coordinates": [
            [
                [0.0, 0.0],
                [2.0, 0.0],
                [2.0, 1.0],
                [0.0, 1.0],
                [0.0, 0.0],
            ]
        ],
    },
    "metrics": ["area"],
}


def test_custom_polygon_requires_artifacts_for_real_metrics(tmp_path) -> None:
    clear_artifact_env()
    os.environ["DMT_ARTIFACT_REQUIRED"] = "true"
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(tmp_path / "missing-manifest.json")
    client = TestClient(app)

    response = client.post("/metrics/custom-polygon", json=POLYGON_REQUEST)

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["status"] == "artifact_required"
    assert detail["requested_metrics"] == ["area"]
    assert detail["artifact_state"]["available"] is False
    assert detail["artifact_state"]["warmup_status"] == "failed"


def test_custom_polygon_returns_area_metrics_from_tiny_artifact() -> None:
    use_tiny_artifact(required=True)
    client = TestClient(app)

    response = client.post("/metrics/custom-polygon", json=POLYGON_REQUEST)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["artifact_state"]["artifact_version"] == "tiny-area-fixture-v1"
    assert body["metrics"]["priority_area_in_region"] == pytest.approx(1.5)
    assert body["metrics"]["national_contribution"] == pytest.approx(50.0)
    assert body["metadata"]["matched_cell_count"] == 2
    assert body["metadata"]["matched_cells"] == ["southwest", "southeast"]
    assert body["metadata"]["request_ms"] is not None
    assert body["metadata"]["total_request_ms"] is not None


def test_custom_polygon_can_return_one_requested_area_metric() -> None:
    use_tiny_artifact(required=True)
    client = TestClient(app)
    request = {**POLYGON_REQUEST, "metrics": ["priority_area_in_region"]}

    response = client.post("/metrics/custom-polygon", json=request)

    assert response.status_code == 200
    assert response.json()["metrics"] == {"priority_area_in_region": 1.5}


def test_custom_polygon_contract_validates_missing_geometry() -> None:
    clear_artifact_env()
    client = TestClient(app)

    response = client.post("/metrics/custom-polygon", json={"metrics": ["area"]})

    assert response.status_code == 422


def test_custom_polygon_handles_invalid_polygon() -> None:
    use_tiny_artifact(required=True)
    client = TestClient(app)
    request = {
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]],
        },
        "metrics": ["area"],
    }

    response = client.post("/metrics/custom-polygon", json=request)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["status"] == "invalid_request"
    assert "rings" in detail["message"]


def test_custom_polygon_handles_unsupported_metric() -> None:
    use_tiny_artifact(required=True)
    client = TestClient(app)
    request = {**POLYGON_REQUEST, "metrics": ["carbon"]}

    response = client.post("/metrics/custom-polygon", json=request)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["status"] == "invalid_request"
    assert "Unsupported metric ids" in detail["message"]
