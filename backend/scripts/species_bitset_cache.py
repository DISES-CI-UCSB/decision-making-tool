"""Reuse published cell-major species bitsets during hydrate.

Hydrate used to rebuild the multi-GB bitset on every run. Published kits live
under ``runtime-artifacts/species-bitsets/{kit_id}/`` on the public Blob host.
When ``DMT_SPECIES_BITSET_INDEX_URL`` is set, a missing local bitset is
downloaded and checksum-verified. Local files are skipped unless ``--force``.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from scripts.aligned_cache import sha256_file

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
INDEX_FORMAT = "dmt-species-bitset-index/v1"
BITSET_INDEX_ENV = "DMT_SPECIES_BITSET_INDEX_URL"
DEFAULT_INDEX_PATHNAME = "runtime-artifacts/species-bitsets/index.json"
DEFAULT_INDEX_URL = f"{PUBLIC_BLOB_HOST}/{DEFAULT_INDEX_PATHNAME}"
KIT_BLOB_PREFIX = "runtime-artifacts/species-bitsets"
# `national` is the legacy 4326 kit; default hydrate asks for unpublished `national-land-solution`.
SUPPORTED_KIT_IDS = ("national", "orinoquia", "eje-cafetero")

DownloadFn = Callable[..., Any]
BuildFn = Callable[..., Any]
LogFn = Callable[[str], None]


def kit_blob_pathnames(kit_id: str) -> dict[str, str]:
    prefix = f"{KIT_BLOB_PREFIX}/{kit_id}"
    return {
        "data": f"{prefix}/species.cells.bits",
        "metadata": f"{prefix}/species.cells.json",
    }


def public_url_for(pathname: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{pathname.lstrip('/')}"


def resolve_bitset_index_url(explicit: str | None = None) -> str | None:
    if explicit:
        return explicit
    raw = os.environ.get(BITSET_INDEX_ENV)
    if raw is None:
        return None
    stripped = raw.strip()
    return stripped or None


def _noop_log(_message: str) -> None:
    return None


def load_bitset_index(index_url: str, *, timeout: float = 30) -> dict[str, Any] | None:
    request = urllib.request.Request(
        index_url,
        headers={"User-Agent": "dmt-runtime-artifact/0.1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    if not isinstance(payload, dict) or payload.get("format") != INDEX_FORMAT:
        return None
    kits = payload.get("kits")
    if not isinstance(kits, dict):
        return None
    return payload


def kit_entry_from_index(index: dict[str, Any], kit_id: str) -> dict[str, Any] | None:
    kits = index.get("kits")
    if not isinstance(kits, dict):
        return None
    entry = kits.get(kit_id)
    return entry if isinstance(entry, dict) else None


def local_bitset_present(data_path: Path, metadata_path: Path) -> bool:
    return (
        data_path.is_file()
        and metadata_path.is_file()
        and data_path.stat().st_size > 0
        and metadata_path.stat().st_size > 0
    )


def _expected_file(entry: dict[str, Any], key: str) -> tuple[str, str, int]:
    raw = entry.get(key)
    if not isinstance(raw, dict):
        raise ValueError(f"bitset index kit is missing {key}")
    url = raw.get("url")
    sha256 = (raw.get("checksum") or {}).get("value") if isinstance(raw.get("checksum"), dict) else raw.get("sha256")
    size_bytes = raw.get("size_bytes")
    if not isinstance(url, str) or not url:
        raise ValueError(f"bitset index kit {key}.url is required")
    if not isinstance(sha256, str) or len(sha256) != 64:
        raise ValueError(f"bitset index kit {key} checksum is required")
    if not isinstance(size_bytes, int) or size_bytes <= 0:
        raise ValueError(f"bitset index kit {key}.size_bytes is required")
    return url, sha256, size_bytes


def download_published_bitset(
    kit_entry: dict[str, Any],
    data_path: Path,
    metadata_path: Path,
    *,
    force: bool,
    download: DownloadFn,
) -> None:
    metadata_url, metadata_sha, metadata_size = _expected_file(kit_entry, "metadata")
    data_url, data_sha, data_size = _expected_file(kit_entry, "data")
    metadata = download(metadata_url, metadata_path, force=force)
    data = download(data_url, data_path, force=force)
    if metadata.sha256 != metadata_sha or metadata.bytes != metadata_size:
        raise ValueError("published species bitset metadata checksum mismatch")
    if data.sha256 != data_sha or data.bytes != data_size:
        raise ValueError("published species bitset data checksum mismatch")


def ensure_species_bitset(
    *,
    kit_id: str,
    matrix_paths: Mapping[str, Path] | Sequence[tuple[str, Path]],
    data_path: Path,
    metadata_path: Path,
    force: bool,
    download: DownloadFn,
    build: BuildFn,
    log: LogFn = _noop_log,
    index_url: str | None = None,
) -> None:
    """Skip, download, or rebuild the cell-major bitset for *kit_id*."""
    if not force and local_bitset_present(data_path, metadata_path):
        size = data_path.stat().st_size
        log(
            f"[hydrate] skip species bitset {kit_id} "
            f"(already have {size / (1024 ** 3):.2f} GB)"
        )
        return

    resolved_index_url = resolve_bitset_index_url(index_url)
    if resolved_index_url:
        index = load_bitset_index(resolved_index_url)
        kit_entry = kit_entry_from_index(index, kit_id) if index else None
        if kit_entry is not None:
            try:
                log(f"[hydrate] downloading published species bitset {kit_id}")
                download_published_bitset(
                    kit_entry,
                    data_path,
                    metadata_path,
                    force=True,
                    download=download,
                )
                log(f"[hydrate] published species bitset {kit_id} ready")
                return
            except Exception as exc:
                log(f"[hydrate] published bitset {kit_id} unusable ({exc}); rebuilding")

    log(f"[hydrate] building species bitset {kit_id} (CPU-heavy, can take several minutes)")
    build(matrix_paths, data_path, metadata_path)
    log(f"[hydrate] species bitset {kit_id} ready")


def read_bitset_sidecar_header(metadata_path: Path) -> dict[str, Any]:
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    grid = payload.get("grid") if isinstance(payload.get("grid"), dict) else {}
    return {
        "format": payload.get("format"),
        "species_count": payload.get("species_count"),
        "bytes_per_cell": payload.get("bytes_per_cell"),
        "grid": {
            "crs": grid.get("crs"),
            "width": grid.get("width"),
            "height": grid.get("height"),
        },
    }


def file_ref(*, pathname: str, sha256: str, size_bytes: int) -> dict[str, Any]:
    return {
        "path": pathname,
        "url": public_url_for(pathname),
        "checksum": {"algorithm": "sha256", "value": sha256},
        "size_bytes": size_bytes,
    }


def build_index_document(
    kits: Mapping[str, dict[str, Any]],
    *,
    created_at: str,
) -> dict[str, Any]:
    return {
        "format": INDEX_FORMAT,
        "public_blob_host": PUBLIC_BLOB_HOST,
        "created_at": created_at,
        "kits": dict(kits),
    }


def checksum_pair(data_path: Path, metadata_path: Path) -> dict[str, dict[str, Any]]:
    return {
        "data": {
            "sha256": sha256_file(data_path),
            "size_bytes": data_path.stat().st_size,
        },
        "metadata": {
            "sha256": sha256_file(metadata_path),
            "size_bytes": metadata_path.stat().st_size,
        },
    }
