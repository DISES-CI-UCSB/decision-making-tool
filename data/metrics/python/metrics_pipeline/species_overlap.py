"""Exact, sparse source-cell overlap on the solution grid.

Species sources are binary geographic rasters.  Presence cells are transformed
as polygons and intersected only with target cells in their transformed bounds.
The cache stores sorted flat target indexes and float64 intersection areas.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import time
import uuid
import zipfile
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import fcntl
import numpy as np
import pyproj
import rasterio
import shapely
from exactextract import __version__ as exactextract_version
from exactextract import exact_extract
from rasterio.features import geometry_mask, shapes
from rasterio.io import MemoryFile
from rasterio.transform import Affine
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform as transform_geometry

from raster_align import (
    AlignmentError,
    canonical_sha256,
    grid_descriptor,
    grid_sha256,
)
from raster_metrics import RasterFingerprint

SPECIES_OVERLAP_FORMAT = "species-exact-overlap-v1"
SPECIES_OVERLAP_ALGORITHM_VERSION = "source-cell-union-exactextract-v1"
SPECIES_GEOMETRY_PRECISION_METERS = 0.00001
SPECIES_POSITIVE_AREA_EPSILON_M2 = SPECIES_GEOMETRY_PRECISION_METERS**2
# Sub-millimetre coordinate snapping can move a cell boundary by a few
# decimetres of aggregate area. 0.2 m² is 2e-7 of a 1 km target cell.
SPECIES_CONSERVATION_ABSOLUTE_TOLERANCE_M2 = 0.2
SPECIES_CONSERVATION_RELATIVE_TOLERANCE = 2e-9
DEFAULT_STALE_TEMP_AGE_SECONDS = 60 * 60


@dataclass(frozen=True)
class SpeciesOverlapPolicy:
    algorithm: str = SPECIES_OVERLAP_ALGORITHM_VERSION
    source_edge_segments_per_cell: int = 2
    geometry_precision_meters: float = SPECIES_GEOMETRY_PRECISION_METERS
    positive_area_epsilon_m2: float = SPECIES_POSITIVE_AREA_EPSILON_M2
    conservation_absolute_tolerance_m2: float = (
        SPECIES_CONSERVATION_ABSOLUTE_TOLERANCE_M2
    )
    conservation_relative_tolerance: float = SPECIES_CONSERVATION_RELATIVE_TOLERANCE
    representation: str = "sorted-flat-index+float64-area-m2"


SPECIES_POLICY = SpeciesOverlapPolicy()


@dataclass(frozen=True)
class SpeciesOverlapResult:
    path: Path
    cache_key: str
    source_sha256: str
    overlap_sha256: str
    target_grid_sha256: str
    policy_sha256: str
    cache_hit: bool
    manifest: dict[str, Any]

    @property
    def aligned_sha256(self) -> str:
        """Compatibility alias used by the shared alignment inventory."""

        return self.overlap_sha256


@dataclass(frozen=True)
class SpeciesOverlap:
    """Sparse overlap arrays loaded from a validated cache artifact."""

    flat_indices: np.ndarray
    areas_m2: np.ndarray

    @property
    def positive_target_cell_count(self) -> int:
        return int(self.flat_indices.size)

    @property
    def intersected_area_m2(self) -> float:
        return float(self.areas_m2.sum(dtype=np.float64))


def species_tool_versions() -> dict[str, str]:
    return {
        "rasterio": rasterio.__version__,
        "gdal": rasterio.__gdal_version__,
        "proj": pyproj.__version__,
        "geos": shapely.geos_version_string,
        "shapely": shapely.__version__,
        "exactextract": exactextract_version,
    }


def read_species_overlap(
    path: Path,
    expected: RasterFingerprint,
    *,
    epsilon_m2: float = SPECIES_POSITIVE_AREA_EPSILON_M2,
) -> SpeciesOverlap:
    """Load and validate one deterministic sparse overlap artifact."""

    try:
        with np.load(path, allow_pickle=False) as archive:
            run_starts = np.asarray(archive["full_run_starts"], dtype=np.int64)
            run_lengths = np.asarray(archive["full_run_lengths"], dtype=np.int64)
            partial_indices = np.asarray(
                archive["partial_flat_indices"], dtype=np.int64
            )
            partial_areas = np.asarray(archive["partial_areas_m2"], dtype=np.float64)
            shape = tuple(int(value) for value in archive["target_shape"].tolist())
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as exc:
        raise AlignmentError(f"Invalid species overlap artifact {path}: {exc}") from exc
    if shape != (expected.height, expected.width):
        raise AlignmentError(
            f"Species overlap target shape {shape} does not match "
            f"{(expected.height, expected.width)}."
        )
    if (
        run_starts.ndim != 1
        or run_lengths.ndim != 1
        or run_starts.shape != run_lengths.shape
        or partial_indices.ndim != 1
        or partial_areas.ndim != 1
        or partial_indices.shape != partial_areas.shape
    ):
        raise AlignmentError("Species overlap sparse arrays are malformed.")
    if np.any(run_lengths <= 0):
        raise AlignmentError("Species full-cell runs must have positive lengths.")
    full_indices = (
        np.concatenate(
            [
                np.arange(start, start + length, dtype=np.int64)
                for start, length in zip(run_starts, run_lengths, strict=True)
            ]
        )
        if run_starts.size
        else np.empty(0, dtype=np.int64)
    )
    target_cell_area = _target_cell_area_m2(expected)
    indices = np.concatenate([full_indices, partial_indices])
    areas = np.concatenate(
        [
            np.full(full_indices.size, target_cell_area, dtype=np.float64),
            partial_areas,
        ]
    )
    order = np.argsort(indices, kind="stable")
    indices = indices[order]
    areas = areas[order]
    if indices.size and (
        indices[0] < 0
        or indices[-1] >= expected.width * expected.height
        or np.any(indices[1:] <= indices[:-1])
    ):
        raise AlignmentError("Species overlap indexes must be sorted, unique, and in-grid.")
    if np.any(~np.isfinite(areas)) or np.any(areas <= epsilon_m2):
        raise AlignmentError("Species overlap areas must be finite and above epsilon.")
    if np.any(areas > target_cell_area + _area_tolerance(target_cell_area)):
        raise AlignmentError("Species overlap area exceeds target-cell physical area.")
    return SpeciesOverlap(flat_indices=indices, areas_m2=areas)


class SpeciesOverlapCache:
    """Atomic, locked, content-addressed sparse species overlap cache."""

    def __init__(
        self,
        cache_dir: Path,
        *,
        max_cache_bytes: int,
        lock_timeout_seconds: float,
        stale_temp_age_seconds: float = DEFAULT_STALE_TEMP_AGE_SECONDS,
    ) -> None:
        self.root = cache_dir / "species-overlap"
        self.max_cache_bytes = max_cache_bytes
        self.lock_timeout_seconds = lock_timeout_seconds
        self.stale_temp_age_seconds = stale_temp_age_seconds
        self._pinned: set[str] = set()
        self._verified: dict[str, tuple[SpeciesOverlapResult, tuple[int, int]]] = {}
        self.cleanup_stale_temporary_files()

    def align(
        self,
        source_path: Path,
        source_sha256: str,
        target: RasterFingerprint,
        *,
        source_url: str | None = None,
        authoritative_area_km2: float | None = None,
        pin: bool = True,
    ) -> SpeciesOverlapResult:
        if len(source_sha256) != 64:
            raise AlignmentError("Species overlap requires the source SHA-256.")
        if target.crs is None:
            raise AlignmentError("Species overlap target grid has no CRS.")
        descriptor = {
            "format": SPECIES_OVERLAP_FORMAT,
            "sourceSha256": source_sha256,
            "sourceGrid": _source_grid_descriptor(source_path),
            "targetGrid": grid_descriptor(target),
            "policy": asdict(SPECIES_POLICY),
            "tools": species_tool_versions(),
            "authoritativeAreaKm2": authoritative_area_km2,
        }
        key = canonical_sha256(descriptor)
        remembered = self._verified.get(key)
        if remembered is not None:
            result, expected_stat = remembered
            try:
                stat = result.path.stat()
                observed_stat = (stat.st_size, stat.st_mtime_ns)
            except OSError:
                observed_stat = (-1, -1)
            if observed_stat == expected_stat:
                if pin:
                    self._pinned.add(key)
                return SpeciesOverlapResult(
                    **{**result.__dict__, "cache_hit": True}
                )
            self._verified.pop(key, None)

        directory = self.root / key[:2]
        path = directory / f"{key}.npz"
        manifest_path = directory / f"{key}.json"
        cached = self._validated_result(
            path, manifest_path, key, source_sha256, target, descriptor
        )
        if cached is not None:
            if pin:
                self._pinned.add(key)
            self._remember(cached)
            return cached

        directory.mkdir(parents=True, exist_ok=True)
        lock_path = directory / f"{key}.lock"
        with self._key_lock(lock_path):
            cached = self._validated_result(
                path, manifest_path, key, source_sha256, target, descriptor
            )
            if cached is not None:
                if pin:
                    self._pinned.add(key)
                self._remember(cached)
                return cached
            artifact_tmp = directory / (
                f".{key}.{os.getpid()}.{uuid.uuid4().hex}.tmp.npz"
            )
            manifest_tmp = directory / (
                f".{key}.{os.getpid()}.{uuid.uuid4().hex}.tmp.json"
            )
            try:
                qa = _build_exact_overlap(
                    source_path,
                    target,
                    artifact_tmp,
                    authoritative_area_km2=authoritative_area_km2,
                )
                overlap_sha256 = _sha256_file(artifact_tmp)
                manifest = {
                    **descriptor,
                    "sourceUrl": source_url,
                    "cacheKey": key,
                    "targetGridSha256": grid_sha256(target),
                    "policySha256": canonical_sha256(asdict(SPECIES_POLICY)),
                    "overlapSha256": overlap_sha256,
                    "qa": qa,
                }
                manifest_tmp.write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True)
                    + "\n",
                    encoding="utf-8",
                )
                _fsync_file(artifact_tmp)
                _fsync_file(manifest_tmp)
                artifact_tmp.replace(path)
                manifest_tmp.replace(manifest_path)
                _fsync_directory(directory)
            finally:
                artifact_tmp.unlink(missing_ok=True)
                manifest_tmp.unlink(missing_ok=True)

        result = self._validated_result(
            path, manifest_path, key, source_sha256, target, descriptor
        )
        if result is None:
            raise AlignmentError(f"New species overlap artifact failed validation: {path}")
        result = SpeciesOverlapResult(**{**result.__dict__, "cache_hit": False})
        if pin:
            self._pinned.add(key)
        self._remember(result)
        self.evict()
        return result

    def _validated_result(
        self,
        path: Path,
        manifest_path: Path,
        key: str,
        source_sha256: str,
        target: RasterFingerprint,
        descriptor: dict[str, Any],
    ) -> SpeciesOverlapResult | None:
        if not path.is_file() or not manifest_path.is_file():
            return None
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            overlap_sha256 = _sha256_file(path)
            overlap = read_species_overlap(path, target)
            qa = manifest["qa"]
            if (
                manifest.get("format") != SPECIES_OVERLAP_FORMAT
                or manifest.get("cacheKey") != key
                or manifest.get("sourceSha256") != source_sha256
                or manifest.get("sourceGrid") != descriptor["sourceGrid"]
                or manifest.get("targetGrid") != descriptor["targetGrid"]
                or manifest.get("authoritativeAreaKm2")
                != descriptor["authoritativeAreaKm2"]
                or manifest.get("targetGridSha256") != grid_sha256(target)
                or manifest.get("policy") != descriptor["policy"]
                or manifest.get("tools") != descriptor["tools"]
                or manifest.get("overlapSha256") != overlap_sha256
                or qa.get("positiveTargetCellCount")
                != overlap.positive_target_cell_count
                or not math.isclose(
                    qa.get("intersectedAreaKm2", -1.0),
                    overlap.intersected_area_m2 / 1_000_000.0,
                    rel_tol=1e-12,
                    abs_tol=1e-12,
                )
            ):
                return None
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            json.JSONDecodeError,
            AlignmentError,
        ):
            return None
        return SpeciesOverlapResult(
            path=path,
            cache_key=key,
            source_sha256=source_sha256,
            overlap_sha256=overlap_sha256,
            target_grid_sha256=grid_sha256(target),
            policy_sha256=canonical_sha256(asdict(SPECIES_POLICY)),
            cache_hit=True,
            manifest=manifest,
        )

    def _remember(self, result: SpeciesOverlapResult) -> None:
        stat = result.path.stat()
        self._verified[result.cache_key] = (
            result,
            (stat.st_size, stat.st_mtime_ns),
        )

    @contextmanager
    def _key_lock(self, path: Path):
        with path.open("a+b") as handle:
            deadline = time.monotonic() + self.lock_timeout_seconds
            while True:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise AlignmentError(
                            f"Timed out waiting for species overlap lock {path.name}."
                        )
                    time.sleep(0.05)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def evict(self) -> int:
        self.cleanup_stale_temporary_files()
        if self.max_cache_bytes <= 0 or not self.root.exists():
            return 0
        pairs: list[tuple[int, int, Path, Path, str]] = []
        total = 0
        for manifest_path in self.root.glob("*/*.json"):
            artifact_path = manifest_path.with_suffix(".npz")
            if not artifact_path.is_file():
                continue
            size = manifest_path.stat().st_size + artifact_path.stat().st_size
            total += size
            if manifest_path.stem not in self._pinned:
                pairs.append(
                    (
                        max(
                            manifest_path.stat().st_mtime_ns,
                            artifact_path.stat().st_mtime_ns,
                        ),
                        size,
                        artifact_path,
                        manifest_path,
                        manifest_path.stem,
                    )
                )
        removed = 0
        for _, size, artifact_path, manifest_path, key in sorted(pairs):
            if total <= self.max_cache_bytes:
                break
            lock_path = manifest_path.with_suffix(".lock")
            with lock_path.open("a+b") as handle:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                try:
                    if key not in self._pinned:
                        artifact_path.unlink(missing_ok=True)
                        manifest_path.unlink(missing_ok=True)
                        self._verified.pop(key, None)
                        total -= size
                        removed += 1
                finally:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return removed

    def cleanup_stale_temporary_files(self) -> int:
        """Remove abandoned temporary writes without racing an active writer."""

        if not self.root.exists():
            return 0
        cutoff_ns = time.time_ns() - int(self.stale_temp_age_seconds * 1_000_000_000)
        removed = 0
        for temporary_path in self.root.glob("*/*.*.tmp.*"):
            parts = temporary_path.name.split(".")
            if (
                len(parts) != 6
                or parts[0] != ""
                or len(parts[1]) != 64
                or any(character not in "0123456789abcdef" for character in parts[1])
                or parts[4] != "tmp"
                or parts[5] not in {"json", "npz"}
            ):
                continue
            key = parts[1]
            lock_path = temporary_path.parent / f"{key}.lock"
            with lock_path.open("a+b") as handle:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                try:
                    try:
                        is_stale = temporary_path.stat().st_mtime_ns <= cutoff_ns
                    except OSError:
                        continue
                    if is_stale:
                        temporary_path.unlink(missing_ok=True)
                        removed += 1
                finally:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return removed

    def cache_usage_bytes(self) -> int:
        total = 0
        for manifest_path in self.root.glob("*/*.json"):
            artifact_path = manifest_path.with_suffix(".npz")
            if artifact_path.is_file():
                total += manifest_path.stat().st_size + artifact_path.stat().st_size
        return total


def _build_exact_overlap(
    source_path: Path,
    target: RasterFingerprint,
    destination: Path,
    *,
    authoritative_area_km2: float | None,
) -> dict[str, Any]:
    if authoritative_area_km2 is None:
        raise AlignmentError(
            "Species exact overlap requires authoritative range_km2 metadata."
        )
    target_transform = Affine(*target.transform)
    if not (
        math.isclose(target_transform.b, 0.0, abs_tol=1e-12)
        and math.isclose(target_transform.d, 0.0, abs_tol=1e-12)
    ):
        raise AlignmentError("Species exact overlap requires a north-up target grid.")
    target_cell_area = _target_cell_area_m2(target)
    target_extent = _target_extent_polygon(target)
    with rasterio.open(source_path) as source:
        if source.count != 1:
            raise AlignmentError(
                f"Species raster {source_path} has {source.count} bands; expected one."
            )
        if source.crs is None:
            raise AlignmentError(f"Species raster {source_path} has no CRS.")
        if source.nodata != 255:
            raise AlignmentError(
                f"Species raster {source_path} must declare nodata=255; "
                f"got {source.nodata!r}."
            )
        values = source.read(1, masked=False)
        valid = values != 255
        allowed = np.unique(values[valid])
        if not set(allowed.tolist()).issubset({0, 1}):
            raise AlignmentError(
                f"Binary raster {source_path} contains values outside {{0, 1}}: "
                f"{allowed[:12].tolist()}."
            )
        presence = values == 1
        source_present_cells = int(presence.sum())
        source_row_areas = _geographic_pixel_areas_km2(source)
        source_geographic_area_km2 = float(
            (presence.sum(axis=1) * source_row_areas).sum(dtype=np.float64)
        )
        transformer = pyproj.Transformer.from_crs(
            source.crs,
            target.crs,
            always_xy=True,
        )
        inverse_transformer = pyproj.Transformer.from_crs(
            target.crs,
            source.crs,
            always_xy=True,
        )
        source_target_extent = transform_geometry(
            inverse_transformer.transform,
            target_extent,
        )
        cells_touching_extent = geometry_mask(
            [mapping(source_target_extent)],
            out_shape=presence.shape,
            transform=source.transform,
            invert=True,
            all_touched=True,
        )
        source_cells_outside_extent = int(
            np.count_nonzero(presence & ~cells_touching_extent)
        )
        projected_geometries = []
        # Preserve projected curvature along geographic cell edges. Two
        # segments per 30-arc-second edge gives sub-metre golden area accuracy
        # while scaling with boundary, not presence-cell count.
        max_source_segment = (
            max(abs(source.transform.a), abs(source.transform.e))
            / SPECIES_POLICY.source_edge_segments_per_cell
        )
        for geometry_mapping, value in shapes(
            presence.astype(np.uint8),
            mask=presence,
            transform=source.transform,
            connectivity=4,
        ):
            if int(value) != 1:
                continue
            source_geometry = shapely.segmentize(
                shape(geometry_mapping),
                max_segment_length=max_source_segment,
            )
            projected = transform_geometry(
                transformer.transform,
                source_geometry,
            )
            projected = shapely.set_precision(
                projected,
                SPECIES_POLICY.geometry_precision_meters,
                mode="valid_output",
            )
            if projected.is_empty or not projected.is_valid:
                raise AlignmentError(
                    "Species source-cell union produced invalid projected geometry."
                )
            projected_geometries.append(projected)

    projected_source_area_m2 = float(
        sum(geometry.area for geometry in projected_geometries)
    )
    expected_intersection_area_m2 = float(
        sum(geometry.intersection(target_extent).area for geometry in projected_geometries)
    )
    accumulated: dict[int, float] = {}
    if projected_geometries:
        target_profile = {
            "driver": "GTiff",
            "width": target.width,
            "height": target.height,
            "count": 1,
            "dtype": "uint8",
            "crs": target.crs,
            "transform": target_transform,
            "nodata": 255,
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
        }
        features = [
            {
                "type": "Feature",
                "properties": {},
                "geometry": mapping(geometry),
            }
            for geometry in projected_geometries
        ]
        with MemoryFile() as memory_file:
            with memory_file.open(**target_profile) as dataset:
                dataset.write(
                    np.zeros((target.height, target.width), dtype=np.uint8),
                    1,
                )
            with memory_file.open() as dataset:
                extracted = exact_extract(
                    dataset,
                    features,
                    ["cell_id", "coverage"],
                    strategy="feature-sequential",
                    max_cells_in_memory=1_000_000,
                )
        for feature in extracted:
            properties = feature["properties"]
            cell_ids = np.asarray(properties["cell_id"], dtype=np.int64)
            coverages = np.asarray(properties["coverage"], dtype=np.float64)
            if cell_ids.shape != coverages.shape:
                raise AlignmentError("Exact coverage returned malformed cell arrays.")
            for flat_index, coverage in zip(cell_ids, coverages, strict=True):
                area = float(coverage * target_cell_area)
                if area > SPECIES_POLICY.positive_area_epsilon_m2:
                    index = int(flat_index)
                    accumulated[index] = accumulated.get(index, 0.0) + area

    source_cells_lost_inside_extent = 0
    indices = np.asarray(sorted(accumulated), dtype=np.int64)
    areas = np.asarray([accumulated[index] for index in indices], dtype=np.float64)
    if np.any(~np.isfinite(areas)) or np.any(
        areas <= SPECIES_POLICY.positive_area_epsilon_m2
    ):
        raise AlignmentError("Species overlap contains invalid or non-positive areas.")
    area_tolerance = _area_tolerance(target_cell_area)
    if np.any(areas > target_cell_area + area_tolerance):
        raise AlignmentError("Species overlap exceeds a target cell's physical area.")
    areas = np.minimum(areas, target_cell_area)
    full_mask = np.isclose(
        areas,
        target_cell_area,
        rtol=0.0,
        atol=area_tolerance,
    )
    areas[full_mask] = target_cell_area
    intersected_area_m2 = float(areas.sum(dtype=np.float64))
    conservation_delta_m2 = intersected_area_m2 - expected_intersection_area_m2
    conservation_tolerance_m2 = max(
        SPECIES_POLICY.conservation_absolute_tolerance_m2,
        expected_intersection_area_m2
        * SPECIES_POLICY.conservation_relative_tolerance,
    ) + (
        SPECIES_POLICY.geometry_precision_meters
        * math.sqrt(target_cell_area)
    )
    if abs(conservation_delta_m2) > conservation_tolerance_m2:
        raise AlignmentError(
            "Species overlap area is not conserved: "
            f"delta={conservation_delta_m2:.9f} m², "
            f"tolerance={conservation_tolerance_m2:.9f} m²."
        )
    metadata_tolerance_km2 = max(1.0, abs(authoritative_area_km2) * 0.01)
    if abs(source_geographic_area_km2 - authoritative_area_km2) > metadata_tolerance_km2:
        raise AlignmentError(
            f"Source species area {source_geographic_area_km2:.6f} km² differs "
            f"from authoritative metadata {authoritative_area_km2:.6f} km² by "
            f"more than {metadata_tolerance_km2:.6f} km²."
        )
    if authoritative_area_km2 == 0 and (
        source_present_cells != 0 or indices.size != 0
    ):
        raise AlignmentError(
            "Zero-range species is valid only when metadata and source are empty."
        )

    full_run_starts, full_run_lengths = _encode_runs(indices[full_mask])
    partial_indices = indices[~full_mask]
    partial_areas = areas[~full_mask]
    _write_deterministic_npz(
        destination,
        full_run_starts=full_run_starts,
        full_run_lengths=full_run_lengths,
        partial_flat_indices=partial_indices,
        partial_areas_m2=partial_areas,
        target_shape=np.asarray([target.height, target.width], dtype=np.int64),
    )
    fractions = areas / target_cell_area
    return {
        "algorithmVersion": SPECIES_OVERLAP_ALGORITHM_VERSION,
        "authoritativeAreaKm2": authoritative_area_km2,
        "authoritativeAreaToleranceKm2": metadata_tolerance_km2,
        "sourcePresentCellCount": source_present_cells,
        "sourceGeographicAreaKm2": source_geographic_area_km2,
        "projectedSourceGeometryAreaKm2": projected_source_area_m2 / 1_000_000.0,
        "intersectedAreaKm2": intersected_area_m2 / 1_000_000.0,
        "expectedClippedSourceAreaKm2": (
            expected_intersection_area_m2 / 1_000_000.0
        ),
        "positiveTargetCellCount": int(indices.size),
        "fullTargetCellCount": int(full_mask.sum()),
        "fullTargetCellRunCount": int(full_run_starts.size),
        "fractionalTargetCellCount": int(partial_indices.size),
        "sourceCellsOutsideTargetExtent": source_cells_outside_extent,
        "sourceCellsLostInsideTargetExtent": source_cells_lost_inside_extent,
        "conservationDeltaM2": conservation_delta_m2,
        "conservationToleranceM2": conservation_tolerance_m2,
        "targetCellAreaM2": target_cell_area,
        "minimumOverlapFraction": float(fractions.min()) if fractions.size else None,
        "maximumOverlapFraction": float(fractions.max()) if fractions.size else None,
        "geometryPrecisionMeters": SPECIES_POLICY.geometry_precision_meters,
        "positiveAreaEpsilonM2": SPECIES_POLICY.positive_area_epsilon_m2,
        "sourceAllowedValues": allowed.tolist(),
    }


def _source_grid_descriptor(path: Path) -> dict[str, Any]:
    with rasterio.open(path) as source:
        return {
            "width": source.width,
            "height": source.height,
            "transform": list(tuple(source.transform)[:6]),
            "crs": str(source.crs) if source.crs else None,
            "nodata": source.nodata,
            "dtype": source.dtypes[0],
        }


def _source_cell_polygon(transform: Affine, row: int, col: int) -> Polygon:
    return Polygon(
        [
            transform * (col, row),
            transform * (col + 1, row),
            transform * (col + 1, row + 1),
            transform * (col, row + 1),
        ]
    )


def _target_cell_polygon(transform: Affine, row: int, col: int) -> Polygon:
    return shapely.set_precision(
        Polygon(
            [
                transform * (col, row),
                transform * (col + 1, row),
                transform * (col + 1, row + 1),
                transform * (col, row + 1),
            ]
        ),
        SPECIES_POLICY.geometry_precision_meters,
        mode="valid_output",
    )


def _target_extent_polygon(target: RasterFingerprint) -> Polygon:
    transform = Affine(*target.transform)
    return shapely.set_precision(
        Polygon(
            [
                transform * (0, 0),
                transform * (target.width, 0),
                transform * (target.width, target.height),
                transform * (0, target.height),
            ]
        ),
        SPECIES_POLICY.geometry_precision_meters,
        mode="valid_output",
    )


def _candidate_target_cells(
    geometry: Any,
    target: RasterFingerprint,
) -> list[tuple[int, int]]:
    inverse = ~Affine(*target.transform)
    min_x, min_y, max_x, max_y = geometry.bounds
    corners = [
        inverse * (min_x, min_y),
        inverse * (min_x, max_y),
        inverse * (max_x, min_y),
        inverse * (max_x, max_y),
    ]
    columns = [point[0] for point in corners]
    rows = [point[1] for point in corners]
    # Expand one cell around the inverse-transformed bounds. This protects
    # candidate selection from sub-millimetre transform/precision rounding at
    # exact grid lines while remaining a tiny local window.
    col_start = max(0, math.floor(min(columns)) - 1)
    col_stop = min(target.width, math.ceil(max(columns)) + 1)
    row_start = max(0, math.floor(min(rows)) - 1)
    row_stop = min(target.height, math.ceil(max(rows)) + 1)
    return [
        (row, col)
        for row in range(row_start, row_stop)
        for col in range(col_start, col_stop)
    ]


def _target_cell_area_m2(target: RasterFingerprint) -> float:
    transform = Affine(*target.transform)
    crs = rasterio.crs.CRS.from_user_input(target.crs)
    if crs.is_geographic:
        raise AlignmentError("Species exact overlap target CRS must be projected.")
    unit = (crs.linear_units or "").lower()
    if unit not in {"metre", "meter", "m"}:
        raise AlignmentError(f"Unsupported target CRS linear unit {unit!r}.")
    return abs(transform.a * transform.e - transform.b * transform.d)


def _geographic_pixel_areas_km2(
    dataset: rasterio.io.DatasetReader,
) -> np.ndarray:
    if dataset.crs is None or not dataset.crs.is_geographic:
        cell_area = abs(
            dataset.transform.a * dataset.transform.e
            - dataset.transform.b * dataset.transform.d
        )
        unit = (dataset.crs.linear_units or "").lower() if dataset.crs else ""
        divisor = 1_000_000.0 if unit in {"metre", "meter", "m"} else 1.0
        return np.full(dataset.height, cell_area / divisor, dtype=np.float64)
    radius_km = 6371.0088
    km_per_degree = math.pi * radius_km / 180.0
    latitude = dataset.transform.f + dataset.transform.e * (
        np.arange(dataset.height, dtype=np.float64) + 0.5
    )
    return (
        abs(dataset.transform.a)
        * km_per_degree
        * np.cos(np.deg2rad(latitude))
        * abs(dataset.transform.e)
        * km_per_degree
    )


def _area_tolerance(area_m2: float) -> float:
    return max(
        SPECIES_POLICY.conservation_absolute_tolerance_m2,
        area_m2 * SPECIES_POLICY.conservation_relative_tolerance,
    )


def _encode_runs(indices: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if indices.size == 0:
        return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int64)
    breaks = np.flatnonzero(np.diff(indices) != 1) + 1
    starts_at = np.concatenate(
        [np.asarray([0], dtype=np.int64), breaks.astype(np.int64)]
    )
    stops_at = np.concatenate(
        [breaks.astype(np.int64), np.asarray([indices.size], dtype=np.int64)]
    )
    return (
        indices[starts_at].astype(np.int64, copy=False),
        (stops_at - starts_at).astype(np.int64, copy=False),
    )


def _write_deterministic_npz(path: Path, **arrays: np.ndarray) -> None:
    """Write NPZ bytes with fixed member order, metadata, and timestamps."""

    with zipfile.ZipFile(
        path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for name in sorted(arrays):
            buffer = io.BytesIO()
            np.lib.format.write_array(
                buffer,
                np.asarray(arrays[name]),
                allow_pickle=False,
            )
            info = zipfile.ZipInfo(f"{name}.npy", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, buffer.getvalue(), compress_type=zipfile.ZIP_DEFLATED)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fsync_file(path: Path) -> None:
    with path.open("rb") as handle:
        os.fsync(handle.fileno())


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
