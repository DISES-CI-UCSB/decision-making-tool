from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.downloads.access import (
    CONFLICTING_SIRAP,
    DownloadPrincipal,
    accessible_sirap_ids,
    can_access_object,
    principal_from_user_document,
    read_app_role,
)
from app.downloads.broker import DownloadBroker, SignedDownload, _hashed_cache_key
from app.downloads.catalog import FileObjectCatalog, MemoryObjectCatalog, index_catalog_document
from app.downloads.credentials import load_service_account_info
from app.downloads.errors import BrokerError
from app.downloads.object_names import object_name_from_reference
from app.downloads.router import (
    _credential_file_identity,
    _settings_key,
    install_test_broker,
    reset_test_broker,
    router,
)
from app.downloads.settings import DownloadSettings, get_download_settings
from app.downloads.verifier import VerifiedIdentity, issuer_matches, subject_uid
from app.security_log import maybe_log_http_exception

NATIONAL = "releases/catalog-v3-7-0/solutions/land/example.tif"
ORINOQUIA = "releases/sirap-2026-09-09-v7/orinoquia/example.tif"
EJE = "releases/sirap-2026-09-09-v7/eje/example.tif"


@dataclass
class Clock:
    now: float = 1_700_000_000.0

    def __call__(self) -> float:
        return self.now


@dataclass
class FakeVerifier:
    identities: dict[str, VerifiedIdentity]
    calls: list[str] = field(default_factory=list)

    def verify(self, token: str) -> VerifiedIdentity:
        self.calls.append(token)
        identity = self.identities.get(token)
        if identity is None:
            raise BrokerError(401, "invalid_token", "The Firebase ID token is invalid.")
        return identity


@dataclass
class FakeUsers:
    records: dict[str, DownloadPrincipal | None]
    calls: list[str] = field(default_factory=list)

    def get_user(self, uid: str) -> DownloadPrincipal | None:
        self.calls.append(uid)
        return self.records.get(uid)


@dataclass
class FakeSigner:
    calls: list[str] = field(default_factory=list)

    def sign(self, object_name: str, ttl_seconds: int, now: float) -> tuple[str, float]:
        self.calls.append(object_name)
        return f"https://signed.example/{len(self.calls)}/{object_name}", now + ttl_seconds


@pytest.fixture(autouse=True)
def _isolated_broker():
    reset_test_broker()
    yield
    reset_test_broker()


def _identity(uid: str, *, totp: bool, expires_at: float = 1_700_003_600.0) -> VerifiedIdentity:
    return VerifiedIdentity(uid=uid, expires_at=expires_at, totp=totp)


def _principal(
    uid: str,
    *,
    role: str = "user",
    status: str = "active",
    allowed: tuple[str, ...] = (),
) -> DownloadPrincipal:
    return DownloadPrincipal(uid=uid, status=status, role=role, allowed_sirap_ids=allowed)


def _broker(
    *,
    clock: Clock | None = None,
    verifier: FakeVerifier | None = None,
    users: FakeUsers | None = None,
    signer: FakeSigner | None = None,
    objects: dict[str, str | None] | None = None,
    auth_ttl: int = 300,
    allow_ttl: int = 120,
    deny_ttl: int = 15,
    url_ttl: int = 600,
) -> tuple[DownloadBroker, FakeVerifier, FakeUsers, FakeSigner, Clock]:
    clock = clock or Clock()
    verifier = verifier or FakeVerifier(
        {
            "national-token": _identity("national-user", totp=False),
            "orinoquia-token": _identity("orinoquia-user", totp=True),
            "admin-token": _identity("admin-user", totp=True),
            "plain-token": _identity("plain-user", totp=False),
        }
    )
    users = users or FakeUsers(
        {
            "national-user": _principal("national-user"),
            "orinoquia-user": _principal(
                "orinoquia-user",
                role="sirap-user",
                allowed=("orinoquia",),
            ),
            "admin-user": _principal("admin-user", role="super-admin"),
            "plain-user": _principal("plain-user"),
        }
    )
    signer = signer or FakeSigner()
    catalog = MemoryObjectCatalog(
        objects
        if objects is not None
        else {NATIONAL: None, ORINOQUIA: "orinoquia", EJE: "eje-cafetero"}
    )
    broker = DownloadBroker(
        verifier=verifier,
        users=users,
        catalog=catalog,
        signer=signer,
        bucket_name="pnn-priorizando-la-naturaleza",
        clock=clock,
        signed_url_ttl_seconds=900,
        url_cache_ttl_seconds=url_ttl,
        auth_cache_ttl_seconds=auth_ttl,
        access_allow_ttl_seconds=allow_ttl,
        access_deny_ttl_seconds=deny_ttl,
    )
    return broker, verifier, users, signer, clock


def _api() -> FastAPI:
    """Router host that does not import the raster metrics app."""
    application = FastAPI()

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    application.include_router(router)
    return application


def _client_for(broker: DownloadBroker | None) -> TestClient:
    install_test_broker(broker)
    return TestClient(_api())


def _http_request(path: str, *, method: str = "GET"):
    from starlette.requests import Request

    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": [],
            "client": ("203.0.113.10", 12345),
            "server": ("testserver", 80),
        }
    )


def _security_events(capsys: pytest.CaptureFixture[str]) -> list[dict]:
    events: list[dict] = []
    for line in capsys.readouterr().out.splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and "event_type" in payload:
            events.append(payload)
    return events


def _post(client: TestClient, token: str | None, object_name: str):
    headers = {}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return client.post(
        "/downloads/signed-url",
        headers=headers,
        json={"object_name": object_name},
    )


def test_read_app_role_matches_frontend_fallbacks() -> None:
    assert read_app_role("sirap-admin") == "sirap-admin"
    assert read_app_role("admin") == "super-admin"
    assert read_app_role(None, legacy_is_admin=True) == "super-admin"
    assert read_app_role(None, administered_sirap_ids=("orinoquia",)) == "sirap-admin"
    assert read_app_role(None, allowed_sirap_ids=("orinoquia",)) == "sirap-user"
    assert read_app_role("user", allowed_sirap_ids=("orinoquia",)) == "user"
    assert read_app_role("user", legacy_is_admin=True) == "user"
    assert read_app_role(None) == "user"


def test_super_admin_grant_ignores_an_empty_allowed_list() -> None:
    principal = principal_from_user_document(
        "admin",
        {"status": "active", "isSuperAdmin": True, "allowedSirapIds": []},
    )

    assert principal.role == "super-admin"
    assert accessible_sirap_ids(principal) == ("eje-cafetero", "orinoquia")
    assert can_access_object(principal, "orinoquia")
    assert not can_access_object(principal, "caribe")
    assert not can_access_object(principal, CONFLICTING_SIRAP)


def test_manifest_index_keeps_national_and_sirap_objects_apart() -> None:
    index = index_catalog_document(
        {
            "layers": [
                {
                    "id": "ecosystems",
                    "sirapId": None,
                    "displayUrl": "https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/ecosystems/ecosistemas.tif",
                    "displayCogUrl": "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/view-layer-display-cogs-v2/ecosistemas.cog.tif?download=1",
                },
                {
                    "id": "orinoquia_birds",
                    "sirapId": "orinoquia",
                    "displayUrl": "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/sirap/birds.tif",
                },
            ],
            "solutions": [
                {
                    "id": "land-1",
                    "scope": "land",
                    "sirapId": "orinoquia",
                    "blobPath": "releases/catalog-v3-7-0/solutions/land/example.tif",
                    "displayUrl": "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/catalog-v3-7-0/solutions/land/example.tif",
                },
                {
                    "id": "sirap-1",
                    "scope": "sirap",
                    "sirapId": "eje-cafetero",
                    "blobPath": "releases/sirap/eje.tif",
                    "displayUrl": "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/sirap/eje.tif",
                    "precomputedMetricUrls": {
                        "area": "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/sirap/eje-area.json"
                    },
                },
                {
                    "id": "sirap-missing",
                    "scope": "sirap",
                    "displayUrl": "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/sirap/missing.tif",
                },
            ],
        }
    )

    assert index["inputs/features/ecosystems/ecosistemas.tif"] is None
    assert index["releases/view-layer-display-cogs-v2/ecosistemas.cog.tif"] is None
    assert index["releases/sirap/birds.tif"] == "orinoquia"
    assert index["releases/catalog-v3-7-0/solutions/land/example.tif"] is None
    assert index["releases/sirap/eje.tif"] == "eje-cafetero"
    assert index["releases/sirap/eje-area.json"] == "eje-cafetero"
    assert index["releases/sirap/missing.tif"] == CONFLICTING_SIRAP


def test_restricted_catalog_row_wins_over_a_national_row() -> None:
    index = index_catalog_document(
        {
            "objects": {
                "releases/shared.tif": {"sirap_id": None},
            },
            "layers": [
                {
                    "sirapId": "orinoquia",
                    "displayUrl": "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/shared.tif",
                }
            ],
        }
    )

    assert index["releases/shared.tif"] == "orinoquia"


def test_national_download_allows_an_active_user_without_totp() -> None:
    broker, _verifier, _users, signer, _clock = _broker()
    client = _client_for(broker)

    response = _post(client, "national-token", NATIONAL)

    assert response.status_code == 200
    body = response.json()
    assert body["object_name"] == NATIONAL
    assert body["method"] == "GET"
    assert body["url"].startswith("https://signed.example/")
    assert body["expires_at"].endswith("Z")
    assert response.headers["cache-control"] == "no-store"
    assert signer.calls == [NATIONAL]


def test_sirap_download_requires_totp_and_the_region_grant() -> None:
    broker, _verifier, _users, signer, _clock = _broker()
    client = _client_for(broker)

    missing_totp = _post(client, "plain-token", ORINOQUIA)
    wrong_region = _post(client, "orinoquia-token", EJE)
    allowed = _post(client, "orinoquia-token", ORINOQUIA)

    assert missing_totp.status_code == 403
    assert missing_totp.json()["detail"]["status"] == "mfa_required"
    assert wrong_region.json()["detail"]["status"] == "layer_forbidden"
    assert allowed.status_code == 200
    assert signer.calls == [ORINOQUIA]


def test_super_admin_can_download_both_access_regions() -> None:
    broker, _verifier, _users, signer, _clock = _broker()
    client = _client_for(broker)

    assert _post(client, "admin-token", ORINOQUIA).status_code == 200
    assert _post(client, "admin-token", EJE).status_code == 200
    assert signer.calls == [ORINOQUIA, EJE]


def test_inactive_and_unknown_accounts_are_forbidden() -> None:
    broker, verifier, users, _signer, _clock = _broker()
    users.records["national-user"] = _principal("national-user", status="denied")
    verifier.identities["missing-token"] = _identity("missing-user", totp=True)
    client = _client_for(broker)

    denied = _post(client, "national-token", NATIONAL)
    missing = _post(client, "missing-token", NATIONAL)

    assert denied.status_code == 403
    assert denied.json()["detail"]["status"] == "account_inactive"
    assert missing.status_code == 403
    assert missing.json()["detail"]["status"] == "account_inactive"


def test_unknown_object_and_bad_object_name() -> None:
    broker, _verifier, _users, signer, _clock = _broker()
    client = _client_for(broker)

    missing = _post(client, "national-token", "releases/not-published.tif")
    traversal = _post(client, "national-token", "../secrets.tif")

    assert missing.status_code == 404
    assert missing.json()["detail"]["status"] == "object_not_in_catalog"
    assert traversal.status_code == 422
    assert traversal.json()["detail"]["status"] == "invalid_object_name"
    assert signer.calls == []


def test_missing_or_invalid_token_is_rejected_without_a_cache_hit() -> None:
    broker, verifier, _users, _signer, _clock = _broker()
    client = _client_for(broker)

    missing = _post(client, None, NATIONAL)
    invalid = _post(client, "nope", NATIONAL)
    invalid_again = _post(client, "nope", NATIONAL)

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert invalid_again.status_code == 401
    assert invalid.json()["detail"]["status"] == "invalid_token"
    assert verifier.calls == ["nope", "nope"]


def test_signed_url_cache_is_per_user() -> None:
    broker, _verifier, _users, signer, _clock = _broker()
    client = _client_for(broker)

    first = _post(client, "admin-token", ORINOQUIA)
    second = _post(client, "admin-token", ORINOQUIA)
    other_user = _post(client, "orinoquia-token", ORINOQUIA)

    assert first.json()["url"] == second.json()["url"]
    assert other_user.json()["url"] != first.json()["url"]
    assert signer.calls == [ORINOQUIA, ORINOQUIA]


def test_allow_and_deny_decisions_expire_on_their_own_ttls() -> None:
    clock = Clock()
    users = FakeUsers(
        {
            "orinoquia-user": _principal(
                "orinoquia-user",
                role="sirap-user",
                allowed=("orinoquia",),
            )
        }
    )
    broker, _verifier, _users, _signer, _clock = _broker(
        clock=clock,
        users=users,
        auth_ttl=0,
        allow_ttl=120,
        deny_ttl=15,
    )
    client = _client_for(broker)
    catalog = broker._catalog
    assert isinstance(catalog, MemoryObjectCatalog)
    # The access key includes the grant, so a user-record edit is a new key.
    # Move the catalog SIRAP binding to watch the allow and deny clocks.
    catalog.objects[ORINOQUIA] = "eje-cafetero"

    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 403
    catalog.objects[ORINOQUIA] = "orinoquia"
    clock.now += 1
    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 403
    clock.now += 15
    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 200

    catalog.objects[ORINOQUIA] = "eje-cafetero"
    clock.now += 1
    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 200
    clock.now += 120
    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 403


def test_unconfigured_broker_returns_503_and_health_stays_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (
        "DMT_DOWNLOAD_CATALOG_PATH",
        "FIREBASE_SERVICE_ACCOUNT_JSON",
        "DMT_FIREBASE_SERVICE_ACCOUNT_FILE",
        "DMT_GCS_SERVICE_ACCOUNT_JSON",
        "DMT_GCS_SERVICE_ACCOUNT_FILE",
    ):
        monkeypatch.delenv(name, raising=False)
    reset_test_broker()
    client = TestClient(_api())

    health = client.get("/health")
    signed = client.post(
        "/downloads/signed-url",
        headers={"Authorization": "Bearer token"},
        json={"object_name": NATIONAL},
    )

    assert health.status_code == 200
    assert signed.status_code == 503
    assert signed.json()["detail"]["status"] == "broker_not_configured"
    assert signed.headers["retry-after"] == "10"


def test_credential_errors_do_not_echo_the_key(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = '{"private_key":"-----BEGIN PRIVATE KEY-----secret","client_email":1}'
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", secret)

    with pytest.raises(BrokerError) as caught:
        load_service_account_info(
            json_env="FIREBASE_SERVICE_ACCOUNT_JSON",
            file_env="DMT_FIREBASE_SERVICE_ACCOUNT_FILE",
        )

    assert "BEGIN PRIVATE KEY" not in caught.value.message
    assert "secret" not in caught.value.message


def test_download_forbidden_is_a_security_event(capsys: pytest.CaptureFixture[str]) -> None:
    maybe_log_http_exception(_http_request("/downloads/signed-url", method="POST"), 403)

    events = _security_events(capsys)
    assert len(events) == 1
    assert events[0]["event_type"] == "download_forbidden"
    assert events[0]["status_code"] == 403
    assert events[0]["resource"] == "/downloads/signed-url"


def test_metrics_app_mounts_the_download_router() -> None:
    source = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8")
    assert "from .downloads.router import router as downloads_router" in source
    assert "app.include_router(downloads_router)" in source


def test_file_catalog_reads_an_object_map(tmp_path) -> None:
    path = tmp_path / "catalog.json"
    path.write_text(
        json.dumps({"objects": {NATIONAL: {"sirap_id": None}}}),
        encoding="utf-8",
    )
    catalog = FileObjectCatalog(path)

    assert catalog.lookup(NATIONAL) is not None
    assert catalog.lookup(ORINOQUIA) is None


_BLOB = "https://aagibolq28slyfof.public.blob.vercel-storage.com"


def test_whitespace_sirap_id_is_not_national_and_padded_id_is_not_a_grant() -> None:
    blank = "releases/blank-sirap.tif"
    padded = "releases/padded-sirap.tif"
    index = index_catalog_document(
        {
            "layers": [
                {"sirapId": " ", "displayUrl": blank},
                {"sirapId": " orinoquia ", "displayUrl": padded},
            ]
        }
    )
    assert index[blank] == " "
    assert index[padded] == " orinoquia "

    broker, _verifier, _users, signer, _clock = _broker(
        objects={blank: index[blank], padded: index[padded]}
    )
    client = _client_for(broker)

    blank_response = _post(client, "orinoquia-token", blank)
    padded_response = _post(client, "orinoquia-token", padded)

    assert blank_response.status_code == 403
    assert blank_response.json()["detail"]["status"] == "layer_forbidden"
    assert padded_response.status_code == 403
    assert padded_response.json()["detail"]["status"] == "layer_forbidden"
    assert signer.calls == []


def test_objects_map_string_value_is_sirap_scoped() -> None:
    index = index_catalog_document(
        {
            "objects": {
                "releases/sirap/secret.tif": "orinoquia",
                "releases/national.tif": None,
                "releases/weird.tif": ["orinoquia"],
            }
        }
    )

    assert index["releases/sirap/secret.tif"] == "orinoquia"
    assert index["releases/national.tif"] is None
    assert index["releases/weird.tif"] == CONFLICTING_SIRAP


def test_non_gcs_https_url_is_not_indexed() -> None:
    index = index_catalog_document(
        {
            "layers": [
                {"displayUrl": "https://mapas2.igac.gov.co/releases/igac.tif"},
                {"displayUrl": f"http://{_BLOB.removeprefix('https://')}/releases/http-blob.tif"},
                {"displayUrl": "http://storage.googleapis.com/bucket/releases/http-gcs.tif"},
            ]
        }
    )

    assert index == {}
    assert object_name_from_reference("gs://any-bucket/releases/from-gs.tif") == (
        "releases/from-gs.tif"
    )


def test_blob_host_and_gcs_https_urls_are_indexed() -> None:
    index = index_catalog_document(
        {
            "layers": [
                {"displayUrl": f"{_BLOB}/releases/blob.tif"},
                {
                    "displayUrl": (
                        "https://storage.googleapis.com/pnn-priorizando-la-naturaleza/"
                        "releases/gcs.tif"
                    )
                },
                {
                    "displayUrl": (
                        "https://storage.cloud.google.com/pnn-priorizando-la-naturaleza/"
                        "releases/cloud.tif"
                    )
                },
            ]
        }
    )

    assert index["releases/blob.tif"] is None
    assert index["releases/gcs.tif"] is None
    assert index["releases/cloud.tif"] is None


def test_shared_national_metric_urls_do_not_inherit_sirap_scope() -> None:
    denominator = f"{_BLOB}/releases/shared/mec-national.json"
    index = index_catalog_document(
        {
            "solutions": [
                {
                    "id": "sirap-orinoquia",
                    "scope": "sirap",
                    "sirapId": "orinoquia",
                    "blobPath": "releases/sirap/orinoquia.tif",
                    "precomputedMetricUrls": {
                        "mecNationalDenominator": denominator,
                        "speciesGoalsCatalog": f"{_BLOB}/releases/shared/species-catalog.json",
                        "speciesGoalsTargetOverlay": f"{_BLOB}/releases/shared/species-overlay.json",
                        "goals": f"{_BLOB}/releases/sirap/orinoquia-goals.json",
                        "speciesGoalsByGeography": {
                            "national": f"{_BLOB}/releases/sirap/orinoquia-species.json"
                        },
                    },
                },
                {
                    "id": "sirap-eje",
                    "scope": "sirap",
                    "sirapId": "eje-cafetero",
                    "blobPath": "releases/sirap/eje.tif",
                    "precomputedMetricUrls": {
                        "mecNationalDenominator": denominator,
                        "goals": f"{_BLOB}/releases/sirap/eje-goals.json",
                    },
                },
            ]
        }
    )

    assert index["releases/shared/mec-national.json"] is None
    assert index["releases/shared/species-catalog.json"] is None
    assert index["releases/shared/species-overlay.json"] is None
    assert index["releases/sirap/orinoquia-goals.json"] == "orinoquia"
    assert index["releases/sirap/orinoquia-species.json"] == "orinoquia"
    assert index["releases/sirap/eje-goals.json"] == "eje-cafetero"
    assert index["releases/sirap/orinoquia.tif"] == "orinoquia"
    assert index["releases/sirap/eje.tif"] == "eje-cafetero"


def test_solution_scope_prefers_finder_inputs_and_normalizes() -> None:
    index = index_catalog_document(
        {
            "solutions": [
                {
                    "scope": "land",
                    "finderInputs": {"scope": " SIRAP "},
                    "sirapId": "orinoquia",
                    "blobPath": "releases/sirap/from-finder.tif",
                },
                {
                    "scope": "SIRAP",
                    "sirapId": "eje-cafetero",
                    "blobPath": "releases/sirap/from-scope.tif",
                },
                {
                    "scope": "sirap",
                    "finderInputs": {"scope": "land"},
                    "sirapId": "orinoquia",
                    "blobPath": "releases/land/not-sirap.tif",
                },
                {
                    "scope": "  sirap  ",
                    "sirapId": "",
                    "blobPath": "releases/sirap/blank-id.tif",
                },
            ]
        }
    )

    assert index["releases/sirap/from-finder.tif"] == "orinoquia"
    assert index["releases/sirap/from-scope.tif"] == "eje-cafetero"
    assert index["releases/land/not-sirap.tif"] is None
    assert index["releases/sirap/blank-id.tif"] == CONFLICTING_SIRAP


def test_revoked_grant_is_not_reused_when_the_user_cache_expires_first() -> None:
    clock = Clock()
    users = FakeUsers(
        {
            "orinoquia-user": _principal(
                "orinoquia-user",
                role="sirap-user",
                allowed=("orinoquia",),
            )
        }
    )
    broker, _verifier, _users, _signer, _clock = _broker(
        clock=clock,
        users=users,
        auth_ttl=60,
        allow_ttl=120,
        deny_ttl=15,
    )
    client = _client_for(broker)

    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 200
    users.records["orinoquia-user"] = _principal("orinoquia-user", role="user", allowed=())
    clock.now += 59
    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 200
    clock.now += 1
    revoked = _post(client, "orinoquia-token", ORINOQUIA)
    assert revoked.status_code == 403
    assert revoked.json()["detail"]["status"] == "layer_forbidden"


def test_deactivation_follows_the_allow_ttl_not_the_auth_ttl() -> None:
    clock = Clock()
    users = FakeUsers({"national-user": _principal("national-user")})
    broker, _verifier, _users, _signer, _clock = _broker(
        clock=clock,
        users=users,
        auth_ttl=300,
        allow_ttl=120,
        deny_ttl=15,
    )
    client = _client_for(broker)

    assert _post(client, "national-token", NATIONAL).status_code == 200
    users.records["national-user"] = _principal("national-user", status="disabled")
    clock.now += 119
    assert _post(client, "national-token", NATIONAL).status_code == 200
    clock.now += 1
    denied = _post(client, "national-token", NATIONAL)
    assert denied.status_code == 403
    assert denied.json()["detail"]["status"] == "account_inactive"


def test_revoked_grant_is_visible_when_the_allow_ttl_elapses() -> None:
    clock = Clock()
    users = FakeUsers(
        {
            "orinoquia-user": _principal(
                "orinoquia-user",
                role="sirap-user",
                allowed=("orinoquia",),
            )
        }
    )
    broker, _verifier, _users, _signer, _clock = _broker(
        clock=clock,
        users=users,
        auth_ttl=300,
        allow_ttl=120,
        deny_ttl=15,
    )
    client = _client_for(broker)

    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 200
    users.records["orinoquia-user"] = _principal("orinoquia-user", role="user", allowed=())
    clock.now += 119
    assert _post(client, "orinoquia-token", ORINOQUIA).status_code == 200
    clock.now += 1
    revoked = _post(client, "orinoquia-token", ORINOQUIA)
    assert revoked.status_code == 403
    assert revoked.json()["detail"]["status"] == "layer_forbidden"


def test_signed_url_cache_does_not_return_a_different_object_name() -> None:
    broker, _verifier, _users, signer, clock = _broker()
    bucket = "pnn-priorizando-la-naturaleza"
    wrong = SignedDownload(
        url="https://signed.example/wrong",
        expires_at="2026-01-01T00:00:00.000Z",
        expires_epoch=clock.now + 900,
        object_name=NATIONAL,
    )
    broker._cache.set(
        _hashed_cache_key("signed", "admin-user", bucket, ORINOQUIA),
        wrong,
        600,
    )

    issued = broker._signed_url("admin-user", ORINOQUIA)

    assert issued.object_name == ORINOQUIA
    assert issued.url != wrong.url
    assert signer.calls == [ORINOQUIA]

    colon_user = f"admin-user:{bucket}"
    colon_object = f"{bucket}:c"
    assert _hashed_cache_key("signed", colon_user, bucket, "c") != _hashed_cache_key(
        "signed", "admin-user", bucket, colon_object
    )
    other_user = broker._signed_url(colon_user, "c")
    same_shape = broker._signed_url("admin-user", colon_object)
    assert other_user.url != same_shape.url
    assert other_user.object_name == "c"
    assert same_shape.object_name == colon_object


def test_issuer_matches_project_and_subject_uid_uses_sub_only() -> None:
    project_id = "dises-decision-making-tool"
    issuer = f"https://securetoken.google.com/{project_id}"

    assert issuer_matches(project_id, issuer)
    assert not issuer_matches(project_id, "https://securetoken.google.com/other-project")
    assert not issuer_matches(project_id, "https://accounts.google.com/" + project_id)
    assert not issuer_matches(project_id, None)
    assert subject_uid({"sub": "user-1", "uid": "custom-claim"}) == "user-1"
    assert subject_uid({"uid": "custom-claim"}) is None
    assert subject_uid({"sub": ""}) is None
    assert subject_uid({"sub": "bad/uid"}) is None
    assert subject_uid({"sub": "x" * 129}) is None


def test_deny_ttl_is_clamped_shorter_than_a_positive_allow_ttl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DMT_ACCESS_ALLOW_TTL_SECONDS", "30")
    monkeypatch.setenv("DMT_ACCESS_DENY_TTL_SECONDS", "30")
    clamped = get_download_settings()
    assert clamped.access_allow_ttl_seconds == 30
    assert clamped.access_deny_ttl_seconds == 29

    monkeypatch.setenv("DMT_ACCESS_ALLOW_TTL_SECONDS", "1")
    monkeypatch.setenv("DMT_ACCESS_DENY_TTL_SECONDS", "50")
    floor = get_download_settings()
    assert floor.access_deny_ttl_seconds == 0

    monkeypatch.setenv("DMT_ACCESS_ALLOW_TTL_SECONDS", "0")
    monkeypatch.setenv("DMT_ACCESS_DENY_TTL_SECONDS", "40")
    disabled = get_download_settings()
    assert disabled.access_allow_ttl_seconds == 0
    assert disabled.access_deny_ttl_seconds == 40


def test_settings_key_tracks_credential_file_identity(tmp_path: Path) -> None:
    firebase_file = tmp_path / "firebase.json"
    gcs_file = tmp_path / "gcs.json"
    firebase_file.write_bytes(b"firebase-a")
    gcs_file.write_bytes(b"gcs-a")
    missing = tmp_path / "missing.json"
    settings = DownloadSettings(
        firebase_project_id="demo",
        gcs_bucket="bucket",
        catalog_path=None,
        firebase_service_account_json=None,
        firebase_service_account_file=str(firebase_file),
        gcs_service_account_json=None,
        gcs_service_account_file=str(missing),
    )

    before = _settings_key(settings)
    firebase_stat = firebase_file.stat()
    assert _credential_file_identity(str(firebase_file)) == (
        str(firebase_file),
        firebase_stat.st_mtime_ns,
        firebase_stat.st_size,
    )
    assert _credential_file_identity(str(missing)) == (str(missing), None, None)
    assert b"firebase-a" not in before

    firebase_file.write_bytes(b"firebase-bb")
    after = _settings_key(settings)
    assert before != after
    appeared = missing
    appeared.write_bytes(b"now-present")
    assert _settings_key(settings) != after
    assert _credential_file_identity(str(gcs_file))[2] == len(b"gcs-a")
