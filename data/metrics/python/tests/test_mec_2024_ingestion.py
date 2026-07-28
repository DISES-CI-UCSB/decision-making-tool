from __future__ import annotations

import json
import sys
import urllib.error
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_DIR = REPOSITORY_ROOT / "data" / "scripts" / "mec-2024"
sys.path.insert(0, str(SCRIPT_DIR / "helpers"))

from arcgis import (
    ITEM_URL,
    LAYER_URL,
    QUERY_URL,
    ArcGISClient,
    ArcGISError,
    ArcGISResponseError,
    RetryPolicy,
    atomic_write_json,
    canonical_json_bytes,
    download_pages,
    fetch_metadata,
    fetch_ordered_oids,
    load_json,
    page_paths,
    sha256_bytes,
    sha256_file,
)
from provenance import build_provenance, output_checksums
from rasterize import (
    COMPOSITE_FILENAME,
    RasterizationError,
    load_grid_fingerprint,
    rasterize_mec,
)
from validate import (
    BIOME_FAMILIES,
    OTHER_BIOME_FAMILY,
    CatalogRow,
    ValidationError,
    biome_family_for_label,
    build_catalog,
    load_crosswalk,
    validate_geometry,
    write_crosswalk,
)


def _category(
    tipo: str,
    biome: str = "Orobioma de prueba",
) -> tuple[str, str, str, str, str]:
    return (
        tipo,
        f"Contexto {tipo}",
        biome,
        f"Síntesis {tipo}",
        f"Detalle {tipo}",
    )


def _polygon(left: float, bottom: float, right: float, top: float):
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [left, bottom],
                [right, bottom],
                [right, top],
                [left, top],
                [left, bottom],
            ]
        ],
    }


def _feature(
    oid: int,
    geometry,
    *,
    category: tuple[str, str, str, str, str] | None = None,
):
    category = category or _category("Bosque húmedo")
    return {
        "type": "Feature",
        "properties": {
            "objectid": oid,
            "tipo_ecos": category[0],
            "gran_bioma": category[1],
            "bioma_iavh": category[2],
            "ecos_sintesis": category[3],
            "ecos_general": category[4],
            "area_ha": 1.0,
        },
        "geometry": geometry,
    }


def _write_page(path: Path, features: list[dict]) -> None:
    atomic_write_json(path, {"type": "FeatureCollection", "features": features})


def _write_oid_manifest(cache_dir: Path, oids: list[int]) -> None:
    atomic_write_json(
        cache_dir / "oid-list.json",
        {
            "objectIdFieldName": "objectid",
            "count": len(oids),
            "oids": oids,
            "oidsSha256": sha256_bytes(canonical_json_bytes(oids)),
        },
    )


def _page_response(requested: tuple[int, ...]):
    return {
        "type": "FeatureCollection",
        "features": [
            _feature(oid, _polygon(oid - 1, 0, oid, 1)) for oid in reversed(requested)
        ],
    }


def _write_validation_raster(path: Path, values: np.ndarray) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=values.shape[1],
        height=values.shape[0],
        count=1,
        crs="EPSG:4326",
        transform=from_origin(0, values.shape[0], 1, 1),
        dtype=str(values.dtype),
        nodata=0,
    ) as target:
        target.write(values, 1)


def test_download_pages_resumes_and_replaces_checksum_corruption(tmp_path):
    calls: list[tuple[int, ...]] = []
    offsets: list[float | None] = []

    def transport(url, parameters, method):
        assert method == "POST"
        requested = tuple(int(value) for value in parameters["objectIds"].split(","))
        calls.append(requested)
        offsets.append(parameters.get("maxAllowableOffset"))
        return _page_response(requested)

    client = ArcGISClient(transport=transport)
    first = download_pages(client, oids=[1, 2, 3], cache_dir=tmp_path, page_size=2)

    assert calls == [(1, 2), (3,)]
    assert [page["count"] for page in first["pages"]] == [2, 1]
    download_pages(client, oids=[1, 2, 3], cache_dir=tmp_path, page_size=2)
    assert calls == [(1, 2), (3,)]

    corrupted = tmp_path / first["pages"][0]["path"]
    corrupted.write_bytes(
        corrupted.read_bytes().replace(b'"area_ha":1.0', b'"area_ha":2.0', 1)
    )
    download_pages(client, oids=[1, 2, 3], cache_dir=tmp_path, page_size=2)

    assert calls == [(1, 2), (3,), (1, 2)]
    assert load_json(corrupted)["features"][0]["properties"]["area_ha"] == 1.0

    download_pages(
        client,
        oids=[1, 2, 3],
        cache_dir=tmp_path,
        page_size=2,
        max_allowable_offset=0.001,
    )
    assert calls[-2:] == [(1, 2), (3,)]
    assert offsets == [None, None, None, 0.001, 0.001]


def test_http_failure_splits_exact_page_and_manifest_proves_coverage(tmp_path):
    calls: list[tuple[int, ...]] = []

    def transport(url, parameters, method):
        requested = tuple(int(value) for value in parameters["objectIds"].split(","))
        calls.append(requested)
        if requested == (1, 2, 3, 4):
            raise urllib.error.HTTPError(url, 500, "upstream failure", None, None)
        return _page_response(requested)

    oids = [1, 2, 3, 4]
    _write_oid_manifest(tmp_path, oids)
    manifest = download_pages(
        ArcGISClient(
            transport=transport,
            retry_policy=RetryPolicy(attempts=1),
        ),
        oids=oids,
        cache_dir=tmp_path,
        page_size=4,
    )

    assert calls == [(1, 2, 3, 4), (1, 2), (3, 4)]
    assert manifest["complete"] is True
    assert manifest["coveredFeatureCount"] == 4
    assert [leaf["count"] for leaf in manifest["pages"]] == [2, 2]
    assert [leaf["startIndex"] for leaf in manifest["pages"]] == [0, 2]
    assert manifest["subdivisions"][0]["failure"]["kind"] == "http"
    assert manifest["subdivisions"][0]["failure"]["httpStatus"] == 500
    assert len(page_paths(tmp_path)) == 2


def test_malformed_json_failure_splits_without_caching_parent(tmp_path):
    calls: list[tuple[int, ...]] = []

    def transport(url, parameters, method):
        requested = tuple(int(value) for value in parameters["objectIds"].split(","))
        calls.append(requested)
        if requested == (1, 2, 3, 4):
            raise json.JSONDecodeError("truncated", '{"type":', 8)
        return _page_response(requested)

    manifest = download_pages(
        ArcGISClient(
            transport=transport,
            retry_policy=RetryPolicy(attempts=1),
        ),
        oids=[1, 2, 3, 4],
        cache_dir=tmp_path,
        page_size=4,
    )

    assert calls == [(1, 2, 3, 4), (1, 2), (3, 4)]
    assert manifest["subdivisions"][0]["failure"]["kind"] == "malformed-json"
    assert all("000004" not in leaf["path"] for leaf in manifest["pages"])
    assert not list((tmp_path / "pages").glob("page-*.geojson"))


def test_adaptive_subdivision_recurses_through_multiple_levels(tmp_path):
    calls: list[tuple[int, ...]] = []

    def transport(url, parameters, method):
        requested = tuple(int(value) for value in parameters["objectIds"].split(","))
        calls.append(requested)
        if 5 in requested and len(requested) > 1:
            raise ArcGISError("response too large")
        return _page_response(requested)

    manifest = download_pages(
        ArcGISClient(
            transport=transport,
            retry_policy=RetryPolicy(attempts=1),
        ),
        oids=list(range(1, 9)),
        cache_dir=tmp_path,
        page_size=8,
    )

    assert [leaf["count"] for leaf in manifest["pages"]] == [4, 1, 1, 2]
    assert [leaf["firstOid"] for leaf in manifest["pages"]] == [1, 5, 6, 7]
    assert len(manifest["subdivisions"]) == 3
    assert max(leaf["depth"] for leaf in manifest["pages"]) == 3


def test_interrupted_subdivision_resumes_from_valid_child(tmp_path):
    first_calls: list[tuple[int, ...]] = []

    def interrupted_transport(url, parameters, method):
        requested = tuple(int(value) for value in parameters["objectIds"].split(","))
        first_calls.append(requested)
        if requested == (1, 2, 3, 4):
            raise ArcGISError("response too large")
        if requested == (3, 4):
            raise KeyboardInterrupt
        return _page_response(requested)

    with pytest.raises(KeyboardInterrupt):
        download_pages(
            ArcGISClient(
                transport=interrupted_transport,
                retry_policy=RetryPolicy(attempts=1),
            ),
            oids=[1, 2, 3, 4],
            cache_dir=tmp_path,
            page_size=4,
        )

    partial = load_json(tmp_path / "download-manifest.json")
    assert partial["complete"] is False
    assert [(leaf["firstOid"], leaf["lastOid"]) for leaf in partial["pages"]] == [
        (1, 2)
    ]

    resumed_calls: list[tuple[int, ...]] = []

    def resumed_transport(url, parameters, method):
        requested = tuple(int(value) for value in parameters["objectIds"].split(","))
        resumed_calls.append(requested)
        return _page_response(requested)

    completed = download_pages(
        ArcGISClient(transport=resumed_transport),
        oids=[1, 2, 3, 4],
        cache_dir=tmp_path,
        page_size=4,
    )

    assert first_calls == [(1, 2, 3, 4), (1, 2), (3, 4)]
    assert resumed_calls == [(3, 4)]
    assert completed["complete"] is True


def test_single_oid_persistent_failure_reports_parent_and_cache_context(tmp_path):
    def transport(url, parameters, method):
        requested = tuple(int(value) for value in parameters["objectIds"].split(","))
        if requested == (41,):
            return _page_response(requested)
        raise urllib.error.HTTPError(
            url, 500, "persistent upstream failure", None, None
        )

    with pytest.raises(ArcGISError, match=r"OID 42.*parent=.*root=.*cache="):
        download_pages(
            ArcGISClient(
                transport=transport,
                retry_policy=RetryPolicy(attempts=1),
            ),
            oids=[41, 42],
            cache_dir=tmp_path,
            page_size=2,
        )

    partial = load_json(tmp_path / "download-manifest.json")
    assert partial["complete"] is False
    assert partial["pages"][0]["firstOid"] == 41


def test_preexisting_fixed_parent_page_is_retained_during_split(tmp_path):
    pages_dir = tmp_path / "pages"
    pages_dir.mkdir(parents=True)
    parent_path = pages_dir / "page-000000.geojson"
    _write_page(
        parent_path,
        [
            _feature(1, _polygon(0, 0, 1, 1)),
            _feature(2, _polygon(1, 0, 2, 1)),
        ],
    )
    first_oids = [1, 2]
    query = {
        "format": "geojson",
        "outFields": [
            "objectid",
            "tipo_ecos",
            "gran_bioma",
            "bioma_iavh",
            "ecos_sintesis",
            "ecos_general",
            "area_ha",
        ],
        "outSR": 4326,
        "orderByFields": "objectid ASC",
        "maxAllowableOffset": None,
        "allTouched": False,
    }
    atomic_write_json(
        tmp_path / "download-manifest.json",
        {
            "format": "mec-2024-arcgis-pages-v1",
            "pageSize": 2,
            "featureCount": 4,
            "query": query,
            "pages": [
                {
                    "index": 0,
                    "path": "pages/page-000000.geojson",
                    "count": 2,
                    "firstOid": 1,
                    "lastOid": 2,
                    "oidSha256": sha256_bytes(canonical_json_bytes(first_oids)),
                    "sha256": sha256_file(parent_path),
                }
            ],
        },
    )
    original_sha256 = sha256_file(parent_path)
    calls: list[tuple[int, ...]] = []

    def transport(url, parameters, method):
        requested = tuple(int(value) for value in parameters["objectIds"].split(","))
        calls.append(requested)
        if requested == (3, 4):
            raise ArcGISError("response too large")
        return _page_response(requested)

    manifest = download_pages(
        ArcGISClient(
            transport=transport,
            retry_policy=RetryPolicy(attempts=1),
        ),
        oids=[1, 2, 3, 4],
        cache_dir=tmp_path,
        page_size=2,
    )

    assert calls == [(3, 4), (3,), (4,)]
    assert sha256_file(parent_path) == original_sha256
    assert manifest["pages"][0]["path"] == "pages/page-000000.geojson"
    assert [leaf["count"] for leaf in manifest["pages"]] == [2, 1, 1]

    def unexpected_transport(url, parameters, method):
        raise AssertionError(
            "Validated leaves should survive a page-size setting change"
        )

    resumed = download_pages(
        ArcGISClient(transport=unexpected_transport),
        oids=[1, 2, 3, 4],
        cache_dir=tmp_path,
        page_size=1,
    )
    assert [leaf["count"] for leaf in resumed["pages"]] == [2, 1, 1]


def test_oid_fetch_orders_ids_and_transport_retries(tmp_path):
    attempts = 0
    sleeps: list[float] = []

    def transport(url, parameters, method):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ArcGISError("temporary")
        return {"objectIdFieldName": "objectid", "objectIds": [7, 2, 4]}

    client = ArcGISClient(
        transport=transport,
        retry_policy=RetryPolicy(
            attempts=2,
            initial_backoff_seconds=0.25,
            max_backoff_seconds=1,
        ),
        sleep=sleeps.append,
    )

    assert fetch_ordered_oids(client, tmp_path) == [2, 4, 7]
    assert attempts == 2
    assert sleeps == [0.25]


def _metadata_transport(item_response, calls):
    fields = [
        {"name": "objectid", "type": "esriFieldTypeOID"},
        {"name": "tipo_ecos", "type": "esriFieldTypeString"},
        {"name": "gran_bioma", "type": "esriFieldTypeString"},
        {"name": "bioma_iavh", "type": "esriFieldTypeString"},
        {"name": "ecos_sintesis", "type": "esriFieldTypeString"},
        {"name": "ecos_general", "type": "esriFieldTypeString"},
        {"name": "area_ha", "type": "esriFieldTypeDouble"},
    ]

    def transport(url, parameters, method):
        calls.append((url, method))
        if url == LAYER_URL:
            return {
                "id": 1,
                "serviceItemId": "enterprise-service-item",
                "fields": fields,
                "extent": {"spatialReference": {"wkid": 4686}},
            }
        if url == QUERY_URL:
            return {"count": 460_350}
        if url == ITEM_URL:
            return item_response
        raise AssertionError(f"Unexpected URL: {url}")

    return transport


def test_item_metadata_enrichment_is_recorded_when_available(tmp_path):
    calls = []
    client = ArcGISClient(
        transport=_metadata_transport(
            {
                "id": "46caafee6f5e4c36ab52bd7b2b2f8629",
                "owner": "SIA_IDEAM",
                "modified": 1_700_000_000_000,
            },
            calls,
        )
    )

    metadata = fetch_metadata(client, tmp_path)

    assert metadata["item"]["owner"] == "SIA_IDEAM"
    assert metadata["itemMetadataEnrichment"] == {
        "attempted": True,
        "required": False,
        "status": "available",
        "itemId": "46caafee6f5e4c36ab52bd7b2b2f8629",
        "url": ITEM_URL,
        "error": None,
    }
    assert load_json(tmp_path / "metadata.json") == metadata


def test_unavailable_item_metadata_is_nonfatal_and_structured_by_default(tmp_path):
    calls = []
    client = ArcGISClient(
        transport=_metadata_transport(
            {
                "error": {
                    "code": 400,
                    "messageCode": "CONT_0001",
                    "message": "Item does not exist or is inaccessible.",
                    "details": [],
                }
            },
            calls,
        )
    )

    metadata = fetch_metadata(client, tmp_path)

    assert metadata["layer"]["serviceItemId"] == "enterprise-service-item"
    assert metadata["featureCount"] == 460_350
    assert metadata["item"] is None
    assert metadata["itemMetadataEnrichment"]["status"] == "unavailable"
    assert metadata["itemMetadataEnrichment"]["error"] == {
        "code": "CONT_0001",
        "message": "Item does not exist or is inaccessible.",
        "details": [],
        "transient": False,
    }


def test_strict_item_metadata_preserves_failure_behavior(tmp_path):
    calls = []
    client = ArcGISClient(
        transport=_metadata_transport(
            {
                "error": {
                    "code": "CONT_0001",
                    "message": "Item does not exist or is inaccessible.",
                }
            },
            calls,
        )
    )

    with pytest.raises(ArcGISResponseError) as error:
        fetch_metadata(client, tmp_path, strict_item_metadata=True)

    assert error.value.code == "CONT_0001"
    assert not (tmp_path / "metadata.json").exists()


def test_cont_0001_response_is_not_retried():
    attempts = 0
    sleeps = []

    def transport(url, parameters, method):
        nonlocal attempts
        attempts += 1
        return {
            "error": {
                "code": 400,
                "messageCode": "CONT_0001",
                "message": "Item does not exist or is inaccessible.",
            }
        }

    client = ArcGISClient(
        transport=transport,
        retry_policy=RetryPolicy(attempts=5),
        sleep=sleeps.append,
    )

    with pytest.raises(ArcGISResponseError) as error:
        client.request_json(ITEM_URL, {"f": "json"}, method="GET")

    assert error.value.is_transient is False
    assert attempts == 1
    assert sleeps == []


def test_download_rejects_missing_or_duplicate_page_oids(tmp_path):
    def transport(url, parameters, method):
        return {
            "type": "FeatureCollection",
            "features": [
                _feature(1, _polygon(0, 0, 1, 1)),
                _feature(1, _polygon(1, 0, 2, 1)),
            ],
        }

    with pytest.raises(ArcGISError, match="unexpected OIDs"):
        download_pages(
            ArcGISClient(transport=transport),
            oids=[1, 2],
            cache_dir=tmp_path,
            page_size=2,
        )


def test_catalog_uses_utf8_order_and_preserves_exact_unicode(tmp_path):
    categories = {
        _category("Árbol"),
        _category("Zorro"),
        _category("Ébano"),
    }

    rows, details = build_catalog(categories)
    path = tmp_path / "crosswalk.csv"
    write_crosswalk(path, rows)
    loaded = load_crosswalk(path)

    assert [row.category[0] for row in rows] == ["Zorro", "Árbol", "Ébano"]
    assert loaded == rows
    assert "Árbol" in path.read_text(encoding="utf-8")
    assert details["priorCrosswalkUsed"] is False


def test_catalog_preserves_prior_ids_and_only_appends(tmp_path):
    prior = [
        CatalogRow(4, _category("Anterior")),
        CatalogRow(9, _category("Persistente", "Zonobioma de prueba")),
    ]
    prior_path = tmp_path / "prior.csv"
    write_crosswalk(prior_path, prior)

    rows, details = build_catalog(
        [prior[0].category, _category("Nueva")],
        prior_crosswalk=prior_path,
    )

    assert [(row.raster_value, row.category[0]) for row in rows] == [
        (4, "Anterior"),
        (9, "Persistente"),
        (10, "Nueva"),
    ]
    assert details["priorRowCount"] == 2
    assert details["newRowCount"] == 1


@pytest.mark.parametrize(
    "label,expected",
    [
        ("Orobioma Andino", "Orobioma"),
        ("Zonobioma húmedo", "Zonobioma"),
        ("Hidrobioma amazónico", "Hidrobioma"),
        ("Helobioma costero", "Helobioma"),
        ("Peinobioma seco", "Peinobioma"),
        ("Litobioma rocoso", "Litobioma"),
        ("Halobioma salino", "Halobioma"),
    ],
)
def test_biome_family_rollup_uses_established_prefixes(label, expected):
    assert biome_family_for_label(label) == expected


@pytest.mark.parametrize("label", ["N.A.", " N.A.", "N.A. ", "\tN.A.\n"])
def test_biome_family_rollup_maps_trimmed_na_sentinel(label):
    assert biome_family_for_label(label) == OTHER_BIOME_FAMILY
    assert OTHER_BIOME_FAMILY == "Other/N.A."
    assert len(BIOME_FAMILIES) == 8


def test_crosswalk_emits_canonical_other_na_family(tmp_path):
    row = CatalogRow(1, _category("Sin clasificación", " \tN.A.\n"))
    path = tmp_path / "na-crosswalk.csv"

    write_crosswalk(path, [row])
    loaded = load_crosswalk(path)

    assert loaded == [row]
    assert "Other/N.A." in path.read_text(encoding="utf-8")


def test_biome_family_rollup_fails_on_unknown_prefix():
    with pytest.raises(ValidationError, match="Unknown biome-family prefix"):
        biome_family_for_label("Bioma no reconocido")


def test_biome_family_rollup_does_not_treat_whitespace_as_na():
    with pytest.raises(ValidationError, match="exact N.A. sentinel"):
        biome_family_for_label(" \t\n")


def test_geometry_validation_handles_holes_and_multipart():
    polygon_with_hole = _polygon(0, 0, 2, 2)
    polygon_with_hole["coordinates"].append(
        [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2], [0.1, 0.1]]
    )
    multipart = {
        "type": "MultiPolygon",
        "coordinates": [
            polygon_with_hole["coordinates"],
            _polygon(3, 0, 4, 1)["coordinates"],
        ],
    }

    assert validate_geometry(polygon_with_hole, oid=1) == (1, 1)
    assert validate_geometry(multipart, oid=2) == (2, 1)


def test_grid_fingerprint_is_loaded_from_validation_raster(tmp_path):
    raster = tmp_path / "validation.tif"
    _write_validation_raster(raster, np.array([[1, 2], [3, 4]], dtype=np.uint16))

    fingerprint = load_grid_fingerprint(raster, require_planning_grid=False)

    assert (fingerprint.width, fingerprint.height) == (2, 2)
    assert fingerprint.transform == (1.0, 0.0, 0.0, 0.0, -1.0, 2.0)
    assert fingerprint.crs == "EPSG:4326"
    assert len(fingerprint.validation_raster_sha256) == 64
    assert len(fingerprint.sha256) == 64


def test_rasterization_preserves_holes_multipart_and_reports_land_gaps(tmp_path):
    validation = tmp_path / "validation.tif"
    _write_validation_raster(
        validation,
        np.array([[1, 2, 1], [1, 2, 1]], dtype=np.uint16),
    )
    validation_crosswalk = tmp_path / "validation.csv"
    validation_crosswalk.write_text(
        "biome_id,biome\n1,Orobioma de prueba\n2,Zonobioma de prueba\n",
        encoding="utf-8",
    )
    category_a = _category("Bosque")
    category_b = _category("Sabana", "Zonobioma de prueba")
    rows = [CatalogRow(1, category_a), CatalogRow(2, category_b)]
    polygon_with_hole = _polygon(2, 0, 3, 2)
    polygon_with_hole["coordinates"].append(
        [[2.05, 0.05], [2.2, 0.05], [2.2, 0.2], [2.05, 0.2], [2.05, 0.05]]
    )
    multipart = {
        "type": "MultiPolygon",
        "coordinates": [
            _polygon(1, 1, 2, 2)["coordinates"],
            _polygon(1, 0, 2, 1)["coordinates"],
        ],
    }
    page = tmp_path / "page.geojson"
    _write_page(
        page,
        [
            _feature(1, _polygon(0, 1, 1, 2), category=category_a),
            _feature(2, multipart, category=category_b),
            _feature(3, polygon_with_hole, category=category_a),
        ],
    )
    output = tmp_path / "output"

    diagnostics = rasterize_mec(
        page_paths=[page],
        rows=rows,
        validation_raster=validation,
        validation_crosswalk=validation_crosswalk,
        output_dir=output,
        require_planning_grid=False,
    )

    with rasterio.open(output / COMPOSITE_FILENAME) as dataset:
        values = dataset.read(1)
        assert dataset.dtypes == ("uint16",)
        assert dataset.nodata == 0
    assert values.tolist() == [[1, 2, 1], [0, 2, 1]]
    assert diagnostics["overlapCells"] == 0
    assert diagnostics["landGapCells"] == 1
    assert diagnostics["multipartFeatures"] == 1
    assert diagnostics["holes"] == 1
    assert diagnostics["validationComparison"]["classMismatchCells"] == 0


def test_rasterization_fails_on_overlapping_center_claims(tmp_path):
    validation = tmp_path / "validation.tif"
    _write_validation_raster(validation, np.ones((1, 1), dtype=np.uint16))
    validation_crosswalk = tmp_path / "validation.csv"
    validation_crosswalk.write_text(
        "biome_id,biome\n1,Orobioma de prueba\n",
        encoding="utf-8",
    )
    category = _category("Bosque")
    page = tmp_path / "overlap.geojson"
    _write_page(
        page,
        [
            _feature(1, _polygon(0, 0, 1, 1), category=category),
            _feature(2, _polygon(0, 0, 1, 1), category=category),
        ],
    )
    output = tmp_path / "output"

    with pytest.raises(RasterizationError, match="overlapping polygon center claims"):
        rasterize_mec(
            page_paths=[page],
            rows=[CatalogRow(1, category)],
            validation_raster=validation,
            validation_crosswalk=validation_crosswalk,
            output_dir=output,
            require_planning_grid=False,
        )

    assert not (output / COMPOSITE_FILENAME).exists()
    diagnostics = load_json(output / "rasterization-diagnostics.json")
    assert diagnostics["overlapCells"] == 1
    assert diagnostics["maximumCenterClaims"] == 2


def test_provenance_is_deterministic_for_fixed_inputs():
    metadata = {
        "featureCount": 3,
        "schemaSha256": "schema",
        "layer": {
            "id": 1,
            "serviceItemId": "service",
            "currentVersion": 11.2,
            "fields": [{"name": "objectid"}],
            "editingInfo": {"lastEditDate": 1_700_000_000_000},
        },
        "item": None,
        "itemMetadataEnrichment": {
            "attempted": True,
            "required": False,
            "status": "unavailable",
            "itemId": "46caafee6f5e4c36ab52bd7b2b2f8629",
            "url": ITEM_URL,
            "error": {
                "code": "CONT_0001",
                "message": "Item does not exist or is inaccessible.",
                "details": [],
                "transient": False,
            },
        },
    }
    oid_manifest = {"count": 3, "oidsSha256": "oids"}
    download_manifest = {
        "pageSize": 3,
        "query": {"maxAllowableOffset": None},
        "pages": [{"index": 0, "sha256": "page"}],
    }
    validation_report = {
        "crosswalkSignature": "signature",
        "crosswalkSha256": "crosswalk",
        "rowCount": 2,
        "biomeFamilyCount": 8,
        "biomeFamilies": list(BIOME_FAMILIES),
        "expectedBiomeFamilyCount": 8,
        "canonicalBiomeFamilies": list(BIOME_FAMILIES),
        "priorCrosswalkUsed": False,
    }
    raster_diagnostics = {
        "grid": {"width": 3, "height": 2},
        "gridFingerprintSha256": "grid",
        "rasterization": {"allTouched": False},
        "overlapCells": 0,
        "landGapCells": 1,
    }
    arguments = {
        "metadata": metadata,
        "oid_manifest": oid_manifest,
        "download_manifest": download_manifest,
        "validation_report": validation_report,
        "raster_diagnostics": raster_diagnostics,
        "outputs": {"crosswalk": {"sha256": "crosswalk"}},
        "generated_at": "2026-07-23T20:00:00Z",
    }

    first = build_provenance(**arguments)
    second = build_provenance(**arguments)

    assert first == second
    assert canonical_json_bytes(first) == canonical_json_bytes(second)
    assert first["source"]["license"]["itemLevelLicense"] == "unspecified"
    assert first["source"]["itemMetadataEnrichment"]["status"] == "unavailable"
    assert first["source"]["itemMetadataEnrichment"]["error"]["code"] == "CONT_0001"
    assert first["catalog"]["biomeFamilies"][-1] == "Other/N.A."
    assert first["catalog"]["expectedBiomeFamilyCount"] == 8
    assert first["catalog"]["tupleFields"][0] == "tipo_ecos"


def test_output_checksums_use_portable_filenames_without_local_paths(tmp_path):
    output_dir = tmp_path / "workstation" / "repository" / "output"
    output_dir.mkdir(parents=True)
    raster = output_dir / "ecosistemas_IDEAM_MEC_2024.tif"
    raster.write_bytes(b"portable MEC fixture")

    outputs = output_checksums({"compositeRaster": raster})

    assert outputs["compositeRaster"]["path"] == raster.name
    assert outputs["compositeRaster"]["bytes"] == raster.stat().st_size
    assert outputs["compositeRaster"]["sha256"] == sha256_file(raster)
    assert str(tmp_path) not in json.dumps(outputs)
