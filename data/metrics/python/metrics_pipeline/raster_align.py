"""Content-addressed raster alignment for metrics inputs.

Raw downloads remain in the existing download cache.  This module writes
derived rasters under ``<cache>/aligned/<key-prefix>/<key>.tif`` and binds each
artifact to its source bytes, exact target grid, policy, and toolchain.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Literal

import fcntl
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject

from metric_definitions import required_layer_ids
from raster_metrics import RasterError, RasterFingerprint

ALIGNMENT_MANIFEST_FORMAT = "metrics-raster-alignment-v3"
ALIGNMENT_POLICY_VERSION = "metrics-alignment-policy-v3"
DEFAULT_ALIGNED_CACHE_MAX_GB = 50.0
DEFAULT_ALIGNMENT_LOCK_TIMEOUT_SECONDS = 120.0

LayerClass = Literal[
    "binary",
    "categorical",
    "continuous_intensive",
    "fraction_or_density",
    "extensive",
]


@dataclass(frozen=True)
class AlignmentPolicy:
    layer_class: LayerClass
    resampling: Literal["nearest", "bilinear", "average", "sum"]
    dtype_policy: Literal["preserve", "uint8", "float32"]
    nodata_policy: Literal["preserve", "uint8-255", "nan"]

    def __post_init__(self) -> None:
        expected = {
            "binary": "nearest",
            "categorical": "nearest",
            "continuous_intensive": "bilinear",
            "fraction_or_density": "average",
            "extensive": "sum",
        }[self.layer_class]
        if self.resampling != expected:
            raise ValueError(
                f"{self.layer_class!r} layers require {expected!r} resampling, "
                f"not {self.resampling!r}."
            )


NEAREST_BINARY = AlignmentPolicy("binary", "nearest", "preserve", "preserve")
NEAREST_CATEGORICAL = AlignmentPolicy(
    "categorical", "nearest", "preserve", "preserve"
)
AVERAGE_DENSITY = AlignmentPolicy(
    "fraction_or_density", "average", "float32", "nan"
)
# Retained only to identify and reject stale callers and v1/v2 cache artifacts.
# Species now use ``SpeciesOverlapCache`` and never produce aligned GeoTIFFs.
SPECIES_POLICY = AlignmentPolicy("binary", "nearest", "uint8", "uint8-255")

# Every non-species raster used by a metric is explicitly classified here.
# Aliases that select classes from one categorical source deliberately share
# one policy so their source/grid cache key resolves to the same aligned file.
_LAYER_POLICIES: dict[str, AlignmentPolicy] = {
    "ecosistemas_IAVH_2024": NEAREST_CATEGORICAL,
    "biomasa": AVERAGE_DENSITY,
    "recarga_agua": NEAREST_BINARY,
    "coberturas_agriculture": NEAREST_CATEGORICAL,
    "coberturas_forest": NEAREST_CATEGORICAL,
    "coberturas_other": NEAREST_CATEGORICAL,
    "paramos": NEAREST_CATEGORICAL,
    "bosque_seco": NEAREST_BINARY,
    "wetlands": NEAREST_CATEGORICAL,
    "marine_ecosystems": NEAREST_CATEGORICAL,
    "mangroves": NEAREST_BINARY,
    "carbono_organico": AVERAGE_DENSITY,
    "resguardos": NEAREST_BINARY,
    "comunidades": NEAREST_BINARY,
    "runap_protegidas": NEAREST_CATEGORICAL,
    "runap_parques": NEAREST_CATEGORICAL,
}


class AlignmentError(RasterError):
    """A source cannot be safely aligned or a cached artifact is invalid."""


@dataclass(frozen=True)
class AlignmentResult:
    path: Path
    cache_key: str
    source_sha256: str
    aligned_sha256: str
    target_grid_sha256: str
    policy_sha256: str
    cache_hit: bool
    manifest: dict[str, Any]


def layer_policy_registry() -> dict[str, AlignmentPolicy]:
    """Return a complete policy registry, failing if metric definitions drift."""

    required = set(required_layer_ids())
    missing = required - set(_LAYER_POLICIES)
    unknown = set(_LAYER_POLICIES) - required
    if missing or unknown:
        details = []
        if missing:
            details.append(f"unclassified required layers={sorted(missing)}")
        if unknown:
            details.append(f"policies without metric layers={sorted(unknown)}")
        raise AlignmentError("Alignment policy registry mismatch: " + "; ".join(details))
    return dict(_LAYER_POLICIES)


def policy_for_layer(layer_id: str) -> AlignmentPolicy:
    try:
        return layer_policy_registry()[layer_id]
    except KeyError as exc:
        raise AlignmentError(
            f"Layer {layer_id!r} has no explicit alignment classification."
        ) from exc


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def grid_descriptor(fingerprint: RasterFingerprint) -> dict[str, Any]:
    return {
        "width": fingerprint.width,
        "height": fingerprint.height,
        "transform": list(fingerprint.transform),
        "crs": fingerprint.crs,
    }


def grid_sha256(fingerprint: RasterFingerprint) -> str:
    return canonical_sha256(grid_descriptor(fingerprint))


def exact_grid_matches(
    observed: RasterFingerprint, expected: RasterFingerprint
) -> bool:
    return grid_descriptor(observed) == grid_descriptor(expected)


def tool_versions() -> dict[str, str]:
    return {
        "rasterio": rasterio.__version__,
        "gdal": rasterio.__gdal_version__,
        "proj": getattr(rasterio, "__proj_version__", "unknown"),
        "alignmentPolicy": ALIGNMENT_POLICY_VERSION,
    }


def alignment_policy_manifest_sha256() -> str:
    from species_overlap import SPECIES_POLICY as EXACT_SPECIES_POLICY

    payload = {
        layer_id: asdict(policy)
        for layer_id, policy in sorted(layer_policy_registry().items())
    }
    payload["__species__"] = asdict(EXACT_SPECIES_POLICY)
    return canonical_sha256(payload)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fingerprint(dataset: rasterio.io.DatasetReader) -> RasterFingerprint:
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


def _resampling(name: str) -> Resampling:
    try:
        return getattr(Resampling, name)
    except AttributeError as exc:
        raise AlignmentError(
            f"Installed GDAL/rasterio does not support {name!r} resampling."
        ) from exc


def _output_dtype(
    source_dtype: np.dtype[Any], policy: AlignmentPolicy
) -> np.dtype[Any]:
    if policy.dtype_policy == "uint8":
        return np.dtype("uint8")
    if policy.dtype_policy == "float32":
        return np.dtype("float32")
    return source_dtype


def _output_nodata(
    source_nodata: float | int | None,
    dtype: np.dtype[Any],
    policy: AlignmentPolicy,
) -> float | int | None:
    if policy.nodata_policy == "uint8-255":
        return 255
    if policy.nodata_policy == "nan":
        return float("nan")
    if source_nodata is not None:
        return source_nodata
    if np.issubdtype(dtype, np.floating):
        return float("nan")
    return int(np.iinfo(dtype).max)


def _valid_values(
    array: np.ndarray, nodata: float | int | None
) -> np.ndarray:
    valid = np.ones(array.shape, dtype=bool)
    if nodata is not None:
        valid &= ~np.isclose(array, nodata, equal_nan=True)
    if np.issubdtype(array.dtype, np.floating):
        valid &= np.isfinite(array)
    return array[valid]


def _pixel_area_km2_per_row(dataset: rasterio.io.DatasetReader) -> np.ndarray:
    transform = dataset.transform
    if dataset.crs is None:
        raise AlignmentError(f"Raster {dataset.name} has no CRS.")
    if dataset.crs.is_geographic:
        radius_km = 6371.0088
        km_per_degree = math.pi * radius_km / 180.0
        latitude = transform.f + transform.e * (
            np.arange(dataset.height, dtype=np.float64) + 0.5
        )
        return (
            abs(transform.a)
            * km_per_degree
            * np.cos(np.deg2rad(latitude))
            * abs(transform.e)
            * km_per_degree
        )
    unit = (dataset.crs.linear_units or "").lower()
    scale = 1_000_000.0 if unit in {"metre", "meter", "m"} else 1.0
    return np.full(
        dataset.height,
        abs(transform.a * transform.e) / scale,
        dtype=np.float64,
    )


def _mask_area_km2(mask: np.ndarray, dataset: rasterio.io.DatasetReader) -> float:
    return float((mask.sum(axis=1) * _pixel_area_km2_per_row(dataset)).sum())


def _target_pixel_width_km(dataset: rasterio.io.DatasetReader) -> float:
    if dataset.crs is None:
        raise AlignmentError(f"Raster {dataset.name} has no CRS.")
    if not dataset.crs.is_geographic:
        unit = (dataset.crs.linear_units or "").lower()
        return abs(dataset.transform.a) / (1000.0 if unit in {"metre", "meter", "m"} else 1.0)
    center_latitude = dataset.transform.f + dataset.transform.e * dataset.height / 2.0
    return (
        abs(dataset.transform.a)
        * math.pi
        * 6371.0088
        / 180.0
        * abs(math.cos(math.radians(center_latitude)))
    )


def _binary_qa(
    source: rasterio.io.DatasetReader,
    aligned: rasterio.io.DatasetReader,
    *,
    source_nodata: float | int | None,
    aligned_nodata: float | int | None,
) -> dict[str, Any] | None:
    source_array = source.read(1)
    values = np.unique(_valid_values(source_array, source_nodata))
    if not set(values.tolist()).issubset({0, 1}):
        raise AlignmentError(
            f"Binary raster {source.name} contains values outside {{0, 1}}: "
            f"{values[:12].tolist()}."
        )

    source_mask = source_array == 1
    interior = source_mask.copy()
    interior[1:-1, 1:-1] &= (
        source_mask[:-2, 1:-1]
        & source_mask[2:, 1:-1]
        & source_mask[1:-1, :-2]
        & source_mask[1:-1, 2:]
    )
    present_cells = int(source_mask.sum())
    edge_fraction = (
        1.0 - float(interior.sum() / present_cells)
        if present_cells
        else 0.0
    )
    aligned_array = aligned.read(1)
    aligned_values = np.unique(_valid_values(aligned_array, aligned_nodata))
    if not set(aligned_values.tolist()).issubset({0, 1}):
        raise AlignmentError(
            f"Aligned binary raster contains values outside {{0, 1}}: "
            f"{aligned_values[:12].tolist()}."
        )
    aligned_mask = aligned_array == 1
    source_area = _mask_area_km2(source_mask, source)
    aligned_area = _mask_area_km2(aligned_mask, aligned)
    area_difference_pct = (
        abs(aligned_area - source_area) / source_area * 100.0
        if source_area
        else 0.0
    )

    round_trip = np.zeros(source_array.shape, dtype=np.uint8)
    reproject(
        source=aligned_mask.astype(np.uint8),
        destination=round_trip,
        src_transform=aligned.transform,
        src_crs=aligned.crs,
        dst_transform=source.transform,
        dst_crs=source.crs,
        resampling=Resampling.nearest,
        src_nodata=0,
        dst_nodata=0,
    )
    union = np.logical_or(source_mask, round_trip == 1).sum()
    intersection = np.logical_and(source_mask, round_trip == 1).sum()
    jaccard = float(intersection / union) if union else 1.0
    area_tolerance_km2 = max(
        1.0,
        1.25 * _target_pixel_width_km(aligned) * math.sqrt(source_area),
    )
    return {
        "sourcePresentAreaKm2": source_area,
        "alignedPresentAreaKm2": aligned_area,
        "areaDifferencePct": area_difference_pct,
        "binaryRoundTripJaccard": jaccard,
        "sourceEdgeFraction": edge_fraction,
        "areaToleranceKm2": area_tolerance_km2,
    }


def _validate_binary_values(
    values: np.ndarray,
    *,
    source_name: str,
    aligned: bool = False,
) -> None:
    if not set(values.tolist()).issubset({0, 1}):
        prefix = "Aligned binary raster" if aligned else f"Binary raster {source_name}"
        raise AlignmentError(
            f"{prefix} contains values outside {{0, 1}}: {values[:12].tolist()}."
        )


def _validate_categorical_values(
    values: np.ndarray,
    *,
    source_name: str,
    aligned: bool = False,
) -> None:
    if not np.all(np.equal(values, np.floor(values))):
        invalid = values[np.not_equal(values, np.floor(values))]
        prefix = "Aligned categorical raster" if aligned else (
            f"Categorical raster {source_name}"
        )
        raise AlignmentError(
            f"{prefix} contains non-integer classes: {invalid[:12].tolist()}."
        )


def _validate_continuous_values(
    array: np.ndarray,
    nodata: float | int | None,
    *,
    source_name: str,
    aligned: bool = False,
) -> None:
    if not np.issubdtype(array.dtype, np.floating):
        return
    valid = np.ones(array.shape, dtype=bool)
    if nodata is not None:
        valid &= ~np.isclose(array, nodata, equal_nan=True)
    invalid_count = int(np.count_nonzero(valid & ~np.isfinite(array)))
    if invalid_count:
        prefix = "Aligned continuous raster" if aligned else (
            f"Continuous raster {source_name}"
        )
        raise AlignmentError(
            f"{prefix} contains {invalid_count} non-finite data value(s)."
        )


def _enforce_species_qa(
    qa: dict[str, Any],
    authoritative_area_km2: float | None,
) -> dict[str, Any]:
    source_area = qa["sourcePresentAreaKm2"]
    aligned_area = qa["alignedPresentAreaKm2"]
    area_delta = abs(aligned_area - source_area)
    if source_area > 0 and aligned_area <= 0:
        raise AlignmentError(
            "Aligned species area is zero although the source area is nonzero."
        )
    if qa["binaryRoundTripJaccard"] < 0.50:
        raise AlignmentError(
            "Species round-trip Jaccard is "
            f"{qa['binaryRoundTripJaccard']:.6f} (<0.50)."
        )
    if (
        qa["sourceEdgeFraction"] <= 0.15
        and qa["binaryRoundTripJaccard"] < 0.975
    ):
        raise AlignmentError(
            "Species round-trip Jaccard is "
            f"{qa['binaryRoundTripJaccard']:.6f} (<0.975 for source edge "
            f"fraction {qa['sourceEdgeFraction']:.2%})."
        )
    if authoritative_area_km2 is None:
        raise AlignmentError(
            "Species alignment requires authoritative range_km2 metadata."
        )
    metadata_tolerance = max(1.0, abs(authoritative_area_km2) * 0.01)
    if abs(source_area - authoritative_area_km2) > metadata_tolerance:
        raise AlignmentError(
            f"Source species area {source_area:.6f} km² differs from "
            f"authoritative metadata {authoritative_area_km2:.6f} km² "
            f"by more than {metadata_tolerance:.6f} km²."
        )
    aligned_tolerance = metadata_tolerance + qa["areaToleranceKm2"]
    aligned_metadata_delta = abs(aligned_area - authoritative_area_km2)
    if aligned_metadata_delta > aligned_tolerance:
        raise AlignmentError(
            f"Aligned species area {aligned_area:.6f} km² differs from "
            f"authoritative metadata {authoritative_area_km2:.6f} km² "
            f"by {aligned_metadata_delta:.6f} km², exceeding the "
            f"combined metadata/discretization tolerance "
            f"{aligned_tolerance:.6f} km²."
        )
    if authoritative_area_km2 == 0 and (
        source_area != 0 or aligned_area != 0
    ):
        raise AlignmentError(
            "Zero-range species is valid only when metadata, source, "
            "and aligned areas are all zero."
        )
    enriched = dict(qa)
    enriched["authoritativeAreaKm2"] = authoritative_area_km2
    enriched["authoritativeAreaToleranceKm2"] = metadata_tolerance
    enriched["sourceAlignedAreaDeltaKm2"] = area_delta
    enriched["alignedAuthoritativeAreaDeltaKm2"] = aligned_metadata_delta
    enriched["alignedAuthoritativeAreaToleranceKm2"] = aligned_tolerance
    return enriched


class RasterAlignmentCache:
    def __init__(
        self,
        cache_dir: Path,
        *,
        max_cache_gb: float | None = None,
        lock_timeout_seconds: float | None = None,
    ) -> None:
        self.root = cache_dir / "aligned"
        configured_max = os.environ.get("METRICS_ALIGNED_CACHE_MAX_GB")
        configured_timeout = os.environ.get("METRICS_ALIGNMENT_LOCK_TIMEOUT_SECONDS")
        self.max_cache_bytes = int(
            1024**3
            * (
                max_cache_gb
                if max_cache_gb is not None
                else float(configured_max or DEFAULT_ALIGNED_CACHE_MAX_GB)
            )
        )
        self.lock_timeout_seconds = (
            lock_timeout_seconds
            if lock_timeout_seconds is not None
            else float(configured_timeout or DEFAULT_ALIGNMENT_LOCK_TIMEOUT_SECONDS)
        )
        self._verified: dict[str, AlignmentResult] = {}
        self._verified_stats: dict[str, tuple[int, int]] = {}
        self._pinned: set[str] = set()
        self._writes_since_eviction = 0
        from species_overlap import SpeciesOverlapCache

        self.species = SpeciesOverlapCache(
            cache_dir,
            max_cache_bytes=self.max_cache_bytes,
            lock_timeout_seconds=self.lock_timeout_seconds,
        )

    def align(
        self,
        source_path: Path,
        source_sha256: str,
        target: RasterFingerprint,
        policy: AlignmentPolicy,
        *,
        source_url: str | None = None,
        authoritative_area_km2: float | None = None,
        pin: bool = True,
    ) -> AlignmentResult:
        if policy == SPECIES_POLICY:
            raise AlignmentError(
                "Nearest-neighbor species alignment is retired; use the exact "
                "sparse species overlap cache."
            )
        if not source_sha256 or len(source_sha256) != 64:
            raise AlignmentError("Alignment requires the source SHA-256.")
        if target.crs is None:
            raise AlignmentError("Target grid has no CRS.")

        descriptor = {
            "format": ALIGNMENT_MANIFEST_FORMAT,
            "sourceSha256": source_sha256,
            "targetGrid": grid_descriptor(target),
            "policy": asdict(policy),
            "tools": tool_versions(),
            "authoritativeAreaKm2": authoritative_area_km2,
        }
        key = canonical_sha256(descriptor)
        verified = self._verified.get(key)
        if verified is not None:
            try:
                stat = verified.path.stat()
                current = (stat.st_size, stat.st_mtime_ns)
            except OSError:
                current = (-1, -1)
            if current == self._verified_stats.get(key):
                if pin:
                    self._pinned.add(key)
                return replace(verified, cache_hit=True)
            self._verified.pop(key, None)
            self._verified_stats.pop(key, None)
        directory = self.root / key[:2]
        path = directory / f"{key}.tif"
        manifest_path = directory / f"{key}.json"
        cached = self._validated_result(
            path, manifest_path, key, source_sha256, target, policy
        )
        if cached is not None:
            self._remember_verified(cached)
            return cached

        directory.mkdir(parents=True, exist_ok=True)
        lock_path = directory / f"{key}.lock"
        with self._key_lock(lock_path):
            cached = self._validated_result(
                path, manifest_path, key, source_sha256, target, policy
            )
            if cached is not None:
                if pin:
                    self._pinned.add(key)
                self._remember_verified(cached)
                return cached
            tmp = directory / f".{key}.{os.getpid()}.{uuid.uuid4().hex}.tmp.tif"
            manifest_tmp = directory / (
                f".{key}.{os.getpid()}.{uuid.uuid4().hex}.tmp.json"
            )
            try:
                legacy = self._legacy_species_artifact(
                    source_sha256,
                    target,
                    policy,
                    authoritative_area_km2,
                )
                if legacy is None:
                    qa = self._write_aligned(
                        tmp,
                        source_path,
                        target,
                        policy,
                        authoritative_area_km2=authoritative_area_km2,
                    )
                else:
                    legacy_path, qa = legacy
                    try:
                        os.link(legacy_path, tmp)
                    except OSError:
                        shutil.copyfile(legacy_path, tmp)
                aligned_sha256 = _sha256_file(tmp)
                manifest = {
                    **descriptor,
                    "sourceUrl": source_url,
                    "cacheKey": key,
                    "targetGridSha256": grid_sha256(target),
                    "policySha256": canonical_sha256(asdict(policy)),
                    "alignedSha256": aligned_sha256,
                    "qa": qa,
                }
                self._write_json_file(manifest_tmp, manifest)
                self._fsync_file(tmp)
                self._fsync_file(manifest_tmp)
                tmp.replace(path)
                manifest_tmp.replace(manifest_path)
                self._fsync_directory(directory)
            finally:
                tmp.unlink(missing_ok=True)
                manifest_tmp.unlink(missing_ok=True)

        result = self._validated_result(
            path, manifest_path, key, source_sha256, target, policy
        )
        if result is None:
            raise AlignmentError(f"New aligned cache artifact failed validation: {path}")
        result = replace(result, cache_hit=False)
        if pin:
            self._pinned.add(key)
        self._remember_verified(result)
        self._writes_since_eviction += 1
        if self.max_cache_bytes < 1024**3 or self._writes_since_eviction >= 100:
            self.evict()
            self._writes_since_eviction = 0
        return result

    def _remember_verified(self, result: AlignmentResult) -> None:
        stat = result.path.stat()
        self._verified[result.cache_key] = result
        self._verified_stats[result.cache_key] = (stat.st_size, stat.st_mtime_ns)

    def _legacy_species_artifact(
        self,
        source_sha256: str,
        target: RasterFingerprint,
        policy: AlignmentPolicy,
        authoritative_area_km2: float | None,
    ) -> tuple[Path, dict[str, Any]] | None:
        if policy != SPECIES_POLICY:
            return None
        legacy_tools = {**tool_versions(), "alignmentPolicy": "metrics-alignment-policy-v1"}
        descriptor = {
            "format": "metrics-raster-alignment-v1",
            "sourceSha256": source_sha256,
            "targetGrid": grid_descriptor(target),
            "policy": asdict(policy),
            "tools": legacy_tools,
        }
        key = canonical_sha256(descriptor)
        directory = self.root / key[:2]
        raster_path = directory / f"{key}.tif"
        manifest_path = directory / f"{key}.json"
        if not raster_path.is_file() or not manifest_path.is_file():
            return None
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if (
                manifest.get("format") != descriptor["format"]
                or manifest.get("cacheKey") != key
                or manifest.get("sourceSha256") != source_sha256
                or manifest.get("targetGrid") != descriptor["targetGrid"]
                or manifest.get("policy") != descriptor["policy"]
                or manifest.get("tools") != descriptor["tools"]
                or manifest.get("alignedSha256") != _sha256_file(raster_path)
            ):
                return None
            source_values = manifest["qa"]["sourceAllowedValues"]
            aligned_values = manifest["qa"]["alignedAllowedValues"]
            if not set(source_values).issubset({0, 1}) or not set(
                aligned_values
            ).issubset({0, 1}):
                return None
            checks = dict(manifest["qa"]["checks"])
            checks["areaToleranceKm2"] = max(
                1.0,
                1.25
                * abs(target.transform[0])
                / 1000.0
                * math.sqrt(checks["sourcePresentAreaKm2"]),
            )
            qa = {
                "sourceAllowedValues": source_values,
                "alignedAllowedValues": aligned_values,
                "checks": _enforce_species_qa(
                    checks,
                    authoritative_area_km2,
                ),
                "warnings": ["adopted checksum-valid v1 aligned raster"],
            }
            return raster_path, qa
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            return None

    def _write_aligned(
        self,
        destination: Path,
        source_path: Path,
        target: RasterFingerprint,
        policy: AlignmentPolicy,
        *,
        authoritative_area_km2: float | None = None,
    ) -> dict[str, Any]:
        with rasterio.open(source_path) as source:
            if source.count != 1:
                raise AlignmentError(
                    f"Raster {source_path} has {source.count} bands; expected exactly one."
                )
            if source.crs is None:
                raise AlignmentError(f"Raster {source_path} has no CRS.")
            if policy == SPECIES_POLICY and source.nodata != 255:
                raise AlignmentError(
                    f"Species raster {source_path} must declare nodata=255; "
                    f"got {source.nodata!r}."
                )

            source_array = source.read(1)
            source_values = np.unique(_valid_values(source_array, source.nodata))
            if policy.layer_class == "binary":
                _validate_binary_values(
                    source_values,
                    source_name=str(source.name),
                )
            elif policy.layer_class == "categorical":
                _validate_categorical_values(
                    source_values,
                    source_name=str(source.name),
                )
            else:
                _validate_continuous_values(
                    source_array,
                    source.nodata,
                    source_name=str(source.name),
                )
            dtype = _output_dtype(source_array.dtype, policy)
            nodata = _output_nodata(source.nodata, dtype, policy)
            fill = nodata if nodata is not None else 0
            destination_array = np.full(
                (target.height, target.width), fill, dtype=dtype
            )
            reproject(
                source=source_array,
                destination=destination_array,
                src_transform=source.transform,
                src_crs=source.crs,
                src_nodata=source.nodata,
                dst_transform=rasterio.Affine(*target.transform),
                dst_crs=target.crs,
                dst_nodata=nodata,
                resampling=_resampling(policy.resampling),
                init_dest_nodata=True,
            )

            profile = source.profile.copy()
            profile.update(
                driver="GTiff",
                width=target.width,
                height=target.height,
                transform=rasterio.Affine(*target.transform),
                crs=target.crs,
                count=1,
                dtype=dtype.name,
                nodata=nodata,
                tiled=True,
                blockxsize=256,
                blockysize=256,
                compress="deflate",
                predictor=2 if np.issubdtype(dtype, np.floating) else 1,
                BIGTIFF="IF_SAFER",
            )
            with rasterio.open(destination, "w", **profile) as aligned:
                aligned.write(destination_array, 1)

            with rasterio.open(destination) as aligned:
                if not exact_grid_matches(_fingerprint(aligned), target):
                    raise AlignmentError("Aligned raster does not match the target grid.")
                aligned_values = np.unique(
                    _valid_values(aligned.read(1), aligned.nodata)
                )
                aligned_array = aligned.read(1)
                if policy.resampling == "nearest" and not set(
                    aligned_values.tolist()
                ).issubset(set(source_values.tolist())):
                    raise AlignmentError(
                        "Nearest-neighbor alignment introduced unexpected values."
                    )
                if policy.layer_class == "binary":
                    _validate_binary_values(
                        aligned_values,
                        source_name=str(source.name),
                        aligned=True,
                    )
                elif policy.layer_class == "categorical":
                    _validate_categorical_values(
                        aligned_values,
                        source_name=str(source.name),
                        aligned=True,
                    )
                else:
                    _validate_continuous_values(
                        aligned_array,
                        aligned.nodata,
                        source_name=str(source.name),
                        aligned=True,
                    )
                qa = (
                    _binary_qa(
                        source,
                        aligned,
                        source_nodata=source.nodata,
                        aligned_nodata=aligned.nodata,
                    )
                    if policy == SPECIES_POLICY
                    else None
                )

        warnings: list[str] = []
        if qa is not None:
            qa = _enforce_species_qa(qa, authoritative_area_km2)
        return {
            "sourceAllowedValues": source_values.tolist(),
            "alignedAllowedValues": aligned_values.tolist(),
            "checks": qa,
            "warnings": warnings,
        }

    def _validated_result(
        self,
        path: Path,
        manifest_path: Path,
        key: str,
        source_sha256: str,
        target: RasterFingerprint,
        policy: AlignmentPolicy,
    ) -> AlignmentResult | None:
        if not path.exists() or not manifest_path.exists():
            return None
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            aligned_sha256 = _sha256_file(path)
            with rasterio.open(path) as dataset:
                observed = _fingerprint(dataset)
                if not exact_grid_matches(observed, target):
                    return None
            expected_values = manifest["qa"]["alignedAllowedValues"]
            if (
                manifest.get("format") != ALIGNMENT_MANIFEST_FORMAT
                or manifest.get("cacheKey") != key
                or manifest.get("sourceSha256") != source_sha256
                or manifest.get("targetGridSha256") != grid_sha256(target)
                or manifest.get("policy") != asdict(policy)
                or manifest.get("tools") != tool_versions()
                or manifest.get("alignedSha256") != aligned_sha256
                or not isinstance(expected_values, list)
            ):
                return None
        except (OSError, ValueError, KeyError, json.JSONDecodeError, RasterError):
            return None
        return AlignmentResult(
            path=path,
            cache_key=key,
            source_sha256=source_sha256,
            aligned_sha256=aligned_sha256,
            target_grid_sha256=grid_sha256(target),
            policy_sha256=canonical_sha256(asdict(policy)),
            cache_hit=True,
            manifest=manifest,
        )

    @contextmanager
    def _key_lock(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a+b") as handle:
            deadline = time.monotonic() + self.lock_timeout_seconds
            while True:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise AlignmentError(
                            f"Timed out waiting for alignment cache lock {path.name}."
                        )
                    time.sleep(0.05)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def evict(self) -> int:
        """Evict oldest complete, unlocked, unpinned pairs to the configured limit."""

        if self.max_cache_bytes <= 0 or not self.root.exists():
            return 0
        pairs: list[tuple[int, int, Path, Path, str]] = []
        total = 0
        for manifest_path in self.root.glob("*/*.json"):
            key = manifest_path.stem
            raster_path = manifest_path.with_suffix(".tif")
            if not raster_path.is_file():
                continue
            size = manifest_path.stat().st_size + raster_path.stat().st_size
            total += size
            if key in self._pinned:
                continue
            pairs.append(
                (
                    max(manifest_path.stat().st_mtime_ns, raster_path.stat().st_mtime_ns),
                    size,
                    raster_path,
                    manifest_path,
                    key,
                )
            )
        removed = 0
        for _, size, raster_path, manifest_path, key in sorted(pairs):
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
                        manifest_path.unlink(missing_ok=True)
                        raster_path.unlink(missing_ok=True)
                        self._verified.pop(key, None)
                        self._verified_stats.pop(key, None)
                        total -= size
                        removed += 1
                finally:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return removed

    def cache_usage_bytes(self) -> int:
        """Return bytes used by complete aligned TIF/manifest pairs."""

        if not self.root.exists():
            return 0
        total = 0
        for manifest_path in self.root.glob("*/*.json"):
            raster_path = manifest_path.with_suffix(".tif")
            if raster_path.is_file():
                total += manifest_path.stat().st_size + raster_path.stat().st_size
        return total

    @staticmethod
    def _write_json_file(path: Path, value: dict[str, Any]) -> None:
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    @staticmethod
    def _fsync_file(path: Path) -> None:
        with path.open("rb") as handle:
            os.fsync(handle.fileno())

    @staticmethod
    def _fsync_directory(path: Path) -> None:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
