from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.verify_runtime_release import (
    aggregate_file_checksum,
    sha256_file,
    verify_runtime_release,
)


def test_verify_runtime_release_accepts_complete_release(tmp_path: Path) -> None:
    payload = tmp_path / "payload.bin"
    payload.write_bytes(b"verified payload")
    entry = {
        "path": payload.name,
        "size_bytes": payload.stat().st_size,
        "checksum": {"algorithm": "sha256", "value": sha256_file(payload)},
    }
    _write_manifest(tmp_path, entry)

    assert verify_runtime_release(tmp_path) == ("release-1", 1)


def test_verify_runtime_release_rejects_changed_payload(tmp_path: Path) -> None:
    payload = tmp_path / "payload.bin"
    payload.write_bytes(b"original payload")
    entry = {
        "path": payload.name,
        "size_bytes": payload.stat().st_size,
        "checksum": {"algorithm": "sha256", "value": sha256_file(payload)},
    }
    _write_manifest(tmp_path, entry)
    payload.write_bytes(b"changed payload")

    with pytest.raises(SystemExit, match="Checksum mismatch"):
        verify_runtime_release(tmp_path)


def _write_manifest(release_dir: Path, entry: dict[str, object]) -> None:
    manifest = {
        "artifact_version": "release-1",
        "files": [entry],
        "checksum": {
            "algorithm": "sha256",
            "value": aggregate_file_checksum([entry]),
        },
    }
    (release_dir / "manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )
