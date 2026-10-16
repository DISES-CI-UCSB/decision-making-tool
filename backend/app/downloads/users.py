from __future__ import annotations

from typing import Protocol

from .access import DownloadPrincipal, principal_from_user_document
from .errors import BrokerError


class UserDirectory(Protocol):
    def get_user(self, uid: str) -> DownloadPrincipal | None: ...


class FirestoreUserDirectory:
    """Read users/{uid} with the Firebase project's service account."""

    def __init__(self, project_id: str, service_account_info: dict[str, object]) -> None:
        self._project_id = project_id
        self._service_account_info = service_account_info
        self._client: object | None = None

    def get_user(self, uid: str) -> DownloadPrincipal | None:
        try:
            snapshot = self._client_or_raise().collection("users").document(uid).get()
        except BrokerError:
            raise
        except Exception:
            raise BrokerError(
                503,
                "account_lookup_failed",
                "The account record could not be read.",
            ) from None
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        if not isinstance(data, dict):
            return None
        return principal_from_user_document(uid, data)

    def _client_or_raise(self):
        if self._client is not None:
            return self._client
        try:
            from google.cloud import firestore
            from google.oauth2 import service_account
        except ImportError as exc:
            raise BrokerError(
                503,
                "broker_not_configured",
                "The Blob URL Signing Service is not configured.",
            ) from exc
        credentials = service_account.Credentials.from_service_account_info(
            self._service_account_info
        )
        self._client = firestore.Client(project=self._project_id, credentials=credentials)
        return self._client
