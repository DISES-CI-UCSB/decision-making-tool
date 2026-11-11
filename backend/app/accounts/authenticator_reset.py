from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..downloads.errors import BrokerError
from ..downloads.users import UserDirectory
from ..downloads.verifier import TokenVerifier

_MAX_TOKEN_LENGTH = 8192
_MAX_UID_LENGTH = 128


class SecondFactorAdmin(Protocol):
    def enrolled_second_factor_count(self, uid: str) -> int | None:
        """Second factors enrolled on the account, or None when no account has that uid."""
        ...

    def remove_second_factors_and_end_sessions(self, uid: str) -> None: ...


class ResetRefused(BrokerError):
    """A refusal after the caller's token was verified, so the security log can name who asked."""

    def __init__(self, status_code: int, code: str, message: str, *, actor_uid: str) -> None:
        super().__init__(status_code, code, message)
        self.actor_uid = actor_uid


@dataclass(frozen=True)
class AuthenticatorResetResult:
    actor_uid: str
    target_uid: str
    removed_second_factor_count: int


class AuthenticatorReset:
    """Removes a person's authenticator and ends their sessions, for a lost phone or app.

    Only an active super-admin signed in with their own authenticator may reset,
    and never their own: a stolen super-admin session must not be able to swap
    in the thief's authenticator, so another super-admin resets a super-admin.
    """

    def __init__(
        self,
        *,
        verifier: TokenVerifier,
        users: UserDirectory,
        second_factors: SecondFactorAdmin,
    ) -> None:
        self._verifier = verifier
        self._users = users
        self._second_factors = second_factors

    def reset(self, token: str, target_uid: str) -> AuthenticatorResetResult:
        if not token or len(token) > _MAX_TOKEN_LENGTH:
            raise BrokerError(401, "invalid_token", "The Firebase ID token is invalid.")
        identity = self._verifier.verify(token)
        actor_uid = identity.uid
        caller = self._users.get_user(actor_uid)
        if caller is None or caller.status != "active" or caller.role != "super-admin":
            raise ResetRefused(
                403,
                "super_admin_required",
                "Only an active super-admin can reset an authenticator.",
                actor_uid=actor_uid,
            )
        if not identity.totp:
            raise ResetRefused(
                403,
                "mfa_required",
                "Sign in with your own authenticator before resetting someone else's.",
                actor_uid=actor_uid,
            )
        if target_uid == actor_uid:
            raise ResetRefused(
                403,
                "self_reset_forbidden",
                "You cannot reset your own authenticator. Ask another super-admin.",
                actor_uid=actor_uid,
            )
        enrolled = (
            self._second_factors.enrolled_second_factor_count(target_uid)
            if _plausible_uid(target_uid)
            else None
        )
        if enrolled is None:
            raise ResetRefused(
                404,
                "user_not_found",
                "No account has that id.",
                actor_uid=actor_uid,
            )
        self._second_factors.remove_second_factors_and_end_sessions(target_uid)
        return AuthenticatorResetResult(
            actor_uid=actor_uid,
            target_uid=target_uid,
            removed_second_factor_count=enrolled,
        )


def _plausible_uid(uid: str) -> bool:
    return bool(uid) and len(uid) <= _MAX_UID_LENGTH and "/" not in uid
