from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from scripts.verify_runtime_release import (
    aggregate_file_checksum,
    sha256_file,
    verify_runtime_release,
)


def test_verify_runtime_release_accepts_complete_release(tmp_path: Path) -> None:
    payload = tmp_path / "payload.bin"
    payload.write_bytes(b"verified payload")
    entry = {
        "path": payload.name,
        "size_bytes": payload.stat().st_size,
        "checksum": {"algorithm": "sha256", "value": sha256_file(payload)},
    }
    _write_manifest(tmp_path, entry)

    assert verify_runtime_release(tmp_path) == ("release-1", 1)


def test_verify_runtime_release_rejects_changed_payload(tmp_path: Path) -> None:
    payload = tmp_path / "payload.bin"
    payload.write_bytes(b"original payload")
    entry = {
        "path": payload.name,
        "size_bytes": payload.stat().st_size,
        "checksum": {"algorithm": "sha256", "value": sha256_file(payload)},
    }
    _write_manifest(tmp_path, entry)
    payload.write_bytes(b"changed payload")

    with pytest.raises(SystemExit, match="Checksum mismatch"):
        verify_runtime_release(tmp_path)


def test_verify_runtime_release_rejects_legacy_release_when_v3_is_required(
    tmp_path: Path,
) -> None:
    payload = tmp_path / "payload.bin"
    payload.write_bytes(b"legacy payload")
    entry = {
        "path": payload.name,
        "size_bytes": payload.stat().st_size,
        "checksum": {"algorithm": "sha256", "value": sha256_file(payload)},
    }
    _write_manifest(tmp_path, entry)

    with pytest.raises(SystemExit, match="no V3 Mesa parity contract"):
        verify_runtime_release(tmp_path, require_mesa_v3=True)


def test_verify_runtime_release_accepts_complete_v3_mesa_contract(
    tmp_path: Path,
) -> None:
    _write_complete_v3_release(tmp_path)

    assert verify_runtime_release(
        tmp_path,
        require_mesa_v3=True,
    ) == ("release-v3", 3)


def test_verify_runtime_release_rejects_missing_golden_solution(
    tmp_path: Path,
) -> None:
    manifest, targets = _write_complete_v3_release(tmp_path)
    manifest["mesa_coverage"]["contract"]["golden_master_solution_id"] = "missing"
    _rewrite_release(tmp_path, manifest, targets)

    with pytest.raises(SystemExit, match="golden-master solution is not packaged"):
        verify_runtime_release(tmp_path, require_mesa_v3=True)


@pytest.mark.parametrize(
    ("binding_update", "message"),
    [
        ({"url": "http://example.test/goals"}, "target inventory is incomplete"),
        ({"sha256": "ABC123"}, "target inventory is incomplete"),
        ({"species_feature_count": 1}, "target inventory is incomplete"),
    ],
)
def test_verify_runtime_release_rejects_invalid_source_binding(
    tmp_path: Path,
    binding_update: dict[str, object],
    message: str,
) -> None:
    manifest, targets = _write_complete_v3_release(tmp_path)
    payload = json.loads(targets.read_text(encoding="utf-8"))
    payload["source_bindings"]["fixture-land-solution"].update(binding_update)
    targets.write_text(json.dumps(payload), encoding="utf-8")
    _rewrite_release(tmp_path, manifest, targets)

    with pytest.raises(SystemExit, match=message):
        verify_runtime_release(tmp_path, require_mesa_v3=True)


def test_verify_runtime_release_rejects_valid_cell_mismatch(
    tmp_path: Path,
) -> None:
    manifest, targets = _write_complete_v3_release(tmp_path)
    manifest["mesa_coverage"]["contract"]["grid"]["valid_planning_cell_count"] = 2
    _rewrite_release(tmp_path, manifest, targets)

    with pytest.raises(SystemExit, match="valid planning-cell count"):
        verify_runtime_release(tmp_path, require_mesa_v3=True)


@pytest.mark.parametrize(
    "duplicate_name",
    ["Eco system", "ECO SYSTEM", " eco   system ", "Eco_system"],
)
def test_verify_runtime_release_rejects_normalized_duplicate_ecosystems(
    tmp_path: Path,
    duplicate_name: str,
) -> None:
    manifest, targets = _write_complete_v3_release(tmp_path)
    payload = json.loads(targets.read_text(encoding="utf-8"))
    rows = payload["solutions"]["fixture-land-solution"]
    rows[0]["feature"] = "Eco system"
    rows[1]["feature"] = duplicate_name
    targets.write_text(json.dumps(payload), encoding="utf-8")
    _rewrite_release(tmp_path, manifest, targets)

    with pytest.raises(SystemExit, match="duplicate normalized feature"):
        verify_runtime_release(tmp_path, require_mesa_v3=True)


def test_verify_runtime_release_rejects_blank_names(
    tmp_path: Path,
) -> None:
    manifest, targets = _write_complete_v3_release(tmp_path)
    payload = json.loads(targets.read_text(encoding="utf-8"))
    rows = payload["solutions"]["fixture-land-solution"]
    rows[417]["feature"] = " \t "
    targets.write_text(json.dumps(payload), encoding="utf-8")
    _rewrite_release(tmp_path, manifest, targets)

    with pytest.raises(SystemExit, match="feature is blank"):
        verify_runtime_release(tmp_path, require_mesa_v3=True)


def test_verify_runtime_release_rejects_normalized_duplicate_species(
    tmp_path: Path,
) -> None:
    manifest, targets = _write_complete_v3_release(tmp_path)
    payload = json.loads(targets.read_text(encoding="utf-8"))
    rows = payload["solutions"]["fixture-land-solution"]
    rows[418]["feature"] = " SPECIES-0 "
    targets.write_text(json.dumps(payload), encoding="utf-8")
    _rewrite_release(tmp_path, manifest, targets)

    with pytest.raises(SystemExit, match="duplicate normalized feature"):
        verify_runtime_release(tmp_path, require_mesa_v3=True)


@pytest.mark.parametrize("relative_target", [float("nan"), float("inf"), -0.1, 1.1])
def test_verify_runtime_release_rejects_invalid_relative_targets(
    tmp_path: Path,
    relative_target: float,
) -> None:
    manifest, targets = _write_complete_v3_release(tmp_path)
    payload = json.loads(targets.read_text(encoding="utf-8"))
    payload["solutions"]["fixture-land-solution"][417]["relative_target"] = (
        relative_target
    )
    targets.write_text(json.dumps(payload), encoding="utf-8")
    _rewrite_release(tmp_path, manifest, targets)

    with pytest.raises(SystemExit, match="relative_target"):
        verify_runtime_release(tmp_path, require_mesa_v3=True)


def _write_complete_v3_release(tmp_path: Path) -> tuple[dict, Path]:
    solution_id = "fixture-land-solution"
    rows = [
        {
            "feature": f"ecosystem-{index}",
            "feature_type": "ecosystem",
            "relative_target": 0.0 if index == 0 else 0.17,
        }
        for index in range(417)
    ] + [
        {
            "feature": f"species-{index}",
            "feature_type": "species",
            "relative_target": 0.3,
        }
        for index in range(7_980)
    ]
    targets = tmp_path / "solution-targets.json"
    targets.write_text(
        json.dumps(
            {
                "format": "mesa-solution-targets-v1",
                "solutions": {
                    solution_id: rows,
                    "sparse-land-solution": [
                        {
                            "feature": f"sparse-ecosystem-{index}",
                            "feature_type": "ecosystem",
                            "relative_target": 0.17,
                        }
                        for index in range(417)
                    ],
                },
                "source_bindings": {
                    solution_id: {
                        "url": "https://example.test/goals",
                        "sha256": "a" * 64,
                        "ecosystem_feature_count": 417,
                        "species_feature_count": 7_980,
                    },
                    "sparse-land-solution": {
                        "url": "https://example.test/sparse-goals",
                        "sha256": "b" * 64,
                        "ecosystem_feature_count": 417,
                        "species_feature_count": 0,
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    species_metadata = tmp_path / "species.cells.json"
    species_metadata.write_text(json.dumps({"species_count": 7_980}), encoding="utf-8")
    reference = tmp_path / "reference.tif"
    with rasterio.open(
        reference,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="uint8",
        crs="EPSG:9377",
        transform=from_origin(4331309.0, 2933186.0, 1000.0, 1000.0),
        nodata=0,
    ) as dataset:
        dataset.write(np.array([[1, 1], [1, 0]], dtype=np.uint8), 1)
    entries = [_file_entry(path) for path in (targets, species_metadata, reference)]
    reference_sha256 = sha256_file(reference)
    transform = [1000.0, 0.0, 4331309.0, 0.0, -1000.0, 2933186.0]
    manifest = {
        "artifact_version": "release-v3",
        "files": entries,
        "checksum": {
            "algorithm": "sha256",
            "value": aggregate_file_checksum(entries),
        },
        "reference_grid": {
            "crs": "EPSG:9377",
            "width": 2,
            "height": 2,
            "transform": transform,
            "pin": {"valid_cell_count": 3},
        },
        "reference_raster_path": reference.name,
        "reference_raster_checksum": {
            "algorithm": "sha256",
            "value": reference_sha256,
        },
        "mesa_coverage": {
            "contract": {
                "format": "coverage-parity-contract-v1",
                "release_id": "solutions-v3-0-0",
                "ecosystem_feature_count": 417,
                "species_feature_count": 7_980,
                "golden_master_solution_id": solution_id,
                "grid": {
                    "crs": "EPSG:9377",
                    "width": 2,
                    "height": 2,
                    "transform": transform,
                    "valid_planning_cell_count": 3,
                    "template_sha256": reference_sha256,
                },
            },
            "targets": {"path": targets.name},
        },
        "species_bitset": {
            "metadata": {"path": species_metadata.name},
        },
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest, targets


def _rewrite_release(tmp_path: Path, manifest: dict, targets: Path) -> None:
    entries = manifest["files"]
    targets_entry = next(entry for entry in entries if entry["path"] == targets.name)
    targets_entry.update(_file_entry(targets))
    manifest["checksum"]["value"] = aggregate_file_checksum(entries)
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def _file_entry(path: Path) -> dict[str, object]:
    return {
        "path": path.name,
        "size_bytes": path.stat().st_size,
        "checksum": {"algorithm": "sha256", "value": sha256_file(path)},
    }


def _write_manifest(release_dir: Path, entry: dict[str, object]) -> None:
    manifest = {
        "artifact_version": "release-1",
        "files": [entry],
        "checksum": {
            "algorithm": "sha256",
            "value": aggregate_file_checksum([entry]),
        },
    }
    (release_dir / "manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )
