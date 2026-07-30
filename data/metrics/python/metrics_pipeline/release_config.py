"""Shared immutable release-prefix configuration for generated metric artifacts."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

_CONFIG_RELATIVE_PATH = Path("frontend/layer-manifest/release-contract.json")
_RELEASE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass(frozen=True)
class ReleaseConfig:
    release_id: str
    regular_verbose_directory: str
    regular_compact_directory: str
    mec_v2_directory: str
    sirap_boundary_path: str
    sirap_metadata_path: str


def _find_release_config(search_start: Path | None = None) -> Path:
    start = (search_start or Path(__file__)).resolve()
    for ancestor in start.parents:
        config_path = ancestor / _CONFIG_RELATIVE_PATH
        if config_path.is_file():
            return config_path

    raise FileNotFoundError(
        f"Could not find {_CONFIG_RELATIVE_PATH} in any parent of {start}"
    )


def load_release_config(
    release_id: str | None = None,
    *,
    search_start: Path | None = None,
) -> ReleaseConfig:
    config_path = _find_release_config(search_start)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    resolved_id = release_id or raw["defaultReleaseId"]
    if not _RELEASE_ID_PATTERN.fullmatch(resolved_id):
        raise ValueError(
            "release id must contain lowercase letters, digits, and single hyphens"
        )
    root = f"{raw['prefixRoot'].strip('/')}/{resolved_id}"

    def directory(key: str) -> str:
        return f"{root}/{raw[key].strip('/')}"

    return ReleaseConfig(
        release_id=resolved_id,
        regular_verbose_directory=directory("regularVerboseDirectory"),
        regular_compact_directory=directory("regularCompactDirectory"),
        mec_v2_directory=directory("mecV2Directory"),
        sirap_boundary_path=raw["sirapBoundaryPath"],
        sirap_metadata_path=raw["sirapMetadataPath"],
    )
