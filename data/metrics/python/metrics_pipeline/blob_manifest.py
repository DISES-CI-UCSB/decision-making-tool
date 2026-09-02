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


_SIRAP_PACKET_FORMAT = "sirap-metric-input-packet-v1"


def is_sirap_solution(solution: dict[str, Any]) -> bool:
    """Return whether a solution must use only regional packet sources."""
    return str(solution.get("scope") or "").strip().lower() == "sirap"


def _require_packet_string(
    packet: dict[str, Any],
    field: str,
    *,
    solution_id: str,
) -> str:
    value = packet.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket requires "
            f"non-empty '{field}'."
        )
    return value


def _require_sha256(packet: dict[str, Any], field: str, *, solution_id: str) -> str:
    value = _require_packet_string(packet, field, solution_id=solution_id)
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value.lower()):
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket requires "
            f"'{field}' to be a SHA-256 hex digest."
        )
    return value.lower()


def _validate_sirap_packet(solution: dict[str, Any]) -> None:
    """Validate the immutable regional sources required for SIRAP analysis."""
    solution_id = str(solution.get("id", "<unknown>"))
    packet = solution.get("regionalInputPacket")
    if not isinstance(packet, dict):
        raise ManifestError(
            f"SIRAP solution {solution_id!r} missing required "
            "'regionalInputPacket'."
        )
    if packet.get("format") != _SIRAP_PACKET_FORMAT:
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket must use "
            f"format '{_SIRAP_PACKET_FORMAT}'."
        )
    region_id = _require_packet_string(packet, "regionId", solution_id=solution_id)
    if region_id != str(solution.get("sirapId")):
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket regionId "
            f"{region_id!r} does not match sirapId {solution.get('sirapId')!r}."
        )

    grid = packet.get("grid")
    if not isinstance(grid, dict):
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket requires 'grid'."
        )
    _require_sha256(grid, "sha256", solution_id=solution_id)

    summary = packet.get("authoritativeSummary")
    if not isinstance(summary, dict):
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket requires "
            "'authoritativeSummary'."
        )
    for field in ("url", "schema"):
        _require_packet_string(summary, field, solution_id=solution_id)
    _require_sha256(summary, "sha256", solution_id=solution_id)

    layers = packet.get("layers")
    if not isinstance(layers, dict) or not layers:
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket requires "
            "a non-empty 'layers' map."
        )
    for layer_id, layer in layers.items():
        if not isinstance(layer_id, str) or not layer_id or not isinstance(layer, dict):
            raise ManifestError(
                f"SIRAP solution {solution_id!r} has invalid packet layer "
                f"{layer_id!r}."
            )
        _require_packet_string(layer, "url", solution_id=solution_id)
        _require_sha256(layer, "sha256", solution_id=solution_id)

    species = packet.get("species")
    if not isinstance(species, dict):
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket requires 'species'."
        )
    if species.get("universePolicy") != "regional-summary":
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket species "
            "universePolicy must be 'regional-summary'."
        )
    matrices = species.get("matrices")
    if not isinstance(matrices, list) or not matrices:
        raise ManifestError(
            f"SIRAP solution {solution_id!r} regionalInputPacket species "
            "requires a non-empty 'matrices' list."
        )
    for matrix in matrices:
        if not isinstance(matrix, dict):
            raise ManifestError(
                f"SIRAP solution {solution_id!r} has an invalid species matrix."
            )
        for field in ("taxonomicClass", "format", "url"):
            _require_packet_string(matrix, field, solution_id=solution_id)
        _require_sha256(matrix, "sha256", solution_id=solution_id)
        _require_sha256(matrix, "gridSha256", solution_id=solution_id)


def resolve_solution_layer(
    manifest: "ResolvedManifest",
    solution: dict[str, Any],
    layer_id: str,
) -> dict[str, Any]:
    """Resolve one source binding, forbidding global fallback for SIRAP."""
    if is_sirap_solution(solution):
        packet = solution["regionalInputPacket"]
        layer = packet["layers"].get(layer_id)
        if not isinstance(layer, dict):
            raise ManifestError(
                f"SIRAP solution {solution.get('id')!r} has no packet binding "
                f"for layer '{layer_id}'; national sources are forbidden."
            )
        return layer
    layer = manifest.layers_by_id.get(layer_id)
    if layer is None:
        raise ManifestError(f"Manifest has no layer with id '{layer_id}'.")
    return layer


def regional_packet_identity(solution: dict[str, Any]) -> dict[str, Any] | None:
    """Return immutable regional identity included in SIRAP cache cohorts."""
    if not is_sirap_solution(solution):
        return None
    packet = solution["regionalInputPacket"]
    return {
        "format": packet["format"],
        "regionId": packet["regionId"],
        "gridSha256": packet["grid"]["sha256"],
        "authoritativeSummary": packet["authoritativeSummary"],
        "layers": packet["layers"],
        "species": packet["species"],
    }


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
        if str(sol.get("scope") or "").strip().lower() == "sirap" and not sol.get(
            "sirapId"
        ):
            raise ManifestError(
                "SIRAP solution missing required field 'sirapId': "
                f"{sol.get('id', '<unknown>')}"
            )
        if str(sol.get("scope") or "").strip().lower() == "sirap":
            _validate_sirap_packet(sol)
        batch.append(sol)
        if domain == "land":
            national.append(sol)

    if not batch:
        raise ManifestError(
            "Manifest contains no national, SIRAP, or marine solutions."
        )

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
