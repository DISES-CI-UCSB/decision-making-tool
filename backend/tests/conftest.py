from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))


def clear_artifact_env() -> None:
    for name in [
        "DMT_ARTIFACT_DIR",
        "DMT_ARTIFACT_MANIFEST",
        "DMT_ARTIFACT_REQUIRED",
        "DMT_ARTIFACT_SCHEMA_VERSION",
    ]:
        os.environ.pop(name, None)
