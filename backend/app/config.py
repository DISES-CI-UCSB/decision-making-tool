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


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


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
    )
