from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify every file and aggregate checksum in a runtime release."
    )
    parser.add_argument("release_dir", type=Path)
    return parser.parse_args()


def main() -> None:
    release_dir = parse_args().release_dir.resolve()
    artifact_version, file_count = verify_runtime_release(release_dir)
    print(f"Verified {file_count} files for {artifact_version}.")


def verify_runtime_release(release_dir: Path) -> tuple[str, int]:
    release_dir = release_dir.resolve()
    manifest_path = release_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise SystemExit("Runtime manifest contains no files.")

    verified: list[dict[str, Any]] = []
    for raw_entry in files:
        if not isinstance(raw_entry, dict):
            raise SystemExit("Runtime manifest contains an invalid file entry.")
        raw_path = raw_entry.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            raise SystemExit("Runtime file entry has no path.")
        path = (release_dir / raw_path).resolve()
        if release_dir not in path.parents:
            raise SystemExit(f"Runtime file escapes release directory: {raw_path}")
        if not path.is_file():
            raise SystemExit(f"Runtime file is missing: {raw_path}")

        checksum = raw_entry.get("checksum")
        expected_checksum = (
            checksum.get("value")
            if isinstance(checksum, dict) and checksum.get("algorithm") == "sha256"
            else None
        )
        actual_checksum = sha256_file(path)
        if expected_checksum != actual_checksum:
            raise SystemExit(f"Checksum mismatch: {raw_path}")
        actual_size = path.stat().st_size
        if raw_entry.get("size_bytes") != actual_size:
            raise SystemExit(f"Size mismatch: {raw_path}")
        verified.append(
            {
                "path": raw_path,
                "size_bytes": actual_size,
                "checksum": {"algorithm": "sha256", "value": actual_checksum},
            }
        )

    aggregate = manifest.get("checksum")
    expected_aggregate = (
        aggregate.get("value")
        if isinstance(aggregate, dict) and aggregate.get("algorithm") == "sha256"
        else None
    )
    if aggregate_file_checksum(verified) != expected_aggregate:
        raise SystemExit("Runtime manifest aggregate checksum does not match.")
    return (
        str(manifest.get("artifact_version") or "unknown release"),
        len(verified),
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def aggregate_file_checksum(files: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for entry in sorted(files, key=lambda item: item["path"]):
        digest.update(entry["path"].encode("utf-8"))
        digest.update(str(entry["size_bytes"]).encode("utf-8"))
        digest.update(entry["checksum"]["value"].encode("utf-8"))
    return digest.hexdigest()


if __name__ == "__main__":
    main()
