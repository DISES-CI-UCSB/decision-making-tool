"""Resolve rasters the metrics pipeline already aligned to a target grid.

The pipeline writes ``<cache>/aligned/<key[:2]>/<key>.tif`` plus a ``<key>.json``
sidecar describing the source bytes, exact target grid, and resampling policy
that produced it (see ``metrics_pipeline/raster_align.py``).

Entries are resolved by reading those sidecars rather than by recomputing the
cache key. The key digests the rasterio, GDAL, and PROJ versions of the machine
that wrote the entry, and the backend venv does not share them, so a recomputed
key would never hit.
"""

from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import rasterio

REPO_ROOT = Path(__file__).resolve().parents[2]
METRICS_PIPELINE = REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"
if str(METRICS_PIPELINE) not in sys.path:
    sys.path.insert(0, str(METRICS_PIPELINE))

from raster_metrics import RasterFingerprint  # noqa: E402

ALIGNMENT_MANIFEST_FORMAT = "metrics-raster-alignment-v3"

# Mirrors AlignmentPolicy.__post_init__ in raster_align.py: the layer class
# dictates the resampling, so a class mismatch is a resampling mismatch.
RESAMPLING_BY_LAYER_CLASS = {
    "binary": "nearest",
    "categorical": "nearest",
    "continuous_intensive": "bilinear",
    "fraction_or_density": "average",
    "extensive": "sum",
}


class AlignedCacheError(RuntimeError):
    """Raised when an aligned raster cannot be resolved or fails verification."""


@dataclass(frozen=True)
class AlignedRaster:
    layer_id: str
    path: Path
    source_url: str
    source_sha256: str
    aligned_sha256: str
    cache_key: str
    layer_class: str
    resampling: str


def grid_descriptor(fingerprint: RasterFingerprint) -> dict[str, Any]:
    return {
        "width": fingerprint.width,
        "height": fingerprint.height,
        "transform": list(fingerprint.transform),
        "crs": fingerprint.crs,
    }


def read_fingerprint(path: Path) -> RasterFingerprint:
    with rasterio.open(path) as dataset:
        transform = dataset.transform
        return RasterFingerprint(
            width=dataset.width,
            height=dataset.height,
            transform=(
                transform.a,
                transform.b,
                transform.c,
                transform.d,
                transform.e,
                transform.f,
            ),
            crs=str(dataset.crs) if dataset.crs else None,
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class AlignedRasterCache:
    """Read-only view over the metrics pipeline's aligned raster cache."""

    def __init__(self, cache_dir: Path) -> None:
        self.root = Path(cache_dir).resolve() / "aligned"
        if not self.root.is_dir():
            raise AlignedCacheError(f"Aligned cache directory not found: {self.root}")
        self._sidecars = self._load_sidecars()
        if not self._sidecars:
            raise AlignedCacheError(
                f"Aligned cache {self.root} holds no {ALIGNMENT_MANIFEST_FORMAT} entries."
            )

    def _load_sidecars(self) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for sidecar_path in sorted(self.root.glob("*/*.json")):
            try:
                sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise AlignedCacheError(f"Unreadable aligned sidecar {sidecar_path}: {exc}") from exc
            if sidecar.get("format") == ALIGNMENT_MANIFEST_FORMAT:
                entries.append(sidecar)
        return entries

    def target_grids(self) -> list[dict[str, Any]]:
        """Return the distinct target grids present in the cache."""
        grids: list[dict[str, Any]] = []
        for sidecar in self._sidecars:
            grid = sidecar["targetGrid"]
            if grid not in grids:
                grids.append(grid)
        return grids

    def lookup(
        self,
        layer_id: str,
        *,
        source_url: str,
        layer_class: str,
        target: RasterFingerprint,
    ) -> AlignedRaster:
        """Return the aligned raster for one source, grid, and resampling policy."""
        expected_resampling = RESAMPLING_BY_LAYER_CLASS.get(layer_class)
        if expected_resampling is None:
            raise AlignedCacheError(f"Layer {layer_id!r} has unknown layer class {layer_class!r}.")

        descriptor = grid_descriptor(target)
        matches = [
            sidecar
            for sidecar in self._sidecars
            if sidecar.get("sourceUrl") == source_url
            and sidecar.get("targetGrid") == descriptor
            and (sidecar.get("policy") or {}).get("layer_class") == layer_class
        ]
        if not matches:
            raise AlignedCacheError(
                f"No aligned raster for layer {layer_id!r} "
                f"({layer_class}/{expected_resampling}) on {descriptor['crs']} "
                f"{descriptor['width']}x{descriptor['height']}. Source: {source_url}"
            )
        if len(matches) > 1:
            keys = ", ".join(sorted(str(match.get("cacheKey")) for match in matches))
            raise AlignedCacheError(
                f"Aligned cache holds {len(matches)} entries for layer {layer_id!r}: {keys}"
            )

        sidecar = matches[0]
        policy = sidecar["policy"]
        if policy.get("resampling") != expected_resampling:
            raise AlignedCacheError(
                f"Layer {layer_id!r} expects {expected_resampling!r} resampling "
                f"but the cached entry used {policy.get('resampling')!r}."
            )

        cache_key = str(sidecar["cacheKey"])
        path = self.root / cache_key[:2] / f"{cache_key}.tif"
        if not path.is_file():
            raise AlignedCacheError(f"Aligned raster missing for layer {layer_id!r}: {path}")

        aligned_sha256 = sha256_file(path)
        if aligned_sha256 != sidecar.get("alignedSha256"):
            raise AlignedCacheError(
                f"Aligned raster for layer {layer_id!r} does not match its recorded checksum: {path}"
            )
        observed = read_fingerprint(path)
        if grid_descriptor(observed) != descriptor:
            raise AlignedCacheError(
                f"Aligned raster for layer {layer_id!r} does not sit on the target grid: {path}"
            )

        return AlignedRaster(
            layer_id=layer_id,
            path=path,
            source_url=source_url,
            source_sha256=str(sidecar["sourceSha256"]),
            aligned_sha256=aligned_sha256,
            cache_key=cache_key,
            layer_class=layer_class,
            resampling=expected_resampling,
        )
