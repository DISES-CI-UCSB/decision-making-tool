"""Validated indexed loading for binary ``.sparse.gz`` layer sidecars.

This packet only replaces validated source loading. It still materializes a
dense boolean mask for the existing calculators; sparse overlap calculation
and grouped boundary fan-out are separate optimization packets.
"""

from __future__ import annotations

import hashlib
import math
import os
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal
from urllib.parse import urlsplit, urlunsplit

import numpy as np

from raster_metrics import RasterFingerprint

from .format import (
    LAYER_TYPE_BINARY,
    SparseFormatError,
    SparseMetadata,
    decode_sparse_bytes,
)

LayerSourceMode = Literal["dense", "sparse", "auto"]
LayerSourceChoice = Literal["dense", "sparse", "none"]
LAND_BINARY_LAYER_IDS = frozenset(
    {
        "bosque_seco",
        "comunidades",
        "mangroves",
        "paramos",
        "resguardos",
        "wetlands",
    }
)


class SparseLayerSourceError(RuntimeError):
    """Base error for unavailable or incompatible sparse layer sources."""


class SparseLayerUnavailableError(SparseLayerSourceError):
    """Raised when a required sparse sidecar cannot be obtained."""


class SparseLayerIncompatibleError(SparseLayerSourceError):
    """Raised when a sidecar cannot safely represent the requested source/grid."""


@dataclass(frozen=True)
class SparseLayerBinding:
    """Trusted pins required to accept a sparse sidecar without reading its TIF.

    ``has_source_nodata`` distinguishes an explicit trusted null from a missing
    ``sourceNodata`` key. Sparse acceptance requires it to be true.
    """

    source_url: str
    source_sha256: str | None
    sparse_url: str | None
    sparse_sha256: str | None = None
    expected_nodata: float | int | None = None
    has_source_nodata: bool = False


@dataclass(frozen=True)
class LayerSourceDiagnostic:
    """Observable record of the source decision for one layer load."""

    layer_id: str
    mode_requested: LayerSourceMode
    source_chosen: LayerSourceChoice
    fallback_reason: str | None = None


def layer_source_mode(value: str | None = None) -> LayerSourceMode:
    """Parse ``METRICS_LAYER_SOURCE``; dense remains the production default."""

    selected = (value or os.environ.get("METRICS_LAYER_SOURCE", "dense")).strip().lower()
    if selected not in {"dense", "sparse", "auto"}:
        raise ValueError(
            "METRICS_LAYER_SOURCE must be one of dense, sparse, or auto "
            f"(got {selected!r})."
        )
    return selected  # type: ignore[return-value]


def sparse_url_for_source(source_url: str) -> str:
    """Return the colocated ``.sparse.gz`` URL for a source TIF URL."""

    try:
        parsed = urlsplit(source_url)
    except (TypeError, ValueError) as exc:
        raise SparseLayerIncompatibleError(
            f"Cannot derive sparse sidecar URL from {source_url!r}: {exc}"
        ) from exc
    path = parsed.path
    lowered = path.lower()
    if lowered.endswith(".tiff"):
        path = path[:-5] + ".sparse.gz"
    elif lowered.endswith(".tif"):
        path = path[:-4] + ".sparse.gz"
    else:
        raise SparseLayerIncompatibleError(
            f"Cannot derive sparse sidecar URL from non-TIF source {source_url!r}."
        )
    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))


def source_pathname(source_url: str) -> str:
    """Normalize a source URL/path to the identity stored in sparse metadata."""

    if not isinstance(source_url, str):
        raise SparseLayerIncompatibleError(
            f"Invalid sparse source URL {source_url!r}."
        )
    try:
        parsed = urlsplit(source_url)
    except (TypeError, ValueError) as exc:
        raise SparseLayerIncompatibleError(
            f"Invalid sparse source URL {source_url!r}: {exc}"
        ) from exc
    if parsed.scheme and (parsed.scheme not in {"http", "https"} or not parsed.netloc):
        raise SparseLayerIncompatibleError(
            f"Invalid sparse source URL {source_url!r}."
        )
    pathname = (
        parsed.path.lstrip("/")
        if parsed.scheme or parsed.netloc
        else source_url.lstrip("/")
    )
    if not pathname:
        raise SparseLayerIncompatibleError("Sparse source pathname is empty.")
    return pathname


def binary_selection_values(rendering: dict) -> tuple[int, ...]:
    """Normalize binary rendering selection or raise one sparse error type."""

    try:
        if not isinstance(rendering, dict):
            raise TypeError("rendering must be an object")
        if str(rendering.get("valueType") or "").lower() != "binary":
            raise ValueError("valueType must be binary")
        raw_values = rendering.get("selectedValues")
        if raw_values is None:
            raw_values = [rendering.get("selectedValue", 1)]
        if (
            not isinstance(raw_values, (list, tuple))
            or not raw_values
            or any(isinstance(value, bool) for value in raw_values)
        ):
            raise ValueError("selectedValue(s) must contain numeric class IDs")
        normalized_values: set[int] = set()
        for value in raw_values:
            if not isinstance(value, (int, float)):
                raise ValueError("selectedValue(s) must contain numeric class IDs")
            numeric = float(value)
            integer = int(value)
            if not math.isfinite(numeric) or numeric != integer:
                raise ValueError("selectedValue(s) must contain integer class IDs")
            normalized_values.add(integer)
        return tuple(sorted(normalized_values))
    except (TypeError, ValueError, OverflowError) as exc:
        raise SparseLayerIncompatibleError(
            f"Malformed binary rendering metadata: {exc}"
        ) from exc


def _trusted_sha256(value: str | None, *, label: str, required: bool) -> str | None:
    if value is None:
        if required:
            raise SparseLayerIncompatibleError(f"Missing trusted {label} SHA-256.")
        return None
    if not isinstance(value, str):
        raise SparseLayerIncompatibleError(f"Invalid trusted {label} SHA-256.")
    normalized = value.lower()
    if len(normalized) != 64 or any(char not in "0123456789abcdef" for char in normalized):
        raise SparseLayerIncompatibleError(f"Invalid trusted {label} SHA-256.")
    return normalized


def _nodata_matches(observed: float | int | None, expected: float | int | None) -> bool:
    if observed is None or expected is None:
        return observed is expected
    try:
        if math.isnan(float(observed)) and math.isnan(float(expected)):
            return True
    except (TypeError, ValueError):
        return False
    return observed == expected


def parse_source_nodata_pin(value: object) -> float | int | None:
    """Parse a JSON-safe trusted nodata pin, including the canonical NaN token."""

    if value == "NaN":
        return float("nan")
    if value is None or (
        isinstance(value, (int, float)) and not isinstance(value, bool)
    ):
        return value
    raise SparseLayerIncompatibleError(
        "Invalid trusted sourceNodata pin; expected numeric, explicit null, or 'NaN'."
    )


def _validate_nodata_pin(binding: SparseLayerBinding) -> None:
    if not binding.has_source_nodata:
        raise SparseLayerIncompatibleError("Missing trusted sourceNodata pin.")
    if isinstance(binding.expected_nodata, bool) or (
        binding.expected_nodata is not None
        and not isinstance(binding.expected_nodata, (int, float))
    ):
        raise SparseLayerIncompatibleError(
            "Invalid trusted sourceNodata pin; expected numeric or explicit null."
        )
    if (
        binding.expected_nodata is not None
        and math.isinf(float(binding.expected_nodata))
    ):
        raise SparseLayerIncompatibleError(
            "Invalid trusted sourceNodata pin; infinity is unsupported."
        )


def validated_sparse_url(binding: SparseLayerBinding) -> str:
    """Validate all trusted binding pins needed before sidecar download."""

    _trusted_sha256(binding.source_sha256, label="source", required=True)
    _trusted_sha256(binding.sparse_sha256, label="sidecar", required=False)
    source_pathname(binding.source_url)
    _validate_nodata_pin(binding)
    if not isinstance(binding.sparse_url, str) or not binding.sparse_url.strip():
        raise SparseLayerIncompatibleError("Missing trusted sparse sidecar URL.")
    try:
        parsed = urlsplit(binding.sparse_url)
    except (TypeError, ValueError) as exc:
        raise SparseLayerIncompatibleError(
            f"Invalid sparse sidecar URL {binding.sparse_url!r}: {exc}"
        ) from exc
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or not parsed.path:
        raise SparseLayerIncompatibleError(
            f"Invalid sparse sidecar URL {binding.sparse_url!r}."
        )
    return binding.sparse_url


def _metadata_fingerprint(metadata: SparseMetadata) -> RasterFingerprint:
    transform = metadata.transform or (
        metadata.x_scale,
        0.0,
        metadata.x_origin,
        0.0,
        metadata.y_scale,
        metadata.y_origin,
    )
    return RasterFingerprint(
        width=metadata.width,
        height=metadata.height,
        transform=transform,
        crs=metadata.crs,
    )


@dataclass(frozen=True)
class IndexedBinaryLayerSource:
    """Sorted occupied cell IDs bound to one source layer and solution grid."""

    layer_id: str
    source_pathname: str
    source_sha256: str
    sparse_sha256: str
    nodata: float | int | None
    selected_values: tuple[int, ...]
    fingerprint: RasterFingerprint
    occupied_cell_ids: np.ndarray

    @classmethod
    def from_bytes(
        cls,
        blob: bytes,
        *,
        layer_id: str,
        binding: SparseLayerBinding,
        expected_fingerprint: RasterFingerprint,
        expected_selected_values: tuple[int, ...] = (1,),
    ) -> "IndexedBinaryLayerSource":
        if not isinstance(blob, bytes):
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} must be bytes."
            )
        _validate_nodata_pin(binding)
        expected_source_sha256 = _trusted_sha256(
            binding.source_sha256,
            label="source",
            required=True,
        )
        assert expected_source_sha256 is not None
        expected_sparse_sha256 = _trusted_sha256(
            binding.sparse_sha256,
            label="sidecar",
            required=False,
        )
        observed_sparse_sha256 = hashlib.sha256(blob).hexdigest()
        if (
            expected_sparse_sha256 is not None
            and observed_sparse_sha256 != expected_sparse_sha256
        ):
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} has a stale artifact checksum."
            )

        try:
            artifact = decode_sparse_bytes(blob)
        except (EOFError, OSError, SparseFormatError, ValueError) as exc:
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} is malformed: {exc}"
            ) from exc

        if artifact.layer_type != LAYER_TYPE_BINARY:
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} is not binary."
            )
        if artifact.metadata.transform is None:
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} lacks a full grid transform."
            )

        observed_fingerprint = _metadata_fingerprint(artifact.metadata)
        if not observed_fingerprint.matches(expected_fingerprint):
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} does not match the solution grid."
            )

        expected_pathname = source_pathname(binding.source_url)
        if artifact.metadata.source_pathname != expected_pathname:
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} is not bound to source "
                f"{expected_pathname!r}."
            )
        if artifact.metadata.source_sha256 != expected_source_sha256:
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} has a stale source checksum."
            )
        if not _nodata_matches(
            artifact.metadata.nodata,
            binding.expected_nodata,
        ):
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} uses different nodata semantics."
            )
        try:
            normalized_selected_values = tuple(
                sorted(int(value) for value in expected_selected_values)
            )
        except (TypeError, ValueError, OverflowError) as exc:
            raise SparseLayerIncompatibleError(
                f"Invalid expected binary selection values for {layer_id!r}: {exc}"
            ) from exc
        if artifact.metadata.selected_values != normalized_selected_values:
            raise SparseLayerIncompatibleError(
                f"Sparse sidecar for {layer_id!r} uses different binary selection values."
            )

        cell_ids = artifact.cell_ids
        if cell_ids.size:
            if np.any(
                cell_ids
                >= expected_fingerprint.width * expected_fingerprint.height
            ):
                raise SparseLayerIncompatibleError(
                    f"Sparse sidecar for {layer_id!r} contains an out-of-grid cell ID."
                )
            if np.any(cell_ids[1:] <= cell_ids[:-1]):
                raise SparseLayerIncompatibleError(
                    f"Sparse sidecar for {layer_id!r} cell IDs are not strictly sorted."
                )

        cell_ids.setflags(write=False)
        return cls(
            layer_id=layer_id,
            source_pathname=expected_pathname,
            source_sha256=expected_source_sha256,
            sparse_sha256=observed_sparse_sha256,
            nodata=artifact.metadata.nodata,
            selected_values=normalized_selected_values,
            fingerprint=observed_fingerprint,
            occupied_cell_ids=cell_ids,
        )

    @classmethod
    def from_path(
        cls,
        path: Path,
        **kwargs,
    ) -> "IndexedBinaryLayerSource":
        try:
            blob = path.read_bytes()
        except OSError as exc:
            raise SparseLayerUnavailableError(
                f"Could not read sparse sidecar {path}: {exc}"
            ) from exc
        return cls.from_bytes(blob, **kwargs)

    def materialize_mask(self) -> np.ndarray:
        """Materialize a dense bool mask for legacy overlap calculators."""

        mask = np.zeros(
            (self.fingerprint.height, self.fingerprint.width),
            dtype=bool,
        )
        mask.ravel()[self.occupied_cell_ids] = True
        return mask


def choose_binary_mask(
    mode: LayerSourceMode,
    *,
    layer_id: str,
    sparse_loader: Callable[[], IndexedBinaryLayerSource],
    dense_loader: Callable[[], np.ndarray],
    record_diagnostic: Callable[[LayerSourceDiagnostic], None] | None = None,
    warn_on_fallback: bool = True,
) -> np.ndarray:
    """Resolve a dense legacy mask and record the validated loading decision."""

    def record(source: LayerSourceChoice, reason: str | None = None) -> None:
        if record_diagnostic is not None:
            record_diagnostic(
                LayerSourceDiagnostic(
                    layer_id=layer_id,
                    mode_requested=mode,
                    source_chosen=source,
                    fallback_reason=reason,
                )
            )

    if mode == "dense":
        record("dense")
        return dense_loader()
    try:
        mask = sparse_loader().materialize_mask()
        record("sparse")
        return mask
    except SparseLayerSourceError as exc:
        reason = f"{type(exc).__name__}: {exc}"
        if mode == "sparse":
            record("none", reason)
            raise
        if warn_on_fallback:
            warnings.warn(
                f"Sparse layer {layer_id!r} rejected; using dense source ({exc}).",
                RuntimeWarning,
                stacklevel=2,
            )
        record("dense", reason)
        return dense_loader()
