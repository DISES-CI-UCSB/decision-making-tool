from __future__ import annotations

import json
import os

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import clear_artifact_env


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


def test_ready_loads_lightweight_manifest(tmp_path) -> None:
    clear_artifact_env()
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "artifact_version": "test",
                "schema_version": "metrics-artifact-manifest/v1",
                "created_at": "2026-06-04T00:00:00Z",
                "checksum": {"algorithm": "sha256", "value": "abc123"},
                "source_manifest": {"planned_prefixes": ["inputs/features/"]},
                "files": [],
            }
        ),
        encoding="utf-8",
    )
    os.environ["DMT_ARTIFACT_REQUIRED"] = "true"
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(manifest_path)
    client = TestClient(app)

    response = client.get("/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["artifact_state"]["available"] is True
    assert body["artifact_state"]["artifact_version"] == "test"
