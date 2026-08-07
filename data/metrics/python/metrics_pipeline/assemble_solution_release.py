"""Assemble recomputed and verified reused artifacts into one immutable release."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from compact_metrics import COMPACT_CACHE_SUFFIX, to_verbose_document
from conservation_goals import GOALS_SUFFIX, goals_document_is_complete
from main import _has_complete_regular_output_shape
from mec_compact import (
    GEOGRAPHY_LEVELS,
    MEC_COMPACT_SUFFIX,
    mec_document_is_complete,
)
from metrics_contract import (
    PROVENANCE_KEY,
    provenance_issues,
    regular_artifact_completeness_issues,
)
from path_contracts import safe_solution_id, solution_artifact_name
from release_config import load_release_config
from solution_catalog import (
    SolutionCatalog,
    SolutionCatalogError,
    bind_release_output,
    catalog_binding,
    load_release_plan,
    load_solution_catalog,
)

ARTIFACT_INVENTORY_FORMAT = "solution-release-artifact-inventory-v1"
PUBLISH_SUMMARY_FORMAT = "solution-release-publish-summary-v1"
COMPONENTS = ("regularVerbose", "regularCompact", "goals", "mecV2")
PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def _artifact_key(record: dict[str, Any]) -> tuple[str, str, str | None]:
    return (
        str(record.get("component") or ""),
        str(record.get("solutionId") or ""),
        (
            str(record["geographyLevel"])
            if record.get("geographyLevel") is not None
            else None
        ),
    )


def load_artifact_inventory(
    path: Path,
    *,
    expected_release_id: str | None = None,
    expected_catalog_sha256: str | None = None,
) -> dict[tuple[str, str, str | None], dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("format") != ARTIFACT_INVENTORY_FORMAT:
        raise SolutionCatalogError("baseline artifact inventory format is invalid.")
    if (
        expected_release_id is not None
        and raw.get("releaseId") != expected_release_id
    ):
        raise SolutionCatalogError("baseline artifact inventory releaseId mismatch.")
    if (
        expected_catalog_sha256 is not None
        and raw.get("catalogSha256") != expected_catalog_sha256
    ):
        raise SolutionCatalogError("baseline artifact inventory catalog SHA mismatch.")
    artifacts = raw.get("artifacts")
    if not isinstance(artifacts, list):
        raise SolutionCatalogError("baseline artifact inventory has no artifacts list.")
    by_key: dict[tuple[str, str, str | None], dict[str, Any]] = {}
    for record in artifacts:
        if not isinstance(record, dict):
            raise SolutionCatalogError("baseline artifact records must be objects.")
        key = _artifact_key(record)
        checksum = record.get("sha256")
        if (
            key in by_key
            or key[0] not in COMPONENTS
            or not key[1]
            or not isinstance(checksum, str)
            or len(checksum) != 64
            or not isinstance(record.get("path"), str)
        ):
            raise SolutionCatalogError(f"invalid baseline artifact record {key!r}.")
        by_key[key] = record
    return by_key


def _local_relative_path(
    component: str,
    solution_id: str,
    geography_level: str | None,
) -> Path:
    safe_id = safe_solution_id(solution_id)
    if component == "regularVerbose":
        return Path("regular/verbose/cache") / solution_artifact_name(
            solution_id,
            suffix=".metrics.json",
        )
    if component == "regularCompact":
        return Path("regular/compact/cache") / solution_artifact_name(
            solution_id,
            suffix=COMPACT_CACHE_SUFFIX,
        )
    if component == "goals":
        return Path("goals/v2/cache") / solution_artifact_name(
            solution_id,
            suffix=GOALS_SUFFIX,
        )
    if component == "mecV2" and geography_level is not None:
        return (
            Path("mec/v2/cache")
            / safe_id
            / f"{geography_level}{MEC_COMPACT_SUFFIX}"
        )
    raise SolutionCatalogError(f"unknown artifact component {component!r}.")


def _blob_path(
    component: str,
    solution_id: str,
    geography_level: str | None,
    *,
    release_id: str,
) -> str:
    config = load_release_config(release_id)
    safe_id = safe_solution_id(solution_id)
    if component == "regularVerbose":
        return f"{config.regular_verbose_directory}/{safe_id}.metrics.json"
    if component == "regularCompact":
        return f"{config.regular_compact_directory}/{safe_id}{COMPACT_CACHE_SUFFIX}"
    if component == "goals":
        return f"{config.goals_current_directory}/{safe_id}{GOALS_SUFFIX}"
    if component == "mecV2" and geography_level is not None:
        return f"{config.mec_v2_directory}/{safe_id}/{geography_level}{MEC_COMPACT_SUFFIX}"
    raise SolutionCatalogError(f"unknown artifact component {component!r}.")


def _expected_keys(catalog: SolutionCatalog) -> list[tuple[str, str, str | None]]:
    keys: list[tuple[str, str, str | None]] = []
    for entry in catalog.solutions:
        for component in ("regularVerbose", "regularCompact", "goals"):
            keys.append((component, entry.solution_id, None))
        if entry.domain == "land":
            keys.extend(
                ("mecV2", entry.solution_id, level)
                for level in GEOGRAPHY_LEVELS
            )
    return keys


def _document_has_usable_structure(
    document: dict[str, Any],
    *,
    component: str,
    solution_id: str,
    geography_level: str | None,
    expected_catalog_binding: dict[str, Any] | None = None,
) -> bool:
    if component in {"regularVerbose", "regularCompact"}:
        try:
            verbose = (
                to_verbose_document(document)
                if component == "regularCompact"
                else document
            )
        except (IndexError, KeyError, TypeError, ValueError):
            return False
        geographies = verbose.get("geographies")
        return (
            verbose.get("solutionId") == solution_id
            and isinstance(geographies, dict)
            and _has_complete_regular_output_shape(
                geographies,
                national_only=False,
            )
        )
    if component == "goals":
        return goals_document_is_complete(
            document,
            solution_id=solution_id,
        )
    if component == "mecV2" and geography_level is not None:
        return mec_document_is_complete(
            document,
            solution_id=solution_id,
            geography_level=geography_level,
            expected_catalog_binding=expected_catalog_binding,
        )
    return False


def _rebind_reused_document(
    content: bytes,
    *,
    component: str,
    catalog: SolutionCatalog,
    solution_id: str,
    geography_level: str | None,
    baseline_release_id: str,
    baseline_catalog_sha256: str,
    planned_input_signature: dict[str, str] | None,
) -> bytes:
    document = json.loads(content.decode("utf-8"))
    if not isinstance(document, dict):
        raise SolutionCatalogError(
            f"baseline {component} artifact must be a JSON object."
        )
    entry = catalog.by_id[solution_id]
    binding = catalog_binding(catalog)
    if not _document_has_usable_structure(
        document,
        component=component,
        solution_id=solution_id,
        geography_level=geography_level,
    ):
        raise SolutionCatalogError(
            f"baseline {component} artifact structure is incomplete for {solution_id!r}."
        )
    if component in {"regularVerbose", "regularCompact"}:
        verbose = (
            to_verbose_document(document)
            if component == "regularCompact"
            else document
        )
        config = verbose.get(PROVENANCE_KEY, {}).get("generationConfig", {})
        completeness_errors = regular_artifact_completeness_issues(
            verbose,
            national_only=bool(config.get("nationalOnly")),
            domain=entry.domain,
            skip_species=bool(config.get("speciesSkipped")),
        )
        if completeness_errors:
            raise SolutionCatalogError(
                f"baseline {component} artifact is incomplete for {solution_id!r}: "
                f"{completeness_errors[0]}"
            )
        provenance = document.get(PROVENANCE_KEY)
        raster = document.get("solutionRaster")
        baseline_binding = document.get("solutionCatalogBinding")
        provenance_errors = provenance_issues(
            document,
            expected_domain=entry.domain,
            expected_release_id=baseline_release_id,
        )
        if (
            not isinstance(provenance, dict)
            or provenance.get("releaseId") != baseline_release_id
            or not isinstance(raster, dict)
            or raster.get("solutionBasename") != entry.solution_basename
            or raster.get("sha256") != entry.raster_sha256
            or document.get("solutionInputSignature") != planned_input_signature
            or not isinstance(baseline_binding, dict)
            or baseline_binding.get("releaseId") != baseline_release_id
            or baseline_binding.get("catalogSha256") != baseline_catalog_sha256
            or provenance_errors
        ):
            raise SolutionCatalogError(
                f"baseline {component} provenance mismatch for {solution_id!r}."
            )
        provenance["reusedFromReleaseId"] = baseline_release_id
        provenance["releaseId"] = catalog.release_id
        document["solutionCatalogBinding"] = binding
        if component == "regularCompact":
            document["metricsProvenanceSha256"] = hashlib.sha256(
                json.dumps(
                    provenance,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            return (
                json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n"
            ).encode("utf-8")
    elif component == "goals":
        provenance = document.get("goalsProvenance")
        baseline_binding = (
            provenance.get("catalogBinding")
            if isinstance(provenance, dict)
            else None
        )
        if (
            not isinstance(provenance, dict)
            or provenance.get("releaseId") != baseline_release_id
            or provenance.get("solutionBasename") != entry.solution_basename
            or provenance.get("rasterSha256") != entry.raster_sha256
            or not isinstance(baseline_binding, dict)
            or baseline_binding.get("releaseId") != baseline_release_id
            or baseline_binding.get("catalogSha256") != baseline_catalog_sha256
        ):
            raise SolutionCatalogError(
                f"baseline goals provenance mismatch for {solution_id!r}."
            )
        provenance["reusedFromReleaseId"] = baseline_release_id
        provenance["releaseId"] = catalog.release_id
        provenance["catalogBinding"] = binding
    elif component == "mecV2":
        sources = document.get("sources")
        baseline_binding = document.get("solutionCatalogBinding")
        if (
            document.get("solutionId") != solution_id
            or not isinstance(sources, dict)
            or sources.get("solutionRasterSha256") != entry.raster_sha256
            or not isinstance(baseline_binding, dict)
            or baseline_binding.get("releaseId") != baseline_release_id
            or baseline_binding.get("catalogSha256") != baseline_catalog_sha256
        ):
            raise SolutionCatalogError(
                f"baseline MEC provenance mismatch for {solution_id!r}."
            )
        document["solutionCatalogBinding"] = binding
        document["reusedFromReleaseId"] = baseline_release_id
    else:
        raise SolutionCatalogError(f"unknown component {component!r}.")
    return (
        json.dumps(document, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    ).encode("utf-8")


def _write_immutable(path: Path, content: bytes) -> str:
    checksum = sha256_bytes(content)
    if path.exists():
        observed = sha256_path(path)
        if observed != checksum:
            raise SolutionCatalogError(
                f"immutable release path already differs: {path}"
            )
        return checksum
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(content)
    temporary.replace(path)
    return checksum


def _validate_recomputed_document(
    path: Path,
    *,
    component: str,
    catalog: SolutionCatalog,
    solution_id: str,
    geography_level: str | None,
    planned_input_signature: dict[str, str] | None,
) -> None:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise SolutionCatalogError(
            f"recomputed {component} artifact must be a JSON object: {path}"
        )
    entry = catalog.by_id[solution_id]
    binding = catalog_binding(catalog)
    if not _document_has_usable_structure(
        document,
        component=component,
        solution_id=solution_id,
        geography_level=geography_level,
        expected_catalog_binding=(
            binding if component == "mecV2" else None
        ),
    ):
        raise SolutionCatalogError(
            f"recomputed {component} artifact structure is incomplete "
            f"for {solution_id!r}: {path}"
        )
    if component in {"regularVerbose", "regularCompact"}:
        verbose = (
            to_verbose_document(document)
            if component == "regularCompact"
            else document
        )
        config = verbose.get(PROVENANCE_KEY, {}).get("generationConfig", {})
        completeness_errors = regular_artifact_completeness_issues(
            verbose,
            national_only=bool(config.get("nationalOnly")),
            domain=entry.domain,
            skip_species=bool(config.get("speciesSkipped")),
        )
        if completeness_errors:
            raise SolutionCatalogError(
                f"recomputed {component} artifact is incomplete for "
                f"{solution_id!r}: {completeness_errors[0]}"
            )
        provenance = document.get(PROVENANCE_KEY)
        raster = document.get("solutionRaster")
        provenance_errors = provenance_issues(
            document,
            expected_domain=entry.domain,
            expected_release_id=catalog.release_id,
        )
        valid = (
            isinstance(provenance, dict)
            and provenance.get("releaseId") == catalog.release_id
            and document.get("solutionCatalogBinding") == binding
            and document.get("solutionInputSignature") == planned_input_signature
            and isinstance(raster, dict)
            and raster.get("solutionBasename") == entry.solution_basename
            and raster.get("sha256") == entry.raster_sha256
            and not provenance_errors
        )
    elif component == "goals":
        provenance = document.get("goalsProvenance")
        valid = (
            isinstance(provenance, dict)
            and provenance.get("releaseId") == catalog.release_id
            and provenance.get("catalogBinding") == binding
            and provenance.get("solutionBasename") == entry.solution_basename
            and provenance.get("rasterSha256") == entry.raster_sha256
        )
    elif component == "mecV2":
        sources = document.get("sources")
        valid = (
            document.get("solutionId") == solution_id
            and document.get("solutionCatalogBinding") == binding
            and isinstance(sources, dict)
            and sources.get("solutionRasterSha256") == entry.raster_sha256
        )
    else:
        valid = False
    if not valid:
        raise SolutionCatalogError(
            f"recomputed {component} provenance mismatch for {solution_id!r}: {path}"
        )


def assemble_release(
    *,
    catalog: SolutionCatalog,
    release_plan: Path,
    baseline_inventory_path: Path | None,
    baseline_root: Path | None,
    release_root: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    plan = json.loads(release_plan.read_text(encoding="utf-8"))
    reuse_ids = set(load_release_plan(release_plan, catalog=catalog, action="reuse"))
    recompute_ids = set(
        load_release_plan(release_plan, catalog=catalog, action="recompute")
    )
    baseline_release_id = plan.get("baselineReleaseId")
    baseline_catalog_sha256 = plan.get("baselineCatalogSha256")
    if reuse_ids and not isinstance(baseline_release_id, str):
        raise SolutionCatalogError("reuse assembly requires baselineReleaseId.")
    if reuse_ids and not isinstance(baseline_catalog_sha256, str):
        raise SolutionCatalogError("reuse assembly requires baselineCatalogSha256.")
    if reuse_ids:
        if baseline_inventory_path is None or baseline_root is None:
            raise SolutionCatalogError(
                "reuse assembly requires baseline inventory and root."
            )
        baseline_inventory = load_artifact_inventory(
            baseline_inventory_path,
            expected_release_id=baseline_release_id,
            expected_catalog_sha256=plan.get("baselineCatalogSha256"),
        )
    else:
        baseline_inventory = {}
    planned_signatures = {
        str(item["solutionId"]): item.get("solutionInputSignature")
        for item in plan["entries"]
    }
    bind_release_output(release_root, catalog=catalog, component="assembled-release")

    artifacts: list[dict[str, Any]] = []
    reused_count = 0
    recomputed_count = 0
    for component, solution_id, geography_level in _expected_keys(catalog):
        relative_path = _local_relative_path(
            component,
            solution_id,
            geography_level,
        )
        destination = release_root / relative_path
        if solution_id in reuse_ids:
            record = baseline_inventory.get(
                (component, solution_id, geography_level)
            )
            if record is None:
                raise SolutionCatalogError(
                    f"baseline inventory is missing {(component, solution_id, geography_level)!r}."
                )
            assert baseline_root is not None
            source = baseline_root / str(record["path"])
            if not source.is_file():
                raise SolutionCatalogError(f"baseline artifact is missing: {source}")
            observed_source_sha = sha256_path(source)
            if observed_source_sha != record["sha256"]:
                raise SolutionCatalogError(
                    f"baseline artifact checksum mismatch: {source}"
                )
            content = _rebind_reused_document(
                source.read_bytes(),
                component=component,
                catalog=catalog,
                solution_id=solution_id,
                geography_level=geography_level,
                baseline_release_id=baseline_release_id,
                baseline_catalog_sha256=baseline_catalog_sha256,
                planned_input_signature=planned_signatures[solution_id],
            )
            checksum = _write_immutable(destination, content)
            origin = "reused"
            source_checksum = observed_source_sha
            reused_count += 1
        elif solution_id in recompute_ids:
            if not destination.is_file():
                raise SolutionCatalogError(
                    f"recomputed artifact is missing: {destination}"
                )
            _validate_recomputed_document(
                destination,
                component=component,
                catalog=catalog,
                solution_id=solution_id,
                geography_level=geography_level,
                planned_input_signature=planned_signatures[solution_id],
            )
            checksum = sha256_path(destination)
            origin = "recomputed"
            source_checksum = None
            recomputed_count += 1
        else:
            raise SolutionCatalogError(
                f"solution {solution_id!r} is absent from release plan actions."
            )
        artifacts.append(
            {
                "component": component,
                "solutionId": solution_id,
                "geographyLevel": geography_level,
                "origin": origin,
                "path": relative_path.as_posix(),
                "blobPath": _blob_path(
                    component,
                    solution_id,
                    geography_level,
                    release_id=catalog.release_id,
                ),
                "sha256": checksum,
                "sourceSha256": source_checksum,
                "bytes": destination.stat().st_size,
            }
        )

    inventory = {
        "format": ARTIFACT_INVENTORY_FORMAT,
        "releaseId": catalog.release_id,
        "catalogVersion": catalog.catalog_version,
        "catalogSha256": catalog.sha256,
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
    }
    component_counts = {
        component: sum(item["component"] == component for item in artifacts)
        for component in COMPONENTS
    }
    expected_component_counts = {
        "regularVerbose": catalog.expected_total_count,
        "regularCompact": catalog.expected_total_count,
        "goals": catalog.expected_total_count,
        "mecV2": catalog.expected_land_count * len(GEOGRAPHY_LEVELS),
    }
    inventory_content = (
        json.dumps(inventory, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    summary = {
        "format": PUBLISH_SUMMARY_FORMAT,
        "releaseId": catalog.release_id,
        "catalogSha256": catalog.sha256,
        "solutionCount": catalog.expected_total_count,
        "landSolutionCount": catalog.expected_land_count,
        "marineSolutionCount": catalog.expected_marine_count,
        "artifactCount": len(artifacts),
        "componentArtifactCounts": component_counts,
        "expectedComponentArtifactCounts": expected_component_counts,
        "reusedArtifactCount": reused_count,
        "recomputedArtifactCount": recomputed_count,
        "complete": component_counts == expected_component_counts,
        "inventoryPath": "release-artifact-inventory.json",
        "inventorySha256": sha256_bytes(inventory_content),
    }
    publish_report = {
        "format": "solution-release-publish-report-v1",
        "releaseId": catalog.release_id,
        "solutionCatalog": {
            "releaseId": catalog.release_id,
            "catalogVersion": catalog.catalog_version,
            "sha256": catalog.sha256,
        },
        "artifactCount": len(artifacts),
        "complete": summary["complete"],
        "entries": [
            {
                "component": item["component"],
                "solutionId": item["solutionId"],
                "geographyLevel": item["geographyLevel"],
                "cachePath": str((release_root / item["path"]).resolve()),
                "expectedBlobPath": item["blobPath"],
                "expectedPublicUrl": f"{PUBLIC_BLOB_HOST}/{item['blobPath']}",
                "artifactSha256": item["sha256"],
            }
            for item in artifacts
        ],
        "failures": [],
    }
    _write_immutable(
        release_root / "release-artifact-inventory.json",
        inventory_content,
    )
    _write_immutable(
        release_root / "release-publish-summary.json",
        (json.dumps(summary, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )
    _write_immutable(
        release_root / "publish-report.json",
        (json.dumps(publish_report, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )
    return inventory, summary


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--release-plan", type=Path, required=True)
    parser.add_argument("--baseline-inventory", type=Path, default=None)
    parser.add_argument("--baseline-root", type=Path, default=None)
    parser.add_argument("--release-root", type=Path, default=None)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        catalog = load_solution_catalog(args.catalog)
        release_root = args.release_root or (
            Path("data/metrics/generated/releases") / catalog.release_id
        )
        _, summary = assemble_release(
            catalog=catalog,
            release_plan=args.release_plan,
            baseline_inventory_path=args.baseline_inventory,
            baseline_root=args.baseline_root,
            release_root=release_root,
        )
    except (OSError, json.JSONDecodeError, SolutionCatalogError) as exc:
        print(f"[assemble-release] ERROR: {exc}", file=sys.stderr)
        return 2
    print(
        f"[assemble-release] complete: {summary['solutionCount']} solutions, "
        f"{summary['artifactCount']} artifacts"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
