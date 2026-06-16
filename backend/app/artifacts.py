from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

import rasterio
from pydantic import BaseModel, Field

from .config import Settings
from .species_index import RuntimeSpeciesIndex, SpeciesIndexLoadError, load_runtime_species_index

LOGGER = logging.getLogger(__name__)


class ArtifactState(BaseModel):
    required: bool
    available: bool
    manifest_path: str
    schema_version: str | None = None
    artifact_version: str | None = None
    checksum: str | None = None
    message: str
    warmup_status: str = "not_started"
    warmup_ms: float | None = None
    loaded_at: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class RuntimeRasterLayer:
    layer_id: str
    path: Path
    kind: str
    rendering: dict[str, Any] = field(default_factory=dict)
    source_url: str | None = None
    metric_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class RuntimeSpeciesMatrix:
    group: str
    path: Path
    source_url: str | None = None
    metric_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class RuntimeArtifact:
    manifest: dict[str, Any]
    area_grid: dict[str, Any] | None = None
    area_grid_path: Path | None = None
    reference_raster_path: Path | None = None
    raster_layers: dict[str, RuntimeRasterLayer] = field(default_factory=dict)
    species_matrices: dict[str, RuntimeSpeciesMatrix] = field(default_factory=dict)
    species_index: RuntimeSpeciesIndex | None = None
    species_pool_sizes: dict[str, Any] = field(default_factory=dict)

    def close(self) -> None:
        if self.species_index is not None:
            self.species_index.close()


class ArtifactValidationError(ValueError):
    pass


REQUIRED_MANIFEST_FIELDS = {
    "artifact_version",
    "schema_version",
    "created_at",
    "checksum",
    "source_manifest",
}

_RUNTIME_LOCK = Lock()
_RUNTIME_ARTIFACT: RuntimeArtifact | None = None
_RUNTIME_STATE: ArtifactState | None = None
_RUNTIME_SETTINGS_KEY: tuple[str, bool, str] | None = None


def _close_runtime_artifact(artifact: RuntimeArtifact | None) -> None:
    if artifact is None:
        return
    try:
        artifact.close()
    except Exception:
        LOGGER.warning("Runtime artifact cleanup failed", exc_info=True)


def _settings_key(settings: Settings) -> tuple[str, bool, str]:
    return (
        str(settings.artifact_manifest_path),
        settings.artifact_required,
        settings.artifact_schema_version,
    )


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact_file:
        for chunk in iter(lambda: artifact_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _relative_artifact_path(manifest_path: Path, artifact_path: str) -> Path:
    path = Path(artifact_path)
    if path.is_absolute():
        return path
    return manifest_path.parent / path


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
    except FileNotFoundError as exc:
        raise ArtifactValidationError("Artifact manifest is missing.") from exc
    except json.JSONDecodeError as exc:
        raise ArtifactValidationError("Artifact manifest is not valid JSON.") from exc

    if not isinstance(manifest, dict):
        raise ArtifactValidationError("Artifact manifest must be a JSON object.")

    missing_fields = sorted(REQUIRED_MANIFEST_FIELDS - manifest.keys())
    if missing_fields:
        raise ArtifactValidationError(
            f"Artifact manifest is missing required fields: {', '.join(missing_fields)}."
        )

    checksum = manifest.get("checksum")
    if not isinstance(checksum, dict) or not checksum.get("algorithm") or not checksum.get("value"):
        raise ArtifactValidationError(
            "Artifact manifest checksum must include algorithm and value."
        )

    source_manifest = manifest.get("source_manifest")
    if not isinstance(source_manifest, dict):
        raise ArtifactValidationError("Artifact manifest source_manifest must be an object.")

    return manifest


def _state_from_manifest(
    settings: Settings,
    manifest: dict[str, Any],
    *,
    message: str,
    warmup_status: str,
    warmup_ms: float | None,
    loaded_at: str | None,
    metadata: dict[str, Any] | None = None,
) -> ArtifactState:
    checksum = manifest.get("checksum", {})
    checksum_text = f"{checksum.get('algorithm')}:{checksum.get('value')}"

    return ArtifactState(
        required=settings.artifact_required,
        available=True,
        manifest_path=str(settings.artifact_manifest_path),
        schema_version=manifest.get("schema_version"),
        artifact_version=manifest.get("artifact_version"),
        checksum=checksum_text,
        message=message,
        warmup_status=warmup_status,
        warmup_ms=warmup_ms,
        loaded_at=loaded_at,
        metadata=metadata or {},
    )


def _state_from_error(
    settings: Settings,
    message: str,
    *,
    warmup_status: str,
    warmup_ms: float | None,
) -> ArtifactState:
    return ArtifactState(
        required=settings.artifact_required,
        available=False,
        manifest_path=str(settings.artifact_manifest_path),
        message=message,
        warmup_status=warmup_status,
        warmup_ms=warmup_ms,
    )


def _verify_checksum(path: Path, checksum: Any, label: str) -> None:
    if isinstance(checksum, dict) and checksum.get("algorithm") == "sha256":
        actual = _sha256(path)
        if actual != checksum.get("value"):
            raise ArtifactValidationError(f"{label} checksum does not match manifest.")


def _load_area_grid(manifest_path: Path, manifest: dict[str, Any]) -> tuple[dict[str, Any], Path]:
    area_grid_path = manifest.get("area_grid_path")
    if not isinstance(area_grid_path, str) or not area_grid_path:
        raise ArtifactValidationError("Artifact manifest must include area_grid_path.")

    path = _relative_artifact_path(manifest_path, area_grid_path)
    try:
        grid = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ArtifactValidationError("Area grid artifact is missing.") from exc
    except json.JSONDecodeError as exc:
        raise ArtifactValidationError("Area grid artifact is not valid JSON.") from exc

    if not isinstance(grid, dict):
        raise ArtifactValidationError("Area grid artifact must be a JSON object.")

    cells = grid.get("cells")
    if not isinstance(cells, list) or not cells:
        raise ArtifactValidationError("Area grid artifact must include cells.")

    pixel_area_km2 = grid.get("pixel_area_km2")
    if not isinstance(pixel_area_km2, (int, float)) or pixel_area_km2 <= 0:
        raise ArtifactValidationError("Area grid artifact must include positive pixel_area_km2.")

    for index, cell in enumerate(cells):
        if not isinstance(cell, dict):
            raise ArtifactValidationError(f"Area grid cell {index} must be an object.")
        bbox = cell.get("bbox")
        if (
            not isinstance(bbox, list)
            or len(bbox) != 4
            or not all(isinstance(value, (int, float)) for value in bbox)
        ):
            raise ArtifactValidationError(f"Area grid cell {index} must include numeric bbox.")
        if bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
            raise ArtifactValidationError(f"Area grid cell {index} bbox is invalid.")
        if not isinstance(cell.get("selected"), bool) or not isinstance(cell.get("valid"), bool):
            raise ArtifactValidationError(
                f"Area grid cell {index} must include boolean selected and valid flags."
            )

    _verify_checksum(path, manifest.get("area_grid_checksum"), "Area grid")
    return grid, path


def _artifact_metadata(area_grid: dict[str, Any], area_grid_path: Path) -> dict[str, Any]:
    cells = area_grid["cells"]
    valid_cells = sum(1 for cell in cells if cell["valid"])
    selected_cells = sum(1 for cell in cells if cell["valid"] and cell["selected"])
    return {
        "artifact_kind": area_grid.get("artifact_kind"),
        "area_grid_path": str(area_grid_path),
        "cell_count": len(cells),
        "valid_cell_count": valid_cells,
        "selected_cell_count": selected_cells,
        "pixel_area_km2": area_grid["pixel_area_km2"],
        "bounds": area_grid.get("bounds"),
        "metric_coverage": {
            "implemented_now": ["priority_area_in_region", "national_contribution"],
            "artifact_mode": "tiny_area_grid",
        },
    }


def _load_raster_layers(manifest_path: Path, manifest: dict[str, Any]) -> dict[str, RuntimeRasterLayer]:
    raw_layers = manifest.get("raster_layers")
    if not isinstance(raw_layers, list) or not raw_layers:
        raise ArtifactValidationError("Raster artifact must include raster_layers.")

    layers: dict[str, RuntimeRasterLayer] = {}
    for index, raw in enumerate(raw_layers):
        if not isinstance(raw, dict):
            raise ArtifactValidationError(f"Raster layer {index} must be an object.")
        layer_id = raw.get("layer_id")
        raw_path = raw.get("path")
        if not isinstance(layer_id, str) or not layer_id:
            raise ArtifactValidationError(f"Raster layer {index} must include layer_id.")
        if not isinstance(raw_path, str) or not raw_path:
            raise ArtifactValidationError(f"Raster layer {layer_id} must include path.")

        path = _relative_artifact_path(manifest_path, raw_path)
        if not path.exists():
            raise ArtifactValidationError(f"Raster layer {layer_id} is missing.")
        _verify_checksum(path, raw.get("checksum"), f"Raster layer {layer_id}")

        rendering = raw.get("rendering") if isinstance(raw.get("rendering"), dict) else {}
        metric_ids = raw.get("metric_ids") if isinstance(raw.get("metric_ids"), list) else []
        layers[layer_id] = RuntimeRasterLayer(
            layer_id=layer_id,
            path=path,
            kind=str(raw.get("kind") or "binary"),
            rendering=rendering,
            source_url=raw.get("source_url") if isinstance(raw.get("source_url"), str) else None,
            metric_ids=tuple(str(metric_id) for metric_id in metric_ids),
        )
    return layers


def _load_species_matrices(manifest_path: Path, manifest: dict[str, Any]) -> dict[str, RuntimeSpeciesMatrix]:
    raw_matrices = manifest.get("species_matrices")
    if raw_matrices is None:
        return {}
    if not isinstance(raw_matrices, list):
        raise ArtifactValidationError("species_matrices must be a list when present.")

    matrices: dict[str, RuntimeSpeciesMatrix] = {}
    for index, raw in enumerate(raw_matrices):
        if not isinstance(raw, dict):
            raise ArtifactValidationError(f"Species matrix {index} must be an object.")
        group = raw.get("group")
        raw_path = raw.get("path")
        if not isinstance(group, str) or not group:
            raise ArtifactValidationError(f"Species matrix {index} must include group.")
        if not isinstance(raw_path, str) or not raw_path:
            raise ArtifactValidationError(f"Species matrix {group} must include path.")

        path = _relative_artifact_path(manifest_path, raw_path)
        if not path.exists():
            raise ArtifactValidationError(f"Species matrix {group} is missing.")
        _verify_checksum(path, raw.get("checksum"), f"Species matrix {group}")

        metric_ids = raw.get("metric_ids") if isinstance(raw.get("metric_ids"), list) else []
        matrices[group] = RuntimeSpeciesMatrix(
            group=group,
            path=path,
            source_url=raw.get("source_url") if isinstance(raw.get("source_url"), str) else None,
            metric_ids=tuple(str(metric_id) for metric_id in metric_ids),
        )
    return matrices


def _load_raster_artifact(
    manifest_path: Path,
    manifest: dict[str, Any],
) -> tuple[RuntimeArtifact, dict[str, Any]]:
    reference_path = manifest.get("reference_raster_path")
    if not isinstance(reference_path, str) or not reference_path:
        raise ArtifactValidationError("Raster artifact must include reference_raster_path.")

    resolved_reference = _relative_artifact_path(manifest_path, reference_path)
    if not resolved_reference.exists():
        raise ArtifactValidationError("Reference raster artifact is missing.")
    _verify_checksum(resolved_reference, manifest.get("reference_raster_checksum"), "Reference raster")

    try:
        with rasterio.open(resolved_reference) as dataset:
            reference_metadata = {
                "width": dataset.width,
                "height": dataset.height,
                "crs": str(dataset.crs) if dataset.crs else None,
                "bounds": [dataset.bounds.left, dataset.bounds.bottom, dataset.bounds.right, dataset.bounds.top],
                "nodata": dataset.nodata,
            }
    except Exception as exc:
        raise ArtifactValidationError(f"Reference raster could not be opened: {exc}") from exc

    layers = _load_raster_layers(manifest_path, manifest)
    species_matrices = _load_species_matrices(manifest_path, manifest)
    species_pool_sizes = (
        manifest.get("species_pool_sizes")
        if isinstance(manifest.get("species_pool_sizes"), dict)
        else {}
    )
    species_index: RuntimeSpeciesIndex | None = None
    species_index_metadata: dict[str, Any] = {"status": "not_configured"}
    if species_matrices:
        try:
            species_index = load_runtime_species_index(species_matrices)
            species_index_metadata = species_index.metadata()
        except SpeciesIndexLoadError as exc:
            species_index_metadata = {"status": "failed", "reason": str(exc)}
            LOGGER.warning(
                "Species sparse index warmup failed; request-time streaming fallback remains available",
                extra={"reason": str(exc)},
            )
    metadata = {
        "artifact_kind": manifest.get("artifact_kind", "colombia-raster-custom-aoi/v1"),
        "reference_raster_path": str(resolved_reference),
        "reference_raster": reference_metadata,
        "raster_layer_count": len(layers),
        "raster_layers": sorted(layers.keys()),
        "species_matrix_count": len(species_matrices),
        "species_matrix_groups": sorted(species_matrices.keys()),
        "species_index": species_index_metadata,
        "species_pool_sizes": species_pool_sizes,
        "metric_coverage": manifest.get("metric_coverage", {}),
    }
    artifact = RuntimeArtifact(
        manifest=manifest,
        reference_raster_path=resolved_reference,
        raster_layers=layers,
        species_matrices=species_matrices,
        species_index=species_index,
        species_pool_sizes=species_pool_sizes,
    )
    return artifact, metadata


def load_runtime_artifact(settings: Settings) -> tuple[RuntimeArtifact, ArtifactState]:
    started = time.perf_counter()
    manifest = load_manifest(settings.artifact_manifest_path)

    if manifest.get("schema_version") != settings.artifact_schema_version:
        raise ArtifactValidationError(
            f"Artifact manifest schema_version must be {settings.artifact_schema_version}."
        )

    if manifest.get("reference_raster_path"):
        artifact, metadata = _load_raster_artifact(settings.artifact_manifest_path, manifest)
    else:
        area_grid, area_grid_path = _load_area_grid(settings.artifact_manifest_path, manifest)
        metadata = _artifact_metadata(area_grid, area_grid_path)
        artifact = RuntimeArtifact(
            manifest=manifest,
            area_grid=area_grid,
            area_grid_path=area_grid_path,
        )

    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    state = _state_from_manifest(
        settings,
        manifest,
        message="Runtime artifact loaded.",
        warmup_status="ready",
        warmup_ms=elapsed_ms,
        loaded_at=_utc_now(),
        metadata=metadata,
    )
    return artifact, state


def warmup_artifacts(settings: Settings) -> ArtifactState:
    global _RUNTIME_ARTIFACT, _RUNTIME_SETTINGS_KEY, _RUNTIME_STATE

    key = _settings_key(settings)
    with _RUNTIME_LOCK:
        if _RUNTIME_SETTINGS_KEY == key and _RUNTIME_STATE is not None:
            return _RUNTIME_STATE

        previous_artifact = _RUNTIME_ARTIFACT
        started = time.perf_counter()
        try:
            artifact, state = load_runtime_artifact(settings)
        except ArtifactValidationError as exc:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
            status = "failed" if settings.artifact_required else "not_required"
            state = _state_from_error(
                settings,
                str(exc),
                warmup_status=status,
                warmup_ms=elapsed_ms,
            )
            _RUNTIME_ARTIFACT = None
            _RUNTIME_STATE = state
            _RUNTIME_SETTINGS_KEY = key
            _close_runtime_artifact(previous_artifact)
            LOGGER.warning(
                "Artifact warmup did not load runtime artifacts",
                extra={"artifact_required": settings.artifact_required, "warmup_ms": elapsed_ms},
            )
            return state

        _RUNTIME_ARTIFACT = artifact
        _RUNTIME_STATE = state
        _RUNTIME_SETTINGS_KEY = key
        if previous_artifact is not artifact:
            _close_runtime_artifact(previous_artifact)
        LOGGER.info(
            "Artifact warmup loaded runtime artifacts",
            extra={"artifact_metadata": state.metadata, "warmup_ms": state.warmup_ms},
        )
        return state


def reset_runtime_artifact_cache() -> None:
    global _RUNTIME_ARTIFACT, _RUNTIME_SETTINGS_KEY, _RUNTIME_STATE

    with _RUNTIME_LOCK:
        artifact = _RUNTIME_ARTIFACT
        _RUNTIME_ARTIFACT = None
        _RUNTIME_SETTINGS_KEY = None
        _RUNTIME_STATE = None
        _close_runtime_artifact(artifact)


def get_artifact_state(settings: Settings) -> ArtifactState:
    return warmup_artifacts(settings)


def get_runtime_artifact(settings: Settings) -> RuntimeArtifact | None:
    warmup_artifacts(settings)
    return _RUNTIME_ARTIFACT


def artifact_ready(settings: Settings, state: ArtifactState) -> bool:
    return state.available or not settings.artifact_required
