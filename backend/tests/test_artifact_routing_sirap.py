"""Phase 2 tests for SIRAP custom-AOI artifact routing."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient

from app import artifacts as artifacts_module
from app.solution_registry import RasterFingerprint, build_solution_registry
from app.config import (
    SIRAP_ARTIFACT_KIND,
    get_settings,
    resolve_sirap_id_from_solution_id,
)
from app.main import app
from scripts.build_runtime_artifact import aggregate_file_checksum, file_entry
from tests.conftest import clear_artifact_env
from tests.test_raster_polygon_metrics import POLYGON_LEFT_COLUMN, write_tif


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_ecosystem_inventory_files(
    artifact_dir: Path,
    ecosystem_path: Path,
    ecosystem_sha: str,
) -> dict:
    crosswalk_path = artifact_dir / "crosswalk.csv"
    crosswalk_path.write_text(
        "rasterValue,tipoEcosistema,biomeFamily,broadBiomeContext,"
        "biomeRegion,broadEcosystem,detailedEcosystem\n"
        "10,Bosque,Orobioma,Contexto bosque,Orobioma Región,Forest,Forest detail\n"
        "11,Sabana,Orobioma,Contexto sabana,Orobioma Región,Wetland,Wetland detail\n"
        "12,Herbazal,Orobioma,Contexto herbazal,Orobioma Región,Grass,Grass detail\n"
        "13,Arbustal,Orobioma,Contexto arbustal,Orobioma Región,Shrub,Shrub detail\n",
        encoding="utf-8",
    )
    crosswalk_sha = sha256_file(crosswalk_path)
    provenance_path = artifact_dir / "provenance.json"
    provenance_path.write_text(
        json.dumps(
            {
                "format": "mec-2024-provenance-v1",
                "generatedAt": "2026-09-02T00:00:00Z",
                "source": {"publisher": "IDEAM"},
                "catalog": {
                    "rowCount": 4,
                    "crosswalkSha256": crosswalk_sha,
                    "crosswalkSignature": "fixture",
                    "tupleFields": [
                        "tipo_ecos",
                        "gran_bioma",
                        "bioma_iavh",
                        "ecos_sintesis",
                        "ecos_general",
                    ],
                },
                "outputs": {
                    "compositeRaster": {"sha256": ecosystem_sha},
                    "crosswalk": {"sha256": crosswalk_sha},
                },
                "rasterization": {"dtype": "uint16", "nodata": 0},
                "grid": {"fingerprintSha256": "fixture"},
            }
        ),
        encoding="utf-8",
    )
    provenance_sha = sha256_file(provenance_path)
    return {
        "raster": {
            "path": ecosystem_path.name,
            "checksum": {"algorithm": "sha256", "value": ecosystem_sha},
            "size_bytes": ecosystem_path.stat().st_size,
        },
        "crosswalk": {
            "path": crosswalk_path.name,
            "checksum": {"algorithm": "sha256", "value": crosswalk_sha},
            "size_bytes": crosswalk_path.stat().st_size,
        },
        "provenance": {
            "path": provenance_path.name,
            "checksum": {"algorithm": "sha256", "value": provenance_sha},
            "size_bytes": provenance_path.stat().st_size,
        },
    }


def write_sirap_coverage_files(
    artifact_dir: Path,
    solution_ids: list[str],
) -> dict:
    coverage_dir = artifact_dir / "sirap-coverage"
    coverage_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = coverage_dir / "catalog.csv"
    catalog_path.write_text(
        "biome,biome_id\nForest,10\nWetland,11\nGrass,12\nShrub,13\n",
        encoding="utf-8",
    )
    catalog_sha = sha256_file(catalog_path)
    solution_targets: dict[str, dict] = {}
    for solution_id in solution_ids:
        targets_path = coverage_dir / f"{solution_id}.targets.json"
        targets_path.write_text(
            json.dumps(
                {
                    "format": "sirap-solution-targets-v1",
                    "solution_id": solution_id,
                    "targets": [
                        {
                            "feature": "Forest",
                            "feature_type": "ecosystem",
                            "class": None,
                            "relative_target": 0.3,
                            "evaluated": "prioritizr_model",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        targets_sha = sha256_file(targets_path)
        solution_targets[solution_id] = {
            "path": str(targets_path.relative_to(artifact_dir)),
            "checksum": {"algorithm": "sha256", "value": targets_sha},
            "size_bytes": targets_path.stat().st_size,
            "target_count": 1,
        }
    return {
        "format": "sirap-runtime-coverage-v1",
        "ecosystems": {
            "raster_layer_id": "ecosistemas_IAVH_2024",
            "catalog": {
                "path": str(catalog_path.relative_to(artifact_dir)),
                "checksum": {"algorithm": "sha256", "value": catalog_sha},
                "size_bytes": catalog_path.stat().st_size,
            },
        },
        "solution_targets": solution_targets,
    }


def seed_solution_cache(
    artifact_dir: Path,
    solution_id: str,
    cache_dir: Path,
    artifact_version: str,
) -> None:
    solution_path = write_tif(
        artifact_dir / f"{solution_id}.tif",
        np.array([[2, 1], [0, 0]], dtype=np.uint8),
        nodata=255,
    )
    with rasterio.open(artifact_dir / "reference.tif") as reference:
        transform = reference.transform
        fingerprint = RasterFingerprint(
            width=reference.width,
            height=reference.height,
            transform=(
                transform.a,
                transform.b,
                transform.c,
                transform.d,
                transform.e,
                transform.f,
            ),
            crs=str(reference.crs),
        )
    source_url = f"https://example.invalid/solutions/{solution_id}.tif"
    cache_key = hashlib.sha256(
        f"{artifact_version}\0{solution_id}\0{source_url}".encode()
    ).hexdigest()
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached_path = cache_dir / f"{cache_key}.tif"
    cached_path.write_bytes(solution_path.read_bytes())
    (cache_dir / f"{cache_key}.json").write_text(
        json.dumps(
            {
                "solution_id": solution_id,
                "source_url": source_url,
                "release_id": artifact_version,
                "sha256": sha256_file(cached_path),
            }
        ),
        encoding="utf-8",
    )
    build_solution_registry(
        [
            {
                "solution_id": solution_id,
                "source_url": source_url,
                "blob_path": f"releases/fixture/solutions/{solution_id}.tif",
            }
        ],
        cache_dir=cache_dir,
        reference_fingerprint=fingerprint,
        public_blob_host="https://example.invalid",
        release_id=artifact_version,
    ).close()


def write_minimal_raster_manifest(
    artifact_dir: Path,
    *,
    artifact_kind: str,
    artifact_version: str,
    sirap_id: str | None = None,
    solution_ids: list[str],
) -> Path:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    reference = write_tif(
        artifact_dir / "reference.tif",
        np.array([[1, 1], [1, 0]], dtype=np.uint8),
        nodata=0,
    )
    ecosystem = write_tif(
        artifact_dir / "ecosystem.tif",
        np.array([[10, 11], [12, 13]], dtype=np.uint16),
        nodata=0,
    )
    reference_sha = sha256_file(reference)
    ecosystem_sha = sha256_file(ecosystem)
    file_entries = [
        file_entry(reference, artifact_dir, reference_sha, reference.stat().st_size),
        file_entry(ecosystem, artifact_dir, ecosystem_sha, ecosystem.stat().st_size),
    ]
    manifest: dict = {
        "artifact_version": artifact_version,
        "artifact_kind": artifact_kind,
        "schema_version": "metrics-artifact-manifest/v1",
        "created_at": "2026-09-02T00:00:00Z",
        "checksum": {"algorithm": "sha256", "value": aggregate_file_checksum(file_entries)},
        "checksum_scope": "files/v1",
        "source_manifest": {
            "url": "https://example.invalid/manifest.json",
            "public_blob_host": "https://example.invalid",
            "purpose": "Fixture runtime artifact for routing tests.",
        },
        "reference_raster_path": "reference.tif",
        "reference_raster_checksum": {"algorithm": "sha256", "value": reference_sha},
        "raster_layers": [
            {
                "layer_id": "ecosistemas_IAVH_2024",
                "path": "ecosystem.tif",
                "kind": "categorical",
                "rendering": {"valueType": "categorical"},
                "checksum": {"algorithm": "sha256", "value": ecosystem_sha},
            }
        ],
        "solution_rasters": [
            {
                "solution_id": solution_id,
                "source_url": f"https://example.invalid/solutions/{solution_id}.tif",
                "blob_path": f"releases/fixture/solutions/{solution_id}.tif",
                "raster_sha256": "a" * 64,
                "category_semantics": {
                    "1": "new_prioritizr",
                    "2": "pre_existing_aggregate",
                },
            }
            for solution_id in solution_ids
        ],
        "files": file_entries,
    }
    if sirap_id is not None:
        manifest["sirap_id"] = sirap_id
        manifest["release_id"] = "sirap-fixture-release"
        manifest["species_matrices"] = {
            "status": "stubbed",
            "todo": "Regional SMSP matrices are not packaged in this fixture.",
            "declared_bindings": [],
            "entries": [],
        }
        ecosystem_inventory = write_ecosystem_inventory_files(
            artifact_dir,
            ecosystem,
            ecosystem_sha,
        )
        manifest["ecosystem_inventory"] = ecosystem_inventory
        for key in ("crosswalk", "provenance"):
            entry = ecosystem_inventory[key]
            path = artifact_dir / entry["path"]
            file_entries.append(
                file_entry(
                    path,
                    artifact_dir,
                    entry["checksum"]["value"],
                    entry["size_bytes"],
                )
            )
        sirap_coverage = write_sirap_coverage_files(artifact_dir, solution_ids)
        manifest["sirap_coverage"] = sirap_coverage
        for entry in sirap_coverage["solution_targets"].values():
            path = artifact_dir / entry["path"]
            file_entries.append(
                file_entry(
                    path,
                    artifact_dir,
                    entry["checksum"]["value"],
                    entry["size_bytes"],
                )
            )
        catalog_path = artifact_dir / sirap_coverage["ecosystems"]["catalog"]["path"]
        file_entries.append(
            file_entry(
                catalog_path,
                artifact_dir,
                sirap_coverage["ecosystems"]["catalog"]["checksum"]["value"],
                sirap_coverage["ecosystems"]["catalog"]["size_bytes"],
            )
        )
        manifest["checksum"]["value"] = aggregate_file_checksum(file_entries)
        manifest["files"] = file_entries
    manifest_path = artifact_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest_path


@pytest.fixture
def routing_fixture_root(tmp_path: Path) -> Path:
    clear_artifact_env()
    national_dir = tmp_path / "national"
    sirap_root = tmp_path / "sirap"
    solution_cache = tmp_path / "solution-cache"
    write_minimal_raster_manifest(
        national_dir,
        artifact_kind="colombia-raster-custom-aoi/v1",
        artifact_version="national-fixture-v1",
        solution_ids=["national-fixture-solution"],
    )
    eje_dir = sirap_root / "eje-cafetero"
    write_minimal_raster_manifest(
        eje_dir,
        artifact_kind=SIRAP_ARTIFACT_KIND,
        artifact_version="eje-cafetero-fixture-v1",
        sirap_id="eje-cafetero",
        solution_ids=["eje-cafetero-001"],
    )
    seed_solution_cache(
        eje_dir,
        "eje-cafetero-001",
        solution_cache,
        "eje-cafetero-fixture-v1",
    )
    write_minimal_raster_manifest(
        sirap_root / "orinoquia",
        artifact_kind=SIRAP_ARTIFACT_KIND,
        artifact_version="orinoquia-fixture-v1",
        sirap_id="orinoquia",
        solution_ids=["sirap-orinoquia-fixture-01"],
    )
    os.environ["DMT_ARTIFACT_REQUIRED"] = "true"
    os.environ["DMT_ARTIFACT_DIR"] = str(national_dir)
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(national_dir / "manifest.json")
    os.environ["DMT_SIRAP_ARTIFACT_ROOT"] = str(sirap_root)
    os.environ["DMT_SOLUTION_CACHE_DIR"] = str(solution_cache)
    artifacts_module.reset_runtime_artifact_cache()
    return tmp_path


@pytest.mark.parametrize(
    ("solution_id", "expected"),
    [
        ("eje-cafetero-001", "eje-cafetero"),
        ("eje-cafetero-040", "eje-cafetero"),
        ("sirap-orinoquia-fixture-01", "orinoquia"),
        ("sirap-orinoquia-estr17-cong17-sab17-runap-omec-iheh2030", "orinoquia"),
        ("national-fixture-solution", None),
        ("v3-golden-master", None),
    ],
)
def test_resolve_sirap_id_from_solution_id(
    solution_id: str,
    expected: str | None,
) -> None:
    assert resolve_sirap_id_from_solution_id(solution_id) == expected


def test_get_runtime_artifact_for_solution_routes_national_and_regional(
    routing_fixture_root: Path,
) -> None:
    settings = get_settings()

    national = artifacts_module.get_runtime_artifact_for_solution(
        settings,
        "national-fixture-solution",
    )
    eje = artifacts_module.get_runtime_artifact_for_solution(settings, "eje-cafetero-001")
    orinoquia = artifacts_module.get_runtime_artifact_for_solution(
        settings,
        "sirap-orinoquia-fixture-01",
    )

    assert national is not None
    assert national.manifest["artifact_version"] == "national-fixture-v1"
    assert eje is not None
    assert eje.manifest["artifact_kind"] == SIRAP_ARTIFACT_KIND
    assert eje.manifest["sirap_id"] == "eje-cafetero"
    assert orinoquia is not None
    assert orinoquia.manifest["sirap_id"] == "orinoquia"
    assert eje is not national
    assert orinoquia is not eje


def test_sirap_artifact_load_skips_required_mesa_validation(
    routing_fixture_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    os.environ["DMT_MESA_COVERAGE_REQUIRED"] = "true"
    artifacts_module.reset_runtime_artifact_cache()
    settings = get_settings()

    artifact = artifacts_module.get_runtime_artifact_for_solution(
        settings,
        "eje-cafetero-001",
    )

    assert artifact is not None
    assert artifact.mesa_coverage is None
    assert artifact.sirap_coverage is not None


def test_custom_polygon_area_profile_returns_ecosystems_for_sirap(
    routing_fixture_root: Path,
) -> None:
    client = TestClient(app)
    response = client.post(
        "/area-profile/custom-polygon",
        json={
            "geometry": POLYGON_LEFT_COLUMN,
            "sections": ["ecosystems"],
            "solution_id": "eje-cafetero-001",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in {"complete", "partial"}
    ecosystems = payload["sections"]["ecosystems"]
    assert ecosystems["status"] == "complete"
    assert ecosystems["solution_coverage"]
    assert ecosystems["solution_coverage"][0]["feature"] == "Forest"
