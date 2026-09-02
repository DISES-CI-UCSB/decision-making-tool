"""Build the shared Colombia-wide MEC denominator for a SIRAP release.

This artifact is deliberately independent of every solution raster. It is the
denominator for: MEC class area in a SIRAP / Colombia-wide MEC class area.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

from boundaries.boundary_loader import load_all_boundaries
from boundaries.boundary_mask import BoundaryMaskCache
from cli_utils import find_repo_root, resolve_output_dir
from local_io import DEFAULT_CACHE_DIR
from mec_compact import (
    AREA_DECIMALS,
    DEFAULT_COMPOSITE_CROSSWALK_URL,
    DEFAULT_COMPOSITE_PROVENANCE_URL,
    DEFAULT_COMPOSITE_RASTER_URL,
    RASTERIZATION_SEMANTICS,
    SOURCE_MODE_COMPOSITE,
    _boundary_features,
    _boundary_collection_metadata,
    _canonical_sha256,
    _grid_payload,
    _resolve_source_path,
    _sha256_path,
    _sum_class_area,
    build_composite_taxonomy,
    load_composite_crosswalk,
    read_mec_raster_values,
    validate_composite_provenance,
    validate_taxonomy_partition,
)
from raster_metrics import _fingerprint, _pixel_area_km2_per_row

FORMAT = "mec-national-denominator-v1"
ROW_LAYOUT = ["classIndex", "nationalMecAreaKm2"]
DEFAULT_OUTPUT_NAME = "national-denominator.mec.json"


def build_document(
    *,
    release_id: str,
    taxonomy: Any,
    values: np.ndarray,
    national_mask: np.ndarray,
    pixel_area_km2_per_row: np.ndarray,
    sources: dict[str, Any],
    grid: dict[str, Any],
    boundary: dict[str, Any],
) -> dict[str, Any]:
    """Create a complete, all-class denominator artifact from a national mask."""

    if values.shape != national_mask.shape:
        raise ValueError("National boundary mask must match the MEC raster grid.")
    valid_mask = national_mask & np.isfinite(values) & (values > 0)
    code_areas: dict[int, float] = {}
    rows, _ = np.nonzero(valid_mask)
    if rows.size:
        codes = values[valid_mask].astype(np.int64)
        unique, inverse = np.unique(codes, return_inverse=True)
        areas = np.bincount(
            inverse, weights=pixel_area_km2_per_row[rows], minlength=len(unique)
        )
        code_areas = {int(code): float(area) for code, area in zip(unique, areas)}

    result_rows = [
        [index, round(_sum_class_area(code_areas, item), AREA_DECIMALS)]
        for index, item in enumerate(taxonomy.classes)
    ]
    classified_area = round(float(pixel_area_km2_per_row[np.nonzero(valid_mask)[0]].sum()), AREA_DECIMALS)
    boundary_area = round(
        float(pixel_area_km2_per_row[np.nonzero(national_mask)[0]].sum()), AREA_DECIMALS
    )
    per_view_totals = {
        view_index: round(
            sum(row[1] for row in result_rows if taxonomy.classes[row[0]].view_index == view_index),
            AREA_DECIMALS,
        )
        for view_index in range(len(taxonomy.views))
    }
    if any(total != classified_area for total in per_view_totals.values()):
        raise AssertionError("Each MEC view must partition the classified national area.")
    return {
        "format": FORMAT,
        "releaseId": release_id,
        "units": "km2",
        "sourceMode": SOURCE_MODE_COMPOSITE,
        "scope": {
            "id": "colombia",
            "name": "Colombia",
            "semantics": (
                "Authoritative Colombia boundary with pixel-center inclusion; "
                "finite mapped MEC cells only; never clipped to solution support."
            ),
        },
        "sources": sources,
        "grid": grid,
        "boundaryProvenance": boundary,
        "validNationalSupport": {
            "boundaryAreaKm2": boundary_area,
            "classifiedMecAreaKm2": classified_area,
            "unclassifiedMecAreaKm2": round(boundary_area - classified_area, AREA_DECIMALS),
        },
        "viewCatalog": taxonomy.view_catalog,
        "classCatalog": taxonomy.class_catalog,
        "rowLayout": ROW_LAYOUT,
        "rows": result_rows,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output", type=Path, default=Path(DEFAULT_OUTPUT_NAME))
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--mec-raster", default=DEFAULT_COMPOSITE_RASTER_URL)
    parser.add_argument("--crosswalk", default=DEFAULT_COMPOSITE_CROSSWALK_URL)
    parser.add_argument("--provenance", default=DEFAULT_COMPOSITE_PROVENANCE_URL)
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args(argv)

    repo_root = find_repo_root()
    cache_dir = resolve_output_dir(repo_root, args.cache_dir)
    output = resolve_output_dir(repo_root, args.output)
    raster_path = _resolve_source_path(args.mec_raster, cache_dir, force_download=args.no_cache)
    crosswalk_path = _resolve_source_path(args.crosswalk, cache_dir, force_download=args.no_cache)
    provenance_path = _resolve_source_path(args.provenance, cache_dir, force_download=args.no_cache)
    raster_sha256 = _sha256_path(raster_path)
    crosswalk_sha256 = _sha256_path(crosswalk_path)
    provenance = json.loads(provenance_path.read_text(encoding="utf-8-sig"))
    composite_rows = load_composite_crosswalk(crosswalk_path.read_text(encoding="utf-8-sig"))
    validate_composite_provenance(
        provenance,
        raster_sha256=raster_sha256,
        crosswalk_sha256=crosswalk_sha256,
        crosswalk_row_count=len(composite_rows),
    )
    taxonomy = build_composite_taxonomy(composite_rows)
    validate_taxonomy_partition(taxonomy)
    with rasterio.open(raster_path) as dataset:
        fingerprint = _fingerprint(dataset)
        areas = _pixel_area_km2_per_row(dataset)
    values, _ = read_mec_raster_values(raster_path, fingerprint, taxonomy)
    boundaries, errors = load_all_boundaries(cache_dir)
    boundary_level = "national" if "national" in boundaries else "departments"
    if boundary_level in errors or boundary_level not in boundaries:
        raise RuntimeError(f"Could not load Colombia boundary: {errors.get(boundary_level)}")
    collection = boundaries[boundary_level]
    masks = BoundaryMaskCache()
    national_mask = np.zeros(values.shape, dtype=bool)
    for feature in _boundary_features(collection):
        national_mask |= masks.get(
            feature.geo_level, feature.boundary_id, feature.geometry, fingerprint,
            source_crs=feature.source_crs, source_sha256=feature.source_sha256,
            geometry_sha256=feature.geometry_sha256,
        )
    document = build_document(
        release_id=args.release_id,
        taxonomy=taxonomy,
        values=values,
        national_mask=national_mask,
        pixel_area_km2_per_row=areas,
        sources={
            "mecRaster": args.mec_raster,
            "mecRasterSha256": raster_sha256,
            "crosswalk": args.crosswalk,
            "crosswalkSha256": crosswalk_sha256,
            "provenance": args.provenance,
            "provenanceSha256": _sha256_path(provenance_path),
        },
        grid=_grid_payload(fingerprint),
        boundary=_boundary_collection_metadata(boundary_level, collection),
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
