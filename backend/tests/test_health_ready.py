from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import main as main_module
from tests.conftest import clear_artifact_env, use_tiny_artifact


class QueueAvailability:
    def __init__(self, reason: str | None = None) -> None:
        self.reason = reason

    def unavailable_reason(self) -> str | None:
        return self.reason


def test_health_returns_ok() -> None:
    clear_artifact_env()
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_custom_polygon_allows_localhost_origin() -> None:
    clear_artifact_env()
    client = TestClient(app)

    response = client.options(
        "/metrics/custom-polygon",
        headers={
            "Origin": "http://localhost:4301",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:4301"


def test_ready_allows_no_artifact_development_mode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_artifact_env()
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(tmp_path / "missing-manifest.json")
    monkeypatch.setattr(
        main_module,
        "_DETAILED_SPECIES_QUEUE",
        QueueAvailability(),
    )
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


def test_ready_passes_when_required_tiny_artifact_loads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_tiny_artifact(required=True)
    monkeypatch.setattr(
        main_module,
        "_DETAILED_SPECIES_QUEUE",
        QueueAvailability(),
    )
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


@pytest.mark.parametrize(
    "unavailable_reason",
    ["worker_unavailable", "queue_storage_unavailable"],
)
def test_ready_recovers_when_detailed_species_worker_recovers(
    unavailable_reason: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_artifact_env()
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(tmp_path / "missing-manifest.json")
    queue = QueueAvailability(unavailable_reason)
    monkeypatch.setattr(main_module, "_DETAILED_SPECIES_QUEUE", queue)
    client = TestClient(app)

    unavailable = client.get("/ready")
    queue.reason = None
    recovered = client.get("/ready")

    assert unavailable.status_code == 503
    assert unavailable.headers["retry-after"] == "10"
    assert (
        unavailable.json()["detail"]["detailed_species_status"]
        == unavailable_reason
    )
    assert recovered.status_code == 200
    assert recovered.json()["status"] == "ready"
