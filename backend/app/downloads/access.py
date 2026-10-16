from __future__ import annotations

from dataclasses import dataclass

# SIRAP (Sistema Regional de Áreas Protegidas) regions that currently have
# catalog data and an access grant. Matches frontend SIRAP_ACCESS_REGION_IDS.
SIRAP_ACCESS_REGION_IDS: tuple[str, ...] = ("eje-cafetero", "orinoquia")
APP_ROLES: tuple[str, ...] = ("user", "sirap-user", "sirap-admin", "super-admin")
# Two catalog rows named the same object under different SIRAP grants.
CONFLICTING_SIRAP = "\x00conflict"


@dataclass(frozen=True)
class DownloadPrincipal:
    uid: str
    status: str
    role: str
    allowed_sirap_ids: tuple[str, ...]


def read_app_role(
    value: object,
    allowed_sirap_ids: tuple[str, ...] = (),
    administered_sirap_ids: tuple[str, ...] = (),
    legacy_is_admin: bool = False,
) -> str:
    """Copy frontend readAppRole(). A stored role wins over the scope lists."""
    if isinstance(value, str) and value in APP_ROLES:
        return value
    if value == "admin" or legacy_is_admin:
        return "super-admin"
    if administered_sirap_ids:
        return "sirap-admin"
    return "sirap-user" if allowed_sirap_ids else "user"


def accessible_sirap_ids(principal: DownloadPrincipal) -> tuple[str, ...]:
    """Regions this account may download. Super-admin receives both access regions."""
    if principal.role == "super-admin":
        return SIRAP_ACCESS_REGION_IDS
    return tuple(
        sirap_id
        for sirap_id in principal.allowed_sirap_ids
        if sirap_id in SIRAP_ACCESS_REGION_IDS
    )


def can_access_object(principal: DownloadPrincipal, sirap_id: str | None) -> bool:
    """National objects have no SIRAP id. A SIRAP id must be in the grant."""
    if not sirap_id:
        return True
    if sirap_id == CONFLICTING_SIRAP:
        return False
    return sirap_id in accessible_sirap_ids(principal)


def principal_from_user_document(uid: str, data: dict[str, object]) -> DownloadPrincipal:
    allowed = _string_tuple(data.get("allowedSirapIds"))
    administered = _string_tuple(data.get("administeredSirapIds"))
    legacy_is_admin = data.get("isAdmin") is True or data.get("isSuperAdmin") is True
    status = data.get("status")
    return DownloadPrincipal(
        uid=uid,
        status=status if isinstance(status, str) else "",
        role=read_app_role(
            data.get("role"),
            allowed,
            administered,
            legacy_is_admin,
        ),
        allowed_sirap_ids=allowed,
    )


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    seen: list[str] = []
    for item in value:
        if isinstance(item, str) and item not in seen:
            seen.append(item)
    return tuple(seen)
