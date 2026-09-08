from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import threading
import urllib.parse
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _install_metrics_pipeline_path() -> None:
    candidates: list[Path] = []
    configured = os.getenv("DMT_METRICS_PIPELINE_PATH")
    if configured:
        candidates.append(Path(configured))
    candidates.append(
        Path(__file__).resolve().parents[2]
        / "data"
        / "metrics"
        / "python"
        / "metrics_pipeline"
    )
    for candidate in candidates:
        if (candidate / "raster_metrics.py").is_file():
            candidate_text = str(candidate)
            if candidate_text not in sys.path:
                sys.path.insert(0, candidate_text)
            return
    raise RuntimeError("Unable to locate metrics pipeline source.")


_install_metrics_pipeline_path()

import math

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject

from raster_metrics import RasterFingerprint, SolutionRaster, read_solution_raster


class SolutionRegistryError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeSolutionEntry:
    solution_id: str
    source_url: str
    release_id: str
    local_path: Path | None = None


@dataclass
class RuntimeSolutionRegistry:
    entries: dict[str, RuntimeSolutionEntry]
    cache_dir: Path
    reference_fingerprint: RasterFingerprint
    public_blob_host: str
    max_loaded_rasters: int = 2
    _loaded: OrderedDict[str, tuple[SolutionRaster, str]] = field(
        default_factory=OrderedDict,
        init=False,
        repr=False,
    )
    _lock: threading.Lock = field(
        default_factory=threading.Lock,
        init=False,
        repr=False,
    )

    def load(self, solution_id: str) -> tuple[SolutionRaster, str]:
        entry = self.entries.get(solution_id)
        if entry is None:
            raise SolutionRegistryError(f"solution_not_registered:{solution_id}")

        with self._lock:
            loaded = self._loaded.pop(solution_id, None)
            if loaded is not None:
                self._loaded[solution_id] = loaded
                return loaded

            path, checksum = self._resolve_cached_raster(entry)
            try:
                raster = read_solution_raster(path)
            except Exception as exc:
                raise SolutionRegistryError(
                    f"solution_raster_invalid:{solution_id}:{exc}"
                ) from exc
            if not raster.fingerprint.matches(self.reference_fingerprint):
                try:
                    raster = self._align_to_reference(path, raster)
                except Exception as exc:
                    raise SolutionRegistryError(
                        f"solution_raster_grid_mismatch:{solution_id}"
                    ) from exc
            if not _fingerprints_compatible(
                raster.fingerprint, self.reference_fingerprint
            ):
                raise SolutionRegistryError(
                    f"solution_raster_grid_mismatch:{solution_id}"
                )
            if not raster.fingerprint.matches(self.reference_fingerprint):
                raster = _with_reference_fingerprint(raster, self.reference_fingerprint)

            self._loaded[solution_id] = (raster, checksum)
            while len(self._loaded) > self.max_loaded_rasters:
                self._loaded.popitem(last=False)
            return raster, checksum

    def metadata(self) -> dict[str, Any]:
        locally_bound = [
            solution_id
            for solution_id, entry in self.entries.items()
            if entry.local_path is not None
        ]
        return {
            "status": "ready",
            "registered_solution_count": len(self.entries),
            "loaded_solution_count": len(self._loaded),
            "locally_bound_solution_count": len(locally_bound),
            "locally_bound_solution_ids": locally_bound,
            "category_semantics": {
                "1": "new_prioritizr",
                "2": "pre_existing_aggregate",
            },
        }

    def close(self) -> None:
        self._loaded.clear()

    def _resolve_cached_raster(
        self,
        entry: RuntimeSolutionEntry,
    ) -> tuple[Path, str]:
        if entry.local_path is not None and entry.local_path.is_file():
            return entry.local_path, _sha256(entry.local_path)

        cache_key = hashlib.sha256(
            f"{entry.release_id}\0{entry.solution_id}\0{entry.source_url}".encode()
        ).hexdigest()
        raster_path = self.cache_dir / f"{cache_key}.tif"
        metadata_path = self.cache_dir / f"{cache_key}.json"
        if raster_path.is_file() and metadata_path.is_file():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                expected_checksum = str(metadata["sha256"])
                if (
                    metadata.get("solution_id") == entry.solution_id
                    and metadata.get("source_url") == entry.source_url
                    and _sha256(raster_path) == expected_checksum
                ):
                    return raster_path, expected_checksum
            except (OSError, json.JSONDecodeError, KeyError, TypeError):
                pass
            raster_path.unlink(missing_ok=True)
            metadata_path.unlink(missing_ok=True)

        self.cache_dir.mkdir(parents=True, exist_ok=True)
        raster_tmp = raster_path.with_name(f".{raster_path.name}.part")
        metadata_tmp = metadata_path.with_name(f".{metadata_path.name}.tmp")
        request = urllib.request.Request(
            entry.source_url,
            headers={"User-Agent": "dmt-solution-registry/1"},
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                with raster_tmp.open("wb") as output:
                    shutil.copyfileobj(response, output)
            checksum = _sha256(raster_tmp)
            metadata_tmp.write_text(
                json.dumps(
                    {
                        "solution_id": entry.solution_id,
                        "source_url": entry.source_url,
                        "release_id": entry.release_id,
                        "sha256": checksum,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            raster_tmp.replace(raster_path)
            metadata_tmp.replace(metadata_path)
            return raster_path, checksum
        except Exception as exc:
            raster_tmp.unlink(missing_ok=True)
            metadata_tmp.unlink(missing_ok=True)
            raise SolutionRegistryError(
                f"solution_raster_download_failed:{entry.solution_id}:{exc}"
            ) from exc

    def _align_to_reference(self, source_path: Path, raster: SolutionRaster) -> SolutionRaster:
        aligned_path = source_path.with_name(
            f"{source_path.stem}.aligned-{_fingerprint_key(self.reference_fingerprint)}.tif"
        )
        if not aligned_path.is_file():
            align_solution_raster_to_reference(
                source_path,
                aligned_path,
                self.reference_fingerprint,
            )
        aligned = read_solution_raster(aligned_path)
        if _fingerprints_compatible(aligned.fingerprint, self.reference_fingerprint):
            return aligned
        raise SolutionRegistryError(
            f"solution_raster_align_failed:{source_path.name}"
        )


def align_solution_raster_to_reference(
    source_path: Path,
    dest_path: Path,
    reference: RasterFingerprint,
) -> None:
    """Nearest-neighbor warp of a categorical 0/1/2 solution onto the AOI grid."""
    if reference.crs is None:
        raise SolutionRegistryError("reference_grid_crs_missing")
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest_path.with_name(f".{dest_path.name}.part")
    with rasterio.open(source_path) as source:
        if source.crs is None:
            raise SolutionRegistryError("solution_raster_crs_missing")
        nodata = source.nodata if source.nodata is not None else 255
        destination = np.full(
            (reference.height, reference.width),
            nodata,
            dtype=source.dtypes[0],
        )
        reproject(
            source=source.read(1),
            destination=destination,
            src_transform=source.transform,
            src_crs=source.crs,
            src_nodata=source.nodata,
            dst_transform=Affine(*reference.transform),
            dst_crs=reference.crs,
            dst_nodata=nodata,
            resampling=Resampling.nearest,
            init_dest_nodata=True,
        )
        profile = source.profile.copy()
        profile.update(
            {
                "driver": "GTiff",
                "height": reference.height,
                "width": reference.width,
                "transform": Affine(*reference.transform),
                "crs": reference.crs,
                "count": 1,
                "nodata": nodata,
            }
        )
        with rasterio.open(tmp, "w", **profile) as output:
            output.write(destination, 1)
    tmp.replace(dest_path)


def _fingerprint_key(fingerprint: RasterFingerprint) -> str:
    payload = (
        f"{fingerprint.width}|{fingerprint.height}|{fingerprint.crs}|"
        f"{','.join(f'{value:.12g}' for value in fingerprint.transform)}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _fingerprints_compatible(
    left: RasterFingerprint,
    right: RasterFingerprint,
) -> bool:
    if left.matches(right):
        return True
    if left.width != right.width or left.height != right.height:
        return False
    if left.crs is None or right.crs is None:
        return False
    if not all(
        math.isclose(a, b, abs_tol=1e-7)
        for a, b in zip(left.transform, right.transform)
    ):
        return False
    try:
        return CRS.from_user_input(left.crs) == CRS.from_user_input(right.crs)
    except Exception:
        return False


def _with_reference_fingerprint(
    raster: SolutionRaster,
    reference: RasterFingerprint,
) -> SolutionRaster:
    return SolutionRaster(
        path=raster.path,
        selected_mask=raster.selected_mask,
        valid_mask=raster.valid_mask,
        pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
        fingerprint=reference,
        selected_cells=raster.selected_cells,
        valid_cells=raster.valid_cells,
        category_values=raster.category_values,
        new_prioritizr_mask=raster.new_prioritizr_mask,
        pre_existing_mask=raster.pre_existing_mask,
    )


def build_solution_registry(
    raw_entries: Any,
    *,
    cache_dir: Path,
    reference_fingerprint: RasterFingerprint,
    public_blob_host: str,
    release_id: str,
) -> RuntimeSolutionRegistry | None:
    if raw_entries is None:
        return None
    if not isinstance(raw_entries, list):
        raise SolutionRegistryError("solution_rasters_must_be_a_list")

    allowed_host = urllib.parse.urlparse(public_blob_host).netloc
    entries: dict[str, RuntimeSolutionEntry] = {}
    for index, raw in enumerate(raw_entries):
        if not isinstance(raw, dict):
            raise SolutionRegistryError(f"solution_registry_entry_invalid:{index}")
        solution_id = raw.get("solution_id")
        source_url = raw.get("source_url")
        if not isinstance(solution_id, str) or not solution_id:
            raise SolutionRegistryError(f"solution_registry_id_missing:{index}")
        if not isinstance(source_url, str) or not source_url:
            raise SolutionRegistryError(
                f"solution_registry_source_url_missing:{solution_id}"
            )
        parsed = urllib.parse.urlparse(source_url)
        if parsed.scheme != "https" or parsed.netloc != allowed_host:
            raise SolutionRegistryError(
                f"solution_registry_source_not_allowed:{solution_id}"
            )
        if solution_id in entries:
            raise SolutionRegistryError(
                f"solution_registry_duplicate_id:{solution_id}"
            )
        raw_local_path = raw.get("local_path")
        local_path = (
            Path(raw_local_path)
            if isinstance(raw_local_path, str) and raw_local_path
            else None
        )
        entries[solution_id] = RuntimeSolutionEntry(
            solution_id=solution_id,
            source_url=source_url,
            release_id=release_id,
            local_path=local_path,
        )
    return RuntimeSolutionRegistry(
        entries=entries,
        cache_dir=cache_dir,
        reference_fingerprint=reference_fingerprint,
        public_blob_host=public_blob_host,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
