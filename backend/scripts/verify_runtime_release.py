from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import numpy as np
import rasterio

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.coverage_target_validation import (  # noqa: E402
    CoverageTargetValidationError,
    MESA_V3_ECOSYSTEM_TARGET_COUNT,
    MESA_V3_GOLDEN_SPECIES_TARGET_COUNT,
    validate_coverage_targets,
)

V3_COVERAGE_CONTRACT_SHA256 = (
    "b96da51fd75a876885bfe2561ecb930f2d3b4337a1a46e73b6b05f25150f324e"
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify every file and aggregate checksum in a runtime release."
    )
    parser.add_argument("release_dir", type=Path)
    parser.add_argument(
        "--require-mesa-v3",
        action="store_true",
        help="Reject releases that do not contain the complete V3 Mesa contract.",
    )
    parser.add_argument(
        "--expected-release-id",
        default="solutions-v3-0-0",
    )
    parser.add_argument(
        "--expected-contract-sha256",
        default=V3_COVERAGE_CONTRACT_SHA256,
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    release_dir = args.release_dir.resolve()
    artifact_version, file_count = verify_runtime_release(
        release_dir,
        require_mesa_v3=args.require_mesa_v3,
        expected_release_id=args.expected_release_id,
        expected_contract_sha256=args.expected_contract_sha256,
    )
    print(f"Verified {file_count} files for {artifact_version}.")


def verify_runtime_release(
    release_dir: Path,
    *,
    require_mesa_v3: bool = False,
    expected_release_id: str = "solutions-v3-0-0",
    expected_contract_sha256: str | None = None,
) -> tuple[str, int]:
    release_dir = release_dir.resolve()
    manifest_path = release_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise SystemExit("Runtime manifest contains no files.")

    verified: list[dict[str, Any]] = []
    for raw_entry in files:
        if not isinstance(raw_entry, dict):
            raise SystemExit("Runtime manifest contains an invalid file entry.")
        raw_path = raw_entry.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            raise SystemExit("Runtime file entry has no path.")
        path = (release_dir / raw_path).resolve()
        if release_dir not in path.parents:
            raise SystemExit(f"Runtime file escapes release directory: {raw_path}")
        if not path.is_file():
            raise SystemExit(f"Runtime file is missing: {raw_path}")

        checksum = raw_entry.get("checksum")
        expected_checksum = (
            checksum.get("value")
            if isinstance(checksum, dict) and checksum.get("algorithm") == "sha256"
            else None
        )
        actual_checksum = sha256_file(path)
        if expected_checksum != actual_checksum:
            raise SystemExit(f"Checksum mismatch: {raw_path}")
        actual_size = path.stat().st_size
        if raw_entry.get("size_bytes") != actual_size:
            raise SystemExit(f"Size mismatch: {raw_path}")
        verified.append(
            {
                "path": raw_path,
                "size_bytes": actual_size,
                "checksum": {"algorithm": "sha256", "value": actual_checksum},
            }
        )

    aggregate = manifest.get("checksum")
    expected_aggregate = (
        aggregate.get("value")
        if isinstance(aggregate, dict) and aggregate.get("algorithm") == "sha256"
        else None
    )
    if aggregate_file_checksum(verified) != expected_aggregate:
        raise SystemExit("Runtime manifest aggregate checksum does not match.")
    if require_mesa_v3:
        verify_mesa_v3_contract(
            release_dir,
            manifest,
            expected_release_id=expected_release_id,
            expected_contract_sha256=expected_contract_sha256,
        )
    return (
        str(manifest.get("artifact_version") or "unknown release"),
        len(verified),
    )


def verify_mesa_v3_contract(
    release_dir: Path,
    manifest: dict[str, Any],
    *,
    expected_release_id: str,
    expected_contract_sha256: str | None,
) -> None:
    mesa = manifest.get("mesa_coverage")
    contract = mesa.get("contract") if isinstance(mesa, dict) else None
    if not isinstance(contract, dict):
        raise SystemExit("Runtime release has no V3 Mesa parity contract.")
    expected_ecosystems = MESA_V3_ECOSYSTEM_TARGET_COUNT
    expected_species = MESA_V3_GOLDEN_SPECIES_TARGET_COUNT
    expected = {
        "format": "coverage-parity-contract-v1",
        "release_id": expected_release_id,
        "ecosystem_feature_count": expected_ecosystems,
        "species_feature_count": expected_species,
    }
    for key, value in expected.items():
        if contract.get(key) != value:
            raise SystemExit(f"Runtime Mesa contract has invalid {key}.")
    golden_solution_id = contract.get("golden_master_solution_id")
    if not isinstance(golden_solution_id, str) or not golden_solution_id:
        raise SystemExit("Runtime Mesa contract has no golden-master solution id.")
    if (
        expected_contract_sha256 is not None
        and contract.get("sha256") != expected_contract_sha256
    ):
        raise SystemExit("Runtime Mesa contract checksum is invalid.")
    grid = contract.get("grid")
    reference = manifest.get("reference_grid")
    checksum = manifest.get("reference_raster_checksum")
    if (
        not isinstance(grid, dict)
        or not isinstance(reference, dict)
        or grid.get("crs") != reference.get("crs")
        or grid.get("width") != reference.get("width")
        or grid.get("height") != reference.get("height")
        or grid.get("transform") != reference.get("transform")
        or not isinstance(checksum, dict)
        or grid.get("template_sha256") != checksum.get("value")
    ):
        raise SystemExit("Runtime Mesa grid fingerprint does not match the reference raster.")
    contract_valid_cells = grid.get("valid_planning_cell_count")
    reference_pin = reference.get("pin")
    manifest_valid_cells = (
        reference_pin.get("valid_cell_count")
        if isinstance(reference_pin, dict)
        else None
    )
    reference_path_value = manifest.get("reference_raster_path")
    if not isinstance(reference_path_value, str):
        raise SystemExit("Runtime reference raster path is missing.")
    reference_path = resolve_release_file(
        release_dir,
        reference_path_value,
        "Runtime reference raster",
    )
    try:
        with rasterio.open(reference_path) as dataset:
            actual_transform = list(tuple(dataset.transform)[:6])
            actual_crs = str(dataset.crs) if dataset.crs else None
            if (
                dataset.width != grid.get("width")
                or dataset.height != grid.get("height")
                or actual_crs != grid.get("crs")
                or any(
                    abs(float(expected) - actual) > 1e-6
                    for expected, actual in zip(
                        grid.get("transform", []),
                        actual_transform,
                        strict=True,
                    )
                )
            ):
                raise SystemExit(
                    "Runtime Mesa grid fingerprint does not match the reference raster."
                )
            actual_valid_cells = sum(
                int(np.count_nonzero(dataset.read_masks(1, window=window)))
                for _, window in dataset.block_windows(1)
            )
        if (
            not isinstance(checksum, dict)
            or checksum.get("algorithm") != "sha256"
            or checksum.get("value") != sha256_file(reference_path)
        ):
            raise SystemExit(
                "Runtime reference raster checksum does not match its manifest."
            )
    except SystemExit:
        raise
    except Exception as exc:
        raise SystemExit(f"Runtime reference raster validity mask is invalid: {exc}") from exc
    if (
        type(contract_valid_cells) is not int
        or contract_valid_cells <= 0
        or manifest_valid_cells != contract_valid_cells
        or actual_valid_cells != contract_valid_cells
    ):
        raise SystemExit(
            "Runtime Mesa valid planning-cell count does not match reference metadata "
            "and raster validity mask."
        )

    targets_entry = mesa.get("targets")
    raw_path = targets_entry.get("path") if isinstance(targets_entry, dict) else None
    if not isinstance(raw_path, str):
        raise SystemExit("Runtime Mesa targets path is missing.")
    targets_path = (release_dir / raw_path).resolve()
    if release_dir not in targets_path.parents:
        raise SystemExit("Runtime Mesa targets escape the release directory.")
    try:
        payload = json.loads(targets_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Runtime Mesa targets are invalid: {exc}") from exc
    if not isinstance(payload, dict) or payload.get("format") != "mesa-solution-targets-v1":
        raise SystemExit("Runtime Mesa targets format is invalid.")
    solutions = payload.get("solutions")
    bindings = payload.get("source_bindings")
    if not isinstance(solutions, dict) or not solutions:
        raise SystemExit("Runtime Mesa targets contain no solutions.")
    if not isinstance(bindings, dict) or set(bindings) != set(solutions):
        raise SystemExit("Runtime Mesa target source bindings are incomplete.")
    if golden_solution_id not in solutions:
        raise SystemExit("Runtime Mesa golden-master solution is not packaged.")
    for solution_id, rows in solutions.items():
        if not isinstance(solution_id, str) or not solution_id:
            raise SystemExit("Runtime Mesa target solution id is invalid.")
        try:
            validated_rows = validate_coverage_targets(
                rows,
                solution_id=solution_id,
                expected_ecosystem_count=expected_ecosystems,
                expected_species_count=(
                    expected_species if solution_id == golden_solution_id else None
                ),
            )
        except CoverageTargetValidationError as exc:
            raise SystemExit(f"{solution_id} Mesa targets are invalid: {exc}") from exc
        ecosystem_count = sum(
            row.feature_type == "ecosystem" for row in validated_rows
        )
        species_count = sum(
            row.feature_type == "species" for row in validated_rows
        )
        binding = bindings[solution_id]
        binding_url = binding.get("url") if isinstance(binding, dict) else None
        parsed_url = urlparse(binding_url or "")
        if (
            not isinstance(binding, dict)
            or parsed_url.scheme != "https"
            or not parsed_url.netloc
            or SHA256_PATTERN.fullmatch(str(binding.get("sha256") or "")) is None
            or binding.get("ecosystem_feature_count") != ecosystem_count
            or binding.get("species_feature_count") != species_count
        ):
            raise SystemExit(f"{solution_id} Mesa target inventory is incomplete.")

    bitset = manifest.get("species_bitset")
    metadata_entry = bitset.get("metadata") if isinstance(bitset, dict) else None
    metadata_path_value = (
        metadata_entry.get("path") if isinstance(metadata_entry, dict) else None
    )
    if not isinstance(metadata_path_value, str):
        raise SystemExit("Runtime species bitset metadata is missing.")
    metadata_path = (release_dir / metadata_path_value).resolve()
    if release_dir not in metadata_path.parents:
        raise SystemExit("Runtime species metadata escapes the release directory.")
    species_metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if species_metadata.get("species_count") != expected_species:
        raise SystemExit("Runtime species index does not contain 7,980 species.")


def resolve_release_file(release_dir: Path, raw_path: str, label: str) -> Path:
    path = (release_dir / raw_path).resolve()
    if release_dir not in path.parents or not path.is_file():
        raise SystemExit(f"{label} is missing or escapes the release directory.")
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def aggregate_file_checksum(files: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for entry in sorted(files, key=lambda item: item["path"]):
        digest.update(entry["path"].encode("utf-8"))
        digest.update(str(entry["size_bytes"]).encode("utf-8"))
        digest.update(entry["checksum"]["value"].encode("utf-8"))
    return digest.hexdigest()


if __name__ == "__main__":
    main()
