from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field

from .config import Settings

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
class RuntimeArtifact:
    manifest: dict[str, Any]
    area_grid: dict[str, Any]
    area_grid_path: Path


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

    expected = manifest.get("area_grid_checksum")
    if isinstance(expected, dict) and expected.get("algorithm") == "sha256":
        actual = _sha256(path)
        if actual != expected.get("value"):
            raise ArtifactValidationError("Area grid checksum does not match manifest.")

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
    }


def load_runtime_artifact(settings: Settings) -> tuple[RuntimeArtifact, ArtifactState]:
    started = time.perf_counter()
    manifest = load_manifest(settings.artifact_manifest_path)

    if manifest.get("schema_version") != settings.artifact_schema_version:
        raise ArtifactValidationError(
            f"Artifact manifest schema_version must be {settings.artifact_schema_version}."
        )

    area_grid, area_grid_path = _load_area_grid(settings.artifact_manifest_path, manifest)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    metadata = _artifact_metadata(area_grid, area_grid_path)
    state = _state_from_manifest(
        settings,
        manifest,
        message="Runtime artifact loaded.",
        warmup_status="ready",
        warmup_ms=elapsed_ms,
        loaded_at=_utc_now(),
        metadata=metadata,
    )
    return RuntimeArtifact(manifest=manifest, area_grid=area_grid, area_grid_path=area_grid_path), state


def warmup_artifacts(settings: Settings) -> ArtifactState:
    global _RUNTIME_ARTIFACT, _RUNTIME_SETTINGS_KEY, _RUNTIME_STATE

    key = _settings_key(settings)
    with _RUNTIME_LOCK:
        if _RUNTIME_SETTINGS_KEY == key and _RUNTIME_STATE is not None:
            return _RUNTIME_STATE

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
            LOGGER.warning(
                "Artifact warmup did not load runtime artifacts",
                extra={"artifact_required": settings.artifact_required, "warmup_ms": elapsed_ms},
            )
            return state

        _RUNTIME_ARTIFACT = artifact
        _RUNTIME_STATE = state
        _RUNTIME_SETTINGS_KEY = key
        LOGGER.info(
            "Artifact warmup loaded runtime artifacts",
            extra={"artifact_metadata": state.metadata, "warmup_ms": state.warmup_ms},
        )
        return state


def reset_runtime_artifact_cache() -> None:
    global _RUNTIME_ARTIFACT, _RUNTIME_SETTINGS_KEY, _RUNTIME_STATE

    with _RUNTIME_LOCK:
        _RUNTIME_ARTIFACT = None
        _RUNTIME_SETTINGS_KEY = None
        _RUNTIME_STATE = None


def get_artifact_state(settings: Settings) -> ArtifactState:
    return warmup_artifacts(settings)


def get_runtime_artifact(settings: Settings) -> RuntimeArtifact | None:
    warmup_artifacts(settings)
    return _RUNTIME_ARTIFACT


def artifact_ready(settings: Settings, state: ArtifactState) -> bool:
    return state.available or not settings.artifact_required
