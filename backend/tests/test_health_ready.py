from __future__ import annotations

import os

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import clear_artifact_env, use_tiny_artifact


def test_health_returns_ok() -> None:
    clear_artifact_env()
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_allows_no_artifact_development_mode(tmp_path) -> None:
    clear_artifact_env()
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(tmp_path / "missing-manifest.json")
    client = TestClient(app)

    response = client.get("/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["artifact_state"]["required"] is False
    assert body["artifact_state"]["available"] is False
    assert body["artifact_state"]["warmup_status"] == "not_required"


def test_ready_fails_when_artifact_required_and_missing(tmp_path) -> None:
    clear_artifact_env()
    os.environ["DMT_ARTIFACT_REQUIRED"] = "true"
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(tmp_path / "missing-manifest.json")
    client = TestClient(app)

    response = client.get("/ready")

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["status"] == "not_ready"
    assert detail["artifact_state"]["required"] is True
    assert detail["artifact_state"]["available"] is False
    assert detail["artifact_state"]["warmup_status"] == "failed"


def test_ready_passes_when_required_tiny_artifact_loads() -> None:
    use_tiny_artifact(required=True)
    client = TestClient(app)

    response = client.get("/ready")

    assert response.status_code == 200
    body = response.json()
    artifact_state = body["artifact_state"]
    assert body["status"] == "ready"
    assert artifact_state["required"] is True
    assert artifact_state["available"] is True
    assert artifact_state["warmup_status"] == "ready"
    assert artifact_state["artifact_version"] == "tiny-area-fixture-v1"
    assert artifact_state["warmup_ms"] is not None
    assert artifact_state["metadata"]["cell_count"] == 4
    assert artifact_state["metadata"]["valid_cell_count"] == 3
