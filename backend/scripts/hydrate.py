"""Download the backend runtime artifact recipe into DMT_ARTIFACT_DIR.

Intended invoke:
    docker compose run --rm --build backend hydrate
"""

from __future__ import annotations

import os
import sys


def prepend_default_args(argv: list[str]) -> list[str]:
    resolved = list(argv)
    if not _has_flag(resolved, "--artifact-dir"):
        artifact_dir = os.environ.get("DMT_ARTIFACT_DIR", "/backend/runtime-artifacts")
        resolved = ["--artifact-dir", artifact_dir, *resolved]
    if not _has_flag(resolved, "--manifest-url"):
        manifest_url = os.environ.get("MANIFEST_BLOB_URL") or os.environ.get(
            "DMT_MANIFEST_URL"
        )
        if manifest_url:
            resolved = ["--manifest-url", manifest_url, *resolved]
    return resolved


def _has_flag(argv: list[str], flag: str) -> bool:
    return any(arg == flag or arg.startswith(f"{flag}=") for arg in argv)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    artifact_dir = os.environ.get("DMT_ARTIFACT_DIR", "/backend/runtime-artifacts")
    print(f"[hydrate] starting — artifacts dir {artifact_dir}", flush=True)
    print("[hydrate] existing files are skipped; Ctrl+C or docker stop to cancel", flush=True)
    sys.argv = [sys.argv[0], *prepend_default_args(sys.argv[1:])]
    from scripts.build_runtime_artifact import main as build_main

    build_main()


if __name__ == "__main__":
    main()
