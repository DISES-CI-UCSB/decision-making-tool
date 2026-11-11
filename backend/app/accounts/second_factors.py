from __future__ import annotations

import time
from threading import Lock
from typing import Callable

from ..downloads.errors import BrokerError

_IDENTITY_TOOLKIT_URL = "https://identitytoolkit.googleapis.com/v1/projects/{project_id}/{method}"
_SCOPES = ("https://www.googleapis.com/auth/cloud-platform",)
_TIMEOUT_SECONDS = 15


class IdentityToolkitSecondFactorAdmin:
    """Read and remove second factors with the Firebase project's service account.

    The Python Admin SDK cannot read or change second factors, so this calls the
    Identity Toolkit admin endpoints the Node Admin SDK uses for
    `updateUser(uid, { multiFactor: { enrolledFactors: null } })`.
    """

    def __init__(
        self,
        project_id: str,
        service_account_info: dict[str, object],
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._project_id = project_id
        self._service_account_info = service_account_info
        self._clock = clock
        self._session: object | None = None
        self._session_lock = Lock()

    def enrolled_second_factor_count(self, uid: str) -> int | None:
        body = self._call("accounts:lookup", {"localId": [uid]})
        users = body.get("users")
        if not isinstance(users, list) or not users or not isinstance(users[0], dict):
            return None
        enrolled = users[0].get("mfaInfo")
        return len(enrolled) if isinstance(enrolled, list) else 0

    def remove_second_factors_and_end_sessions(self, uid: str) -> None:
        # An empty mfa object removes every second factor. validSince refuses every
        # token issued before now, as firebase_admin.auth.revoke_refresh_tokens does.
        self._call(
            "accounts:update",
            {"localId": uid, "mfa": {}, "validSince": str(int(self._clock()))},
        )

    def _call(self, method: str, payload: dict[str, object]) -> dict[str, object]:
        url = _IDENTITY_TOOLKIT_URL.format(project_id=self._project_id, method=method)
        try:
            response = self._authorized_session().post(url, json=payload, timeout=_TIMEOUT_SECONDS)
            body = response.json() if response.status_code == 200 else None
        except BrokerError:
            raise
        except Exception:
            body = None
        if not isinstance(body, dict):
            raise BrokerError(
                503,
                "account_update_failed",
                "Firebase Authentication could not be reached. Try again.",
            )
        return body

    def _authorized_session(self):
        with self._session_lock:
            if self._session is not None:
                return self._session
            try:
                from google.auth.transport.requests import AuthorizedSession
                from google.oauth2 import service_account

                credentials = service_account.Credentials.from_service_account_info(
                    self._service_account_info,
                    scopes=_SCOPES,
                )
                self._session = AuthorizedSession(credentials)
            except Exception:
                raise BrokerError(
                    503,
                    "admin_not_configured",
                    "Account administration is not configured.",
                ) from None
            return self._session
