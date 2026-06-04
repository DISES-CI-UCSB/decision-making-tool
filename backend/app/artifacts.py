from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .config import Settings


class ArtifactState(BaseModel):
    required: bool
    available: bool
    manifest_path: str
    schema_version: str | None = None
    artifact_version: str | None = None
    checksum: str | None = None
    message: str


class ArtifactValidationError(ValueError):
    pass


REQUIRED_MANIFEST_FIELDS = {
    "artifact_version",
    "schema_version",
    "created_at",
    "checksum",
    "source_manifest",
}


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
    except FileNotFoundError as exc:
        raise ArtifactValidationError("Artifact manifest is missing.") from exc
    except json.JSONDecodeError as exc:
        raise ArtifactValidationError("Artifact manifest is not valid JSON.") from exc

    if not isinstance(manifest, dict):
        raise ArtifactValidationError("Artifact manifest must be a JSON object.")

    missing_fields = sorted(REQUIRED_MANIFEST_FIELDS - manifest.keys())
    if missing_fields:
        raise ArtifactValidationError(
            f"Artifact manifest is missing required fields: {', '.join(missing_fields)}."
        )

    checksum = manifest.get("checksum")
    if not isinstance(checksum, dict) or not checksum.get("algorithm") or not checksum.get("value"):
        raise ArtifactValidationError(
            "Artifact manifest checksum must include algorithm and value."
        )

    source_manifest = manifest.get("source_manifest")
    if not isinstance(source_manifest, dict):
        raise ArtifactValidationError("Artifact manifest source_manifest must be an object.")

    return manifest


def get_artifact_state(settings: Settings) -> ArtifactState:
    manifest_path = settings.artifact_manifest_path

    try:
        manifest = load_manifest(manifest_path)
    except ArtifactValidationError as exc:
        return ArtifactState(
            required=settings.artifact_required,
            available=False,
            manifest_path=str(manifest_path),
            message=str(exc),
        )

    checksum = manifest.get("checksum", {})
    checksum_text = f"{checksum.get('algorithm')}:{checksum.get('value')}"

    return ArtifactState(
        required=settings.artifact_required,
        available=True,
        manifest_path=str(manifest_path),
        schema_version=manifest.get("schema_version"),
        artifact_version=manifest.get("artifact_version"),
        checksum=checksum_text,
        message="Artifact manifest loaded.",
    )


def artifact_ready(settings: Settings, state: ArtifactState) -> bool:
    return state.available or not settings.artifact_required
