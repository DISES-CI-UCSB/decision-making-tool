"""Vercel Blob helpers for the RUNAP identify-geojson build.

Public blob host is fixed by the workspace rule; the read/write token is read
from `.env.local` at the repo root (or any process-level env) so we never need
to hardcode credentials.
"""

from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path
from typing import Iterable

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"


def public_url(pathname: str) -> str:
    """Return the public Blob URL for a given pathname (no leading slash)."""
    return f"{PUBLIC_BLOB_HOST}/{pathname.lstrip('/')}"


def download_to(pathnames: Iterable[str], dest_dir: Path) -> dict[str, Path]:
    """Download every Blob pathname into dest_dir (flat layout, preserving basename)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for pathname in pathnames:
        local_path = dest_dir / Path(pathname).name
        if local_path.exists() and local_path.stat().st_size > 0:
            print(f"[blob] cached {pathname} → {local_path}")
        else:
            url = public_url(pathname)
            print(f"[blob] downloading {url}")
            urllib.request.urlretrieve(url, local_path)
        out[pathname] = local_path
    return out


def load_env_file(env_path: Path) -> None:
    """Mirror `set -a && source .env.local` — populate os.environ from KEY=VALUE lines."""
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def upload_via_vercel_cli(local_path: Path, target_pathname: str) -> None:
    """Upload a file to Vercel Blob via the `vercel blob put` CLI command.

    Requires `BLOB_READ_WRITE_TOKEN` in the environment. We shell out to the
    Vercel CLI rather than POSTing directly so the workflow matches the
    existing data-deploy pattern in this repo.
    """
    token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if not token:
        raise RuntimeError(
            "BLOB_READ_WRITE_TOKEN missing — source .env.local before running with --upload."
        )
    import subprocess

    # NOTE: do NOT pass `--add-random-suffix` — the Vercel CLI parses any value
    # (even `false`) as truthy and appends a random suffix anyway, breaking the
    # public URL. The flag defaults to false when omitted.
    cmd = [
        "vercel",
        "blob",
        "put",
        str(local_path),
        "--pathname",
        target_pathname,
        "--rw-token",
        token,
        "--force",
    ]
    print(f"[blob] uploading {local_path.name} → {target_pathname}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stdout + "\n" + result.stderr + "\n")
        raise RuntimeError(f"vercel blob put failed (exit {result.returncode})")
    print(result.stdout.strip())
