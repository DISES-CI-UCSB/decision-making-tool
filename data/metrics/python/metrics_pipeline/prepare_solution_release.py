"""Build deterministic solution-release catalogs, preflight manifests, and upload plans."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

from release_config import load_release_config
from species_exception import load_species_exception

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
MEC_GEOGRAPHY_LEVELS = (
    "national",
    "departments",
    "municipalities",
    "siraps",
    "runaps",
    "omecs",
)
TARGET_DIMENSIONS = (
    "ecosystems",
    "strategicEcosystems",
    "ecosystemServices",
    "speciesRepresentation",
    "espRn",
)


class ReleasePreparationError(ValueError):
    """Release source inputs or generated contracts are inconsistent."""


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_id(basename: str, domain: str) -> str:
    stem = Path(basename).stem
    normalized = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode()
    normalized = re.sub(r"[^a-z0-9]+", "_", normalized.lower()).strip("_")
    solution_id = f"marine_{normalized}" if domain == "marine" else normalized
    if not re.fullmatch(r"[a-z0-9]+(?:_[a-z0-9]+)*", solution_id):
        raise ReleasePreparationError(f"could not derive a safe ID from {basename!r}.")
    return solution_id


def _summary_path(raster: Path) -> Path:
    summary = raster.with_name(f"{raster.stem}_summary.csv")
    if not summary.is_file():
        raise ReleasePreparationError(
            f"missing exact top-level summary CSV for {raster.name!r}: {summary.name!r}"
        )
    return summary


def discover_sources(directory: Path, domain: str, expected_count: int) -> list[dict[str, Any]]:
    if not directory.is_dir():
        raise ReleasePreparationError(f"{domain} source directory does not exist: {directory}")
    rasters = sorted(
        path for path in directory.iterdir() if path.is_file() and path.suffix == ".tif"
    )
    if len(rasters) != expected_count:
        raise ReleasePreparationError(
            f"expected {expected_count} top-level {domain} TIFFs, found {len(rasters)}."
        )
    sources = [
        {
            "solutionId": canonical_id(raster.name, domain),
            "domain": domain,
            "rasterPath": raster.resolve(),
            "rasterSha256": sha256_path(raster),
            "summaryPath": _summary_path(raster).resolve(),
        }
        for raster in rasters
    ]
    ids = [source["solutionId"] for source in sources]
    basenames = [source["rasterPath"].name for source in sources]
    if len(ids) != len(set(ids)) or len(basenames) != len(set(basenames)):
        raise ReleasePreparationError(f"{domain} sources contain duplicate IDs or basenames.")
    return sources


def _slug(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    ascii_value = normalized.encode("ascii", "ignore").decode().lower().strip()
    return re.sub(r"[^a-z0-9]+", "_", ascii_value).strip("_")


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _boolean(value: Any) -> bool | None:
    normalized = str(value or "").strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    return None


def _dimension(row: dict[str, str], solution_id: str) -> str | None:
    feature_type = str(row.get("feature_type") or "").lower()
    feature_id = _slug(row.get("feature"))
    if "species" in feature_type:
        return "espRn" if "_esprn_" in f"_{solution_id}_" else "speciesRepresentation"
    if "service" in feature_type or "servicio" in feature_type:
        return "ecosystemServices"
    if "strategic" in feature_type or feature_id in {
        "paramos",
        "bosque_seco",
        "humedales",
        "wetlands",
        "manglares",
    }:
        return "strategicEcosystems"
    if "ecosystem" in feature_type or feature_id == "ecosistemas":
        return "ecosystems"
    return None


def structured_finder_inputs(
    summary_path: Path,
    *,
    solution_id: str,
    domain: str,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    with summary_path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    if not rows:
        raise ReleasePreparationError(f"summary CSV has no rows: {summary_path}")

    coverage: list[dict[str, Any]] = []
    dimensions: dict[str, list[dict[str, Any]]] = {
        dimension: [] for dimension in TARGET_DIMENSIONS
    }
    for row in rows:
        relative_target = _number(row.get("relative_target"))
        coverage_row = {
            "feature": str(row.get("feature") or "").strip() or "unknown",
            "met": _boolean(row.get("met")),
            "relativeTarget": relative_target,
            "relativeHeld": _number(row.get("relative_held")),
            "relativeShortfall": _number(row.get("relative_shortfall")),
            "type": str(row.get("feature_type") or "").strip() or None,
            "class": str(row.get("class") or "").strip() or None,
            "scenario": str(row.get("scenario") or "").strip() or None,
            "evaluated": str(row.get("evaluated") or "").strip() or None,
        }
        coverage.append(coverage_row)
        dimension = _dimension(row, solution_id)
        if (
            dimension is not None
            and relative_target is not None
            and coverage_row["evaluated"] == "prioritizr_model"
        ):
            dimensions[dimension].append(
                {
                    "featureId": _slug(coverage_row["feature"]),
                    "targetPercent": round(relative_target * 100, 6),
                }
            )
    for values in dimensions.values():
        values.sort(key=lambda item: item["featureId"])

    target_set = next(
        (
            label
            for dimension, label in (
                ("espRn", "esp_rn"),
                ("speciesRepresentation", "species"),
                ("strategicEcosystems", "strategic_ecosystems"),
                ("ecosystemServices", "ecosystem_services"),
                ("ecosystems", "ecosystems"),
            )
            if dimensions[dimension]
        ),
        None,
    )
    target_values = {
        item["targetPercent"]
        for item in dimensions["ecosystems"]
        if item["targetPercent"] is not None
    }
    target_percent = next(iter(target_values)) if len(target_values) == 1 else None
    feature_ids = [
        layer_id
        for dimension, layer_id in (
            ("ecosystems", "marine_ecosystems" if domain == "marine" else "ecosystems"),
            ("strategicEcosystems", "strategic_ecosystems"),
            ("ecosystemServices", "ecosystem_services"),
            ("speciesRepresentation", "species"),
            ("espRn", "species"),
        )
        if dimensions[dimension]
    ]
    tokens = set(solution_id.split("_"))
    input_layer_ids = {
        "features": list(dict.fromkeys(feature_ids)),
        "cost": next(
            (
                value
                for token, value in (
                    ("iheh2022", "iheh_2022"),
                    ("iheh2030", "iheh_2030"),
                    ("hhm", "hhm"),
                )
                if token in tokens
            ),
            None,
        ),
        "includes": [value for value in ("runap", "omec") if value in tokens],
        "excludes": [],
    }
    finder_inputs = {
        "domain": domain,
        "scope": "marine" if domain == "marine" else "nacional",
        "targetFeatureSet": target_set,
        "targetFeatureIds": input_layer_ids["features"],
        "targetPercent": target_percent,
        "structuredTargets": {
            "format": "solution-target-metadata-v1",
            "sourceEvaluation": "prioritizr_model",
            **dimensions,
        },
        "costLayerId": input_layer_ids["cost"],
        "includeLayerIds": input_layer_ids["includes"],
        "excludeLayerIds": [],
    }
    evaluated = [row for row in coverage if row["met"] is not None]
    summary_metrics = {
        "nSelected": None,
        "totalCost": None,
        "pctTargetsMet": (
            round(100 * sum(row["met"] is True for row in evaluated) / len(evaluated), 6)
            if evaluated
            else None
        ),
        "coverageRowCount": len(coverage),
    }
    return finder_inputs, input_layer_ids, coverage, summary_metrics


def _url(pathname: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{quote(pathname, safe='/+_.-')}"


def _metric_urls(solution_id: str, release_id: str, domain: str) -> dict[str, Any]:
    config = load_release_config(release_id)
    urls: dict[str, Any] = {
        "goals": f"{PUBLIC_BLOB_HOST}/{config.goals_current_directory}/{solution_id}.goals.json",
        "cache": (
            f"{PUBLIC_BLOB_HOST}/{config.regular_verbose_directory}/"
            f"{solution_id}.metrics.json"
        ),
        "compactCache": (
            f"{PUBLIC_BLOB_HOST}/{config.regular_compact_directory}/"
            f"{solution_id}.metrics.compact.json"
        ),
    }
    if domain == "land":
        urls["mecV2ByGeography"] = {
            level: (
                f"{PUBLIC_BLOB_HOST}/{config.mec_v2_directory}/"
                f"{solution_id}/{level}.mec.compact.json"
            )
            for level in MEC_GEOGRAPHY_LEVELS
        }
    return urls


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ReleasePreparationError(f"expected a JSON object: {path}")
    return value


def _write_json(path: Path, value: Any) -> None:
    content = json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") != content:
        raise ReleasePreparationError(f"generated path already differs: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def build_release(
    *,
    land_directory: Path,
    marine_directory: Path,
    baseline_catalog_path: Path,
    baseline_manifest_path: Path,
    species_exception_path: Path,
    release_root: Path,
    release_id: str,
    catalog_version: str,
    expected_land: int,
    expected_marine: int,
    existing_blob_paths: Iterable[str] = (),
) -> dict[str, Any]:
    sources = discover_sources(land_directory, "land", expected_land)
    sources += discover_sources(marine_directory, "marine", expected_marine)
    sources.sort(key=lambda source: source["solutionId"])
    policy = load_species_exception(
        species_exception_path,
        release_id=release_id,
        catalog_version=catalog_version,
    )
    catalog = {
        "format": "solution-catalog-v1",
        "catalogVersion": catalog_version,
        "releaseId": release_id,
        "expectedSolutionCount": len(sources),
        "expectedLandSolutionCount": expected_land,
        "expectedMarineSolutionCount": expected_marine,
        "solutions": [
            {
                "solutionId": source["solutionId"],
                "solutionBasename": source["rasterPath"].name,
                "domain": source["domain"],
                "rasterSha256": source["rasterSha256"],
            }
            for source in sources
        ],
        "speciesException": policy.binding,
    }

    baseline = _load_json(baseline_catalog_path)
    baseline_by_id = {
        entry["solutionId"]: entry for entry in baseline.get("solutions", [])
    }
    diff_entries = []
    for source in sources:
        previous = baseline_by_id.get(source["solutionId"])
        diff_entries.append(
            {
                "solutionId": source["solutionId"],
                "domain": source["domain"],
                "change": "added" if previous is None else "unchanged-solution-id",
                "rasterBytesMatch": (
                    previous is not None
                    and previous.get("rasterSha256") == source["rasterSha256"]
                ),
                "baselineBasename": previous.get("solutionBasename") if previous else None,
                "releaseBasename": source["rasterPath"].name,
                "baselineRasterSha256": previous.get("rasterSha256") if previous else None,
                "releaseRasterSha256": source["rasterSha256"],
            }
        )
    new_ids = {source["solutionId"] for source in sources}
    removed = sorted(set(baseline_by_id) - new_ids)
    diff = {
        "format": "solution-catalog-diff-v1",
        "releaseId": release_id,
        "baselineReleaseId": baseline.get("releaseId"),
        "counts": {
            "addedLand": sum(
                entry["change"] == "added" and entry["domain"] == "land"
                for entry in diff_entries
            ),
            "unchangedLand": sum(
                entry["change"] == "unchanged-solution-id" and entry["domain"] == "land"
                for entry in diff_entries
            ),
            "unchangedMarine": sum(
                entry["change"] == "unchanged-solution-id" and entry["domain"] == "marine"
                for entry in diff_entries
            ),
            "checksumMatchedLand": sum(
                entry["rasterBytesMatch"] and entry["domain"] == "land"
                for entry in diff_entries
            ),
            "checksumMatchedMarine": sum(
                entry["rasterBytesMatch"] and entry["domain"] == "marine"
                for entry in diff_entries
            ),
            "removed": len(removed),
        },
        "removedSolutionIds": removed,
        "entries": diff_entries,
    }

    existing = {path.strip().lstrip("/") for path in existing_blob_paths if path.strip()}
    upload_entries: list[dict[str, Any]] = []
    solution_entries: list[dict[str, Any]] = []
    for source in sources:
        solution_id = source["solutionId"]
        domain = source["domain"]
        raster_path = source["rasterPath"]
        summary_path = source["summaryPath"]
        summary_sha = sha256_path(summary_path)
        destination_root = f"releases/{release_id}/solutions/{domain}"
        raster_blob_path = f"{destination_root}/{raster_path.name}"
        summary_blob_path = f"{destination_root}/{summary_path.name}"
        finder_inputs, input_layer_ids, coverage, summary_metrics = (
            structured_finder_inputs(
                summary_path,
                solution_id=solution_id,
                domain=domain,
            )
        )
        solution_entries.append(
            {
                "id": solution_id,
                "name": raster_path.stem,
                "description": f"National solution scenario {raster_path.stem}.",
                "domain": domain,
                "scope": finder_inputs["scope"],
                "displayUrl": _url(raster_blob_path),
                "metadataUrl": _url(summary_blob_path),
                "rasterFile": raster_path.name,
                "metadataFile": summary_path.name,
                "blobPath": raster_blob_path,
                "rasterSha256": source["rasterSha256"],
                "generatedAt": None,
                "finderInputs": finder_inputs,
                "inputLayerIds": input_layer_ids,
                "summaryMetrics": summary_metrics,
                "coverage": coverage,
                "precomputedMetricUrls": _metric_urls(solution_id, release_id, domain),
                "rendering": {
                    "valueType": "categorical",
                    "renderMode": "categorical",
                    "noDataValue": 255,
                    "classColors": [
                        {"value": 1, "color": "#16a34a", "label": "New coverage"},
                        {
                            "value": 2,
                            "color": "#2563eb",
                            "label": "Existing protected areas",
                        },
                    ],
                },
                "sourceProvenance": {
                    "sourceRasterFilename": raster_path.name,
                    "sourceRasterSha256": source["rasterSha256"],
                    "sourceSummaryFilename": summary_path.name,
                    "sourceSummarySha256": summary_sha,
                },
            }
        )
        for artifact_type, path, blob_path, checksum in (
            ("raster", raster_path, raster_blob_path, source["rasterSha256"]),
            ("summary", summary_path, summary_blob_path, summary_sha),
        ):
            upload_entries.append(
                {
                    "solutionId": solution_id,
                    "artifactType": artifact_type,
                    "sourcePath": str(path),
                    "expectedBlobPath": blob_path,
                    "expectedPublicUrl": _url(blob_path),
                    "artifactSha256": checksum,
                    "bytes": path.stat().st_size,
                    "status": "already-present" if blob_path in existing else "upload-required",
                }
            )

    baseline_manifest = _load_json(baseline_manifest_path)
    manifest = {
        key: value
        for key, value in baseline_manifest.items()
        if key not in {"solutions", "releaseId", "catalogVersion", "generatedAt", "preflightProvenance"}
    }
    manifest.update(
        {
            "generatedAt": "2026-08-05T00:00:00Z",
            "releaseId": release_id,
            "catalogVersion": catalog_version,
            "solutions": solution_entries,
            "preflightProvenance": {
                "format": "solution-release-preflight-provenance-v1",
                "catalogSha256": hashlib.sha256(
                    json.dumps(
                        catalog,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode()
                ).hexdigest(),
                "speciesException": policy.binding,
                "topLevelInputsOnly": True,
                "excludedSubtrees": ["OLD_RUNS"],
                "kbaAica": "excluded_pending_authorization",
            },
        }
    )
    upload_plan = {
        "format": "solution-source-upload-plan-v1",
        "releaseId": release_id,
        "prefix": f"releases/{release_id}/solutions/",
        "artifactCount": len(upload_entries),
        "counts": {
            "alreadyPresent": sum(
                entry["status"] == "already-present" for entry in upload_entries
            ),
            "uploadRequired": sum(
                entry["status"] == "upload-required" for entry in upload_entries
            ),
        },
        "entries": upload_entries,
    }
    _write_json(release_root / "solution-catalog.json", catalog)
    _write_json(release_root / "preflight" / "manifest.json", manifest)
    _write_json(release_root / "preflight" / "catalog-diff.json", diff)
    _write_json(release_root / "source-upload" / "upload-plan.json", upload_plan)
    _write_json(
        release_root / "preflight" / "source-inventory.json",
        {
            "format": "solution-source-inventory-v1",
            "releaseId": release_id,
            "topLevelInputsOnly": True,
            "excludedSubtrees": ["OLD_RUNS"],
            "entries": [
                {
                    "solutionId": source["solutionId"],
                    "domain": source["domain"],
                    "rasterPath": str(source["rasterPath"]),
                    "rasterSha256": source["rasterSha256"],
                    "summaryPath": str(source["summaryPath"]),
                    "summarySha256": sha256_path(source["summaryPath"]),
                }
                for source in sources
            ],
        },
    )
    return {"catalog": catalog, "diff": diff, "uploadPlan": upload_plan}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--land-directory", type=Path, required=True)
    parser.add_argument("--marine-directory", type=Path, required=True)
    parser.add_argument("--baseline-catalog", type=Path, required=True)
    parser.add_argument("--baseline-manifest", type=Path, required=True)
    parser.add_argument("--species-exception", type=Path, required=True)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--catalog-version", required=True)
    parser.add_argument("--expected-land", type=int, default=168)
    parser.add_argument("--expected-marine", type=int, default=4)
    parser.add_argument("--existing-blob-paths", type=Path, default=None)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        existing = (
            args.existing_blob_paths.read_text(encoding="utf-8").splitlines()
            if args.existing_blob_paths
            else ()
        )
        result = build_release(
            land_directory=args.land_directory,
            marine_directory=args.marine_directory,
            baseline_catalog_path=args.baseline_catalog,
            baseline_manifest_path=args.baseline_manifest,
            species_exception_path=args.species_exception,
            release_root=args.release_root,
            release_id=args.release_id,
            catalog_version=args.catalog_version,
            expected_land=args.expected_land,
            expected_marine=args.expected_marine,
            existing_blob_paths=existing,
        )
    except (OSError, json.JSONDecodeError, ReleasePreparationError, ValueError) as exc:
        print(f"[prepare-solution-release] ERROR: {exc}", file=sys.stderr)
        return 2
    print(
        "[prepare-solution-release] prepared "
        f"{result['catalog']['expectedSolutionCount']} solutions; "
        f"{result['uploadPlan']['counts']['uploadRequired']} uploads required"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
