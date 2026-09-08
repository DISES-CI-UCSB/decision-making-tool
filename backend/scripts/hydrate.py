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


def _sirap_artifact_root(national_artifact_dir: str) -> str:
    return os.environ.get("DMT_SIRAP_ARTIFACT_ROOT") or f"{national_artifact_dir.rstrip('/')}/sirap"


def hydrate_sirap_artifacts(national_artifact_dir: str, force: bool) -> None:
    """Build regional SIRAP kits after the national artifact."""
    from scripts.build_sirap_runtime_artifact import SUPPORTED_SIRAP_IDS
    from scripts.build_sirap_runtime_artifact import main as sirap_main

    sirap_root = _sirap_artifact_root(national_artifact_dir)
    print(f"[hydrate] SIRAP artifacts dir {sirap_root}", flush=True)
    for sirap_id in sorted(SUPPORTED_SIRAP_IDS):
        print(f"[hydrate] SIRAP {sirap_id}", flush=True)
        argv = [
            "build_sirap_runtime_artifact.py",
            "--sirap-id",
            sirap_id,
            "--artifact-dir",
            sirap_root,
        ]
        if force:
            argv.append("--force")
        sys.argv = argv
        try:
            sirap_main()
        except SystemExit as exc:
            print(f"[hydrate] SIRAP {sirap_id} failed: {exc}", flush=True)
            raise


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    artifact_dir = os.environ.get("DMT_ARTIFACT_DIR", "/backend/runtime-artifacts")
    print(f"[hydrate] starting — artifacts dir {artifact_dir}", flush=True)
    print("[hydrate] existing files are skipped; Ctrl+C or docker stop to cancel", flush=True)
    forwarded = prepend_default_args(sys.argv[1:])
    force = "--force" in forwarded
    sys.argv = [sys.argv[0], *forwarded]
    from scripts.build_runtime_artifact import main as build_main

    build_main()
    hydrate_sirap_artifacts(artifact_dir, force=force)


if __name__ == "__main__":
    main()
