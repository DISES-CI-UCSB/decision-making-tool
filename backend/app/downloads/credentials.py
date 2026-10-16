from __future__ import annotations

import json
import os
from pathlib import Path

from .errors import BrokerError


def load_service_account_info(*, json_env: str, file_env: str) -> dict[str, object]:
    """Load a service-account key. Error text names the env var and never the key."""
    raw = os.getenv(json_env)
    if raw and raw.strip():
        return _parse_service_account_json(raw, source_name=json_env)
    file_value = os.getenv(file_env)
    if not file_value or not file_value.strip():
        raise BrokerError(
            503,
            "broker_not_configured",
            "The Blob URL Signing Service is not configured.",
        )
    try:
        raw_file = Path(file_value).read_text(encoding="utf-8")
    except OSError:
        raise BrokerError(
            503,
            "broker_not_configured",
            "The Blob URL Signing Service is not configured.",
        ) from None
    return _parse_service_account_json(raw_file, source_name=file_env)


def _parse_service_account_json(raw: str, *, source_name: str) -> dict[str, object]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise BrokerError(
            503,
            "broker_not_configured",
            f"{source_name} is not valid JSON.",
        ) from None
    if (
        not isinstance(data, dict)
        or not isinstance(data.get("private_key"), str)
        or not isinstance(data.get("client_email"), str)
    ):
        raise BrokerError(
            503,
            "broker_not_configured",
            f"{source_name} is not a service account key.",
        )
    return data
