from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    artifact_dir: Path
    artifact_manifest_path: Path
    artifact_required: bool
    artifact_schema_version: str


def get_settings() -> Settings:
    artifact_dir = Path(os.getenv("DMT_ARTIFACT_DIR", "runtime-artifacts"))
    manifest_path = Path(
        os.getenv("DMT_ARTIFACT_MANIFEST", str(artifact_dir / "manifest.json"))
    )

    return Settings(
        artifact_dir=artifact_dir,
        artifact_manifest_path=manifest_path,
        artifact_required=_env_bool("DMT_ARTIFACT_REQUIRED", default=False),
        artifact_schema_version=os.getenv(
            "DMT_ARTIFACT_SCHEMA_VERSION", "metrics-artifact-manifest/v1"
        ),
    )
