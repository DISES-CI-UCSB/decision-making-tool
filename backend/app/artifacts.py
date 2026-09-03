from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import urlparse

import numpy as np
import rasterio
from pydantic import BaseModel, Field

from .config import SIRAP_ARTIFACT_KIND, Settings, resolve_sirap_id_from_solution_id
from .coverage_target_validation import (
    CoverageTargetValidationError,
    MESA_V3_ECOSYSTEM_TARGET_COUNT,
    MESA_V3_GOLDEN_SPECIES_TARGET_COUNT,
    validate_coverage_targets,
)
from .solution_registry import (
    RasterFingerprint,
    RuntimeSolutionRegistry,
    SolutionRegistryError,
    build_solution_registry,
)
from .species_index import (
    RuntimeSpeciesBitsetIndex,
    RuntimeSpeciesIndex,
    SpeciesIndexLoadError,
    load_runtime_species_bitset_index,
    load_runtime_species_index,
)
from .ecosystem_inventory import (
    EcosystemInventoryError,
    RuntimeEcosystemInventory,
    load_ecosystem_inventory,
)
from .solution_coverage import (
    RuntimeMesaCoverage,
    SolutionCoverageError,
    load_runtime_mesa_coverage,
)
from .sirap_coverage import (
    RuntimeSirapCoverage,
    SirapCoverageError,
    load_runtime_sirap_coverage,
)

LOGGER = logging.getLogger(__name__)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


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
    species_index: RuntimeSpeciesIndex | RuntimeSpeciesBitsetIndex | None = None
    species_pool_sizes: dict[str, Any] = field(default_factory=dict)
    ecosystem_inventory: RuntimeEcosystemInventory | None = None
    mesa_coverage: RuntimeMesaCoverage | None = None
    sirap_coverage: RuntimeSirapCoverage | None = None
    solution_registry: RuntimeSolutionRegistry | None = None

    def close(self) -> None:
        if self.species_index is not None:
            self.species_index.close()
        if self.solution_registry is not None:
            self.solution_registry.close()


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
_RUNTIME_SETTINGS_KEY: tuple[
    str,
    bool,
    str,
    str,
    bool,
    str | None,
    str | None,
] | None = None
_SIRAP_RUNTIME_LOCK = Lock()
_SIRAP_RUNTIME_ARTIFACTS: dict[str, RuntimeArtifact] = {}
_SIRAP_RUNTIME_SETTINGS_KEY: str | None = None


def _close_runtime_artifact(artifact: RuntimeArtifact | None) -> None:
    if artifact is None:
        return
    try:
        artifact.close()
    except Exception:
        LOGGER.warning("Runtime artifact cleanup failed", exc_info=True)


def _settings_key(
    settings: Settings,
) -> tuple[str, bool, str, str, bool, str | None, str | None]:
    return (
        str(settings.artifact_manifest_path),
        settings.artifact_required,
        settings.artifact_schema_version,
        str(settings.solution_cache_dir),
        settings.mesa_coverage_required,
        settings.expected_coverage_release_id,
        settings.expected_coverage_contract_sha256,
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


def _verify_aggregate_checksum(manifest: dict[str, Any]) -> None:
    if manifest.get("checksum_scope") != "files/v1":
        return
    files = manifest.get("files")
    if files is None:
        return
    if not isinstance(files, list):
        raise ArtifactValidationError("Artifact files must be a list.")
    aggregate = manifest.get("checksum")
    if (
        not isinstance(aggregate, dict)
        or aggregate.get("algorithm") != "sha256"
        or not isinstance(aggregate.get("value"), str)
    ):
        raise ArtifactValidationError("Artifact aggregate checksum is invalid.")

    digest = hashlib.sha256()
    try:
        for entry in sorted(files, key=lambda item: item["path"]):
            checksum = entry["checksum"]
            if checksum.get("algorithm") != "sha256":
                raise ArtifactValidationError(
                    "Artifact file checksum algorithm must be sha256."
                )
            digest.update(str(entry["path"]).encode("utf-8"))
            digest.update(str(entry["size_bytes"]).encode("utf-8"))
            digest.update(str(checksum["value"]).encode("utf-8"))
    except (KeyError, TypeError) as exc:
        raise ArtifactValidationError("Artifact file checksum entry is invalid.") from exc
    if digest.hexdigest() != aggregate["value"]:
        raise ArtifactValidationError("Artifact aggregate checksum mismatch.")


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
    if isinstance(raw_matrices, dict) and raw_matrices.get("status") == "stubbed":
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


def _load_species_bitset(
    manifest_path: Path,
    manifest: dict[str, Any],
) -> RuntimeSpeciesBitsetIndex | None:
    raw = manifest.get("species_bitset")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ArtifactValidationError("species_bitset must be an object when present.")

    resolved: dict[str, Path] = {}
    for key in ("data", "metadata"):
        entry = raw.get(key)
        if not isinstance(entry, dict):
            raise ArtifactValidationError(f"species_bitset.{key} must be an object.")
        raw_path = entry.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            raise ArtifactValidationError(f"species_bitset.{key}.path is required.")
        path = _relative_artifact_path(manifest_path, raw_path)
        if not path.is_file():
            raise ArtifactValidationError(f"Species bitset {key} artifact is missing.")
        _verify_checksum(path, entry.get("checksum"), f"Species bitset {key}")
        resolved[key] = path

    try:
        return load_runtime_species_bitset_index(
            resolved["data"],
            resolved["metadata"],
        )
    except SpeciesIndexLoadError as exc:
        raise ArtifactValidationError(str(exc)) from exc


def _load_ecosystem_inventory(
    manifest_path: Path,
    manifest: dict[str, Any],
) -> tuple[RuntimeEcosystemInventory | None, dict[str, Any]]:
    raw = manifest.get("ecosystem_inventory")
    if raw is None:
        return None, {"status": "not_configured", "reason": "ecosystem_artifact_not_packaged"}
    if not isinstance(raw, dict):
        raise ArtifactValidationError("ecosystem_inventory must be an object when present.")

    resolved: dict[str, Path] = {}
    for key in ("raster", "crosswalk", "provenance"):
        entry = raw.get(key)
        if not isinstance(entry, dict):
            raise ArtifactValidationError(f"ecosystem_inventory.{key} must be an object.")
        raw_path = entry.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            raise ArtifactValidationError(f"ecosystem_inventory.{key}.path is required.")
        path = _relative_artifact_path(manifest_path, raw_path)
        if not path.exists():
            raise ArtifactValidationError(f"Ecosystem inventory {key} artifact is missing.")
        checksum = entry.get("checksum")
        if (
            not isinstance(checksum, dict)
            or checksum.get("algorithm") != "sha256"
            or not isinstance(checksum.get("value"), str)
        ):
            raise ArtifactValidationError(
                f"ecosystem_inventory.{key}.checksum must be a sha256 checksum."
            )
        _verify_checksum(path, checksum, f"Ecosystem inventory {key}")
        resolved[key] = path

    try:
        inventory = load_ecosystem_inventory(
            resolved["raster"],
            resolved["crosswalk"],
            resolved["provenance"],
            raster_sha256=_sha256(resolved["raster"]),
            crosswalk_sha256=_sha256(resolved["crosswalk"]),
        )
    except EcosystemInventoryError as exc:
        raise ArtifactValidationError(str(exc)) from exc
    return inventory, {
        "status": "ready",
        "source_mode": inventory.taxonomy.source_mode,
        "view_ids": [view.view_id for view in inventory.taxonomy.views],
        "class_count": len(inventory.taxonomy.classes),
    }


def _load_mesa_coverage(
    manifest_path: Path,
    manifest: dict[str, Any],
    raster_layers: dict[str, RuntimeRasterLayer],
) -> tuple[RuntimeMesaCoverage | None, dict[str, Any]]:
    raw = manifest.get("mesa_coverage")
    if raw is None:
        return None, {"status": "not_configured"}
    if not isinstance(raw, dict):
        raise ArtifactValidationError("mesa_coverage must be an object when present.")

    ecosystems = raw.get("ecosystems")
    if not isinstance(ecosystems, dict):
        raise ArtifactValidationError("mesa_coverage.ecosystems must be an object.")
    layer_id = ecosystems.get("raster_layer_id")
    layer = raster_layers.get(str(layer_id))
    if layer is None:
        raise ArtifactValidationError("Mesa ecosystem raster layer is not packaged.")

    resolved: dict[str, Path] = {"raster": layer.path}
    for key, entry in (
        ("catalog", ecosystems.get("catalog")),
        ("targets", raw.get("targets")),
    ):
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise ArtifactValidationError(f"mesa_coverage.{key}.path is required.")
        path = _relative_artifact_path(manifest_path, entry["path"])
        if not path.is_file():
            raise ArtifactValidationError(f"Mesa coverage {key} artifact is missing.")
        _verify_checksum(path, entry.get("checksum"), f"Mesa coverage {key}")
        resolved[key] = path

    species_groups = raw.get("species_groups", [])
    if not isinstance(species_groups, list) or not all(
        isinstance(group, str) for group in species_groups
    ):
        raise ArtifactValidationError("mesa_coverage.species_groups must be strings.")
    try:
        coverage = load_runtime_mesa_coverage(
            resolved["raster"],
            resolved["catalog"],
            resolved["targets"],
            species_groups,
        )
    except SolutionCoverageError as exc:
        raise ArtifactValidationError(str(exc)) from exc
    return coverage, {
        "status": "ready",
        "solution_count": len(coverage.targets_by_solution),
        "species_groups": list(coverage.species_groups),
        "contract": raw.get("contract"),
    }


def _load_sirap_coverage(
    manifest_path: Path,
    manifest: dict[str, Any],
    raster_layers: dict[str, RuntimeRasterLayer],
) -> tuple[RuntimeSirapCoverage | None, dict[str, Any]]:
    raw = manifest.get("sirap_coverage")
    if raw is None:
        return None, {"status": "not_configured"}
    if not isinstance(raw, dict):
        raise ArtifactValidationError("sirap_coverage must be an object when present.")

    ecosystems = raw.get("ecosystems")
    if not isinstance(ecosystems, dict):
        raise ArtifactValidationError("sirap_coverage.ecosystems must be an object.")
    layer_id = ecosystems.get("raster_layer_id")
    layer = raster_layers.get(str(layer_id))
    if layer is None:
        raise ArtifactValidationError("SIRAP ecosystem raster layer is not packaged.")

    catalog_entry = ecosystems.get("catalog")
    if not isinstance(catalog_entry, dict) or not isinstance(catalog_entry.get("path"), str):
        raise ArtifactValidationError("sirap_coverage.ecosystems.catalog.path is required.")
    catalog_path = _relative_artifact_path(manifest_path, catalog_entry["path"])
    if not catalog_path.is_file():
        raise ArtifactValidationError("SIRAP ecosystem catalog artifact is missing.")
    _verify_checksum(catalog_path, catalog_entry.get("checksum"), "SIRAP ecosystem catalog")

    raw_targets = raw.get("solution_targets")
    if not isinstance(raw_targets, dict) or not raw_targets:
        raise ArtifactValidationError("sirap_coverage.solution_targets must be a non-empty object.")

    solution_targets: dict[str, Path] = {}
    for solution_id, entry in raw_targets.items():
        if not isinstance(solution_id, str) or not solution_id:
            raise ArtifactValidationError("sirap_coverage solution ids must be non-empty strings.")
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise ArtifactValidationError(
                f"sirap_coverage.solution_targets.{solution_id}.path is required."
            )
        targets_path = _relative_artifact_path(manifest_path, entry["path"])
        if not targets_path.is_file():
            raise ArtifactValidationError(
                f"SIRAP coverage targets for {solution_id} are missing."
            )
        _verify_checksum(
            targets_path,
            entry.get("checksum"),
            f"SIRAP coverage targets {solution_id}",
        )
        solution_targets[solution_id] = targets_path

    try:
        coverage = load_runtime_sirap_coverage(
            layer.path,
            catalog_path,
            solution_targets,
        )
    except SirapCoverageError as exc:
        raise ArtifactValidationError(str(exc)) from exc
    return coverage, {
        "status": "ready",
        "solution_count": len(coverage.targets_by_solution),
    }


def _validate_required_mesa_coverage(
    settings: Settings,
    manifest: dict[str, Any],
    coverage: RuntimeMesaCoverage | None,
    reference_fingerprint: RasterFingerprint,
    reference_valid_cell_count: int,
    species_index: RuntimeSpeciesIndex | RuntimeSpeciesBitsetIndex | None,
) -> None:
    if not settings.mesa_coverage_required:
        return
    if coverage is None:
        raise ArtifactValidationError(
            "Production runtime requires the V3 Mesa coverage bundle."
        )
    raw = manifest.get("mesa_coverage")
    contract = raw.get("contract") if isinstance(raw, dict) else None
    if not isinstance(contract, dict):
        raise ArtifactValidationError(
            "Production Mesa coverage must declare its parity contract."
        )
    if contract.get("format") != "coverage-parity-contract-v1":
        raise ArtifactValidationError("Mesa coverage parity contract format is invalid.")
    release_id = contract.get("release_id")
    if (
        settings.expected_coverage_release_id is not None
        and release_id != settings.expected_coverage_release_id
    ):
        raise ArtifactValidationError(
            "Mesa coverage release does not match DMT_EXPECTED_COVERAGE_RELEASE_ID."
        )
    if (
        settings.expected_coverage_contract_sha256 is not None
        and contract.get("sha256") != settings.expected_coverage_contract_sha256
    ):
        raise ArtifactValidationError(
            "Mesa coverage contract does not match "
            "DMT_EXPECTED_COVERAGE_CONTRACT_SHA256."
        )
    expected_ecosystems = MESA_V3_ECOSYSTEM_TARGET_COUNT
    expected_species = MESA_V3_GOLDEN_SPECIES_TARGET_COUNT
    if contract.get("ecosystem_feature_count") != expected_ecosystems:
        raise ArtifactValidationError("Mesa ecosystem inventory must contain 417 rows.")
    if contract.get("species_feature_count") != expected_species:
        raise ArtifactValidationError("Mesa species inventory must contain 7,980 rows.")
    golden_solution_id = contract.get("golden_master_solution_id")
    if not isinstance(golden_solution_id, str) or not golden_solution_id:
        raise ArtifactValidationError("Mesa golden-master solution identity is missing.")
    if golden_solution_id not in coverage.targets_by_solution:
        raise ArtifactValidationError(
            "Mesa golden-master solution is not present in packaged targets."
        )
    if (
        not isinstance(species_index, RuntimeSpeciesBitsetIndex)
        or species_index.species_count != expected_species
    ):
        raise ArtifactValidationError(
            "Runtime species bitset must contain the approved 7,980-species universe."
        )

    grid = contract.get("grid")
    if not isinstance(grid, dict):
        raise ArtifactValidationError("Mesa coverage parity grid fingerprint is missing.")
    expected_transform = grid.get("transform")
    if (
        grid.get("crs") != reference_fingerprint.crs
        or grid.get("width") != reference_fingerprint.width
        or grid.get("height") != reference_fingerprint.height
        or not isinstance(expected_transform, list)
        or len(expected_transform) != len(reference_fingerprint.transform)
        or any(
            abs(float(expected) - actual) > 1e-6
            for expected, actual in zip(
                expected_transform,
                reference_fingerprint.transform,
            )
        )
    ):
        raise ArtifactValidationError(
            "Runtime reference raster does not match the Mesa parity grid fingerprint."
        )
    reference_checksum = manifest.get("reference_raster_checksum")
    if (
        not isinstance(reference_checksum, dict)
        or reference_checksum.get("algorithm") != "sha256"
        or grid.get("template_sha256") != reference_checksum.get("value")
    ):
        raise ArtifactValidationError(
            "Runtime reference raster checksum does not match the Mesa parity contract."
        )
    contract_valid_cells = grid.get("valid_planning_cell_count")
    reference_grid = manifest.get("reference_grid")
    reference_pin = (
        reference_grid.get("pin")
        if isinstance(reference_grid, dict)
        else None
    )
    manifest_valid_cells = (
        reference_pin.get("valid_cell_count")
        if isinstance(reference_pin, dict)
        else None
    )
    if (
        type(contract_valid_cells) is not int
        or contract_valid_cells <= 0
        or manifest_valid_cells != contract_valid_cells
        or reference_valid_cell_count != contract_valid_cells
    ):
        raise ArtifactValidationError(
            "Mesa valid planning-cell count does not match the reference metadata "
            "and raster validity mask."
        )

    if set(coverage.source_bindings_by_solution) != set(
        coverage.targets_by_solution
    ):
        raise ArtifactValidationError(
            "Mesa target source bindings are incomplete."
        )
    for solution_id, targets in coverage.targets_by_solution.items():
        try:
            validated_targets = validate_coverage_targets(
                [
                    {
                        "feature": target.feature,
                        "feature_type": target.feature_type,
                        "class": target.feature_class,
                        "relative_target": target.relative_target,
                        "evaluated": target.evaluated,
                    }
                    for target in targets
                ],
                solution_id=solution_id,
                expected_ecosystem_count=expected_ecosystems,
                expected_species_count=(
                    expected_species if solution_id == golden_solution_id else None
                ),
            )
        except CoverageTargetValidationError as exc:
            raise ArtifactValidationError(
                f"{solution_id} has invalid Mesa coverage targets: {exc}"
            ) from exc
        ecosystem_count = sum(
            target.feature_type == "ecosystem" for target in validated_targets
        )
        species_count = sum(
            target.feature_type == "species" for target in validated_targets
        )
        binding = coverage.source_bindings_by_solution[solution_id]
        parsed_url = urlparse(binding.url or "")
        if (
            parsed_url.scheme != "https"
            or not parsed_url.netloc
            or SHA256_PATTERN.fullmatch(binding.sha256 or "") is None
            or binding.ecosystem_feature_count != ecosystem_count
            or binding.species_feature_count != species_count
        ):
            raise ArtifactValidationError(
                f"{solution_id} has an invalid Mesa target source binding."
            )


def _validate_ecosystem_grid_alignment(
    reference_path: Path,
    inventory: RuntimeEcosystemInventory,
) -> None:
    try:
        with (
            rasterio.open(reference_path) as reference,
            rasterio.open(inventory.raster_path) as ecosystem,
        ):
            aligned = (
                reference.width == ecosystem.width
                and reference.height == ecosystem.height
                and reference.crs == ecosystem.crs
                and reference.transform.almost_equals(ecosystem.transform)
            )
            if not aligned:
                raise ArtifactValidationError(
                    "Ecosystem inventory raster does not align with the reference grid."
                )
    except ArtifactValidationError:
        raise
    except Exception as exc:
        raise ArtifactValidationError(
            f"Ecosystem inventory grid could not be validated: {exc}"
        ) from exc


def _load_raster_artifact(
    settings: Settings,
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
            transform = dataset.transform
            reference_valid_cell_count = sum(
                int(np.count_nonzero(dataset.read_masks(1, window=window)))
                for _, window in dataset.block_windows(1)
            )
            reference_fingerprint = RasterFingerprint(
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
            reference_metadata = {
                "width": dataset.width,
                "height": dataset.height,
                "crs": str(dataset.crs) if dataset.crs else None,
                "bounds": [dataset.bounds.left, dataset.bounds.bottom, dataset.bounds.right, dataset.bounds.top],
                "nodata": dataset.nodata,
                "valid_cell_count": reference_valid_cell_count,
            }
    except Exception as exc:
        raise ArtifactValidationError(f"Reference raster could not be opened: {exc}") from exc

    source_manifest = manifest.get("source_manifest") or {}
    public_blob_host = source_manifest.get("public_blob_host")
    if manifest.get("solution_rasters") is not None and (
        not isinstance(public_blob_host, str) or not public_blob_host
    ):
        raise ArtifactValidationError(
            "Artifact source_manifest.public_blob_host is required."
        )
    try:
        solution_registry = build_solution_registry(
            manifest.get("solution_rasters"),
            cache_dir=settings.solution_cache_dir,
            reference_fingerprint=reference_fingerprint,
            public_blob_host=(
                public_blob_host
                if isinstance(public_blob_host, str)
                else ""
            ),
            release_id=str(manifest.get("artifact_version") or ""),
        )
    except SolutionRegistryError as exc:
        raise ArtifactValidationError(str(exc)) from exc
    solution_registry_metadata = (
        solution_registry.metadata()
        if solution_registry is not None
        else {"status": "not_configured"}
    )

    layers = _load_raster_layers(manifest_path, manifest)
    species_matrices = _load_species_matrices(manifest_path, manifest)
    species_pool_sizes = (
        manifest.get("species_pool_sizes")
        if isinstance(manifest.get("species_pool_sizes"), dict)
        else {}
    )
    species_index: RuntimeSpeciesIndex | RuntimeSpeciesBitsetIndex | None = None
    species_index_metadata: dict[str, Any] = {"status": "not_configured"}
    species_index = _load_species_bitset(manifest_path, manifest)
    if species_index is not None:
        species_index_metadata = species_index.metadata()
    elif species_matrices:
        try:
            species_index = load_runtime_species_index(species_matrices)
            species_index_metadata = species_index.metadata()
        except SpeciesIndexLoadError as exc:
            species_index_metadata = {"status": "failed", "reason": str(exc)}
            LOGGER.warning(
                "Species sparse index warmup failed; request-time streaming fallback remains available",
                extra={"reason": str(exc)},
            )
    try:
        ecosystem_inventory, ecosystem_inventory_metadata = _load_ecosystem_inventory(
            manifest_path,
            manifest,
        )
        if ecosystem_inventory is not None:
            _validate_ecosystem_grid_alignment(
                resolved_reference,
                ecosystem_inventory,
            )
        mesa_coverage, mesa_coverage_metadata = _load_mesa_coverage(
            manifest_path,
            manifest,
            layers,
        )
        sirap_coverage, sirap_coverage_metadata = _load_sirap_coverage(
            manifest_path,
            manifest,
            layers,
        )
        artifact_kind = manifest.get("artifact_kind", "colombia-raster-custom-aoi/v1")
        if artifact_kind != SIRAP_ARTIFACT_KIND:
            _validate_required_mesa_coverage(
                settings,
                manifest,
                mesa_coverage,
                reference_fingerprint,
                reference_valid_cell_count,
                species_index,
            )
    except Exception:
        if species_index is not None:
            species_index.close()
        if solution_registry is not None:
            solution_registry.close()
        raise
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
        "ecosystem_inventory": ecosystem_inventory_metadata,
        "mesa_coverage": mesa_coverage_metadata,
        "sirap_coverage": sirap_coverage_metadata,
        "solution_registry": solution_registry_metadata,
        "metric_coverage": manifest.get("metric_coverage", {}),
    }
    artifact = RuntimeArtifact(
        manifest=manifest,
        reference_raster_path=resolved_reference,
        raster_layers=layers,
        species_matrices=species_matrices,
        species_index=species_index,
        species_pool_sizes=species_pool_sizes,
        ecosystem_inventory=ecosystem_inventory,
        mesa_coverage=mesa_coverage,
        sirap_coverage=sirap_coverage,
        solution_registry=solution_registry,
    )
    return artifact, metadata


def load_runtime_artifact(settings: Settings) -> tuple[RuntimeArtifact, ArtifactState]:
    started = time.perf_counter()
    manifest = load_manifest(settings.artifact_manifest_path)

    if manifest.get("schema_version") != settings.artifact_schema_version:
        raise ArtifactValidationError(
            f"Artifact manifest schema_version must be {settings.artifact_schema_version}."
        )
    _verify_aggregate_checksum(manifest)

    if manifest.get("reference_raster_path"):
        artifact, metadata = _load_raster_artifact(
            settings,
            settings.artifact_manifest_path,
            manifest,
        )
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


def load_sirap_runtime_artifact(settings: Settings, sirap_id: str) -> RuntimeArtifact:
    manifest_path = settings.sirap_artifact_root / sirap_id / "manifest.json"
    manifest = load_manifest(manifest_path)

    if manifest.get("schema_version") != settings.artifact_schema_version:
        raise ArtifactValidationError(
            f"Artifact manifest schema_version must be {settings.artifact_schema_version}."
        )
    if manifest.get("artifact_kind") != SIRAP_ARTIFACT_KIND:
        raise ArtifactValidationError(
            f"SIRAP artifact manifest must declare artifact_kind {SIRAP_ARTIFACT_KIND!r}."
        )
    packaged_sirap_id = manifest.get("sirap_id")
    if packaged_sirap_id != sirap_id:
        raise ArtifactValidationError(
            f"SIRAP artifact manifest sirap_id {packaged_sirap_id!r} does not match "
            f"requested {sirap_id!r}."
        )
    _verify_aggregate_checksum(manifest)
    artifact, _metadata = _load_raster_artifact(settings, manifest_path, manifest)
    return artifact


def get_sirap_runtime_artifact(settings: Settings, sirap_id: str) -> RuntimeArtifact | None:
    global _SIRAP_RUNTIME_ARTIFACTS, _SIRAP_RUNTIME_SETTINGS_KEY

    settings_key = str(settings.sirap_artifact_root.resolve())
    with _SIRAP_RUNTIME_LOCK:
        if _SIRAP_RUNTIME_SETTINGS_KEY != settings_key:
            for artifact in _SIRAP_RUNTIME_ARTIFACTS.values():
                _close_runtime_artifact(artifact)
            _SIRAP_RUNTIME_ARTIFACTS = {}
            _SIRAP_RUNTIME_SETTINGS_KEY = settings_key

        cached = _SIRAP_RUNTIME_ARTIFACTS.get(sirap_id)
        if cached is not None:
            return cached

        try:
            artifact = load_sirap_runtime_artifact(settings, sirap_id)
        except ArtifactValidationError as exc:
            LOGGER.warning(
                "SIRAP runtime artifact did not load",
                extra={"sirap_id": sirap_id, "reason": str(exc)},
            )
            return None

        _SIRAP_RUNTIME_ARTIFACTS[sirap_id] = artifact
        return artifact


def get_runtime_artifact_for_solution(
    settings: Settings,
    solution_id: str | None,
) -> RuntimeArtifact | None:
    if solution_id:
        sirap_id = resolve_sirap_id_from_solution_id(solution_id)
        if sirap_id is not None:
            return get_sirap_runtime_artifact(settings, sirap_id)
    return get_runtime_artifact(settings)


def reset_runtime_artifact_cache() -> None:
    global _RUNTIME_ARTIFACT, _RUNTIME_SETTINGS_KEY, _RUNTIME_STATE
    global _SIRAP_RUNTIME_ARTIFACTS, _SIRAP_RUNTIME_SETTINGS_KEY

    with _RUNTIME_LOCK:
        artifact = _RUNTIME_ARTIFACT
        _RUNTIME_ARTIFACT = None
        _RUNTIME_SETTINGS_KEY = None
        _RUNTIME_STATE = None
        _close_runtime_artifact(artifact)

    with _SIRAP_RUNTIME_LOCK:
        for sirap_artifact in _SIRAP_RUNTIME_ARTIFACTS.values():
            _close_runtime_artifact(sirap_artifact)
        _SIRAP_RUNTIME_ARTIFACTS = {}
        _SIRAP_RUNTIME_SETTINGS_KEY = None


def get_artifact_state(settings: Settings) -> ArtifactState:
    return warmup_artifacts(settings)


def get_runtime_artifact(settings: Settings) -> RuntimeArtifact | None:
    warmup_artifacts(settings)
    return _RUNTIME_ARTIFACT


def artifact_ready(settings: Settings, state: ArtifactState) -> bool:
    return state.available or not settings.artifact_required
