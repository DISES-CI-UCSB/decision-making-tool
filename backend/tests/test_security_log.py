from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app import main as main_module
from app.job_queue import JobQueueFullError
from app.main import app, security_http_exception_handler
from app.polygon_metrics import PolygonMetricError
from app.security_log import (
    emit_security_event,
    is_job_cancel_path,
    is_oversized_polygon_error,
    log_unauthorized_cancel,
    maybe_log_http_exception,
)
from tests.conftest import use_tiny_artifact
from tests.test_polygon_caps import _box


SECURITY_KEYS = {"timestamp", "client_ip", "event_type", "resource", "status_code"}


def _security_events(capsys: pytest.CaptureFixture[str]) -> list[dict]:
    events: list[dict] = []
    for line in capsys.readouterr().out.splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and "event_type" in payload:
            events.append(payload)
    return events


def _http_request(
    path: str,
    *,
    method: str = "GET",
    client_ip: str = "203.0.113.10",
) -> Request:
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": [],
            "client": (client_ip, 12345),
            "server": ("testserver", 80),
        }
    )


def _assert_security_event(
    event: dict,
    *,
    event_type: str,
    status_code: int,
    resource: str,
    client_ip: str | None = None,
) -> None:
    assert set(event) == SECURITY_KEYS
    assert event["event_type"] == event_type
    assert event["status_code"] == status_code
    assert event["resource"] == resource
    assert isinstance(event["timestamp"], str)
    assert event["timestamp"].endswith("Z")
    if client_ip is not None:
        assert event["client_ip"] == client_ip


def test_emit_security_event_writes_one_json_line(capsys: pytest.CaptureFixture[str]) -> None:
    emit_security_event(
        event_type="invalid_token",
        resource="/protected",
        status_code=401,
        client_ip="198.51.100.4",
        timestamp="2026-09-18T16:51:00.000Z",
    )

    events = _security_events(capsys)
    assert len(events) == 1
    _assert_security_event(
        events[0],
        event_type="invalid_token",
        status_code=401,
        resource="/protected",
        client_ip="198.51.100.4",
    )
    assert events[0]["timestamp"] == "2026-09-18T16:51:00.000Z"


def test_emit_security_event_unauthorized_cancel(capsys: pytest.CaptureFixture[str]) -> None:
    emit_security_event(
        event_type="unauthorized_cancel",
        resource="/area-profile/custom-polygon/species-coverage/jobs/job-1",
        status_code=403,
        client_ip="203.0.113.10",
    )

    events = _security_events(capsys)
    assert len(events) == 1
    _assert_security_event(
        events[0],
        event_type="unauthorized_cancel",
        status_code=403,
        resource="/area-profile/custom-polygon/species-coverage/jobs/job-1",
        client_ip="203.0.113.10",
    )


def test_log_unauthorized_cancel_helper(capsys: pytest.CaptureFixture[str]) -> None:
    request = _http_request(
        "/area-profile/custom-polygon/species-coverage/jobs/job-9",
        method="DELETE",
    )
    log_unauthorized_cancel(request)

    events = _security_events(capsys)
    assert len(events) == 1
    _assert_security_event(
        events[0],
        event_type="unauthorized_cancel",
        status_code=403,
        resource="/area-profile/custom-polygon/species-coverage/jobs/job-9",
        client_ip="203.0.113.10",
    )


def test_401_handler_emits_invalid_token(capsys: pytest.CaptureFixture[str]) -> None:
    request = _http_request("/future-protected")
    maybe_log_http_exception(request, 401)

    events = _security_events(capsys)
    assert len(events) == 1
    _assert_security_event(
        events[0],
        event_type="invalid_token",
        status_code=401,
        resource="/future-protected",
        client_ip="203.0.113.10",
    )


def test_403_handler_emits_unauthorized_cancel_on_job_path(
    capsys: pytest.CaptureFixture[str],
) -> None:
    path = "/area-profile/custom-polygon/species-coverage/jobs/abc"
    request = _http_request(path, method="DELETE")
    response = asyncio.run(
        security_http_exception_handler(
            request,
            HTTPException(status_code=403, detail="forbidden"),
        )
    )

    assert response.status_code == 403
    events = _security_events(capsys)
    assert len(events) == 1
    _assert_security_event(
        events[0],
        event_type="unauthorized_cancel",
        status_code=403,
        resource=path,
        client_ip="203.0.113.10",
    )


def test_403_on_other_paths_is_not_unauthorized_cancel(
    capsys: pytest.CaptureFixture[str],
) -> None:
    maybe_log_http_exception(_http_request("/metrics/custom-polygon"), 403)
    assert _security_events(capsys) == []


def test_is_job_cancel_path() -> None:
    assert is_job_cancel_path("/area-profile/custom-polygon/species-coverage/jobs/job-1")
    assert not is_job_cancel_path("/area-profile/custom-polygon/species-coverage/jobs")
    assert not is_job_cancel_path("/ops/custom-polygon")


def test_oversized_polygon_emits_security_event(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    use_tiny_artifact(required=True)
    monkeypatch.setenv("DMT_MAX_POLYGON_VERTICES", "8")
    client = TestClient(app)
    path = "/metrics/custom-polygon"

    response = client.post(
        path,
        json={"geometry": _box(0.0, 0.0, 2.0, 1.0, extra_vertices=4), "metrics": ["area"]},
    )

    assert response.status_code == 422
    events = [event for event in _security_events(capsys) if event["event_type"] == "oversized_polygon"]
    assert len(events) == 1
    _assert_security_event(
        events[0],
        event_type="oversized_polygon",
        status_code=422,
        resource=path,
    )


def test_is_oversized_polygon_error_only_matches_caps() -> None:
    assert is_oversized_polygon_error(
        PolygonMetricError("too_many_vertices: geometry has 9 vertices; maximum is 8.")
    )
    assert is_oversized_polygon_error(
        PolygonMetricError(
            "area_exceeds_national_territory: geometry area is 2000000 km2; maximum is 1000000 km2."
        )
    )
    assert not is_oversized_polygon_error(
        PolygonMetricError("geometry type must be Polygon or MultiPolygon.")
    )
    assert not is_oversized_polygon_error(PolygonMetricError("Polygon rings must be closed."))
    assert not is_oversized_polygon_error(
        PolygonMetricError("Custom polygon raster calculation failed: boom")
    )


def test_non_cap_polygon_error_is_not_oversized_polygon(
    capsys: pytest.CaptureFixture[str],
) -> None:
    use_tiny_artifact(required=True)
    client = TestClient(app)
    path = "/metrics/custom-polygon"

    response = client.post(
        path,
        json={
            "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [1.0, 1.0]]},
            "metrics": ["area"],
        },
    )

    assert response.status_code == 422
    assert "Polygon or MultiPolygon" in response.json()["detail"]["message"]
    events = [event for event in _security_events(capsys) if event["event_type"] == "oversized_polygon"]
    assert events == []


def test_rate_limited_emits_security_event(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DMT_RATE_LIMIT_PER_MINUTE", "1")
    from app.rate_limit import reset_rate_limiter

    reset_rate_limiter()
    client = TestClient(app)
    payload = {
        "geometry": _box(0.0, 0.0, 2.0, 1.0),
        "metrics": ["area"],
    }

    first = client.post("/metrics/custom-polygon", json=payload)
    second = client.post("/metrics/custom-polygon", json=payload)

    assert first.status_code != 429
    assert second.status_code == 429
    assert second.json()["detail"]["status"] == "rate_limited"
    events = _security_events(capsys)
    rate_limited = [event for event in events if event["event_type"] == "rate_limited"]
    assert len(rate_limited) == 1
    _assert_security_event(
        rate_limited[0],
        event_type="rate_limited",
        status_code=429,
        resource="/metrics/custom-polygon",
    )
    assert all(event["event_type"] != "repeat_blocked" for event in events)


def test_repeat_blocked_emits_on_second_denial(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DMT_RATE_LIMIT_PER_MINUTE", "1")
    from app.rate_limit import reset_rate_limiter

    reset_rate_limiter()
    client = TestClient(app)
    payload = {
        "geometry": _box(0.0, 0.0, 2.0, 1.0),
        "metrics": ["area"],
    }
    path = "/metrics/custom-polygon"

    first = client.post(path, json=payload)
    second = client.post(path, json=payload)
    events_after_first_block = _security_events(capsys)
    third = client.post(path, json=payload)
    events_after_second_block = _security_events(capsys)

    assert first.status_code != 429
    assert second.status_code == 429
    assert third.status_code == 429
    assert [event["event_type"] for event in events_after_first_block] == ["rate_limited"]
    _assert_security_event(
        events_after_first_block[0],
        event_type="rate_limited",
        status_code=429,
        resource=path,
    )
    assert [event["event_type"] for event in events_after_second_block] == [
        "rate_limited",
        "repeat_blocked",
    ]
    _assert_security_event(
        events_after_second_block[0],
        event_type="rate_limited",
        status_code=429,
        resource=path,
    )
    _assert_security_event(
        events_after_second_block[1],
        event_type="repeat_blocked",
        status_code=429,
        resource=path,
    )


def test_job_queue_full_is_not_logged_as_rate_limited(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    class FullQueue:
        def unavailable_reason(self) -> None:
            return None

        def enqueue(self, payload):
            raise JobQueueFullError("detailed_species_queue_full")

    artifact = SimpleNamespace(
        manifest={"artifact_version": "test-raster"},
        species_index=object(),
        solution_registry=SimpleNamespace(entries={"solution-1": object()}),
    )
    monkeypatch.setattr(main_module, "_DETAILED_SPECIES_QUEUE", FullQueue())
    monkeypatch.setattr(main_module, "RuntimeSpeciesBitsetIndex", object)
    monkeypatch.setattr(
        main_module,
        "get_runtime_artifact_for_solution",
        lambda settings, solution_id=None: artifact,
    )

    response = TestClient(app).post(
        "/area-profile/custom-polygon/species-coverage/jobs",
        json={
            "geometry": _box(-74.1, 4.6, -74.0, 4.7),
            "solution_id": "solution-1",
            "artifact_version": "test-raster",
        },
    )

    assert response.status_code == 429
    assert response.json()["detail"]["status"] == "temporarily_overloaded"
    events = _security_events(capsys)
    assert all(event["event_type"] not in {"rate_limited", "repeat_blocked"} for event in events)


def test_ops_token_404_is_not_invalid_token(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DMT_OPS_TOKEN", "unit-test-ops-token")
    response = TestClient(app).get("/ops/custom-polygon")

    assert response.status_code == 404
    events = _security_events(capsys)
    assert all(event["event_type"] != "invalid_token" for event in events)
