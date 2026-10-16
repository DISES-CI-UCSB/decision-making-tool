from __future__ import annotations

import hashlib
import time
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Response

from .broker import DownloadBroker, SignedDownload
from .catalog import FileObjectCatalog
from .credentials import load_service_account_info
from .errors import BrokerError
from .models import SignedUrlRequest, SignedUrlResponse
from .settings import DownloadSettings, get_download_settings
from .signer import GcsV4Signer
from .users import FirestoreUserDirectory
from .verifier import FirebaseIdTokenVerifier

router = APIRouter()

_test_broker: DownloadBroker | None = None
_test_broker_installed = False
_live_broker: DownloadBroker | None = None
_live_key: tuple[object, ...] | None = None


def install_test_broker(broker: DownloadBroker | None) -> None:
    """Tests inject a broker. None stands for an unconfigured broker."""
    global _test_broker, _test_broker_installed
    _test_broker = broker
    _test_broker_installed = True


def reset_test_broker() -> None:
    global _test_broker, _test_broker_installed, _live_broker, _live_key
    _test_broker = None
    _test_broker_installed = False
    _live_broker = None
    _live_key = None


def resolve_broker(clock=time.time) -> DownloadBroker:
    if _test_broker_installed:
        if _test_broker is None:
            raise BrokerError(
                503,
                "broker_not_configured",
                "The Blob URL Signing Service is not configured.",
            )
        return _test_broker
    return live_broker(clock)


def live_broker(clock=time.time) -> DownloadBroker:
    global _live_broker, _live_key
    settings = get_download_settings()
    key = _settings_key(settings)
    if _live_broker is not None and _live_key == key:
        return _live_broker
    broker = build_live_broker(settings, clock)
    _live_broker = broker
    _live_key = key
    return broker


def build_live_broker(settings: DownloadSettings, clock=time.time) -> DownloadBroker:
    if not settings.credentials_configured() or not settings.catalog_path:
        raise BrokerError(
            503,
            "broker_not_configured",
            "The Blob URL Signing Service is not configured.",
        )
    catalog = FileObjectCatalog(Path(settings.catalog_path))
    if not catalog.available():
        raise BrokerError(
            503,
            "broker_not_configured",
            "The download catalog is not available.",
        )
    return DownloadBroker(
        verifier=FirebaseIdTokenVerifier(settings.firebase_project_id),
        users=FirestoreUserDirectory(
            settings.firebase_project_id,
            load_service_account_info(
                json_env="FIREBASE_SERVICE_ACCOUNT_JSON",
                file_env="DMT_FIREBASE_SERVICE_ACCOUNT_FILE",
            ),
        ),
        catalog=catalog,
        signer=GcsV4Signer(
            settings.gcs_bucket,
            load_service_account_info(
                json_env="DMT_GCS_SERVICE_ACCOUNT_JSON",
                file_env="DMT_GCS_SERVICE_ACCOUNT_FILE",
            ),
        ),
        bucket_name=settings.gcs_bucket,
        clock=clock,
        signed_url_ttl_seconds=settings.signed_url_ttl_seconds,
        url_cache_ttl_seconds=settings.url_cache_ttl_seconds,
        auth_cache_ttl_seconds=settings.auth_cache_ttl_seconds,
        access_allow_ttl_seconds=settings.access_allow_ttl_seconds,
        access_deny_ttl_seconds=settings.access_deny_ttl_seconds,
    )


def read_bearer(authorization: str | None) -> str:
    if not authorization:
        raise BrokerError(401, "invalid_token", "A Firebase ID token is required.")
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        raise BrokerError(401, "invalid_token", "A Firebase ID token is required.")
    return value.strip()


@router.post("/downloads/signed-url", response_model=SignedUrlResponse)
def signed_url(
    body: SignedUrlRequest,
    response: Response,
    authorization: str | None = Header(default=None),
) -> SignedUrlResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        signed = resolve_broker().issue(read_bearer(authorization), body.object_name)
    except BrokerError as exc:
        raise _http_error(exc) from None
    return _response(signed)


def _response(signed: SignedDownload) -> SignedUrlResponse:
    return SignedUrlResponse(
        url=signed.url,
        expires_at=signed.expires_at,
        object_name=signed.object_name,
        method="GET",
    )


def _http_error(exc: BrokerError) -> HTTPException:
    headers = {"Retry-After": "10"} if exc.status_code == 503 else None
    return HTTPException(
        status_code=exc.status_code,
        detail={"status": exc.code, "message": exc.message},
        headers=headers,
    )


def _settings_key(settings: DownloadSettings) -> tuple[object, ...]:
    return (
        settings.firebase_project_id,
        settings.gcs_bucket,
        settings.catalog_path,
        _fingerprint(settings.firebase_service_account_json),
        _credential_file_identity(settings.firebase_service_account_file),
        _fingerprint(settings.gcs_service_account_json),
        _credential_file_identity(settings.gcs_service_account_file),
        settings.signed_url_ttl_seconds,
        settings.url_cache_ttl_seconds,
        settings.auth_cache_ttl_seconds,
        settings.access_allow_ttl_seconds,
        settings.access_deny_ttl_seconds,
    )


def _credential_file_identity(path: str | None) -> tuple[str | None, int | None, int | None]:
    """Path, mtime_ns, and size. A missing file keeps the path and no stat.

    File bytes are not read, so a rotated key is picked up without logging it.
    """
    if not path:
        return (None, None, None)
    file_path = Path(path)
    try:
        if not file_path.is_file():
            return (path, None, None)
        stat_result = file_path.stat()
    except OSError:
        return (path, None, None)
    return (path, stat_result.st_mtime_ns, stat_result.st_size)


def _fingerprint(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
