"""Shared path contracts for solution-scoped metric artifacts."""

from __future__ import annotations

import re
from pathlib import Path

SAFE_SOLUTION_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[_-][a-z0-9]+)*$")


def safe_solution_id(solution_id: str) -> str:
    """Validate and return the canonical frontend-safe solution identifier."""
    value = str(solution_id)
    if not SAFE_SOLUTION_ID_PATTERN.fullmatch(value):
        raise ValueError(f"unsafe solution id {solution_id!r}")
    return value


def solution_artifact_name(solution_id: str, *, suffix: str) -> str:
    return f"{safe_solution_id(solution_id)}{suffix}"


def solution_artifact_path(
    output_dir: Path,
    solution_id: str,
    *,
    suffix: str,
) -> Path:
    return output_dir / "cache" / solution_artifact_name(solution_id, suffix=suffix)


def solution_blob_path(
    solution_id: str,
    *,
    blob_directory: str,
    suffix: str,
) -> str:
    directory = blob_directory.strip("/")
    return f"{directory}/{solution_artifact_name(solution_id, suffix=suffix)}"


def solution_public_url(
    public_blob_host: str,
    solution_id: str,
    *,
    blob_directory: str,
    suffix: str,
) -> str:
    blob_path = solution_blob_path(
        solution_id,
        blob_directory=blob_directory,
        suffix=suffix,
    )
    return f"{public_blob_host.rstrip('/')}/{blob_path}"
