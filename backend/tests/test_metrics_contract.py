from __future__ import annotations

import os

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import clear_artifact_env


POLYGON_REQUEST = {
    "geometry": {
        "type": "Polygon",
        "coordinates": [
            [
                [-74.1, 4.6],
                [-74.0, 4.6],
                [-74.0, 4.7],
                [-74.1, 4.7],
                [-74.1, 4.6],
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


def test_custom_polygon_contract_validates_geometry() -> None:
    clear_artifact_env()
    client = TestClient(app)

    response = client.post("/metrics/custom-polygon", json={"metrics": ["area"]})

    assert response.status_code == 422
