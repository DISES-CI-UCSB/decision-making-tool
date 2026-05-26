"""Helpers for talking to Vercel Blob storage from the sparse pipeline.

Wraps the ``vercel blob`` CLI with three primitives:

- :func:`list_blobs` — enumerate every blob under a path prefix.
- :func:`blob_exists` — single-blob existence check (uses a HEAD-like
  approach by listing with a tight prefix, since the CLI lacks ``head``).
- :func:`upload_blob` — push a local file to a target path.

The CLI is invoked through ``subprocess`` and given the read/write token
explicitly; the token is never logged.  Errors raise :class:`BlobError`.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
BLOB_TOKEN_ENV_VAR = "BLOB_READ_WRITE_TOKEN"

_DEFAULT_LIMIT = 1000


class BlobError(RuntimeError):
    """Wraps any failure communicating with Vercel Blob."""


@dataclass(frozen=True)
class BlobEntry:
    pathname: str
    size_bytes: int
    url: str


def _run_vercel(args: list[str], *, capture: bool = True) -> subprocess.CompletedProcess:
    """Run a ``vercel`` subcommand.

    The Vercel CLI writes its progress and table output to stderr, including
    the ``blob list`` table. We capture both streams and treat them as one
    body of text for parsing — exit code is the only signal we treat as
    fatal.
    """
    completed = subprocess.run(
        ["vercel", *args, "--no-color"],
        capture_output=capture,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        raise BlobError(
            f"vercel CLI failed (code {completed.returncode}): "
            f"{stderr or stdout or '(no output)'}"
        )
    return completed


def _combined_output(completed: subprocess.CompletedProcess) -> str:
    return (completed.stdout or "") + (completed.stderr or "")


_HEADER_PATTERN = re.compile(r"^\s*Uploaded At\s+Size\s+Pathname\s+URL\b", re.IGNORECASE)


def list_blobs(
    prefix: str,
    *,
    token: str,
    limit: int = _DEFAULT_LIMIT,
    page_size: int = _DEFAULT_LIMIT,
) -> list[BlobEntry]:
    """Return every blob whose pathname starts with *prefix*.

    The Vercel CLI caps ``--limit`` at 1000 per call but exposes ``--cursor``
    for pagination.  We follow the cursor until the CLI stops returning
    one or until *limit* entries have been collected.

    Args:
        prefix: Pathname prefix to filter on (e.g. ``inputs/features/species/``).
        token: Vercel Blob read-write token.
        limit: Hard cap on the number of entries to collect across pages
            (default 1000; pass a larger value to paginate further).
        page_size: Per-page limit handed to the CLI (max 1000).
    """
    page_size = min(page_size, 1000)
    collected: list[BlobEntry] = []
    cursor: str | None = None

    while len(collected) < limit:
        args = [
            "blob",
            "list",
            "--prefix", prefix,
            "--limit", str(page_size),
            "--rw-token", token,
        ]
        if cursor:
            args.extend(["--cursor", cursor])
        completed = _run_vercel(args)
        text = _combined_output(completed)
        page_entries = _parse_blob_list(text)
        if not page_entries:
            break
        collected.extend(page_entries)
        next_cursor = _extract_cursor(text)
        if not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor

    return collected[:limit]


_CURSOR_PATTERN = re.compile(r"--cursor\s+([A-Za-z0-9+/=]+)")


def _extract_cursor(text: str) -> str | None:
    """Pull the next-page cursor out of the CLI's footer, if any."""
    match = _CURSOR_PATTERN.search(text)
    if not match:
        return None
    return match.group(1)


def _parse_blob_list(text: str) -> list[BlobEntry]:
    entries: list[BlobEntry] = []
    lines = text.splitlines()
    body_started = False
    for raw in lines:
        if not body_started:
            if _HEADER_PATTERN.match(raw):
                body_started = True
            continue
        line = raw.rstrip()
        if not line.strip():
            continue
        # Columns are space-separated with variable width.  The pathname and
        # URL are guaranteed to be slug-safe (no spaces) so we split on
        # whitespace and re-split the trailing fields manually.
        parts = line.split()
        if len(parts) < 4:
            # The first column ("Uploaded At") may itself contain spaces (e.g.
            # "5h ago"), making >4 field splits valid but <4 not.
            continue
        # Locate the URL: must be the rightmost token starting with "https://".
        url_idx = next(
            (i for i in range(len(parts) - 1, -1, -1) if parts[i].startswith("https://")),
            -1,
        )
        if url_idx < 2:
            continue
        url = parts[url_idx]
        pathname = parts[url_idx - 1]
        size_str = parts[url_idx - 2]
        try:
            size_bytes = int(size_str)
        except ValueError:
            continue
        entries.append(BlobEntry(pathname=pathname, size_bytes=size_bytes, url=url))
    return entries


def blob_exists(path: str, *, token: str) -> bool:
    """Quick existence check: list with the exact pathname as the prefix.

    This is a subset of :func:`list_blobs` and intentionally cheap — Vercel
    Blob's CLI doesn't expose a HEAD primitive, but listing a single-pathname
    prefix returns at most one entry.
    """
    matches = list_blobs(path, token=token, limit=1)
    return any(entry.pathname == path for entry in matches)


def upload_blob(local_path: Path, remote_pathname: str, *, token: str) -> str:
    """Upload *local_path* to *remote_pathname*, returning the public URL.

    Always passes ``--force`` so re-uploads overwrite the previous artifact.
    """
    if not local_path.exists():
        raise BlobError(f"local file not found: {local_path}")
    args = [
        "blob",
        "put",
        str(local_path),
        "--pathname", remote_pathname,
        "--force",
        "--rw-token", token,
    ]
    completed = _run_vercel(args)
    return _extract_url_from_put_output(_combined_output(completed), fallback=remote_pathname)


_URL_PATTERN = re.compile(r"https://\S+")


def _extract_url_from_put_output(output: str, *, fallback: str) -> str:
    match = _URL_PATTERN.search(output or "")
    if match:
        return match.group(0)
    return f"{PUBLIC_BLOB_HOST}/{fallback.lstrip('/')}"


def load_token_from_env_file(env_file: Path | None = None) -> str:
    """Read ``BLOB_READ_WRITE_TOKEN`` from ``.env.local`` (or fall back to env)."""
    env = os.environ.get(BLOB_TOKEN_ENV_VAR)
    if env:
        return env

    candidate = env_file or Path(".env.local")
    if not candidate.exists():
        raise BlobError(
            f"{BLOB_TOKEN_ENV_VAR} not set and {candidate} does not exist"
        )

    with candidate.open(encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            if key.strip() == BLOB_TOKEN_ENV_VAR:
                return value.strip().strip('"').strip("'")
    raise BlobError(f"{BLOB_TOKEN_ENV_VAR} not found in {candidate}")


def public_url_for(pathname: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{pathname.lstrip('/')}"


def collect_existing_paths(prefix: str, *, token: str, limit: int = _DEFAULT_LIMIT) -> set[str]:
    """Return a ``set`` of pathnames currently present under *prefix*."""
    return {entry.pathname for entry in list_blobs(prefix, token=token, limit=limit)}


def iter_blob_pages(
    prefix: str, *, token: str, page_size: int = _DEFAULT_LIMIT
) -> Iterator[list[BlobEntry]]:
    """Yield successive pages of blob entries under *prefix*.

    The Vercel CLI does not expose a cursor in the simple ``list`` form, so
    this helper currently issues one call.  Kept as a generator so future
    callers can switch to pagination without changing the interface when CLI
    support lands.
    """
    yield list_blobs(prefix, token=token, limit=page_size)
