"""Canonical provenance records for MEC 2024 ingestion outputs."""

from __future__ import annotations

import importlib.metadata
import platform
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arcgis import (
    ITEM_ID,
    LAYER_URL,
    QUERY_URL,
    atomic_write_json,
    canonical_json_bytes,
    load_json,
    sha256_bytes,
    sha256_file,
)


def _arcgis_date(value: Any) -> str | None:
    if value is None:
        return None
    try:
        timestamp = float(value) / 1000
    except (TypeError, ValueError):
        return str(value)
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def tool_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {
        "python": platform.python_version(),
        "gdal": None,
        "numpy": None,
        "rasterio": None,
    }
    for package in ("numpy", "rasterio"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            pass
    try:
        import rasterio

        versions["gdal"] = rasterio.__gdal_version__
    except ImportError:
        pass
    return versions


def output_checksums(paths: Mapping[str, Path]) -> dict[str, dict[str, Any]]:
    return {
        name: {
            "path": path.name,
            "sha256": sha256_file(path),
            "bytes": path.stat().st_size,
        }
        for name, path in sorted(paths.items())
    }


def build_provenance(
    *,
    metadata: Mapping[str, Any],
    oid_manifest: Mapping[str, Any],
    download_manifest: Mapping[str, Any],
    validation_report: Mapping[str, Any],
    raster_diagnostics: Mapping[str, Any],
    outputs: Mapping[str, dict[str, Any]],
    generated_at: str,
) -> dict[str, Any]:
    """Build a deterministic record when inputs and generated_at are fixed."""

    layer = metadata.get("layer") or {}
    item = metadata.get("item") or {}
    item_enrichment = metadata.get("itemMetadataEnrichment")
    if not isinstance(item_enrichment, dict):
        item_enrichment = {
            "attempted": False,
            "required": False,
            "status": "not-recorded",
            "itemId": metadata.get("itemId", ITEM_ID),
            "url": metadata.get("itemUrl"),
            "error": None,
        }
    editing_info = layer.get("editingInfo") or {}
    pages = download_manifest.get("pages") or []
    schema = layer.get("fields") or []
    provenance = {
        "format": "mec-2024-provenance-v1",
        "generatedAt": generated_at,
        "source": {
            "publisher": "IDEAM",
            "owner": item.get("owner") or layer.get("owner") or "SIA_IDEAM",
            "itemId": metadata.get("itemId", ITEM_ID),
            "serviceItemId": layer.get("serviceItemId"),
            "layerId": layer.get("id", 1),
            "layerUrl": LAYER_URL,
            "queryUrl": QUERY_URL,
            "sourceCrs": "EPSG:4686",
            "requestedOutputCrs": "EPSG:4326",
            "itemCreated": _arcgis_date(item.get("created")),
            "itemModified": _arcgis_date(item.get("modified")),
            "layerLastEdit": _arcgis_date(editing_info.get("lastEditDate")),
            "serviceVersion": layer.get("currentVersion"),
            "featureCount": metadata.get("featureCount"),
            "itemMetadataEnrichment": {
                "attempted": item_enrichment.get("attempted"),
                "required": item_enrichment.get("required"),
                "status": item_enrichment.get("status"),
                "itemId": item_enrichment.get("itemId"),
                "url": item_enrichment.get("url"),
                "error": item_enrichment.get("error"),
            },
            "license": {
                "access": "Public IDEAM source",
                "itemLevelLicense": "unspecified",
            },
        },
        "query": download_manifest.get("query"),
        "metadata": {
            "schemaSha256": metadata.get("schemaSha256"),
            "schemaCanonicalSha256": sha256_bytes(canonical_json_bytes(schema)),
        },
        "oids": {
            "count": oid_manifest.get("count"),
            "sha256": oid_manifest.get("oidsSha256"),
        },
        "pages": {
            "pageSize": download_manifest.get("pageSize"),
            "adaptiveSubdivision": download_manifest.get("adaptiveSubdivision"),
            "count": len(pages),
            "subdivisionCount": len(download_manifest.get("subdivisions") or []),
            "manifestSha256": sha256_bytes(canonical_json_bytes(download_manifest)),
            "hashes": [
                {
                    "index": page.get("index"),
                    "leafId": page.get("leafId"),
                    "startIndex": page.get("startIndex"),
                    "count": page.get("count"),
                    "firstOid": page.get("firstOid"),
                    "lastOid": page.get("lastOid"),
                    "oidSha256": page.get("oidSha256"),
                    "sha256": page.get("sha256"),
                    "parentNodeId": page.get("parentNodeId"),
                    "rootNodeId": page.get("rootNodeId"),
                    "depth": page.get("depth"),
                }
                for page in pages
            ],
        },
        "catalog": {
            "crosswalkSignature": validation_report.get("crosswalkSignature"),
            "crosswalkSha256": validation_report.get("crosswalkSha256"),
            "rowCount": validation_report.get("rowCount"),
            "biomeFamilyCount": validation_report.get("biomeFamilyCount"),
            "biomeFamilies": validation_report.get("biomeFamilies"),
            "expectedBiomeFamilyCount": validation_report.get(
                "expectedBiomeFamilyCount"
            ),
            "canonicalBiomeFamilies": validation_report.get("canonicalBiomeFamilies"),
            "priorCrosswalkUsed": validation_report.get("priorCrosswalkUsed"),
            "priorCrosswalk": validation_report.get("priorCrosswalk"),
            "priorRowCount": validation_report.get("priorRowCount"),
            "newRowCount": validation_report.get("newRowCount"),
            "tupleFields": [
                "tipo_ecos",
                "gran_bioma",
                "bioma_iavh",
                "ecos_sintesis",
                "ecos_general",
            ],
            "newIdOrdering": "canonical tuple order by component UTF-8 bytes",
        },
        "grid": {
            **(raster_diagnostics.get("grid") or {}),
            "fingerprintSha256": raster_diagnostics.get("gridFingerprintSha256"),
        },
        "rasterization": raster_diagnostics.get("rasterization"),
        "geometry": {
            "features": raster_diagnostics.get("features"),
            "multipartFeatures": raster_diagnostics.get("multipartFeatures"),
            "holes": raster_diagnostics.get("holes"),
        },
        "diagnostics": {
            "overlapCells": raster_diagnostics.get("overlapCells"),
            "maximumCenterClaims": raster_diagnostics.get("maximumCenterClaims"),
            "landMaskCells": raster_diagnostics.get("landMaskCells"),
            "landGapCells": raster_diagnostics.get("landGapCells"),
            "claimsOutsideLandMaskCells": raster_diagnostics.get(
                "claimsOutsideLandMaskCells"
            ),
            "validationComparison": raster_diagnostics.get("validationComparison"),
        },
        "tools": tool_versions(),
        "outputs": dict(sorted(outputs.items())),
    }
    return provenance


def write_provenance(
    path: Path,
    *,
    metadata_path: Path,
    oid_manifest_path: Path,
    download_manifest_path: Path,
    validation_report_path: Path,
    raster_diagnostics_path: Path,
    outputs: Mapping[str, Path],
    generated_at: str | None = None,
) -> dict[str, Any]:
    generated_at = generated_at or datetime.now(timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    provenance = build_provenance(
        metadata=load_json(metadata_path),
        oid_manifest=load_json(oid_manifest_path),
        download_manifest=load_json(download_manifest_path),
        validation_report=load_json(validation_report_path),
        raster_diagnostics=load_json(raster_diagnostics_path),
        outputs=output_checksums(outputs),
        generated_at=generated_at,
    )
    atomic_write_json(path, provenance)
    return provenance
