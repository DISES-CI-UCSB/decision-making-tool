"""Build and validate an immutable, SIRAP-only runtime release."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import warnings
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from goal_summary import build_goal_summary
from metrics_pipeline.species_goals import validate_catalog, validate_compact

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
DEFAULT_RELEASE_ID = "sirap-2026-09-01-v4"
MANIFEST_FORMAT = "sirap-runtime-manifest-v1"
INVENTORY_FORMAT = "sirap-release-artifact-inventory-v1"
SIRAP_SPECIES_GEOGRAPHY_LEVELS = ("siraps", "departments", "municipalities")


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def validate_species_goals_release_artifacts(
    root: Path,
    *,
    release_id: str,
    species_artifacts: list[dict[str, Any]],
    completion_artifacts: list[dict[str, Any]],
) -> None:
    catalog_item = next(
        item for item in species_artifacts if item["component"] == "speciesGoalsCatalog"
    )
    catalog_path = root / catalog_item["path"]
    catalog = validate_catalog(read_json(catalog_path))
    catalog_provenance = catalog.get("provenance")
    if isinstance(catalog_provenance, dict):
        catalog_provenance_release_id = catalog_provenance.get("releaseId")
        if (
            isinstance(catalog_provenance_release_id, str)
            and catalog_provenance_release_id
            and catalog_provenance_release_id != release_id
        ):
            warnings.warn(
                "Species goals catalog provenance releaseId "
                f"{catalog_provenance_release_id!r} differs from release "
                f"{release_id!r}; binding on catalogSha256 is expected.",
                stacklevel=2,
            )
    catalog_completion_item = next(
        item
        for item in completion_artifacts
        if item.get("solutionId") is None
    )
    catalog_completion = read_json(root / catalog_completion_item["path"])
    if catalog_completion != {
        "format": "species-goals-catalog-completion-v1",
        "status": "complete",
        "releaseId": release_id,
        "catalogSha256": catalog["catalogSha256"],
        "artifactSha256": sha256_file(catalog_path),
    }:
        raise ValueError("SIRAP species-goals catalog completion is invalid or stale")

    completions_by_scope = {
        (item["solutionId"], item["geographyLevel"]): item
        for item in completion_artifacts
        if item.get("solutionId") is not None
    }
    for item in species_artifacts:
        if item["component"] != "speciesGoals":
            continue
        path = root / item["path"]
        document = validate_compact(
            read_json(path),
            catalog=catalog,
            expected_release_id=release_id,
        )
        scope = (item["solutionId"], item["geographyLevel"])
        if (
            document["solutionId"],
            document["geographyLevel"],
        ) != scope:
            raise ValueError(f"SIRAP species-goals inventory binding is stale: {item['path']}")
        completion_item = completions_by_scope[scope]
        completion = read_json(root / completion_item["path"])
        expected_completion = {
            **document["completion"],
            "artifactSha256": sha256_file(path),
            "solutionId": document["solutionId"],
            "geographyLevel": document["geographyLevel"],
            "catalogSha256": catalog["catalogSha256"],
            "provenance": document["provenance"],
        }
        if completion != expected_completion:
            raise ValueError(
                f"SIRAP species-goals completion is invalid or stale: "
                f"{completion_item['path']}"
            )


def local_path(url: str) -> Path:
    parsed = urlsplit(url)
    if parsed.scheme != "file":
        raise ValueError(f"expected local file URL, got {url}")
    return Path(unquote(parsed.path))


def immutable_url(path: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{path.lstrip('/')}"


def artifact_path(component: str, solution_id: str) -> Path:
    paths = {
        "regularVerbose": Path("regular/verbose/cache") / f"{solution_id}.metrics.json",
        "regularCompact": Path("regular/compact/cache")
        / f"{solution_id}.metrics.compact.json",
        "goalSummary": Path("goals/cache") / f"{solution_id}.goals.json",
        "sourceSummary": Path("source-summaries") / f"{solution_id}.summary.csv",
    }
    try:
        return paths[component]
    except KeyError as exc:
        raise ValueError(f"unsupported SIRAP release component: {component}") from exc


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
            compact_scope = {
                key: value for key, value in scope.items() if key != "metrics"
            }
            compact_scope["metrics"] = [
                [
                    index(
                        "metricCatalog",
                        [
                            metric["metricId"],
                            metric["unit"],
                            metric["labelKey"],
                            metric["formatHint"],
                        ],
                    ),
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


def adapt_verbose(
    source: dict[str, Any],
    solution: dict[str, Any],
    binding: dict[str, Any],
    release_id: str,
) -> dict[str, Any]:
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


def runtime_solution(
    solution: dict[str, Any],
    entry: dict[str, Any],
    goal_summary: dict[str, Any],
    release_id: str,
    *,
    include_species_goals: bool = False,
    include_mec: bool = False,
    mec_national_denominator: str | None = None,
) -> dict[str, Any]:
    solution_id = solution["id"]
    raster_path = Path("solutions/sirap") / solution["rasterFile"]
    metadata_path = Path("metadata/sirap") / f"{solution_id}.metadata.json"
    target_context = goal_summary["targetContext"]
    target_groups = goal_summary["regionalTargetGroups"]
    precomputed_urls = {
        "cache": immutable_url(
            blob_path(release_id, artifact_path("regularVerbose", solution_id))
        ),
        "compactCache": immutable_url(
            blob_path(release_id, artifact_path("regularCompact", solution_id))
        ),
        "goals": immutable_url(
            blob_path(release_id, artifact_path("goalSummary", solution_id))
        ),
    }
    if include_species_goals:
        precomputed_urls.update(
            {
                "speciesGoalsCatalog": immutable_url(
                    blob_path(
                        release_id, Path("species-goals/catalog/v1/catalog.json")
                    )
                ),
                "speciesGoalsByGeography": {
                    level: immutable_url(
                        blob_path(
                            release_id,
                            Path("species-goals/compact/v1")
                            / solution_id
                            / f"{level}.species-goals.compact.json",
                        )
                    )
                    for level in SIRAP_SPECIES_GEOGRAPHY_LEVELS
                },
            }
        )
    if include_mec:
        precomputed_urls["mecV2ByGeography"] = {
            level: immutable_url(
                blob_path(
                    release_id,
                    Path("mec/v2/cache")
                    / solution_id
                    / f"{level}.mec.compact.json",
                )
            )
            for level in (
                "national",
                "departments",
                "municipalities",
                "siraps",
                "runaps",
                "omecs",
            )
        }
    if mec_national_denominator:
        precomputed_urls["mecNationalDenominator"] = mec_national_denominator
    return {
        "id": solution_id,
        "name": goal_summary["solutionName"],
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
        "capabilities": (
            {"aoiCoverageMetrics": "v2"}
            if include_species_goals and include_mec
            else {}
        ),
        "precomputedMetricUrls": precomputed_urls,
        "finderInputs": {
            "domain": "land",
            "scope": "sirap",
            "targetFeatureSet": target_context["targetFeatureSet"],
            "targetFeatureIds": target_context["targetFeatureIds"],
            "targetPercent": target_context["finderTargetPercent"],
            "structuredTargets": target_context["structuredTargets"],
            "costLayerId": None,
            "includeLayerIds": [],
            "excludeLayerIds": [],
        },
        "inputLayerIds": {"features": [], "cost": None, "includes": [], "excludes": []},
        "summaryMetrics": {
            "nSelected": None,
            "totalCost": None,
            "pctTargetsMet": goal_summary["summary"]["pctMet"],
            "coverageRowCount": sum(len(group["features"]) for group in target_groups),
        },
        "coverage": [],
        "rendering": {"valueType": "binary", "renderMode": "mask", "selectedValue": 1},
    }


def source_artifact(roots: list[Path], relative_path: Path) -> Path:
    matches = [root / relative_path for root in roots if (root / relative_path).is_file()]
    if len(matches) != 1:
        raise ValueError(
            f"expected one source for {relative_path}, found {len(matches)}"
        )
    return matches[0]


def copy_release_artifact(
    *,
    source: Path,
    root: Path,
    relative_path: Path,
    release_id: str,
    component: str,
    solution_id: str | None = None,
    geography_level: str | None = None,
) -> dict[str, Any]:
    output = root / relative_path
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, output)
    item: dict[str, Any] = {
        "component": component,
        "path": relative_path.as_posix(),
        "blobPath": blob_path(release_id, relative_path),
        "sha256": sha256_file(output),
        "bytes": output.stat().st_size,
    }
    if solution_id is not None:
        item["solutionId"] = solution_id
    if geography_level is not None:
        item["geographyLevel"] = geography_level
    return item


def build(args: argparse.Namespace) -> dict[str, Any]:
    root = args.output_root / args.release_id
    if root.exists() and any(root.iterdir()):
        raise ValueError(f"candidate root already exists and is immutable: {root}")
    sources = [
        solution
        for path in args.packet_manifest
        for solution in read_json(path).get("solutions", [])
    ]
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
    root.mkdir(parents=True, exist_ok=True)
    artifacts: list[dict[str, Any]] = []
    runtime_solutions = []
    species_goals_roots = list(getattr(args, "species_goals_root", None) or [])
    mec_roots = list(getattr(args, "mec_root", None) or [])
    mec_national_denominator = getattr(args, "mec_national_denominator", None)
    if mec_national_denominator is not None and not mec_roots:
        raise ValueError("--mec-national-denominator requires --mec-root")
    if species_goals_roots:
        catalogs = [
            path / "species-goals/catalog/v1/catalog.json"
            for path in species_goals_roots
        ]
        catalog_documents = [
            read_json(path) for path in catalogs if path.is_file()
        ]
        catalog_bindings = {
            document.get("catalogSha256") for document in catalog_documents
        }
        if (
            len(catalog_documents) != len(catalogs)
            or len(catalog_bindings) != 1
            or None in catalog_bindings
        ):
            raise ValueError("species-goals roots do not share one complete catalog")
        artifacts.append(
            copy_release_artifact(
                source=catalogs[0],
                root=root,
                relative_path=Path("species-goals/catalog/v1/catalog.json"),
                release_id=args.release_id,
                component="speciesGoalsCatalog",
            )
        )
        artifacts.append(
            copy_release_artifact(
                source=catalogs[0].with_name(f"{catalogs[0].name}.complete.json"),
                root=root,
                relative_path=Path(
                    "species-goals/catalog/v1/catalog.json.complete.json"
                ),
                release_id=args.release_id,
                component="speciesGoalsCompletion",
            )
        )
    if mec_national_denominator is not None:
        denominator = read_json(mec_national_denominator)
        if denominator.get("format") != "mec-national-denominator-v1":
            raise ValueError("MEC national denominator has an invalid format")
        if denominator.get("releaseId") != args.release_id:
            raise ValueError("MEC national denominator release ID is stale")
        artifacts.append(
            copy_release_artifact(
                source=mec_national_denominator,
                root=root,
                relative_path=Path("mec/v2/national-denominator.mec.json"),
                release_id=args.release_id,
                component="mecNationalDenominator",
            )
        )
    by_id = {entry["solutionId"]: entry for entry in catalog_entries}
    for source in sources:
        solution_id = source["id"]
        verbose = adapt_verbose(
            read_json(
                args.sidecar_root
                / source["sirapId"]
                / "cache"
                / f"{solution_id}.metrics.json"
            ),
            source,
            binding,
            args.release_id,
        )
        source_summary_path = local_path(
            source["regionalInputPacket"]["authoritativeSummary"]["url"]
        )
        summary_relative_path = artifact_path("sourceSummary", solution_id)
        summary_output = root / summary_relative_path
        summary_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_summary_path, summary_output)
        artifacts.append(
            {
                "component": "sourceSummary",
                "solutionId": solution_id,
                "path": summary_relative_path.as_posix(),
                "blobPath": blob_path(args.release_id, summary_relative_path),
                "sha256": sha256_file(summary_output),
                "bytes": summary_output.stat().st_size,
            }
        )
        goal_summary = build_goal_summary(
            source,
            args.generated_at,
            published_summary_url=immutable_url(
                blob_path(args.release_id, summary_relative_path)
            ),
        )
        for component, document in (
            ("regularVerbose", verbose),
            ("regularCompact", compact_document(verbose)),
            ("goalSummary", goal_summary),
        ):
            relative_path = artifact_path(component, solution_id)
            output = root / relative_path
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(
                json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            artifacts.append(
                {
                    "component": component,
                    "solutionId": solution_id,
                    "path": relative_path.as_posix(),
                    "blobPath": blob_path(args.release_id, relative_path),
                    "sha256": sha256_file(output),
                    "bytes": output.stat().st_size,
                }
            )
        if species_goals_roots:
            for level in SIRAP_SPECIES_GEOGRAPHY_LEVELS:
                relative_path = (
                    Path("species-goals/compact/v1")
                    / solution_id
                    / f"{level}.species-goals.compact.json"
                )
                artifacts.append(
                    copy_release_artifact(
                        source=source_artifact(species_goals_roots, relative_path),
                        root=root,
                        relative_path=relative_path,
                        release_id=args.release_id,
                        component="speciesGoals",
                        solution_id=solution_id,
                        geography_level=level,
                    )
                )
                completion_relative_path = relative_path.with_name(
                    f"{relative_path.name}.complete.json"
                )
                artifacts.append(
                    copy_release_artifact(
                        source=source_artifact(
                            species_goals_roots, completion_relative_path
                        ),
                        root=root,
                        relative_path=completion_relative_path,
                        release_id=args.release_id,
                        component="speciesGoalsCompletion",
                        solution_id=solution_id,
                        geography_level=level,
                    )
                )
        if mec_roots:
            for level in (
                "national",
                "departments",
                "municipalities",
                "siraps",
                "runaps",
                "omecs",
            ):
                source_relative_path = (
                    Path("cache")
                    / solution_id
                    / f"{level}.mec.compact.json"
                )
                release_relative_path = (
                    Path("mec/v2/cache")
                    / solution_id
                    / f"{level}.mec.compact.json"
                )
                artifacts.append(
                    copy_release_artifact(
                        source=source_artifact(mec_roots, source_relative_path),
                        root=root,
                        relative_path=release_relative_path,
                        release_id=args.release_id,
                        component="mecV2",
                        solution_id=solution_id,
                        geography_level=level,
                    )
                )
        raster_path = Path("solutions/sirap") / source["rasterFile"]
        raster_output = root / raster_path
        raster_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path(source["displayUrl"]), raster_output)
        artifacts.append(
            {
                "component": "raster",
                "solutionId": solution_id,
                "path": raster_path.as_posix(),
                "blobPath": blob_path(args.release_id, raster_path),
                "sha256": sha256_file(raster_output),
                "bytes": raster_output.stat().st_size,
            }
        )
        metadata_path = Path("metadata/sirap") / f"{solution_id}.metadata.json"
        metadata_output = root / metadata_path
        metadata_output.parent.mkdir(parents=True, exist_ok=True)
        metadata_output.write_text(
            json.dumps(
                {
                    "format": "sirap-release-solution-metadata-v1",
                    "solutionId": solution_id,
                    "sirapId": source["sirapId"],
                    "rasterSha256": by_id[solution_id]["rasterSha256"],
                    "catalogBinding": binding,
                    "sourceSidecarSha256": sha256_file(
                        args.sidecar_root
                        / source["sirapId"]
                        / "cache"
                        / f"{solution_id}.metrics.json"
                    ),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        artifacts.append(
            {
                "component": "metadata",
                "solutionId": solution_id,
                "path": metadata_path.as_posix(),
                "blobPath": blob_path(args.release_id, metadata_path),
                "sha256": sha256_file(metadata_output),
                "bytes": metadata_output.stat().st_size,
            }
        )
        runtime_solutions.append(
            runtime_solution(
                source,
                by_id[solution_id],
                goal_summary,
                args.release_id,
                include_species_goals=bool(species_goals_roots),
                include_mec=bool(mec_roots),
                mec_national_denominator=(
                    immutable_url(
                        blob_path(args.release_id, Path("mec/v2/national-denominator.mec.json"))
                    )
                    if mec_national_denominator is not None
                    else None
                ),
            )
        )

    manifest = {
        "format": MANIFEST_FORMAT,
        "releaseId": args.release_id,
        "catalogVersion": args.catalog_version,
        "catalogSha256": binding["catalogSha256"],
        "generatedAt": args.generated_at,
        "publicBlobHost": PUBLIC_BLOB_HOST,
        "expectedSolutionCount": 56,
        "expectedRegularArtifactCount": 112,
        "expectedGoalSummaryArtifactCount": 56,
        "expectedSourceSummaryArtifactCount": 56,
        "expectedSpeciesGoalsArtifactCount": (
            1 + 56 * len(SIRAP_SPECIES_GEOGRAPHY_LEVELS)
            if species_goals_roots
            else 0
        ),
        "expectedSpeciesGoalsCompletionArtifactCount": (
            1 + 56 * len(SIRAP_SPECIES_GEOGRAPHY_LEVELS)
            if species_goals_roots
            else 0
        ),
        "expectedMecV2ArtifactCount": 56 * 6 if mec_roots else 0,
        "expectedMecNationalDenominatorArtifactCount": 1 if mec_national_denominator else 0,
        "solutions": sorted(runtime_solutions, key=lambda solution: solution["id"]),
    }
    inventory = {
        "format": INVENTORY_FORMAT,
        "releaseId": args.release_id,
        "catalogSha256": binding["catalogSha256"],
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
    }
    for filename, document in (
        ("catalog.json", catalog),
        ("manifest.json", manifest),
        ("release-artifact-inventory.json", inventory),
    ):
        (root / filename).write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return validate(root)


def validate(root: Path) -> dict[str, Any]:
    catalog = read_json(root / "catalog.json")
    manifest = read_json(root / "manifest.json")
    inventory = read_json(root / "release-artifact-inventory.json")
    if (
        catalog.get("format") != "sirap-solution-catalog-v1"
        or manifest.get("format") != MANIFEST_FORMAT
    ):
        raise ValueError("invalid SIRAP catalog or manifest format")
    if catalog["releaseId"] != manifest["releaseId"] or manifest[
        "catalogSha256"
    ] != canonical_sha256(catalog):
        raise ValueError("SIRAP release binding is stale")
    if len(catalog["solutions"]) != 56 or len(manifest["solutions"]) != 56:
        raise ValueError("SIRAP release must contain exactly 56 solutions")
    if manifest["expectedRegularArtifactCount"] != 112:
        raise ValueError("SIRAP release must declare exactly 112 regular artifacts")
    if manifest.get("expectedGoalSummaryArtifactCount") != 56:
        raise ValueError("SIRAP release must declare exactly 56 goal-summary artifacts")
    if manifest.get("expectedSourceSummaryArtifactCount") != 56:
        raise ValueError(
            "SIRAP release must declare exactly 56 source-summary artifacts"
        )
    expected = {
        (component, solution["solutionId"])
        for solution in catalog["solutions"]
        for component in ("regularVerbose", "regularCompact")
    }
    actual = {
        (item["component"], item["solutionId"])
        for item in inventory["artifacts"]
        if item["component"] in {"regularVerbose", "regularCompact"}
    }
    if actual != expected:
        raise ValueError("SIRAP regular artifact inventory is incomplete")
    expected_goals = {
        ("goalSummary", solution["solutionId"]) for solution in catalog["solutions"]
    }
    actual_goals = {
        (item["component"], item["solutionId"])
        for item in inventory["artifacts"]
        if item["component"] == "goalSummary"
    }
    if actual_goals != expected_goals:
        raise ValueError("SIRAP goal-summary artifact inventory is incomplete")
    expected_summaries = {
        ("sourceSummary", solution["solutionId"]) for solution in catalog["solutions"]
    }
    actual_summaries = {
        (item["component"], item["solutionId"])
        for item in inventory["artifacts"]
        if item["component"] == "sourceSummary"
    }
    if actual_summaries != expected_summaries:
        raise ValueError("SIRAP source-summary artifact inventory is incomplete")
    expected_species_count = manifest.get("expectedSpeciesGoalsArtifactCount", 0)
    species_artifacts = [
        item
        for item in inventory["artifacts"]
        if item["component"] in {"speciesGoalsCatalog", "speciesGoals"}
    ]
    if len(species_artifacts) != expected_species_count:
        raise ValueError("SIRAP species-goals artifact inventory is incomplete")
    if expected_species_count:
        expected_species = {
            (solution["solutionId"], level)
            for solution in catalog["solutions"]
            for level in SIRAP_SPECIES_GEOGRAPHY_LEVELS
        }
        actual_species = {
            (item["solutionId"], item["geographyLevel"])
            for item in species_artifacts
            if item["component"] == "speciesGoals"
        }
        if actual_species != expected_species or sum(
            item["component"] == "speciesGoalsCatalog"
            for item in species_artifacts
        ) != 1:
            raise ValueError("SIRAP species-goals release coverage is incomplete")
    expected_species_completion_count = manifest.get(
        "expectedSpeciesGoalsCompletionArtifactCount", 0
    )
    species_completion_artifacts = [
        item
        for item in inventory["artifacts"]
        if item["component"] == "speciesGoalsCompletion"
    ]
    if len(species_completion_artifacts) != expected_species_completion_count:
        raise ValueError(
            "SIRAP species-goals completion artifact inventory is incomplete"
        )
    if expected_species_completion_count:
        expected_species_completions = {
            (solution["solutionId"], level)
            for solution in catalog["solutions"]
            for level in SIRAP_SPECIES_GEOGRAPHY_LEVELS
        }
        actual_species_completions = {
            (item["solutionId"], item["geographyLevel"])
            for item in species_completion_artifacts
            if item.get("solutionId") is not None
        }
        catalog_completion_count = sum(
            item.get("solutionId") is None for item in species_completion_artifacts
        )
        if (
            actual_species_completions != expected_species_completions
            or catalog_completion_count != 1
        ):
            raise ValueError(
                "SIRAP species-goals completion release coverage is incomplete"
            )
    expected_mec_count = manifest.get("expectedMecV2ArtifactCount", 0)
    mec_artifacts = [
        item for item in inventory["artifacts"] if item["component"] == "mecV2"
    ]
    if len(mec_artifacts) != expected_mec_count:
        raise ValueError("SIRAP MEC v2 artifact inventory is incomplete")
    if expected_mec_count:
        expected_mec = {
            (solution["solutionId"], level)
            for solution in catalog["solutions"]
            for level in (
                "national",
                "departments",
                "municipalities",
                "siraps",
                "runaps",
                "omecs",
            )
        }
        if {
            (item["solutionId"], item["geographyLevel"])
            for item in mec_artifacts
        } != expected_mec:
            raise ValueError("SIRAP MEC v2 release coverage is incomplete")
    denominator_artifacts = [
        item for item in inventory["artifacts"] if item["component"] == "mecNationalDenominator"
    ]
    if len(denominator_artifacts) != manifest.get("expectedMecNationalDenominatorArtifactCount", 0):
        raise ValueError("SIRAP MEC national denominator inventory is incomplete")
    if denominator_artifacts and denominator_artifacts[0]["path"] != "mec/v2/national-denominator.mec.json":
        raise ValueError("SIRAP MEC national denominator path is invalid")
    for item in inventory["artifacts"]:
        path = root / item["path"]
        if not path.is_file() or sha256_file(path) != item["sha256"]:
            raise ValueError(f"artifact checksum mismatch: {item['path']}")
    if expected_species_count:
        validate_species_goals_release_artifacts(
            root,
            release_id=manifest["releaseId"],
            species_artifacts=species_artifacts,
            completion_artifacts=species_completion_artifacts,
        )
    return {
        "releaseId": manifest["releaseId"],
        "solutionCount": 56,
        "regularArtifactCount": 112,
        "artifactCount": len(inventory["artifacts"]),
        "catalogSha256": manifest["catalogSha256"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sidecar-root", type=Path)
    parser.add_argument("--packet-manifest", type=Path, action="append")
    parser.add_argument("--species-goals-root", type=Path, action="append")
    parser.add_argument("--mec-root", type=Path, action="append")
    parser.add_argument("--mec-national-denominator", type=Path)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--release-id", default=DEFAULT_RELEASE_ID)
    parser.add_argument("--catalog-version", default="1.0.0")
    parser.add_argument("--generated-at", default="2026-09-01T00:00:00Z")
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
