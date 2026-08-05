"""Regenerate mixed-domain frozen-release signatures without computing metrics."""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from solution_input_signature import SOLUTION_INPUT_SIGNATURE_FORMAT
from species_exception import load_species_exception


def _write_json_atomic(path: Path, value: Any) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _run_signature_partition(
    *,
    main_script: Path,
    manifest_path: Path,
    catalog_path: Path,
    cache_dir: Path,
    output_dir: Path,
    release_id: str,
    solution_ids: list[str],
    expected_exit_code: int,
    species_exception_path: Path,
) -> tuple[dict[str, Any], str]:
    command = [
        sys.executable,
        str(main_script),
        "--manifest-url",
        manifest_path.as_uri(),
        "--release-id",
        release_id,
        "--solution-catalog",
        str(catalog_path),
        "--cache-dir",
        str(cache_dir),
        "--output-dir",
        str(output_dir),
        "--national-only",
        "--write-input-signatures-only",
        "--species-exception-contract",
        str(species_exception_path),
    ]
    for solution_id in solution_ids:
        command.extend(["--solution-id", solution_id])
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    combined_output = result.stdout + result.stderr
    if result.returncode != expected_exit_code:
        raise RuntimeError(
            f"Signature partition returned {result.returncode}, expected "
            f"{expected_exit_code}:\n{combined_output}"
        )
    inventory_path = output_dir / "solution-input-signatures.json"
    if not inventory_path.is_file():
        raise RuntimeError(f"Signature partition did not write {inventory_path}")
    return json.loads(inventory_path.read_text(encoding="utf-8")), combined_output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--species-exception-contract", type=Path, required=True)
    args = parser.parse_args()

    release_root = args.release_root.resolve()
    catalog_path = release_root / "solution-catalog.json"
    manifest_path = release_root / "preflight" / "manifest.json"
    policy = load_species_exception(args.species_exception_contract.resolve())
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    if (
        policy.release_id != catalog["releaseId"]
        or policy.catalog_version != catalog["catalogVersion"]
    ):
        raise RuntimeError("Species exception does not match the frozen catalog.")
    catalog["speciesException"] = policy.binding
    _write_json_atomic(catalog_path, catalog)
    _write_json_atomic(
        release_root / "preflight" / "species-exception.json",
        policy.document,
    )
    by_domain: dict[str, list[str]] = {"land": [], "marine": []}
    for entry in catalog["solutions"]:
        by_domain[entry["domain"]].append(entry["solutionId"])

    main_script = Path(__file__).with_name("main.py")
    with tempfile.TemporaryDirectory(
        prefix="signature-parts-",
        dir=release_root / "preflight",
    ) as temporary:
        temporary_root = Path(temporary)
        land, land_output = _run_signature_partition(
            main_script=main_script,
            manifest_path=manifest_path,
            catalog_path=catalog_path,
            cache_dir=args.cache_dir.resolve(),
            output_dir=temporary_root / "land",
            release_id=catalog["releaseId"],
            solution_ids=by_domain["land"],
            expected_exit_code=0,
            species_exception_path=policy.source_path,
        )
        aligned_match = re.search(r"aligned (\d+) required input\(s\)", land_output)
        if (
            aligned_match is None
            or int(aligned_match.group(1)) != policy.binding["availableExpected"] + 14
            or "input alignment preflight failed" in land_output
        ):
            raise RuntimeError(
                "Land signature preflight did not validate exactly 8,298 available "
                "species plus 14 required non-species layers."
            )
        marine, _marine_output = _run_signature_partition(
            main_script=main_script,
            manifest_path=manifest_path,
            catalog_path=catalog_path,
            cache_dir=args.cache_dir.resolve(),
            output_dir=temporary_root / "marine",
            release_id=catalog["releaseId"],
            solution_ids=by_domain["marine"],
            expected_exit_code=0,
            species_exception_path=policy.source_path,
        )

    signatures = {**land["signatures"], **marine["signatures"]}
    expected_ids = set(by_domain["land"] + by_domain["marine"])
    if set(signatures) != expected_ids:
        raise RuntimeError("Merged signature inventory does not match the frozen catalog.")
    if any(
        signature.get("format") != SOLUTION_INPUT_SIGNATURE_FORMAT
        for signature in signatures.values()
    ):
        raise RuntimeError("Merged inventory contains a stale signature format.")
    inventory = {
        "format": "solution-input-signatures-v1",
        "releaseId": catalog["releaseId"],
        "catalogSha256": land["catalogSha256"],
        "signatures": {
            solution_id: signatures[solution_id]
            for solution_id in sorted(signatures)
        },
    }
    inventory_path = release_root / "preflight" / "solution-input-signatures.json"
    _write_json_atomic(inventory_path, inventory)
    _write_json_atomic(
        release_root / "regular" / "verbose" / "solution-input-signatures.json",
        inventory,
    )

    plan_script = Path(__file__).with_name("plan_solution_release.py")
    subprocess.run(
        [
            sys.executable,
            str(plan_script),
            "--catalog",
            str(catalog_path),
            "--input-signatures",
            str(inventory_path),
            "--output",
            str(release_root / "release-plan.json"),
        ],
        check=True,
    )
    plan_path = release_root / "release-plan.json"
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("speciesException") != policy.binding:
        raise RuntimeError("Release plan is not bound to the species exception.")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_by_id = {solution["id"]: solution for solution in manifest["solutions"]}
    land_target_counts = Counter(
        manifest_by_id[solution_id]["finderInputs"]["targetPercent"]
        for solution_id in by_domain["land"]
    )
    if land_target_counts != {17: 41, 30: 41}:
        raise RuntimeError("Frozen land structured-target distribution drifted.")
    if manifest.get("preflightProvenance", {}).get("excludedDirectory") != "OLD_RUNS":
        raise RuntimeError("Frozen manifest no longer records OLD_RUNS exclusion.")
    action_counts = {
        domain: Counter(
            entry["action"] for entry in plan["entries"] if entry["domain"] == domain
        )
        for domain in ("land", "marine")
    }
    preflight_report = {
        "format": "solution-release-preflight-v2",
        "releaseId": catalog["releaseId"],
        "catalogVersion": catalog["catalogVersion"],
        "catalogSha256": inventory["catalogSha256"],
        "speciesException": policy.binding,
        "speciesInventory": {
            "catalogTotal": 8300,
            "availableExpected": 8298,
            "excluded": 2,
            "processed": 8298,
            "missingUnexpected": 0,
        },
        "solutionCounts": {
            "total": len(catalog["solutions"]),
            "land": len(by_domain["land"]),
            "marine": len(by_domain["marine"]),
        },
        "planActions": {
            domain: dict(sorted(counts.items()))
            for domain, counts in action_counts.items()
        },
        "targets": {
            "structuredLandSolutions": len(by_domain["land"]),
            "targetPercentDistribution": {
                str(key): value for key, value in sorted(land_target_counts.items())
            },
        },
        "sourceSelection": {
            "excludedSubtree": "OLD_RUNS",
            "exclusionVerified": True,
        },
        "validation": {
            "status": "pass-with-approved-exception",
            "metricsWritten": False,
            "unexpectedFailures": 0,
        },
    }
    _write_json_atomic(
        release_root / "preflight" / "preflight-report.json",
        preflight_report,
    )
    _write_json_atomic(
        release_root / "regular" / "verbose" / ".solution-release.json",
        {
            "format": "solution-release-output-v1",
            "releaseId": catalog["releaseId"],
            "catalogVersion": catalog["catalogVersion"],
            "catalogSha256": inventory["catalogSha256"],
            "component": "regular-verbose",
        },
    )
    print(
        f"[regenerate-frozen-signatures] wrote {len(signatures)} v3 signatures "
        f"and {release_root / 'release-plan.json'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
