from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SIRAP_ARTIFACT_KIND = "sirap-raster-custom-aoi/v1"

# Catalog solution_id prefixes mapped to packaged SIRAP artifact directories.
SIRAP_SOLUTION_ID_PREFIXES: tuple[tuple[str, str], ...] = (
    ("eje-cafetero-", "eje-cafetero"),
    ("sirap-orinoquia-", "orinoquia"),
)


def resolve_sirap_id_from_solution_id(solution_id: str) -> str | None:
    normalized = solution_id.strip()
    if not normalized:
        return None
    for prefix, sirap_id in SIRAP_SOLUTION_ID_PREFIXES:
        if normalized.startswith(prefix):
            return sirap_id
    return None


DEFAULT_MAX_POLYGON_VERTICES = 5000
DEFAULT_MAX_POLYGON_AREA_KM2 = 2_200_000.0
DEFAULT_RATE_LIMIT_PER_MINUTE = 30


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, minimum: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def _env_float(name: str, default: float, *, minimum: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


@dataclass(frozen=True)
class Settings:
    artifact_dir: Path
    artifact_manifest_path: Path
    sirap_artifact_root: Path
    artifact_required: bool
    artifact_schema_version: str
    mesa_coverage_required: bool = False
    expected_coverage_release_id: str | None = None
    expected_coverage_contract_sha256: str | None = None
    solution_cache_dir: Path = Path("runtime-cache/solutions")
    custom_polygon_job_db: Path = Path("runtime-cache/jobs.sqlite3")
    ops_token: str | None = None
    max_polygon_vertices: int = DEFAULT_MAX_POLYGON_VERTICES
    max_polygon_area_km2: float = DEFAULT_MAX_POLYGON_AREA_KM2
    rate_limit_per_minute: int = DEFAULT_RATE_LIMIT_PER_MINUTE


def get_settings() -> Settings:
    artifact_dir = Path(os.getenv("DMT_ARTIFACT_DIR", "runtime-artifacts"))
    manifest_path = Path(
        os.getenv("DMT_ARTIFACT_MANIFEST", str(artifact_dir / "manifest.json"))
    )

    return Settings(
        artifact_dir=artifact_dir,
        artifact_manifest_path=manifest_path,
        sirap_artifact_root=Path(
            os.getenv("DMT_SIRAP_ARTIFACT_ROOT", "runtime-artifacts/sirap")
        ),
        solution_cache_dir=Path(
            os.getenv("DMT_SOLUTION_CACHE_DIR", "runtime-cache/solutions")
        ),
        custom_polygon_job_db=Path(
            os.getenv("DMT_CUSTOM_POLYGON_JOB_DB", "runtime-cache/jobs.sqlite3")
        ),
        ops_token=os.getenv("DMT_OPS_TOKEN") or None,
        artifact_required=_env_bool("DMT_ARTIFACT_REQUIRED", default=False),
        artifact_schema_version=os.getenv(
            "DMT_ARTIFACT_SCHEMA_VERSION", "metrics-artifact-manifest/v1"
        ),
        mesa_coverage_required=_env_bool(
            "DMT_MESA_COVERAGE_REQUIRED",
            default=False,
        ),
        expected_coverage_release_id=(
            os.getenv("DMT_EXPECTED_COVERAGE_RELEASE_ID") or None
        ),
        expected_coverage_contract_sha256=(
            os.getenv("DMT_EXPECTED_COVERAGE_CONTRACT_SHA256") or None
        ),
        max_polygon_vertices=_env_int(
            "DMT_MAX_POLYGON_VERTICES",
            DEFAULT_MAX_POLYGON_VERTICES,
            minimum=1,
        ),
        max_polygon_area_km2=_env_float(
            "DMT_MAX_POLYGON_AREA_KM2",
            DEFAULT_MAX_POLYGON_AREA_KM2,
            minimum=1.0,
        ),
        rate_limit_per_minute=_env_int(
            "DMT_RATE_LIMIT_PER_MINUTE",
            DEFAULT_RATE_LIMIT_PER_MINUTE,
            minimum=0,
        ),
    )
