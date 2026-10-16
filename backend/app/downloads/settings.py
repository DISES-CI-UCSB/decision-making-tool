from __future__ import annotations

import os
from dataclasses import dataclass

from ..config import _env_int

DEFAULT_FIREBASE_PROJECT_ID = "dises-decision-making-tool"
DEFAULT_GCS_BUCKET = "pnn-priorizando-la-naturaleza"
DEFAULT_SIGNED_URL_TTL_SECONDS = 900
# Google's V4 signed URLs reject lifetimes over 7 days, so larger values clamp here.
MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60
DEFAULT_URL_CACHE_TTL_SECONDS = 600
DEFAULT_AUTH_CACHE_TTL_SECONDS = 300
DEFAULT_ACCESS_ALLOW_TTL_SECONDS = 120
DEFAULT_ACCESS_DENY_TTL_SECONDS = 15


@dataclass(frozen=True)
class DownloadSettings:
    firebase_project_id: str
    gcs_bucket: str
    catalog_path: str | None
    firebase_service_account_json: str | None
    firebase_service_account_file: str | None
    gcs_service_account_json: str | None
    gcs_service_account_file: str | None
    signed_url_ttl_seconds: int = DEFAULT_SIGNED_URL_TTL_SECONDS
    url_cache_ttl_seconds: int = DEFAULT_URL_CACHE_TTL_SECONDS
    auth_cache_ttl_seconds: int = DEFAULT_AUTH_CACHE_TTL_SECONDS
    access_allow_ttl_seconds: int = DEFAULT_ACCESS_ALLOW_TTL_SECONDS
    access_deny_ttl_seconds: int = DEFAULT_ACCESS_DENY_TTL_SECONDS

    def credentials_configured(self) -> bool:
        return bool(
            self.catalog_path
            and (self.firebase_service_account_json or self.firebase_service_account_file)
            and (self.gcs_service_account_json or self.gcs_service_account_file)
        )


def get_download_settings() -> DownloadSettings:
    access_allow_ttl_seconds = _env_int(
        "DMT_ACCESS_ALLOW_TTL_SECONDS",
        DEFAULT_ACCESS_ALLOW_TTL_SECONDS,
        minimum=0,
    )
    access_deny_ttl_seconds = _env_int(
        "DMT_ACCESS_DENY_TTL_SECONDS",
        DEFAULT_ACCESS_DENY_TTL_SECONDS,
        minimum=0,
    )
    if access_allow_ttl_seconds > 0 and access_deny_ttl_seconds >= access_allow_ttl_seconds:
        access_deny_ttl_seconds = max(access_allow_ttl_seconds - 1, 0)
    return DownloadSettings(
        firebase_project_id=os.getenv("DMT_FIREBASE_PROJECT_ID", DEFAULT_FIREBASE_PROJECT_ID),
        gcs_bucket=os.getenv("DMT_GCS_BUCKET", DEFAULT_GCS_BUCKET),
        catalog_path=os.getenv("DMT_DOWNLOAD_CATALOG_PATH") or None,
        firebase_service_account_json=os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or None,
        firebase_service_account_file=os.getenv("DMT_FIREBASE_SERVICE_ACCOUNT_FILE") or None,
        gcs_service_account_json=os.getenv("DMT_GCS_SERVICE_ACCOUNT_JSON") or None,
        gcs_service_account_file=os.getenv("DMT_GCS_SERVICE_ACCOUNT_FILE") or None,
        signed_url_ttl_seconds=min(
            _env_int(
                "DMT_GCS_SIGNED_URL_TTL_SECONDS",
                DEFAULT_SIGNED_URL_TTL_SECONDS,
                minimum=60,
            ),
            MAX_SIGNED_URL_TTL_SECONDS,
        ),
        url_cache_ttl_seconds=_env_int(
            "DMT_GCS_URL_CACHE_TTL_SECONDS",
            DEFAULT_URL_CACHE_TTL_SECONDS,
            minimum=0,
        ),
        auth_cache_ttl_seconds=_env_int(
            "DMT_AUTH_CACHE_TTL_SECONDS",
            DEFAULT_AUTH_CACHE_TTL_SECONDS,
            minimum=0,
        ),
        access_allow_ttl_seconds=access_allow_ttl_seconds,
        access_deny_ttl_seconds=access_deny_ttl_seconds,
    )
