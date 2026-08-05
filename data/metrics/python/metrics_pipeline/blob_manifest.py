"""Vercel Blob layer manifest fetching, validation, and lookup helpers.

Validates only the fields the Tier 1 batch needs and fails clearly when
required entries are missing.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from solution_domain import is_batch_solution, solution_domain

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
    layers_by_id: dict[str, dict[str, Any]]
    national_solutions: list[dict[str, Any]]
    batch_solutions: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Compatibility for callers that still construct this class with only
        # the historical national_solutions field.
        if not self.batch_solutions:
            object.__setattr__(self, "batch_solutions", self.national_solutions)


def fetch_manifest(url: str | None = None, *, timeout: int = 30) -> ResolvedManifest:
    target = (url or DEFAULT_MANIFEST_URL).strip()
    if not target:
        raise ManifestError("Manifest URL is empty.")

    parsed = urlsplit(target)
    if parsed.scheme == "file":
        try:
            payload = json.loads(
                Path(unquote(parsed.path)).read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as exc:
            raise ManifestError(
                f"Failed to read local manifest at {target}: {exc}"
            ) from exc
        return _validate_and_index(target, payload)

    cache_buster_url = f"{target}{'&' if '?' in target else '?'}v={int(__import__('time').time())}"
    req = urllib.request.Request(cache_buster_url, headers={"User-Agent": "tier1-metrics/0.1"})
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
    for key in ("publicBlobHost", "layers", "solutions"):
        if key not in payload:
            raise ManifestError(f"Manifest is missing required field '{key}'.")

    public_host = str(payload["publicBlobHost"]).rstrip("/")

    layers = payload["layers"]
    if not isinstance(layers, list) or not layers:
        raise ManifestError("Manifest 'layers' must be a non-empty list.")
    layers_by_id: dict[str, dict[str, Any]] = {}
    for layer in layers:
        if not isinstance(layer, dict) or "id" not in layer:
            raise ManifestError(f"Encountered a layer entry without an id: {layer!r}")
        layers_by_id[str(layer["id"])] = layer

    solutions = payload["solutions"]
    if not isinstance(solutions, list):
        raise ManifestError("Manifest 'solutions' must be a list.")

    batch: list[dict[str, Any]] = []
    national: list[dict[str, Any]] = []
    for sol in solutions:
        if not isinstance(sol, dict):
            continue
        try:
            if not is_batch_solution(sol):
                continue
            domain = solution_domain(sol)
        except ValueError as exc:
            raise ManifestError(str(exc)) from exc
        for key in ("id", "displayUrl", "blobPath"):
            if not sol.get(key):
                raise ManifestError(
                    f"Batch solution missing required field '{key}': "
                    f"{sol.get('id', '<unknown>')}"
                )
        batch.append(sol)
        if domain == "land":
            national.append(sol)

    if not batch:
        raise ManifestError("Manifest contains no land/nacional or marine solutions.")

    return ResolvedManifest(
        url=url,
        raw=payload,
        public_blob_host=public_host,
        layers_by_id=layers_by_id,
        national_solutions=national,
        batch_solutions=batch,
    )


def resolve_layer_display_url(manifest: ResolvedManifest, layer_id: str) -> str:
    layer = manifest.layers_by_id.get(layer_id)
    if layer is None:
        raise ManifestError(f"Manifest has no layer with id '{layer_id}'.")
    url = layer.get("displayUrl")
    if not url:
        raise ManifestError(
            f"Layer '{layer_id}' has no displayUrl; cannot read raster for overlap metrics."
        )
    return str(url)


def solution_blob_basename(solution: dict[str, Any]) -> str:
    """Return the solution raster filename, including its extension."""

    raster_file = solution.get("rasterFile") or ""
    if raster_file:
        return raster_file.rsplit("/", 1)[-1]
    blob_path = solution.get("blobPath") or ""
    if blob_path:
        return blob_path.rsplit("/", 1)[-1]
    display_url = str(solution.get("displayUrl") or "").split("?", 1)[0]
    if display_url:
        return display_url.rsplit("/", 1)[-1]
    return str(solution.get("id", "unknown"))
