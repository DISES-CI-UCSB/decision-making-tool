from __future__ import annotations

from fastapi import APIRouter, Header, Request, Response
from pydantic import BaseModel

from ..downloads.credentials import load_service_account_info
from ..downloads.errors import BrokerError
from ..downloads.router import _credential_file_identity, _fingerprint, _http_error, read_bearer
from ..downloads.settings import DownloadSettings, get_download_settings
from ..downloads.users import FirestoreUserDirectory
from ..downloads.verifier import FirebaseIdTokenVerifier
from ..security_log import (
    EVENT_AUTHENTICATOR_RESET,
    EVENT_AUTHENTICATOR_RESET_REFUSED,
    client_ip_from_request,
    emit_security_event,
)
from .authenticator_reset import AuthenticatorReset, ResetRefused
from .second_factors import IdentityToolkitSecondFactorAdmin

router = APIRouter()

_test_reset: AuthenticatorReset | None = None
_test_reset_installed = False
_live_reset: AuthenticatorReset | None = None
_live_key: tuple[object, ...] | None = None


class AuthenticatorResetResponse(BaseModel):
    uid: str
    removed_second_factor_count: int
    sessions_ended: bool = True


def install_test_authenticator_reset(reset: AuthenticatorReset | None) -> None:
    """Tests inject the reset service. None stands for an unconfigured service."""
    global _test_reset, _test_reset_installed
    _test_reset = reset
    _test_reset_installed = True


def reset_test_authenticator_reset() -> None:
    global _test_reset, _test_reset_installed, _live_reset, _live_key
    _test_reset = None
    _test_reset_installed = False
    _live_reset = None
    _live_key = None


def resolve_authenticator_reset() -> AuthenticatorReset:
    if _test_reset_installed:
        if _test_reset is None:
            raise _not_configured()
        return _test_reset
    return _live_authenticator_reset()


def _live_authenticator_reset() -> AuthenticatorReset:
    global _live_reset, _live_key
    settings = get_download_settings()
    key = _settings_key(settings)
    if _live_reset is not None and _live_key == key:
        return _live_reset
    if not (settings.firebase_service_account_json or settings.firebase_service_account_file):
        raise _not_configured()
    service_account = load_service_account_info(
        json_env="FIREBASE_SERVICE_ACCOUNT_JSON",
        file_env="DMT_FIREBASE_SERVICE_ACCOUNT_FILE",
    )
    project_id = settings.firebase_project_id
    _live_reset = AuthenticatorReset(
        verifier=FirebaseIdTokenVerifier(project_id, service_account),
        users=FirestoreUserDirectory(project_id, service_account),
        second_factors=IdentityToolkitSecondFactorAdmin(project_id, service_account),
    )
    _live_key = key
    return _live_reset


@router.post(
    "/admin/users/{uid}/reset-authenticator",
    response_model=AuthenticatorResetResponse,
)
def reset_authenticator(
    uid: str,
    request: Request,
    response: Response,
    authorization: str | None = Header(default=None),
) -> AuthenticatorResetResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        result = resolve_authenticator_reset().reset(read_bearer(authorization), uid)
    except ResetRefused as exc:
        _log(request, EVENT_AUTHENTICATOR_RESET_REFUSED, exc.status_code, exc.actor_uid, exc.code)
        raise _http_error(exc) from None
    except BrokerError as exc:
        raise _http_error(exc) from None
    _log(request, EVENT_AUTHENTICATOR_RESET, 200, result.actor_uid, None)
    return AuthenticatorResetResponse(
        uid=result.target_uid,
        removed_second_factor_count=result.removed_second_factor_count,
    )


def _log(request: Request, event_type: str, status_code: int, actor_uid: str, reason: str | None) -> None:
    emit_security_event(
        event_type=event_type,
        resource=request.url.path,
        status_code=status_code,
        client_ip=client_ip_from_request(request),
        actor_uid=actor_uid,
        reason=reason,
    )


def _not_configured() -> BrokerError:
    return BrokerError(
        503,
        "admin_not_configured",
        "Account administration is not configured.",
    )


def _settings_key(settings: DownloadSettings) -> tuple[object, ...]:
    return (
        settings.firebase_project_id,
        _fingerprint(settings.firebase_service_account_json),
        _credential_file_identity(settings.firebase_service_account_file),
    )
