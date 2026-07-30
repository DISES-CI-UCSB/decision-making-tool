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

from raster_metrics import RasterFingerprint, SolutionRaster, read_solution_raster


class SolutionRegistryError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeSolutionEntry:
    solution_id: str
    source_url: str
    release_id: str


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
                raise SolutionRegistryError(
                    f"solution_raster_grid_mismatch:{solution_id}"
                )

            self._loaded[solution_id] = (raster, checksum)
            while len(self._loaded) > self.max_loaded_rasters:
                self._loaded.popitem(last=False)
            return raster, checksum

    def metadata(self) -> dict[str, Any]:
        return {
            "status": "ready",
            "registered_solution_count": len(self.entries),
            "loaded_solution_count": len(self._loaded),
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
        entries[solution_id] = RuntimeSolutionEntry(
            solution_id=solution_id,
            source_url=source_url,
            release_id=release_id,
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
