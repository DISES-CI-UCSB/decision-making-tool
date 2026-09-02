"""Normalize solution domain metadata used by mixed land/marine batches."""

from __future__ import annotations

from typing import Any, Literal


SolutionDomain = Literal["land", "marine"]

_LAND_VALUES = frozenset({"land", "nacional", "national", "terrestrial"})
_MARINE_VALUES = frozenset({"marine"})
_SIRAP_SCOPE_VALUES = frozenset({"sirap"})
_BATCH_SCOPE_VALUES = _LAND_VALUES | _MARINE_VALUES | _SIRAP_SCOPE_VALUES | {""}


class SolutionDomainError(ValueError):
    """Raised when solution metadata declares an unsupported or conflicting domain."""


def normalize_domain(value: Any, *, default: SolutionDomain = "land") -> SolutionDomain:
    """Map land aliases and marine to the two supported metric domains."""
    normalized = str(value or "").strip().lower()
    if not normalized:
        return default
    if normalized in _LAND_VALUES:
        return "land"
    if normalized in _MARINE_VALUES:
        return "marine"
    raise SolutionDomainError(f"Unknown solution domain '{value}'.")


def solution_domain(solution: dict[str, Any]) -> SolutionDomain:
    """Resolve domain from ``domain`` and legacy ``scope`` fields."""
    raw_domain = solution.get("domain")
    raw_scope = solution.get("scope")

    domain = (
        normalize_domain(raw_domain)
        if str(raw_domain or "").strip()
        else None
    )
    scope_text = str(raw_scope or "").strip().lower()
    scope = (
        "land"
        if scope_text in _SIRAP_SCOPE_VALUES
        else (
            normalize_domain(raw_scope)
            if scope_text and scope_text in _BATCH_SCOPE_VALUES
            else None
        )
    )

    if domain is not None and scope is not None and domain != scope:
        solution_id = solution.get("id") or "<unknown>"
        raise SolutionDomainError(
            f"Solution '{solution_id}' has conflicting domain '{raw_domain}' "
            f"and scope '{raw_scope}'."
        )
    if domain is not None:
        return domain
    if scope is not None:
        return scope
    if str(raw_scope or "").strip():
        raise SolutionDomainError(f"Unknown solution scope '{raw_scope}'.")
    return "land"


def is_batch_solution(solution: dict[str, Any]) -> bool:
    """Return whether a manifest solution belongs to a supported metric batch."""
    scope = str(solution.get("scope") or "").strip().lower()
    if scope not in _BATCH_SCOPE_VALUES:
        return False
    solution_domain(solution)
    return True
