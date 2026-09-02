"""Publish a validated immutable SIRAP release and verify every uploaded byte."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from main import PUBLIC_BLOB_HOST, blob_path, validate


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_token(repo_root: Path) -> str:
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if token:
        return token
    for line in (repo_root / ".env.local").read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if key.strip() == "BLOB_READ_WRITE_TOKEN" and separator:
            return value.strip().strip("'\"")
    raise RuntimeError("BLOB_READ_WRITE_TOKEN is required in .env.local")


def public_url(path: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{path}"


def upload(token: str, source: Path, destination: str) -> None:
    completed = subprocess.run(
        ["vercel", "blob", "put", str(source), "--pathname", destination, "--rw-token", token, "--no-color"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip())


def remote_sha256(url: str) -> str | None:
    request = urllib.request.Request(url, headers={"User-Agent": "sirap-release-publisher/1"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return hashlib.sha256(response.read()).hexdigest()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def wait_for_remote_sha256(url: str, expected_sha256: str) -> str:
    for attempt in range(5):
        observed_sha256 = remote_sha256(url)
        if observed_sha256 == expected_sha256:
            return observed_sha256
        if attempt < 4:
            time.sleep(0.5 * (2**attempt))
    raise RuntimeError(f"remote checksum mismatch: {url}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    args = parser.parse_args()
    release_root = args.release_root.resolve()
    validate(release_root)
    inventory = json.loads((release_root / "release-artifact-inventory.json").read_text(encoding="utf-8"))
    uploads = [
        (release_root / item["path"], item["blobPath"], item["sha256"])
        for item in inventory["artifacts"]
    ]
    release_id = inventory["releaseId"]
    for filename in ("catalog.json", "manifest.json", "release-artifact-inventory.json"):
        source = release_root / filename
        uploads.append((source, blob_path(release_id, Path(filename)), sha256_file(source)))

    token = load_token(args.repo_root.resolve())
    results = []
    for source, destination, expected_sha256 in uploads:
        url = public_url(destination)
        if remote_sha256(url) != expected_sha256:
            upload(token, source, destination)
        observed_sha256 = wait_for_remote_sha256(url, expected_sha256)
        results.append({"path": destination, "url": url, "sha256": observed_sha256})

    report = {
        "format": "sirap-release-remote-verification-v1",
        "releaseId": release_id,
        "ok": True,
        "uploadCount": len(results),
        "manifestUrl": public_url(blob_path(release_id, Path("manifest.json"))),
        "entries": results,
    }
    (release_root / "remote-verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
