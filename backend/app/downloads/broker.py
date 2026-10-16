from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Callable

from .access import can_access_object
from .cache import TtlCache
from .catalog import ObjectCatalog
from .errors import BrokerError
from .object_names import normalize_object_name
from .signer import ObjectSigner
from .users import UserDirectory
from .verifier import TokenVerifier, VerifiedIdentity

_MISSING_USER = "missing"
_MAX_TOKEN_LENGTH = 8192


def _hashed_cache_key(prefix: str, *parts: str) -> str:
    """SHA-256 each component and join with NUL so raw colons cannot collide."""
    hashed_parts = [
        hashlib.sha256(part.encode("utf-8")).hexdigest() for part in parts
    ]
    return prefix + "\x00" + "\x00".join(hashed_parts)


def _grant_component(allowed_sirap_ids: tuple[str, ...]) -> str:
    return "\x00".join(
        hashlib.sha256(sirap_id.encode("utf-8")).hexdigest()
        for sirap_id in allowed_sirap_ids
    )


@dataclass(frozen=True)
class SignedDownload:
    url: str
    expires_at: str
    expires_epoch: float
    object_name: str
    method: str = "GET"


class DownloadBroker:
    def __init__(
        self,
        *,
        verifier: TokenVerifier,
        users: UserDirectory,
        catalog: ObjectCatalog,
        signer: ObjectSigner,
        bucket_name: str,
        clock: Callable[[], float],
        signed_url_ttl_seconds: int,
        url_cache_ttl_seconds: int,
        auth_cache_ttl_seconds: int,
        access_allow_ttl_seconds: int,
        access_deny_ttl_seconds: int,
    ) -> None:
        self._verifier = verifier
        self._users = users
        self._catalog = catalog
        self._signer = signer
        self._bucket_name = bucket_name
        self._clock = clock
        self._signed_url_ttl_seconds = signed_url_ttl_seconds
        self._url_cache_ttl_seconds = url_cache_ttl_seconds
        self._auth_cache_ttl_seconds = auth_cache_ttl_seconds
        self._access_allow_ttl_seconds = access_allow_ttl_seconds
        self._access_deny_ttl_seconds = access_deny_ttl_seconds
        self._cache = TtlCache(clock)

    def issue(self, token: str, object_name: str) -> SignedDownload:
        identity = self._identity(token)
        principal = self._principal(identity.uid)
        if principal.status != "active":
            raise BrokerError(
                403,
                "account_inactive",
                "This account cannot download catalog objects.",
            )
        normalized = normalize_object_name(object_name)
        record = self._catalog.lookup(normalized)
        if record is None:
            raise BrokerError(
                404,
                "object_not_in_catalog",
                "That object is not in the download catalog.",
            )
        if record.sirap_id and not identity.totp:
            raise BrokerError(
                403,
                "mfa_required",
                "SIRAP downloads require an authenticator sign-in.",
            )
        if not self._access_allowed(principal, record.object_name, record.sirap_id):
            raise BrokerError(
                403,
                "layer_forbidden",
                "This account cannot download that object.",
            )
        return self._signed_url(identity.uid, normalized)

    def _identity(self, token: str) -> VerifiedIdentity:
        if not token or len(token) > _MAX_TOKEN_LENGTH:
            raise BrokerError(401, "invalid_token", "The Firebase ID token is invalid.")
        key = "auth:" + hashlib.sha256(token.encode("utf-8")).hexdigest()
        cached = self._cache.get(key)
        now = self._clock()
        if isinstance(cached, VerifiedIdentity) and cached.expires_at > now:
            return cached
        identity = self._verifier.verify(token)
        if identity.expires_at <= now:
            raise BrokerError(401, "invalid_token", "The Firebase ID token is invalid.")
        ttl = min(
            self._auth_cache_ttl_seconds,
            identity.expires_at - now - 30,
        )
        self._cache.set(key, identity, ttl)
        return identity

    def _principal(self, uid: str):
        key = f"user:{uid}"
        cached = self._cache.get(key)
        if cached == _MISSING_USER:
            raise BrokerError(
                403,
                "account_inactive",
                "This account cannot download catalog objects.",
            )
        if cached is not None and not isinstance(cached, str):
            return cached
        principal = self._users.get_user(uid)
        if principal is None:
            self._cache.set(key, _MISSING_USER, self._access_deny_ttl_seconds)
            raise BrokerError(
                403,
                "account_inactive",
                "This account cannot download catalog objects.",
            )
        if principal.status != "active":
            self._cache.set(key, principal, self._access_deny_ttl_seconds)
            return principal
        # Token claims keep the longer auth TTL. The user record must not
        # outlive an allow decision, or a revoked grant is approved again.
        self._cache.set(
            key,
            principal,
            min(self._auth_cache_ttl_seconds, self._access_allow_ttl_seconds),
        )
        return principal

    def _access_allowed(self, principal, object_name: str, sirap_id: str | None) -> bool:
        key = _hashed_cache_key(
            "access",
            principal.uid,
            principal.status,
            principal.role,
            _grant_component(principal.allowed_sirap_ids),
            self._catalog.version(),
            object_name,
        )
        cached = self._cache.get(key)
        if isinstance(cached, bool):
            return cached
        allowed = can_access_object(principal, sirap_id)
        self._cache.set(
            key,
            allowed,
            self._access_allow_ttl_seconds if allowed else self._access_deny_ttl_seconds,
        )
        return allowed

    def _signed_url(self, uid: str, object_name: str) -> SignedDownload:
        key = _hashed_cache_key("signed", uid, self._bucket_name, object_name)
        cached = self._cache.get(key)
        now = self._clock()
        if (
            isinstance(cached, SignedDownload)
            and cached.object_name == object_name
            and cached.expires_epoch - now >= 60
        ):
            return cached
        try:
            url, expires_epoch = self._signer.sign(
                object_name,
                self._signed_url_ttl_seconds,
                now,
            )
        except BrokerError:
            raise
        except Exception:
            raise BrokerError(
                503,
                "signing_failed",
                "A signed URL could not be issued.",
            ) from None
        signed = SignedDownload(
            url=url,
            expires_at=_format_expires(expires_epoch),
            expires_epoch=expires_epoch,
            object_name=object_name,
        )
        self._cache.set(
            key,
            signed,
            min(self._url_cache_ttl_seconds, expires_epoch - now - 60),
        )
        return signed


def _format_expires(epoch: float) -> str:
    from datetime import datetime, timezone

    return (
        datetime.fromtimestamp(epoch, timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
