from __future__ import annotations

from threading import Lock

from ..downloads.errors import BrokerError


class FirestoreAuthenticatorSetupRecords:
    """Forget when a person set up their authenticator, on users/{uid}.mfaEnrolledAt.

    The sign-in dialog reads a saved setup time with no authenticator as an email
    scanner having removed it, so a deliberate reset must clear that time first.
    """

    def __init__(self, project_id: str, service_account_info: dict[str, object]) -> None:
        self._project_id = project_id
        self._service_account_info = service_account_info
        self._client: object | None = None
        self._client_lock = Lock()

    def forget_setup(self, uid: str) -> None:
        try:
            from google.api_core.exceptions import NotFound
            from google.cloud import firestore

            user = self._client_or_raise().collection("users").document(uid)
            try:
                user.update({"mfaEnrolledAt": firestore.DELETE_FIELD})
            except NotFound:
                return
        except BrokerError:
            raise
        except Exception:
            raise BrokerError(
                503,
                "account_update_failed",
                "The account record could not be updated. Try again.",
            ) from None

    def _client_or_raise(self):
        with self._client_lock:
            if self._client is not None:
                return self._client
            try:
                from google.cloud import firestore
                from google.oauth2 import service_account

                credentials = service_account.Credentials.from_service_account_info(
                    self._service_account_info
                )
                self._client = firestore.Client(project=self._project_id, credentials=credentials)
            except Exception:
                raise BrokerError(
                    503,
                    "admin_not_configured",
                    "Account administration is not configured.",
                ) from None
            return self._client
