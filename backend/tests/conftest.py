from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

TINY_ARTIFACT_DIR = BACKEND_ROOT / "artifacts" / "fixtures" / "tiny-area"
TINY_ARTIFACT_MANIFEST = TINY_ARTIFACT_DIR / "manifest.json"


def clear_artifact_env() -> None:
    for name in [
        "DMT_ARTIFACT_DIR",
        "DMT_ARTIFACT_MANIFEST",
        "DMT_ARTIFACT_REQUIRED",
        "DMT_ARTIFACT_SCHEMA_VERSION",
        "DMT_MESA_COVERAGE_REQUIRED",
        "DMT_EXPECTED_COVERAGE_RELEASE_ID",
        "DMT_EXPECTED_COVERAGE_CONTRACT_SHA256",
        "DMT_SIRAP_ARTIFACT_ROOT",
    ]:
        os.environ.pop(name, None)

    from app.artifacts import reset_runtime_artifact_cache

    reset_runtime_artifact_cache()


def use_tiny_artifact(*, required: bool = True) -> None:
    clear_artifact_env()
    os.environ["DMT_ARTIFACT_REQUIRED"] = "true" if required else "false"
    os.environ["DMT_ARTIFACT_DIR"] = str(TINY_ARTIFACT_DIR)
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(TINY_ARTIFACT_MANIFEST)
