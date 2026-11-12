from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from .errors import BrokerError

LOGGER = logging.getLogger(__name__)


def load_service_account_info(*, json_env: str, file_env: str) -> dict[str, object]:
    """Load a service-account key. A mounted key file wins over inline JSON.

    Error and log text names the env var and never the key.
    """
    file_value = os.getenv(file_env)
    if file_value and file_value.strip():
        try:
            raw_file = Path(file_value.strip()).read_text(encoding="utf-8")
        except OSError:
            raise _not_configured() from None
        return _parse_service_account_json(raw_file, source_name=file_env)
    raw = os.getenv(json_env)
    if raw and raw.strip():
        LOGGER.warning(
            "%s holds an inline key. Mount the key read-only and set %s instead.",
            json_env,
            file_env,
        )
        return _parse_service_account_json(raw, source_name=json_env)
    raise _not_configured()


def _not_configured() -> BrokerError:
    return BrokerError(
        503,
        "broker_not_configured",
        "The Blob URL Signing Service is not configured.",
    )


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
