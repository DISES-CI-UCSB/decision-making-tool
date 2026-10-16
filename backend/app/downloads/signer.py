from __future__ import annotations

import logging
from datetime import timedelta
from typing import Protocol

from .errors import BrokerError

LOGGER = logging.getLogger(__name__)


class ObjectSigner(Protocol):
    def sign(self, object_name: str, ttl_seconds: int, now: float) -> tuple[str, float]: ...


class GcsV4Signer:
    """Mint a V4 signed GET URL with the bucket project's service account."""

    def __init__(self, bucket_name: str, service_account_info: dict[str, object]) -> None:
        self._bucket_name = bucket_name
        self._service_account_info = service_account_info
        self._client: object | None = None
        self._credentials: object | None = None

    def sign(self, object_name: str, ttl_seconds: int, now: float) -> tuple[str, float]:
        client, credentials = self._client_or_raise()
        blob = client.bucket(self._bucket_name).blob(object_name)
        try:
            url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(seconds=ttl_seconds),
                method="GET",
                credentials=credentials,
            )
        except Exception:
            LOGGER.warning("GCS signed URL generation failed")
            raise BrokerError(
                503,
                "signing_failed",
                "A signed URL could not be issued.",
            ) from None
        if not isinstance(url, str) or not url:
            raise BrokerError(503, "signing_failed", "A signed URL could not be issued.")
        return url, now + ttl_seconds

    def _client_or_raise(self):
        if self._client is not None and self._credentials is not None:
            return self._client, self._credentials
        try:
            from google.cloud import storage
            from google.oauth2 import service_account
        except ImportError as exc:
            raise BrokerError(
                503,
                "broker_not_configured",
                "The Blob URL Signing Service is not configured.",
            ) from exc
        project_id = self._service_account_info.get("project_id")
        credentials = service_account.Credentials.from_service_account_info(
            self._service_account_info
        )
        self._credentials = credentials
        self._client = storage.Client(
            credentials=credentials,
            project=project_id if isinstance(project_id, str) else None,
        )
        return self._client, self._credentials
