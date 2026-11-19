"""Resumable ingestion and rasterization for official IDEAM MEC 2024 vectors."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
HELPERS_DIR = SCRIPT_DIR / "helpers"
if str(HELPERS_DIR) not in sys.path:
    sys.path.insert(0, str(HELPERS_DIR))

from arcgis import (
    DEFAULT_PAGE_SIZE,
    OID_FIELD,
    REQUIRED_FIELDS,
    ArcGISClient,
    ArcGISError,
    RetryPolicy,
    atomic_write_json,
    canonical_json_bytes,
    download_pages,
    fetch_metadata,
    fetch_ordered_oids,
    load_json,
    load_ordered_oids,
    page_paths,
    sha256_bytes,
    sha256_file,
)
from provenance import write_provenance
from rasterize import (
    COMPOSITE_FILENAME,
    DERIVED_REGION_FILENAME,
    GAP_MASK_FILENAME,
    HIT_COUNT_FILENAME,
    RasterizationError,
    rasterize_mec,
)
from validate import (
    ValidationError,
    load_crosswalk,
    validate_and_catalog,
)

DEFAULT_SOURCE_COUNT = 460_350
DEFAULT_CATEGORY_COUNT = 3_344
DEFAULT_BIOME_FAMILY_COUNT = 8
CROSSWALK_FILENAME = "ecosistemas_IDs_IDEAM_MEC_2024.csv"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Download, validate, catalog, and rasterize official IDEAM MEC 2024 "
            "ArcGIS vectors."
        )
    )
    parser.add_argument(
        "stage",
        choices=(
            "metadata",
            "download",
            "validate",
            "validate/catalog",
            "rasterize",
            "provenance",
            "all",
        ),
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=SCRIPT_DIR / "cache",
        help="Resumable metadata and GeoJSON page cache.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=SCRIPT_DIR / "output",
        help="Crosswalk, raster, diagnostics, and provenance destination.",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=DEFAULT_PAGE_SIZE,
        help=f"OID page size (1-{DEFAULT_PAGE_SIZE}).",
    )
    parser.add_argument(
        "--adaptive-subdivision",
        action=argparse.BooleanOptionalAction,
        default=None,
        help=(
            "Recursively split only exhausted page requests into exact ordered "
            "halves. Defaults on for exact downloads and off when "
            "--max-allowable-offset is used."
        ),
    )
    parser.add_argument(
        "--minimum-chunk-size",
        type=int,
        default=1,
        help=(
            "Smallest exact OID chunk attempted by adaptive subdivision (default: 1)."
        ),
    )
    parser.add_argument("--retry-attempts", type=int, default=5)
    parser.add_argument("--initial-backoff-seconds", type=float, default=1.0)
    parser.add_argument("--max-backoff-seconds", type=float, default=30.0)
    parser.add_argument("--timeout-seconds", type=float, default=120.0)
    parser.add_argument(
        "--strict-item-metadata",
        action="store_true",
        help=(
            "Fail when ArcGIS Online item enrichment is unavailable. By default, "
            "healthy authoritative Enterprise service metadata remains sufficient."
        ),
    )
    precision = parser.add_mutually_exclusive_group()
    precision.add_argument(
        "--exact",
        action="store_true",
        help="Request exact vector coordinates (the default).",
    )
    precision.add_argument(
        "--max-allowable-offset",
        type=float,
        help="Request server-side geometry generalization in output CRS units.",
    )
    parser.add_argument(
        "--prior-crosswalk",
        type=Path,
        help="Optional prior MEC crosswalk whose IDs must remain stable.",
    )
    parser.add_argument(
        "--validation-raster",
        type=Path,
        help="Independent ecosistemas_IAVH_2024.tif planning-grid reference.",
    )
    parser.add_argument(
        "--validation-crosswalk",
        type=Path,
        help="Independent IAvH biome_id,biome CSV used for class comparison.",
    )
    parser.add_argument(
        "--expected-source-count",
        type=int,
        default=DEFAULT_SOURCE_COUNT,
    )
    parser.add_argument(
        "--expected-category-count",
        type=int,
        default=DEFAULT_CATEGORY_COUNT,
    )
    parser.add_argument(
        "--expected-biome-family-count",
        type=int,
        default=DEFAULT_BIOME_FAMILY_COUNT,
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="Create and process a tiny deterministic dataset without network access.",
    )
    return parser


def _client(arguments: argparse.Namespace) -> ArcGISClient:
    return ArcGISClient(
        retry_policy=RetryPolicy(
            attempts=arguments.retry_attempts,
            initial_backoff_seconds=arguments.initial_backoff_seconds,
            max_backoff_seconds=arguments.max_backoff_seconds,
        ),
        timeout_seconds=arguments.timeout_seconds,
    )


def _run_metadata(
    client: ArcGISClient,
    cache_dir: Path,
    *,
    strict_item_metadata: bool,
) -> tuple[dict[str, Any], list[int]]:
    metadata = fetch_metadata(
        client,
        cache_dir,
        strict_item_metadata=strict_item_metadata,
    )
    oids = fetch_ordered_oids(client, cache_dir)
    source_count = int(metadata["featureCount"])
    if len(oids) != source_count:
        raise ArcGISError(
            f"Source count is {source_count:,}, but ArcGIS returned "
            f"{len(oids):,} unique OIDs."
        )
    print(f"[mec-2024] cached metadata and {len(oids):,} ordered OIDs")
    return metadata, oids


def _ensure_metadata(
    client: ArcGISClient,
    cache_dir: Path,
    *,
    strict_item_metadata: bool,
) -> tuple[dict[str, Any], list[int]]:
    metadata_path = cache_dir / "metadata.json"
    oid_path = cache_dir / "oid-list.json"
    if metadata_path.exists() and oid_path.exists():
        metadata = load_json(metadata_path)
        enrichment = metadata.get("itemMetadataEnrichment") or {}
        if strict_item_metadata and enrichment.get("status") != "available":
            raise ArcGISError(
                "Strict item metadata mode requires an available cached ArcGIS "
                "Online item enrichment; rerun the metadata stage in strict mode."
            )
        oids = load_ordered_oids(cache_dir)
        if int(metadata["featureCount"]) != len(oids):
            raise ArcGISError(
                "Cached metadata count and cached OID count do not match."
            )
        return metadata, oids
    return _run_metadata(
        client,
        cache_dir,
        strict_item_metadata=strict_item_metadata,
    )


def _run_download(
    client: ArcGISClient,
    *,
    cache_dir: Path,
    page_size: int,
    max_allowable_offset: float | None,
    strict_item_metadata: bool,
    adaptive_subdivision: bool | None,
    minimum_chunk_size: int,
) -> dict[str, Any]:
    _, oids = _ensure_metadata(
        client,
        cache_dir,
        strict_item_metadata=strict_item_metadata,
    )
    subdivision_enabled = (
        max_allowable_offset is None
        if adaptive_subdivision is None
        else adaptive_subdivision
    )
    manifest = download_pages(
        client,
        oids=oids,
        cache_dir=cache_dir,
        page_size=page_size,
        max_allowable_offset=max_allowable_offset,
        adaptive_subdivision=subdivision_enabled,
        minimum_chunk_size=minimum_chunk_size,
    )
    print(f"[mec-2024] verified {len(manifest['pages']):,} cached/downloaded pages")
    return manifest


def _run_validate(
    arguments: argparse.Namespace,
    *,
    expected_source_count: int | None,
    expected_category_count: int | None,
    expected_biome_family_count: int | None,
) -> dict[str, Any]:
    _, report = validate_and_catalog(
        metadata_path=arguments.cache_dir / "metadata.json",
        page_paths=page_paths(arguments.cache_dir),
        output_dir=arguments.output_dir,
        prior_crosswalk=arguments.prior_crosswalk,
        expected_source_count=expected_source_count,
        expected_category_count=expected_category_count,
        expected_biome_family_count=expected_biome_family_count,
    )
    print(
        f"[mec-2024] validated {report['featureCount']:,} features and "
        f"{report['categoryCount']:,} observed categories"
    )
    return report


def _require_raster_inputs(arguments: argparse.Namespace) -> tuple[Path, Path]:
    if arguments.validation_raster is None:
        raise ValueError("--validation-raster is required for rasterization.")
    if arguments.validation_crosswalk is None:
        raise ValueError("--validation-crosswalk is required for rasterization.")
    return arguments.validation_raster, arguments.validation_crosswalk


def _provenance_outputs(output_dir: Path) -> dict[str, Path]:
    return {
        "compositeRaster": output_dir / COMPOSITE_FILENAME,
        "crosswalk": output_dir / CROSSWALK_FILENAME,
        "derivedBiomeRegionRaster": output_dir / DERIVED_REGION_FILENAME,
        "gapMaskRaster": output_dir / GAP_MASK_FILENAME,
        "hitCountRaster": output_dir / HIT_COUNT_FILENAME,
        "rasterizationDiagnostics": (
            output_dir / "rasterization-diagnostics.json"
        ),
        "validationCatalog": output_dir / "validation-catalog.json",
    }


def _run_provenance(arguments: argparse.Namespace) -> dict[str, Any]:
    provenance = write_provenance(
        arguments.output_dir / "provenance.json",
        metadata_path=arguments.cache_dir / "metadata.json",
        oid_manifest_path=arguments.cache_dir / "oid-list.json",
        download_manifest_path=arguments.cache_dir / "download-manifest.json",
        validation_report_path=arguments.output_dir / "validation-catalog.json",
        raster_diagnostics_path=(
            arguments.output_dir / "rasterization-diagnostics.json"
        ),
        outputs=_provenance_outputs(arguments.output_dir),
    )
    print("[mec-2024] wrote portable provenance.json from existing outputs")
    return provenance


def _run_rasterize(arguments: argparse.Namespace) -> dict[str, Any]:
    validation_raster, validation_crosswalk = _require_raster_inputs(arguments)
    rows = load_crosswalk(arguments.output_dir / CROSSWALK_FILENAME)
    diagnostics = rasterize_mec(
        page_paths=page_paths(arguments.cache_dir),
        rows=rows,
        validation_raster=validation_raster,
        validation_crosswalk=validation_crosswalk,
        output_dir=arguments.output_dir,
        require_planning_grid=not arguments.synthetic,
    )
    _run_provenance(arguments)
    print(
        f"[mec-2024] wrote {COMPOSITE_FILENAME}; "
        f"land gaps={diagnostics['landGapCells']:,}, overlaps=0"
    )
    return diagnostics


def _polygon(
    left: float,
    bottom: float,
    right: float,
    top: float,
    holes: list[list[list[float]]] | None = None,
) -> dict[str, Any]:
    exterior = [
        [left, bottom],
        [right, bottom],
        [right, top],
        [left, top],
        [left, bottom],
    ]
    return {"type": "Polygon", "coordinates": [exterior, *(holes or [])]}


def _synthetic_feature(
    oid: int,
    geometry: dict[str, Any],
    *,
    biome: str,
    tipo: str,
) -> dict[str, Any]:
    return {
        "type": "Feature",
        "properties": {
            OID_FIELD: oid,
            "tipo_ecos": tipo,
            "gran_bioma": f"Contexto {tipo}",
            "bioma_iavh": biome,
            "ecos_sintesis": f"Síntesis {tipo}",
            "ecos_general": f"Ecosistema detallado {tipo}",
            "area_ha": 100.0,
        },
        "geometry": geometry,
    }


def _write_synthetic_inputs(arguments: argparse.Namespace) -> None:
    """Create a tiny deterministic cache and independent validation fixture."""

    import numpy as np
    import rasterio
    from rasterio.transform import from_origin

    arguments.cache_dir.mkdir(parents=True, exist_ok=True)
    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    fields = [
        {
            "name": field,
            "type": (
                "esriFieldTypeOID"
                if field == OID_FIELD
                else "esriFieldTypeDouble"
                if field == "area_ha"
                else "esriFieldTypeString"
            ),
            "nullable": False,
        }
        for field in REQUIRED_FIELDS
    ]
    metadata = {
        "layerUrl": "synthetic://layer",
        "queryUrl": "synthetic://query",
        "itemId": "synthetic",
        "itemUrl": "synthetic://item",
        "featureCount": 3,
        "schemaSha256": sha256_bytes(canonical_json_bytes(fields)),
        "layer": {
            "id": 1,
            "fields": fields,
            "extent": {"spatialReference": {"wkid": 4686}},
        },
        "item": {"owner": "SIA_IDEAM"},
        "itemMetadataEnrichment": {
            "attempted": True,
            "required": arguments.strict_item_metadata,
            "status": "available",
            "itemId": "synthetic",
            "url": "synthetic://item",
            "error": None,
        },
    }
    atomic_write_json(arguments.cache_dir / "metadata.json", metadata)
    oids = [1, 2, 3]
    atomic_write_json(
        arguments.cache_dir / "oid-list.json",
        {
            "objectIdFieldName": OID_FIELD,
            "count": len(oids),
            "oids": oids,
            "oidsSha256": sha256_bytes(canonical_json_bytes(oids)),
        },
    )
    small_hole = [
        [2.05, 0.05],
        [2.20, 0.05],
        [2.20, 0.20],
        [2.05, 0.20],
        [2.05, 0.05],
    ]
    features = [
        _synthetic_feature(
            1,
            _polygon(0, 1, 1, 2),
            biome="Orobioma Sintético",
            tipo="Bosque húmedo",
        ),
        _synthetic_feature(
            2,
            {
                "type": "MultiPolygon",
                "coordinates": [
                    _polygon(1, 1, 2, 2)["coordinates"],
                    _polygon(1, 0, 2, 1)["coordinates"],
                ],
            },
            biome="Zonobioma Sintético",
            tipo="Sabana",
        ),
        _synthetic_feature(
            3,
            _polygon(2, 0, 3, 2, holes=[small_hole]),
            biome="Orobioma Sintético",
            tipo="Bosque húmedo",
        ),
    ]
    pages_dir = arguments.cache_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    page_file = pages_dir / "page-000000.geojson"
    atomic_write_json(
        page_file,
        {"type": "FeatureCollection", "features": features},
    )
    synthetic_query = {
        "format": "geojson",
        "outFields": list(REQUIRED_FIELDS),
        "outSR": 4326,
        "orderByFields": f"{OID_FIELD} ASC",
        "maxAllowableOffset": None,
        "allTouched": False,
    }
    synthetic_oid_hash = sha256_bytes(canonical_json_bytes(oids))
    synthetic_query_hash = sha256_bytes(canonical_json_bytes(synthetic_query))
    synthetic_leaf_id = (
        f"oids-000000000-000003-{synthetic_oid_hash[:12]}-{synthetic_query_hash[:12]}"
    )
    atomic_write_json(
        arguments.cache_dir / "download-manifest.json",
        {
            "format": "mec-2024-arcgis-pages-v2",
            "pageSize": 3,
            "requestedPageSize": 3,
            "featureCount": 3,
            "sourceOidSha256": synthetic_oid_hash,
            "query": synthetic_query,
            "querySha256": synthetic_query_hash,
            "adaptiveSubdivision": {
                "enabled": True,
                "minimumChunkSize": 1,
                "splitRule": "ordered deterministic halves; left=floor(n/2)",
            },
            "coveredFeatureCount": 3,
            "complete": True,
            "pages": [
                {
                    "index": 0,
                    "leafId": synthetic_leaf_id,
                    "nodeId": synthetic_leaf_id,
                    "parentNodeId": None,
                    "rootNodeId": synthetic_leaf_id,
                    "depth": 0,
                    "startIndex": 0,
                    "path": "pages/page-000000.geojson",
                    "count": 3,
                    "firstOid": 1,
                    "lastOid": 3,
                    "oidSha256": synthetic_oid_hash,
                    "sha256": sha256_file(page_file),
                }
            ],
            "subdivisions": [],
        },
    )

    validation_raster = arguments.cache_dir / "synthetic-validation.tif"
    validation_values = np.array([[1, 2, 1], [1, 2, 1]], dtype=np.uint16)
    with rasterio.open(
        validation_raster,
        "w",
        driver="GTiff",
        width=3,
        height=2,
        count=1,
        crs="EPSG:4326",
        transform=from_origin(0, 2, 1, 1),
        dtype="uint16",
        nodata=0,
    ) as target:
        target.write(validation_values, 1)
    validation_crosswalk = arguments.cache_dir / "synthetic-biomes.csv"
    validation_crosswalk.write_text(
        "biome_id,biome\n1,Orobioma Sintético\n2,Zonobioma Sintético\n",
        encoding="utf-8",
    )
    arguments.validation_raster = validation_raster
    arguments.validation_crosswalk = validation_crosswalk
    print("[mec-2024] prepared deterministic offline synthetic inputs")


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    arguments.cache_dir = arguments.cache_dir.resolve()
    arguments.output_dir = arguments.output_dir.resolve()
    arguments.cache_dir.mkdir(parents=True, exist_ok=True)
    arguments.output_dir.mkdir(parents=True, exist_ok=True)

    if arguments.synthetic:
        _write_synthetic_inputs(arguments)
        expected_source_count = 3
        expected_category_count = 2
        expected_biome_family_count = 2
    else:
        expected_source_count = arguments.expected_source_count
        expected_category_count = arguments.expected_category_count
        expected_biome_family_count = arguments.expected_biome_family_count

    try:
        stage = "validate" if arguments.stage == "validate/catalog" else arguments.stage
        client = _client(arguments)
        if not arguments.synthetic and stage in {"metadata", "all"}:
            _run_metadata(
                client,
                arguments.cache_dir,
                strict_item_metadata=arguments.strict_item_metadata,
            )
        if not arguments.synthetic and stage in {"download", "all"}:
            _run_download(
                client,
                cache_dir=arguments.cache_dir,
                page_size=arguments.page_size,
                max_allowable_offset=arguments.max_allowable_offset,
                strict_item_metadata=arguments.strict_item_metadata,
                adaptive_subdivision=arguments.adaptive_subdivision,
                minimum_chunk_size=arguments.minimum_chunk_size,
            )
        if stage in {"validate", "all"}:
            _run_validate(
                arguments,
                expected_source_count=expected_source_count,
                expected_category_count=expected_category_count,
                expected_biome_family_count=expected_biome_family_count,
            )
        if stage in {"rasterize", "all"}:
            _run_rasterize(arguments)
        if stage == "provenance":
            _run_provenance(arguments)
        if arguments.synthetic and stage in {"metadata", "download"}:
            print(f"[mec-2024] synthetic {stage} cache is ready")
        return 0
    except (
        ArcGISError,
        RasterizationError,
        ValidationError,
        OSError,
        ValueError,
    ) as exc:
        print(f"[mec-2024] ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
