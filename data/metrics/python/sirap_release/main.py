"""Build and validate an immutable, SIRAP-only runtime release."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
DEFAULT_RELEASE_ID = "sirap-2026-08-29-v2"
MANIFEST_FORMAT = "sirap-runtime-manifest-v1"
INVENTORY_FORMAT = "sirap-release-artifact-inventory-v1"


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def local_path(url: str) -> Path:
    parsed = urlsplit(url)
    if parsed.scheme != "file":
        raise ValueError(f"expected local file URL, got {url}")
    return Path(unquote(parsed.path))


def immutable_url(path: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{path.lstrip('/')}"


def artifact_path(component: str, solution_id: str) -> Path:
    suffix = ".metrics.json" if component == "regularVerbose" else ".metrics.compact.json"
    directory = "regular/verbose/cache" if component == "regularVerbose" else "regular/compact/cache"
    return Path(directory) / f"{solution_id}{suffix}"


def blob_path(release_id: str, path: Path) -> str:
    return f"releases/{release_id}/{path.as_posix()}"


def compact_document(doc: dict[str, Any]) -> dict[str, Any]:
    catalogs: dict[str, list[Any]] = {
        "metricCatalog": [],
        "statusCatalog": [],
        "sourceCatalog": [],
        "notesCatalog": [],
    }

    def index(catalog: str, value: Any) -> int:
        values = catalogs[catalog]
        try:
            return values.index(value)
        except ValueError:
            values.append(value)
            return len(values) - 1

    geographies: dict[str, Any] = {}
    for level, scopes in doc["geographies"].items():
        geographies[level] = {}
        for scope_id, scope in scopes.items():
            compact_scope = {key: value for key, value in scope.items() if key != "metrics"}
            compact_scope["metrics"] = [
                [
                    index("metricCatalog", [metric["metricId"], metric["unit"], metric["labelKey"], metric["formatHint"]]),
                    metric["value"],
                    index("statusCatalog", metric["status"]),
                    index("sourceCatalog", metric["source"]),
                    index("notesCatalog", metric["notes"]),
                    *([metric["details"]] if "details" in metric else []),
                ]
                for metric in scope["metrics"]
            ]
            geographies[level][scope_id] = compact_scope
    compact = {
        "format": "metrics-compact-v1",
        "solutionId": doc["solutionId"],
        "generatedAt": doc["generatedAt"],
        **catalogs,
        "geographies": geographies,
        "primaryGeography": doc["primaryGeography"],
        "metricsProvenance": doc["metricsProvenance"],
        "solutionRaster": doc["solutionRaster"],
        "solutionInputSignature": doc["solutionInputSignature"],
        "solutionCatalogBinding": doc["solutionCatalogBinding"],
    }
    compact["metricsProvenanceSha256"] = canonical_sha256(doc["metricsProvenance"])
    return compact


def adapt_verbose(source: dict[str, Any], solution: dict[str, Any], binding: dict[str, Any], release_id: str) -> dict[str, Any]:
    national = source.get("geographies", {}).get("national", {}).get("colombia")
    if not isinstance(national, dict):
        raise ValueError(f"{solution['id']} has no primary packet aggregate")
    primary = json.loads(json.dumps(national))
    primary["name"] = str(solution.get("name") or solution["sirapId"])
    primary["scopeState"]["boundary"] = {
        "geographyLevel": "sirap",
        "scopeId": solution["sirapId"],
        "sourceSha256": solution["regionalInputPacket"]["grid"]["sha256"],
        "geometrySha256": solution["regionalInputPacket"]["grid"]["sha256"],
    }
    primary["scopeState"]["rasterizationPolicy"] = {
        "boundaryInclusion": "packet-grid",
        "allTouched": False,
        "referenceGrid": "regional packet grid",
    }
    doc = json.loads(json.dumps(source))
    doc["geographies"] = {
        "sirap": {solution["sirapId"]: primary},
        "departments": source["geographies"].get("departments", {}),
        "municipalities": source["geographies"].get("municipalities", {}),
    }
    if not all(doc["geographies"].values()):
        raise ValueError(f"{solution['id']} lacks required regional scopes")
    doc["primaryGeography"] = {"level": "sirap", "scopeId": solution["sirapId"]}
    doc["solutionCatalogBinding"] = binding
    doc["metricsProvenance"]["releaseId"] = release_id
    doc["metricsProvenance"]["regionalPrimaryGeography"] = doc["primaryGeography"]
    return doc


def runtime_solution(solution: dict[str, Any], entry: dict[str, Any], release_id: str) -> dict[str, Any]:
    solution_id = solution["id"]
    raster_path = Path("solutions/sirap") / solution["rasterFile"]
    metadata_path = Path("metadata/sirap") / f"{solution_id}.metadata.json"
    return {
        "id": solution_id,
        "name": solution.get("name") or solution_id,
        "description": f"Certified regional SIRAP solution for {solution['sirapId']}.",
        "domain": "land",
        "scope": "sirap",
        "sirapId": solution["sirapId"],
        "displayUrl": immutable_url(blob_path(release_id, raster_path)),
        "metadataUrl": immutable_url(blob_path(release_id, metadata_path)),
        "rasterFile": solution["rasterFile"],
        "metadataFile": metadata_path.name,
        "blobPath": blob_path(release_id, raster_path),
        "rasterSha256": entry["rasterSha256"],
        "generatedAt": solution.get("generatedAt"),
        "capabilities": {},
        "precomputedMetricUrls": {
            "cache": immutable_url(blob_path(release_id, artifact_path("regularVerbose", solution_id))),
            "compactCache": immutable_url(blob_path(release_id, artifact_path("regularCompact", solution_id))),
        },
        "finderInputs": {
            "domain": "land",
            "scope": "sirap",
            "targetFeatureSet": None,
            "targetFeatureIds": [],
            "targetPercent": None,
            "structuredTargets": {
                "format": "solution-target-metadata-v1",
                "sourceEvaluation": "final_summary_csv",
                "ecosystems": [],
                "strategicEcosystems": [],
                "ecosystemServices": [],
                "speciesRepresentation": [],
                "espRn": [],
            },
            "costLayerId": None,
            "includeLayerIds": [],
            "excludeLayerIds": [],
        },
        "inputLayerIds": {"features": [], "cost": None, "includes": [], "excludes": []},
        "summaryMetrics": {"nSelected": None, "totalCost": None, "pctTargetsMet": None, "coverageRowCount": 0},
        "coverage": [],
        "rendering": {"valueType": "binary", "renderMode": "mask", "selectedValue": 1},
    }


def build(args: argparse.Namespace) -> dict[str, Any]:
    root = args.output_root / args.release_id
    if root.exists() and any(root.iterdir()):
        raise ValueError(f"candidate root already exists and is immutable: {root}")
    sources = [solution for path in args.packet_manifest for solution in read_json(path).get("solutions", [])]
    if len(sources) != 56 or len({source.get("id") for source in sources}) != 56:
        raise ValueError(f"expected exactly 56 SIRAP solutions, found {len(sources)}")

    catalog_entries = sorted(
        [
            {
                "solutionId": source["id"],
                "solutionBasename": source["rasterFile"],
                "domain": "land",
                "scope": "sirap",
                "sirapId": source["sirapId"],
                "rasterSha256": sha256_file(local_path(source["displayUrl"])),
            }
            for source in sources
        ],
        key=lambda entry: entry["solutionId"],
    )
    catalog = {
        "format": "sirap-solution-catalog-v1",
        "catalogVersion": args.catalog_version,
        "releaseId": args.release_id,
        "expectedSolutionCount": 56,
        "solutions": catalog_entries,
    }
    binding = {
        "format": "sirap-solution-catalog-binding-v1",
        "releaseId": args.release_id,
        "catalogVersion": args.catalog_version,
        "catalogSha256": canonical_sha256(catalog),
    }
    root.mkdir(parents=True)
    artifacts: list[dict[str, Any]] = []
    runtime_solutions = []
    by_id = {entry["solutionId"]: entry for entry in catalog_entries}
    for source in sources:
        solution_id = source["id"]
        verbose = adapt_verbose(
            read_json(args.sidecar_root / source["sirapId"] / "cache" / f"{solution_id}.metrics.json"),
            source,
            binding,
            args.release_id,
        )
        for component, document in (("regularVerbose", verbose), ("regularCompact", compact_document(verbose))):
            relative_path = artifact_path(component, solution_id)
            output = root / relative_path
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            artifacts.append({"component": component, "solutionId": solution_id, "path": relative_path.as_posix(), "blobPath": blob_path(args.release_id, relative_path), "sha256": sha256_file(output), "bytes": output.stat().st_size})
        raster_path = Path("solutions/sirap") / source["rasterFile"]
        raster_output = root / raster_path
        raster_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path(source["displayUrl"]), raster_output)
        artifacts.append({"component": "raster", "solutionId": solution_id, "path": raster_path.as_posix(), "blobPath": blob_path(args.release_id, raster_path), "sha256": sha256_file(raster_output), "bytes": raster_output.stat().st_size})
        metadata_path = Path("metadata/sirap") / f"{solution_id}.metadata.json"
        metadata_output = root / metadata_path
        metadata_output.parent.mkdir(parents=True, exist_ok=True)
        metadata_output.write_text(json.dumps({"format": "sirap-release-solution-metadata-v1", "solutionId": solution_id, "sirapId": source["sirapId"], "rasterSha256": by_id[solution_id]["rasterSha256"], "catalogBinding": binding, "sourceSidecarSha256": sha256_file(args.sidecar_root / source["sirapId"] / "cache" / f"{solution_id}.metrics.json")}, indent=2) + "\n", encoding="utf-8")
        artifacts.append({"component": "metadata", "solutionId": solution_id, "path": metadata_path.as_posix(), "blobPath": blob_path(args.release_id, metadata_path), "sha256": sha256_file(metadata_output), "bytes": metadata_output.stat().st_size})
        runtime_solutions.append(runtime_solution(source, by_id[solution_id], args.release_id))

    manifest = {
        "format": MANIFEST_FORMAT,
        "releaseId": args.release_id,
        "catalogVersion": args.catalog_version,
        "catalogSha256": binding["catalogSha256"],
        "generatedAt": args.generated_at,
        "publicBlobHost": PUBLIC_BLOB_HOST,
        "expectedSolutionCount": 56,
        "expectedRegularArtifactCount": 112,
        "solutions": sorted(runtime_solutions, key=lambda solution: solution["id"]),
    }
    inventory = {
        "format": INVENTORY_FORMAT,
        "releaseId": args.release_id,
        "catalogSha256": binding["catalogSha256"],
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
    }
    for filename, document in (("catalog.json", catalog), ("manifest.json", manifest), ("release-artifact-inventory.json", inventory)):
        (root / filename).write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return validate(root)


def validate(root: Path) -> dict[str, Any]:
    catalog = read_json(root / "catalog.json")
    manifest = read_json(root / "manifest.json")
    inventory = read_json(root / "release-artifact-inventory.json")
    if catalog.get("format") != "sirap-solution-catalog-v1" or manifest.get("format") != MANIFEST_FORMAT:
        raise ValueError("invalid SIRAP catalog or manifest format")
    if catalog["releaseId"] != manifest["releaseId"] or manifest["catalogSha256"] != canonical_sha256(catalog):
        raise ValueError("SIRAP release binding is stale")
    if len(catalog["solutions"]) != 56 or len(manifest["solutions"]) != 56:
        raise ValueError("SIRAP release must contain exactly 56 solutions")
    if manifest["expectedRegularArtifactCount"] != 112:
        raise ValueError("SIRAP release must declare exactly 112 regular artifacts")
    expected = {(component, solution["solutionId"]) for solution in catalog["solutions"] for component in ("regularVerbose", "regularCompact")}
    actual = {(item["component"], item["solutionId"]) for item in inventory["artifacts"] if item["component"] in {"regularVerbose", "regularCompact"}}
    if actual != expected:
        raise ValueError("SIRAP regular artifact inventory is incomplete")
    for item in inventory["artifacts"]:
        path = root / item["path"]
        if not path.is_file() or sha256_file(path) != item["sha256"]:
            raise ValueError(f"artifact checksum mismatch: {item['path']}")
    return {"releaseId": manifest["releaseId"], "solutionCount": 56, "regularArtifactCount": 112, "artifactCount": len(inventory["artifacts"]), "catalogSha256": manifest["catalogSha256"]}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sidecar-root", type=Path)
    parser.add_argument("--packet-manifest", type=Path, action="append")
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--release-id", default=DEFAULT_RELEASE_ID)
    parser.add_argument("--catalog-version", default="1.0.0")
    parser.add_argument("--generated-at", default="2026-08-29T00:00:00Z")
    parser.add_argument("--validate", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.validate:
        result = validate(args.validate)
    elif args.sidecar_root and args.packet_manifest and args.output_root:
        result = build(args)
    else:
        raise SystemExit(
            "--sidecar-root, --packet-manifest, and --output-root are required when building"
        )
    print(json.dumps(result, indent=2))
