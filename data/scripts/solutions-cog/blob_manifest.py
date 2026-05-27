"""Vercel Blob layer manifest fetching and solution lookup helpers."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

DEFAULT_MANIFEST_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com/manifest/manifest.json"
)


class ManifestError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResolvedManifest:
    url: str
    raw: dict[str, Any]
    public_blob_host: str
    national_solutions: list[dict[str, Any]]


def fetch_manifest(url: str | None = None, *, timeout: int = 30) -> ResolvedManifest:
    target = (url or DEFAULT_MANIFEST_URL).strip()
    if not target:
        raise ManifestError("Manifest URL is empty.")

    cache_buster_url = f"{target}{'&' if '?' in target else '?'}v={int(time.time())}"
    req = urllib.request.Request(cache_buster_url, headers={"User-Agent": "solutions-cog/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        raise ManifestError(f"Failed to fetch manifest at {target}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ManifestError(f"Manifest at {target} is not valid JSON: {exc}") from exc

    return _validate_and_index(target, payload)


def _validate_and_index(url: str, payload: Any) -> ResolvedManifest:
    if not isinstance(payload, dict):
        raise ManifestError("Manifest root is not a JSON object.")
    for key in ("publicBlobHost", "solutions"):
        if key not in payload:
            raise ManifestError(f"Manifest is missing required field '{key}'.")

    public_host = str(payload["publicBlobHost"]).rstrip("/")
    solutions = payload["solutions"]
    if not isinstance(solutions, list):
        raise ManifestError("Manifest 'solutions' must be a list.")

    national: list[dict[str, Any]] = []
    for solution in solutions:
        if not isinstance(solution, dict):
            continue
        if str(solution.get("scope", "")).lower() != "nacional":
            continue
        for key in ("id", "displayUrl", "blobPath"):
            if not solution.get(key):
                raise ManifestError(
                    f"National solution missing required field '{key}': "
                    f"{solution.get('id', '<unknown>')}"
                )
        national.append(solution)

    if not national:
        raise ManifestError("Manifest contains no national-scope solutions.")

    return ResolvedManifest(
        url=url,
        raw=payload,
        public_blob_host=public_host,
        national_solutions=national,
    )


def solution_blob_basename(solution: dict[str, Any]) -> str:
    """Return the source raster basename without extension."""

    raster_file = solution.get("rasterFile") or ""
    if raster_file:
        return raster_file.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    blob_path = solution.get("blobPath") or ""
    if blob_path:
        return blob_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return str(solution.get("id", "unknown"))
