"""Reusable release utility: draft a catalog patch for corrected regular metrics.

Lifecycle: off-pipeline supplemental release when verbose/compact JSON was
corrected out-of-band (for example backfill output) while goals, MEC, and other
artifacts remain on the baseline release. Rebases source documents onto a new
``releaseId`` / ``catalogVersion``, writes patched cache copies under
``--release-root``, and drafts manifest/index metadata. Does not upload to Blob.

Safe reuse: supply baseline catalog, manifest, and index plus corrected
``--source-verbose-dir`` and ``--source-compact-dir``. Follow with the normal
publish/assemble flow for the new release id as needed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from compact_metrics import COMPACT_CACHE_SUFFIX, to_verbose_document
from metrics_contract import (
    PROVENANCE_KEY,
    provenance_issues,
    regular_artifact_completeness_issues,
)
from path_contracts import solution_artifact_name
from release_config import load_release_config
from solution_catalog import (
    SolutionCatalog,
    SolutionCatalogError,
    catalog_binding,
    load_solution_catalog,
)
from solution_domain import normalize_domain

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
VERBOSE_SUFFIX = ".metrics.json"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--baseline-catalog",
        type=Path,
        required=True,
        help="Released solution-catalog.json to clone and rebind from.",
    )
    parser.add_argument(
        "--baseline-manifest",
        type=Path,
        required=True,
        help="Runtime manifest.json whose metric URLs will point at the patch.",
    )
    parser.add_argument(
        "--baseline-index",
        type=Path,
        required=True,
        help="catalog-release-index.json draft to update for the patch release.",
    )
    parser.add_argument(
        "--source-verbose-dir",
        type=Path,
        required=True,
        help="Directory of corrected .metrics.json files to rebind and copy.",
    )
    parser.add_argument(
        "--source-compact-dir",
        type=Path,
        required=True,
        help="Directory of corrected .metrics.compact.json files to rebind and copy.",
    )
    parser.add_argument(
        "--release-root",
        type=Path,
        required=True,
        help="Output tree for solution-catalog.json, cache copies, and draft metadata.",
    )
    parser.add_argument(
        "--release-id",
        required=True,
        help="New immutable release id written into the patch catalog and manifest.",
    )
    parser.add_argument(
        "--catalog-version",
        required=True,
        help="New catalogVersion string paired with --release-id.",
    )
    return parser.parse_args()


def _atomic_json(path: Path, document: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if compact:
        content = json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n"
    else:
        content = json.dumps(
            document,
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        ) + "\n"
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_patch_catalog(
    baseline_path: Path,
    output_path: Path,
    *,
    release_id: str,
    catalog_version: str,
) -> SolutionCatalog:
    raw = json.loads(baseline_path.read_text(encoding="utf-8"))
    raw["releaseId"] = release_id
    raw["catalogVersion"] = catalog_version
    _atomic_json(output_path, raw)
    return load_solution_catalog(output_path)


def rebind_regular_document(
    document: dict[str, Any],
    *,
    catalog: SolutionCatalog,
    solution_id: str,
    baseline_release_id: str,
    compact: bool,
) -> dict[str, Any]:
    entry = catalog.by_id[solution_id]
    updated = deepcopy(document)
    provenance = updated.get(PROVENANCE_KEY)
    if not isinstance(provenance, dict):
        raise SolutionCatalogError(f"{solution_id!r} has no metrics provenance.")
    provenance["reusedFromReleaseId"] = baseline_release_id
    provenance["releaseId"] = catalog.release_id
    updated["solutionCatalogBinding"] = catalog_binding(catalog)
    if compact:
        updated["metricsProvenanceSha256"] = hashlib.sha256(
            json.dumps(
                provenance,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()

    verbose = to_verbose_document(updated) if compact else updated
    config = provenance.get("generationConfig")
    if not isinstance(config, dict):
        raise SolutionCatalogError(f"{solution_id!r} has no generationConfig.")
    issues = regular_artifact_completeness_issues(
        verbose,
        national_only=bool(config.get("nationalOnly")),
        domain=entry.domain,
        skip_species=False,
    )
    issues.extend(
        provenance_issues(
            updated,
            expected_domain=normalize_domain(entry.domain),
            expected_release_id=catalog.release_id,
        )
    )
    raster = updated.get("solutionRaster")
    if (
        updated.get("solutionId") != solution_id
        or not isinstance(raster, dict)
        or raster.get("solutionBasename") != entry.solution_basename
        or raster.get("sha256") != entry.raster_sha256
    ):
        issues.append("solution raster binding does not match the patch catalog")
    if issues:
        raise SolutionCatalogError(f"{solution_id!r} is invalid: {issues[0]}")
    return updated


def _publish_entry(
    path: Path,
    *,
    component: str,
    solution_id: str,
    blob_path: str,
    catalog_signature: str,
) -> dict[str, Any]:
    return {
        "component": component,
        "solutionId": solution_id,
        "geographyLevel": None,
        "cachePath": str(path.resolve()),
        "expectedBlobPath": blob_path,
        "expectedPublicUrl": f"{PUBLIC_BLOB_HOST}/{blob_path}",
        "artifactSha256": _sha256(path),
        "catalogSignature": catalog_signature,
    }


def prepare_regular_artifacts(
    *,
    baseline_catalog: SolutionCatalog,
    catalog: SolutionCatalog,
    source_verbose_dir: Path,
    source_compact_dir: Path,
    release_root: Path,
) -> list[dict[str, Any]]:
    config = load_release_config(catalog.release_id)
    entries: list[dict[str, Any]] = []
    for index, solution in enumerate(catalog.solutions, start=1):
        solution_id = solution.solution_id
        artifacts = (
            (
                "regularVerbose",
                source_verbose_dir / solution_artifact_name(solution_id, suffix=VERBOSE_SUFFIX),
                release_root
                / "regular"
                / "verbose"
                / "cache"
                / solution_artifact_name(solution_id, suffix=VERBOSE_SUFFIX),
                f"{config.regular_verbose_directory}/{solution_id}{VERBOSE_SUFFIX}",
                False,
            ),
            (
                "regularCompact",
                source_compact_dir
                / solution_artifact_name(solution_id, suffix=COMPACT_CACHE_SUFFIX),
                release_root
                / "regular"
                / "compact"
                / "cache"
                / solution_artifact_name(solution_id, suffix=COMPACT_CACHE_SUFFIX),
                f"{config.regular_compact_directory}/{solution_id}{COMPACT_CACHE_SUFFIX}",
                True,
            ),
        )
        for component, source, destination, blob_path, compact in artifacts:
            document = json.loads(source.read_text(encoding="utf-8"))
            rebound = rebind_regular_document(
                document,
                catalog=catalog,
                solution_id=solution_id,
                baseline_release_id=baseline_catalog.release_id,
                compact=compact,
            )
            _atomic_json(destination, rebound, compact=compact)
            provenance = rebound[PROVENANCE_KEY]
            entries.append(
                _publish_entry(
                    destination,
                    component=component,
                    solution_id=solution_id,
                    blob_path=blob_path,
                    catalog_signature=provenance["catalogSignature"],
                )
            )
        print(
            f"[regular-metrics-patch] {index}/{len(catalog.solutions)} PASS {solution_id}",
            flush=True,
        )
    return entries


def build_patch_manifest(
    baseline_path: Path,
    output_path: Path,
    *,
    catalog: SolutionCatalog,
) -> dict[str, Any]:
    manifest = json.loads(baseline_path.read_text(encoding="utf-8"))
    manifest["releaseId"] = catalog.release_id
    manifest["catalogVersion"] = catalog.catalog_version
    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    config = load_release_config(catalog.release_id)
    seen: set[str] = set()
    for solution in manifest.get("solutions", []):
        solution_id = solution.get("id")
        if solution_id not in catalog.by_id:
            continue
        urls = solution.get("precomputedMetricUrls")
        if not isinstance(urls, dict):
            raise SolutionCatalogError(f"{solution_id!r} has no precomputed metric URLs.")
        urls["cache"] = (
            f"{PUBLIC_BLOB_HOST}/{config.regular_verbose_directory}/"
            f"{solution_id}{VERBOSE_SUFFIX}"
        )
        urls["compactCache"] = (
            f"{PUBLIC_BLOB_HOST}/{config.regular_compact_directory}/"
            f"{solution_id}{COMPACT_CACHE_SUFFIX}"
        )
        species_urls = urls.get("speciesGoalsByGeography")
        if isinstance(species_urls, dict):
            species_root = f"releases/{catalog.release_id}/species-goals"
            urls["speciesGoalsCatalog"] = (
                f"{PUBLIC_BLOB_HOST}/{species_root}/catalog/v1/catalog.json"
            )
            urls["speciesGoalsByGeography"] = {
                level: (
                    f"{PUBLIC_BLOB_HOST}/{species_root}/compact/v1/{solution_id}/"
                    f"{level}.species-goals.compact.json"
                )
                for level in species_urls
            }
        seen.add(solution_id)
    if seen != set(catalog.solution_ids):
        raise SolutionCatalogError("baseline manifest does not exactly cover the patch catalog.")
    _atomic_json(output_path, manifest, compact=True)
    return manifest


def build_patch_index(
    baseline_path: Path,
    output_path: Path,
    *,
    catalog: SolutionCatalog,
) -> dict[str, Any]:
    index = json.loads(baseline_path.read_text(encoding="utf-8"))
    index["catalogVersion"] = catalog.catalog_version
    index["releaseId"] = catalog.release_id
    index["generatedAt"] = datetime.now(timezone.utc).isoformat()
    index["draft"] = True
    national = index["batches"][0]
    national["manifestUrl"] = f"{PUBLIC_BLOB_HOST}/releases/{catalog.release_id}/manifest.json"
    national["localDraftManifest"] = str(
        Path("data/metrics/generated/releases")
        / catalog.release_id
        / "manifest.json"
    )
    national["published"] = False
    _atomic_json(output_path, index)
    return index


def main() -> int:
    args = _parse_args()
    try:
        baseline_catalog = load_solution_catalog(args.baseline_catalog)
        catalog_path = args.release_root / "solution-catalog.json"
        catalog = build_patch_catalog(
            args.baseline_catalog,
            catalog_path,
            release_id=args.release_id,
            catalog_version=args.catalog_version,
        )
        entries = prepare_regular_artifacts(
            baseline_catalog=baseline_catalog,
            catalog=catalog,
            source_verbose_dir=args.source_verbose_dir,
            source_compact_dir=args.source_compact_dir,
            release_root=args.release_root,
        )
        report = {
            "format": "solution-release-supplemental-publish-report-v1",
            "releaseId": catalog.release_id,
            "catalogVersion": catalog.catalog_version,
            "artifactCount": len(entries),
            "complete": len(entries) == len(catalog.solutions) * 2,
            "entries": entries,
            "failures": [],
        }
        _atomic_json(args.release_root / "regular-patch-publish-report.json", report)
        build_patch_manifest(
            args.baseline_manifest,
            args.release_root / "manifest.json",
            catalog=catalog,
        )
        build_patch_index(
            args.baseline_index,
            args.release_root / "catalog-release-index.json",
            catalog=catalog,
        )
    except (KeyError, OSError, json.JSONDecodeError, SolutionCatalogError) as exc:
        print(f"[regular-metrics-patch] ERROR: {exc}")
        return 2
    print(
        f"[regular-metrics-patch] prepared {catalog.release_id}: "
        f"{len(entries)} regular artifacts"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
