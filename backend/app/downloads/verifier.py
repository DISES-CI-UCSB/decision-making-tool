from __future__ import annotations

import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Protocol

from .errors import BrokerError


@dataclass(frozen=True)
class VerifiedIdentity:
    uid: str
    expires_at: float
    totp: bool


class TokenVerifier(Protocol):
    def verify(self, token: str) -> VerifiedIdentity: ...


def issuer_matches(project_id: str, iss: object) -> bool:
    """True when iss is the Firebase securetoken issuer for this project."""
    return iss == f"https://securetoken.google.com/{project_id}"


def subject_uid(claims: dict[str, object]) -> str | None:
    """Firebase subject. A custom uid claim is not the account id."""
    uid = claims.get("sub")
    if not isinstance(uid, str) or not uid or "/" in uid or len(uid) > 128:
        return None
    return uid


class FirebaseIdTokenVerifier:
    """Verify a Firebase ID token and that its session and account are still live.

    Google's public certificates prove the signature. A Firebase Auth lookup
    then refuses a token issued before its sessions were ended (for example,
    when an administrator removes 2-step verification) or one whose account
    is disabled.
    """

    def __init__(self, project_id: str, service_account_info: dict[str, object]) -> None:
        self._project_id = project_id
        self._service_account_info = service_account_info
        self._firebase_app: object | None = None
        self._firebase_app_lock = Lock()

    def verify(self, token: str) -> VerifiedIdentity:
        claims = self._claims(token)
        if not issuer_matches(self._project_id, claims.get("iss")):
            raise BrokerError(
                401,
                "invalid_token",
                "The Firebase ID token is invalid.",
            )
        uid = subject_uid(claims)
        if uid is None:
            raise BrokerError(
                401,
                "invalid_token",
                "The Firebase ID token is invalid.",
            )
        expires_at = claims.get("exp")
        if not isinstance(expires_at, (int, float)):
            raise BrokerError(
                401,
                "invalid_token",
                "The Firebase ID token is invalid.",
            )
        firebase = claims.get("firebase")
        factor = None
        identifier = None
        if isinstance(firebase, dict):
            factor = firebase.get("sign_in_second_factor")
            identifier = firebase.get("second_factor_identifier")
        totp = (
            factor == "totp"
            and isinstance(identifier, str)
            and bool(identifier.strip())
        )
        return VerifiedIdentity(uid=uid, expires_at=float(expires_at), totp=totp)

    def _claims(self, token: str) -> dict[str, object]:
        try:
            from firebase_admin import auth, exceptions
        except ImportError as exc:
            raise BrokerError(
                503,
                "broker_not_configured",
                "The Blob URL Signing Service is not configured.",
            ) from exc
        try:
            claims = auth.verify_id_token(token, app=self._app(), check_revoked=True)
        except BrokerError:
            raise
        except auth.RevokedIdTokenError:
            raise BrokerError(
                401,
                "session_revoked",
                "This sign-in has ended. Sign in again.",
            ) from None
        except auth.UserDisabledError:
            raise BrokerError(
                401,
                "account_disabled",
                "This Firebase account is disabled.",
            ) from None
        except auth.CertificateFetchError:
            # Fetching Google's public certificates failed. The token itself
            # was never judged, so this is a retryable 503, not a 401.
            raise BrokerError(
                503,
                "token_certs_unavailable",
                "Google's token certificates could not be fetched. Try again.",
            ) from None
        except auth.UserNotFoundError:
            raise BrokerError(
                401,
                "invalid_token",
                "The Firebase ID token is invalid.",
            ) from None
        except auth.InvalidIdTokenError:
            raise BrokerError(
                401,
                "invalid_token",
                "The Firebase ID token is invalid.",
            ) from None
        except exceptions.FirebaseError:
            # The signature was fine but the session lookup failed. Refuse
            # without judging the token, so the client can retry.
            raise BrokerError(
                503,
                "session_check_failed",
                "The sign-in could not be checked. Try again.",
            ) from None
        except Exception:
            raise BrokerError(
                401,
                "invalid_token",
                "The Firebase ID token is invalid.",
            ) from None
        if not isinstance(claims, dict):
            raise BrokerError(
                401,
                "invalid_token",
                "The Firebase ID token is invalid.",
            )
        return claims

    def _app(self):
        """A named Firebase Admin app per verifier, so other app instances stay untouched."""
        with self._firebase_app_lock:
            if self._firebase_app is not None:
                return self._firebase_app
            try:
                import firebase_admin
                from firebase_admin import credentials

                self._firebase_app = firebase_admin.initialize_app(
                    credentials.Certificate(self._service_account_info),
                    {"projectId": self._project_id},
                    name=f"dmt-downloads-{uuid.uuid4().hex}",
                )
            except Exception:
                raise BrokerError(
                    503,
                    "broker_not_configured",
                    "The Blob URL Signing Service is not configured.",
                ) from None
            return self._firebase_app
