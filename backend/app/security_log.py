from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import Request

EVENT_INVALID_TOKEN = "invalid_token"
EVENT_UNAUTHORIZED_CANCEL = "unauthorized_cancel"
EVENT_OVERSIZED_POLYGON = "oversized_polygon"
EVENT_RATE_LIMITED = "rate_limited"
EVENT_REPEAT_BLOCKED = "repeat_blocked"

JOB_CANCEL_PATH_PREFIX = "/area-profile/custom-polygon/species-coverage/jobs/"
_OVERSIZED_POLYGON_PREFIXES = (
    "too_many_vertices:",
    "area_exceeds_national_territory:",
)


def is_oversized_polygon_error(exc: BaseException) -> bool:
    return str(exc).startswith(_OVERSIZED_POLYGON_PREFIXES)


def utc_timestamp() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def client_ip_from_request(request: Request | None) -> str:
    if request is None or request.client is None:
        return "unknown"
    return request.client.host


def emit_security_event(
    *,
    event_type: str,
    resource: str,
    status_code: int,
    client_ip: str,
    timestamp: str | None = None,
) -> None:
    payload = {
        "timestamp": timestamp or utc_timestamp(),
        "client_ip": client_ip,
        "event_type": event_type,
        "resource": resource,
        "status_code": int(status_code),
    }
    print(json.dumps(payload), flush=True)


def emit_from_request(request: Request, event_type: str, status_code: int) -> None:
    emit_security_event(
        event_type=event_type,
        resource=request.url.path,
        status_code=status_code,
        client_ip=client_ip_from_request(request),
    )


def log_unauthorized_cancel(request: Request) -> None:
    emit_from_request(request, EVENT_UNAUTHORIZED_CANCEL, 403)


def is_job_cancel_path(path: str) -> bool:
    if not path.startswith(JOB_CANCEL_PATH_PREFIX):
        return False
    job_id = path[len(JOB_CANCEL_PATH_PREFIX) :].strip("/")
    return bool(job_id) and "/" not in job_id


def maybe_log_http_exception(request: Request, status_code: int) -> None:
    if status_code == 401:
        emit_from_request(request, EVENT_INVALID_TOKEN, 401)
        return
    if status_code == 403 and is_job_cancel_path(request.url.path):
        log_unauthorized_cancel(request)
