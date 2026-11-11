from __future__ import annotations

import json
from dataclasses import dataclass, field

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.authenticator_reset import AuthenticatorReset
from app.accounts.router import (
    install_test_authenticator_reset,
    reset_test_authenticator_reset,
    router,
)
from app.accounts.second_factors import IdentityToolkitSecondFactorAdmin
from app.downloads.access import DownloadPrincipal
from app.downloads.errors import BrokerError
from app.downloads.router import install_test_broker, reset_test_broker
from app.downloads.verifier import VerifiedIdentity

PERSON = "person-who-lost-their-phone"
ADMIN_TOKEN = "super-admin-totp-token"


@dataclass
class FakeVerifier:
    identities: dict[str, VerifiedIdentity]

    def verify(self, token: str) -> VerifiedIdentity:
        identity = self.identities.get(token)
        if identity is None:
            raise BrokerError(401, "invalid_token", "The Firebase ID token is invalid.")
        return identity


@dataclass
class FakeUsers:
    records: dict[str, DownloadPrincipal]

    def get_user(self, uid: str) -> DownloadPrincipal | None:
        return self.records.get(uid)


@dataclass
class FakeSecondFactors:
    """Firebase Auth's second factors and each users record's setup time, in one change log."""

    enrolled: dict[str, int]
    lookups: list[str] = field(default_factory=list)
    removals: list[str] = field(default_factory=list)
    changes: list[tuple[str, str]] = field(default_factory=list)
    setup_write_fails: bool = False

    def enrolled_second_factor_count(self, uid: str) -> int | None:
        self.lookups.append(uid)
        return self.enrolled.get(uid)

    def remove_second_factors_and_end_sessions(self, uid: str) -> None:
        self.removals.append(uid)
        self.changes.append(("remove_second_factors", uid))
        self.enrolled[uid] = 0

    def forget_setup(self, uid: str) -> None:
        if self.setup_write_fails:
            raise BrokerError(503, "account_update_failed", "The account record could not be updated.")
        self.changes.append(("forget_setup", uid))


@pytest.fixture(autouse=True)
def _isolated_reset():
    reset_test_authenticator_reset()
    reset_test_broker()
    yield
    reset_test_authenticator_reset()
    reset_test_broker()


def _principal(uid: str, role: str, status: str = "active") -> DownloadPrincipal:
    return DownloadPrincipal(uid=uid, status=status, role=role, allowed_sirap_ids=())


def _client() -> tuple[TestClient, FakeSecondFactors]:
    second_factors = FakeSecondFactors({PERSON: 1, "other-super-admin": 1})
    identities = {
        ADMIN_TOKEN: VerifiedIdentity(uid="super-admin", expires_at=2_000_000_000.0, totp=True),
        "super-admin-without-totp": VerifiedIdentity(
            uid="super-admin", expires_at=2_000_000_000.0, totp=False
        ),
        "regional-admin-totp": VerifiedIdentity(
            uid="regional-admin", expires_at=2_000_000_000.0, totp=True
        ),
        "pending-super-admin-totp": VerifiedIdentity(
            uid="pending-super-admin", expires_at=2_000_000_000.0, totp=True
        ),
        "no-record-totp": VerifiedIdentity(uid="no-record", expires_at=2_000_000_000.0, totp=True),
    }
    users = FakeUsers(
        {
            "super-admin": _principal("super-admin", "super-admin"),
            "regional-admin": _principal("regional-admin", "sirap-admin"),
            "pending-super-admin": _principal("pending-super-admin", "super-admin", "pending"),
            PERSON: _principal(PERSON, "user"),
        }
    )
    install_test_authenticator_reset(
        AuthenticatorReset(
            verifier=FakeVerifier(identities),
            users=users,
            second_factors=second_factors,
            setup_records=second_factors,
        )
    )
    application = FastAPI()
    application.include_router(router)
    return TestClient(application), second_factors


def _reset(client: TestClient, uid: str, token: str | None):
    headers = {} if token is None else {"Authorization": f"Bearer {token}"}
    return client.post(f"/admin/users/{uid}/reset-authenticator", headers=headers)


def _security_events(capsys: pytest.CaptureFixture[str]) -> tuple[list[dict], str]:
    output = capsys.readouterr().out
    events = []
    for line in output.splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and "event_type" in payload:
            events.append(payload)
    return events, output


def test_super_admin_with_authenticator_resets_another_person(
    capsys: pytest.CaptureFixture[str],
) -> None:
    client, second_factors = _client()

    response = _reset(client, PERSON, ADMIN_TOKEN)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "uid": PERSON,
        "removed_second_factor_count": 1,
        "sessions_ended": True,
    }
    assert second_factors.removals == [PERSON]
    events, output = _security_events(capsys)
    assert [
        (event["event_type"], event["status_code"], event["actor_uid"], event["resource"])
        for event in events
    ] == [("authenticator_reset", 200, "super-admin", f"/admin/users/{PERSON}/reset-authenticator")]
    assert ADMIN_TOKEN not in output


def test_a_reset_forgets_the_setup_time_so_the_email_scanner_notice_stays_hidden() -> None:
    client, second_factors = _client()

    assert _reset(client, PERSON, ADMIN_TOKEN).status_code == 200

    assert second_factors.changes == [
        ("forget_setup", PERSON),
        ("remove_second_factors", PERSON),
    ]


def test_a_failed_setup_time_write_is_a_retryable_503_that_keeps_the_authenticator() -> None:
    client, second_factors = _client()
    second_factors.setup_write_fails = True

    response = _reset(client, PERSON, ADMIN_TOKEN)

    assert response.status_code == 503
    assert response.json()["detail"]["status"] == "account_update_failed"
    assert second_factors.removals == []


def test_another_super_admin_can_reset_a_super_admin() -> None:
    client, second_factors = _client()

    response = _reset(client, "other-super-admin", ADMIN_TOKEN)

    assert response.status_code == 200
    assert second_factors.removals == ["other-super-admin"]


@pytest.mark.parametrize(
    ("token", "reason"),
    [
        ("regional-admin-totp", "super_admin_required"),
        ("pending-super-admin-totp", "super_admin_required"),
        ("no-record-totp", "super_admin_required"),
        ("super-admin-without-totp", "mfa_required"),
    ],
)
def test_only_an_active_super_admin_signed_in_with_an_authenticator_may_reset(
    token: str,
    reason: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    client, second_factors = _client()

    response = _reset(client, PERSON, token)

    assert response.status_code == 403
    assert response.json()["detail"]["status"] == reason
    assert second_factors.lookups == []
    assert second_factors.removals == []
    events, output = _security_events(capsys)
    assert [(event["event_type"], event["reason"]) for event in events] == [
        ("authenticator_reset_refused", reason)
    ]
    assert token not in output


@dataclass
class SignInForgettingBroker:
    forgotten: list[str] = field(default_factory=list)

    def forget_sign_ins(self, uid: str) -> None:
        self.forgotten.append(uid)


def test_a_reset_makes_the_download_service_recheck_only_that_persons_tokens() -> None:
    broker = SignInForgettingBroker()
    install_test_broker(broker)
    client, _second_factors = _client()

    assert _reset(client, PERSON, ADMIN_TOKEN).status_code == 200
    assert _reset(client, PERSON, "regional-admin-totp").status_code == 403

    assert broker.forgotten == [PERSON]


def test_a_super_admin_cannot_reset_their_own_authenticator() -> None:
    client, second_factors = _client()

    response = _reset(client, "super-admin", ADMIN_TOKEN)

    assert response.status_code == 403
    assert response.json()["detail"]["status"] == "self_reset_forbidden"
    assert second_factors.removals == []


def test_an_unknown_account_is_404_and_nothing_changes() -> None:
    client, second_factors = _client()

    response = _reset(client, "nobody-has-this-uid", ADMIN_TOKEN)

    assert response.status_code == 404
    assert response.json()["detail"]["status"] == "user_not_found"
    assert second_factors.changes == []


def test_an_overlong_uid_is_404_without_an_account_lookup() -> None:
    client, second_factors = _client()

    response = _reset(client, "x" * 129, ADMIN_TOKEN)

    assert response.status_code == 404
    assert second_factors.lookups == []


@pytest.mark.parametrize("token", [None, "", "forged-token"])
def test_a_missing_or_invalid_token_is_401_before_any_account_lookup(token: str | None) -> None:
    client, second_factors = _client()

    response = _reset(client, PERSON, token)

    assert response.status_code == 401
    assert second_factors.lookups == []
    assert second_factors.removals == []


def test_an_unconfigured_service_is_503() -> None:
    install_test_authenticator_reset(None)
    application = FastAPI()
    application.include_router(router)

    response = _reset(TestClient(application), PERSON, ADMIN_TOKEN)

    assert response.status_code == 503
    assert response.json()["detail"]["status"] == "admin_not_configured"


def test_metrics_app_mounts_the_reset_route() -> None:
    from app.main import app

    operations = app.openapi()["paths"]["/admin/users/{uid}/reset-authenticator"]
    assert set(operations) == {"post"}


@dataclass
class FakeResponse:
    status_code: int
    body: object

    def json(self) -> object:
        return self.body


@dataclass
class FakeSession:
    responses: list[FakeResponse]
    calls: list[tuple[str, dict]] = field(default_factory=list)

    def post(self, url: str, *, json: dict, timeout: float) -> FakeResponse:
        self.calls.append((url, json))
        return self.responses.pop(0)


def _identity_toolkit(session: FakeSession) -> IdentityToolkitSecondFactorAdmin:
    admin = IdentityToolkitSecondFactorAdmin("demo-project", {}, clock=lambda: 1_800_000_000.5)
    admin._session = session
    return admin


def test_identity_toolkit_counts_enrolled_factors_and_reports_a_missing_account() -> None:
    session = FakeSession(
        [
            FakeResponse(200, {"users": [{"localId": PERSON, "mfaInfo": [{"mfaEnrollmentId": "a"}]}]}),
            FakeResponse(200, {"users": [{"localId": PERSON}]}),
            FakeResponse(200, {"kind": "identitytoolkit#GetAccountInfoResponse"}),
        ]
    )
    admin = _identity_toolkit(session)

    assert admin.enrolled_second_factor_count(PERSON) == 1
    assert admin.enrolled_second_factor_count(PERSON) == 0
    assert admin.enrolled_second_factor_count("missing") is None
    assert session.calls[0] == (
        "https://identitytoolkit.googleapis.com/v1/projects/demo-project/accounts:lookup",
        {"localId": [PERSON]},
    )


def test_identity_toolkit_reset_clears_every_factor_and_ends_sessions_in_one_update() -> None:
    session = FakeSession([FakeResponse(200, {"localId": PERSON})])

    _identity_toolkit(session).remove_second_factors_and_end_sessions(PERSON)

    assert session.calls == [
        (
            "https://identitytoolkit.googleapis.com/v1/projects/demo-project/accounts:update",
            {"localId": PERSON, "mfa": {}, "validSince": "1800000000"},
        )
    ]


def test_identity_toolkit_error_is_a_retryable_503() -> None:
    session = FakeSession([FakeResponse(500, {"error": {"message": "INTERNAL"}})])

    with pytest.raises(BrokerError) as raised:
        _identity_toolkit(session).remove_second_factors_and_end_sessions(PERSON)

    assert raised.value.status_code == 503
    assert raised.value.code == "account_update_failed"
