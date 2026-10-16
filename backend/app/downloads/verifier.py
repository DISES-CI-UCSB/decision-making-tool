from __future__ import annotations

from dataclasses import dataclass
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
    """Verify a Firebase ID token with Google's public certificates."""

    def __init__(self, project_id: str) -> None:
        self._project_id = project_id

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
            from google.auth.exceptions import TransportError
            from google.auth.transport import requests as google_requests
            from google.oauth2 import id_token
        except ImportError as exc:
            raise BrokerError(
                503,
                "broker_not_configured",
                "The Blob URL Signing Service is not configured.",
            ) from exc
        try:
            claims = id_token.verify_firebase_token(
                token,
                google_requests.Request(),
                audience=self._project_id,
            )
        except TransportError:
            # Fetching Google's public certificates failed. The token itself
            # was never judged, so this is a retryable 503, not a 401.
            raise BrokerError(
                503,
                "token_certs_unavailable",
                "Google's token certificates could not be fetched. Try again.",
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
