"""Immutable Vercel Blob uploads with checksum verification."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

import requests

PUBLIC_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
TOKEN_NAME = "BLOB_READ_WRITE_TOKEN"
_public_verification_available = True


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_token(repo_root: Path) -> str:
    token = os.environ.get(TOKEN_NAME)
    env_path = repo_root / ".env.local"
    if not token and env_path.is_file():
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            key, separator, value = raw_line.partition("=")
            if separator and key.strip() == TOKEN_NAME:
                token = value.strip().strip("\"'")
                break
    if not token:
        raise RuntimeError(f"{TOKEN_NAME} is required in the environment or .env.local")
    return token


def public_url(blob_path: str) -> str:
    return f"{PUBLIC_HOST}/{blob_path.lstrip('/')}"


def remote_sha256(url: str) -> str | None:
    last_error: requests.RequestException | None = None
    for attempt in range(3):
        try:
            response = requests.get(url, timeout=120)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return hashlib.sha256(response.content).hexdigest()
        except requests.RequestException as error:
            last_error = error
            if attempt < 2:
                time.sleep(min(2**attempt, 10))
    raise RuntimeError(f"could not verify public Blob URL {url}: {last_error}")


def destination_size(blob_path: str, token: str) -> int | None:
    completed = subprocess.run(
        [
            "vercel",
            "blob",
            "list",
            "--rw-token",
            token,
            "--limit",
            "10",
            "--prefix",
            blob_path,
            "--no-color",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode:
        message = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(f"could not list Vercel Blob destination: {message}")
    output = f"{completed.stdout}\n{completed.stderr}"
    if "No blobs in this store" in output:
        return None
    match = re.search(rf"\s+(\d+)\s+{re.escape(blob_path)}\s+", output)
    if not match:
        raise RuntimeError(f"unexpected Blob listing response for exact path {blob_path}")
    return int(match.group(1))


def _receipt_path(local_path: Path) -> Path:
    return local_path.with_suffix(f"{local_path.suffix}.upload-receipt.json")


def _write_receipt(local_path: Path, blob_path: str, sha256: str) -> None:
    _receipt_path(local_path).write_text(
        json.dumps(
            {
                "blobPath": blob_path,
                "bytes": local_path.stat().st_size,
                "sha256": sha256,
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _receipt_matches(local_path: Path, blob_path: str, sha256: str) -> bool:
    path = _receipt_path(local_path)
    if not path.is_file():
        return False
    try:
        receipt = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return receipt == {
        "blobPath": blob_path,
        "bytes": local_path.stat().st_size,
        "sha256": sha256,
    }


def upload_immutable(local_path: Path, blob_path: str, token: str) -> dict[str, str]:
    """Upload only absent content; identical existing content is accepted."""

    global _public_verification_available
    url = public_url(blob_path)
    local_sha = sha256_file(local_path)
    existing_size = destination_size(blob_path, token)
    if existing_size is not None:
        if existing_size != local_path.stat().st_size:
            raise RuntimeError(
                f"immutable destination already contains different content: {blob_path}"
            )
        try:
            if not _public_verification_available:
                raise RuntimeError("public Blob verification is unavailable")
            existing_sha = remote_sha256(url)
        except RuntimeError:
            _public_verification_available = False
            if not _receipt_matches(local_path, blob_path, local_sha):
                raise
            return {
                "path": blob_path,
                "url": url,
                "sha256": local_sha,
                "status": "existing",
                "verification": "authenticated-size-and-local-upload-receipt",
            }
        if existing_sha != local_sha:
            raise RuntimeError(
                f"immutable destination already contains different content: {blob_path}"
            )
        return {
            "path": blob_path,
            "url": url,
            "sha256": local_sha,
            "status": "existing",
            "verification": "public-url-sha256",
        }

    completed = subprocess.run(
        [
            "vercel",
            "blob",
            "put",
            str(local_path),
            "--pathname",
            blob_path,
            "--rw-token",
            token,
            "--no-color",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode:
        message = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(f"Vercel Blob upload failed for {blob_path}: {message}")
    _write_receipt(local_path, blob_path, local_sha)

    try:
        if not _public_verification_available:
            raise RuntimeError("public Blob verification is unavailable")
        uploaded_sha = remote_sha256(url)
    except RuntimeError:
        _public_verification_available = False
        verified_size = destination_size(blob_path, token)
        if verified_size != local_path.stat().st_size:
            raise RuntimeError(f"uploaded size mismatch for {blob_path}")
        return {
            "path": blob_path,
            "url": url,
            "sha256": local_sha,
            "status": "uploaded",
            "verification": "authenticated-size-and-local-upload-receipt",
        }
    if uploaded_sha != local_sha:
        raise RuntimeError(
            f"uploaded checksum mismatch for {blob_path}: {uploaded_sha} != {local_sha}"
        )
    return {
        "path": blob_path,
        "url": url,
        "sha256": local_sha,
        "status": "uploaded",
        "verification": "public-url-sha256",
    }
