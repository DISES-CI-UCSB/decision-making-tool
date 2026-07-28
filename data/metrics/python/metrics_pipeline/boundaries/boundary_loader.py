"""Load version-pinned AOI boundary snapshots for metric calculation.

Every source is the same public GeoJSON used by the map identify flow. Source
bytes, CRS, fields, catalog, feature count, and representative geometries are
validated before any boundary can enter the metrics pipeline. A stale or
unexpected source therefore fails closed instead of being name-matched to a
different geometry provider.
"""

from __future__ import annotations

import json
import hashlib
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import rasterio.features
from rasterio.crs import CRS

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"


class BoundaryLoadError(RuntimeError):
    pass


@dataclass(frozen=True)
class BoundarySourceSpec:
    geo_level: str
    url: str
    cache_filename: str
    expected_sha256: str
    expected_crs: str
    id_field: str
    name_field: str
    expected_feature_count: int
    expected_catalog_sha256: str
    expected_geometry_collection_sha256: str
    feature_behavior: str
    required_fields: tuple[str, ...] = ()
    representative_geometry_sha256: tuple[tuple[str, str], ...] = ()
    allowed_geometry_types: tuple[str, ...] = ()


@dataclass(frozen=True)
class BoundarySourceMetadata:
    """Validated provenance shared by every feature from one source."""

    url: str
    sha256: str
    crs: str
    feature_count: int
    id_field: str
    name_field: str
    catalog_sha256: str
    geometry_collection_sha256: str
    feature_behavior: str


@dataclass(frozen=True)
class BoundaryFeature:
    boundary_id: str
    name: str
    geo_level: str
    geometry: dict
    properties: dict
    source_crs: str = "EPSG:4326"
    source_metadata: BoundarySourceMetadata | None = None
    geometry_sha256: str | None = None

    @property
    def source_sha256(self) -> str:
        return self.source_metadata.sha256 if self.source_metadata else ""


EXPECTED_DEPARTMENT_CATALOG: tuple[tuple[str, str], ...] = (
    ("00", "Area en Litigio Cauca - Huila"),
    ("05", "Antioquia"),
    ("08", "Atlántico"),
    ("13", "Bolívar"),
    ("15", "Boyacá"),
    ("17", "Caldas"),
    ("18", "Caquetá"),
    ("19", "Cauca"),
    ("20", "Cesar"),
    ("23", "Córdoba"),
    ("25", "Cundinamarca"),
    ("27", "Chocó"),
    ("41", "Huila"),
    ("44", "La Guajira"),
    ("47", "Magdalena"),
    ("50", "Meta"),
    ("52", "Nariño"),
    ("54", "Norte de Santander"),
    ("63", "Quindío"),
    ("66", "Risaralda"),
    ("68", "Santander"),
    ("70", "Sucre"),
    ("73", "Tolima"),
    ("76", "Valle del Cauca"),
    ("81", "Arauca"),
    ("85", "Casanare"),
    ("86", "Putumayo"),
    ("88", "San Andrés Providencia y Santa Catalina"),
    ("91", "Amazonas"),
    ("94", "Guainía"),
    ("95", "Guaviare"),
    ("97", "Vaupés"),
    ("99", "Vichada"),
)

EXPECTED_SIRAP_CATALOG: tuple[tuple[str, str], ...] = (
    ("thematic_eje_cafetero_1", "Eje Cafetero"),
    ("thematic_macizo_2", "Macizo"),
    ("territorial_territorial_amazonia_3", "Territorial Amazonia"),
    (
        "territorial_territorial_andes_nororientales_4",
        "Territorial Andes Nororientales",
    ),
    (
        "territorial_territorial_andes_occidentales_5",
        "Territorial Andes Occidentales",
    ),
    ("territorial_territorial_caribe_6", "Territorial Caribe"),
    ("territorial_territorial_orinoquia_7", "Territorial Orinoquia"),
    ("territorial_territorial_pacifico_8", "Territorial Pacifico"),
    ("territorial_territorial_caribe_9", "Territorial Caribe"),
    ("territorial_territorial_pacifico_10", "Territorial Pacifico"),
)


BOUNDARY_SOURCE_SPECS: dict[str, BoundarySourceSpec] = {
    "departments": BoundarySourceSpec(
        geo_level="departments",
        url=f"{PUBLIC_BLOB_HOST}/boundaries/igac_departments_detailed.geojson",
        cache_filename="igac_departments_detailed.88304394.geojson",
        expected_sha256="88304394fdd315f7803a65730392cafe2d0defa7b73acc068ba51d1795d3ed64",
        expected_crs="EPSG:4326",
        id_field="boundary_id",
        name_field="boundary_name",
        expected_feature_count=33,
        expected_catalog_sha256="12a5a3ea5b5fdbe0e2348aa76614773fb8b428e429199ee0a655a9a7933c7ee0",
        expected_geometry_collection_sha256="d840e04d13bdecbab8fdd99cc7c9d2d73afba6a968e5d34b13291cfde991334a",
        feature_behavior="matching_frontend_identify_feature",
        required_fields=("DeCodigo", "DeNombre"),
        representative_geometry_sha256=(
            ("05", "3cdb74596ea0b15141e23eb2ad5e312470a28c76b858dd12d9db3d5a46e24a23"),
            ("50", "41d971bc07e52347ae5096d6436795c34bf97d5d112d42dae1d150f2d3948f76"),
        ),
    ),
    "municipalities": BoundarySourceSpec(
        geo_level="municipalities",
        url=f"{PUBLIC_BLOB_HOST}/boundaries/igac_municipalities_detailed.geojson",
        cache_filename="igac_municipalities_detailed.13775cad.geojson",
        expected_sha256="13775cad6853b632029597e101628b6ed1051e7adc7e983864a84aa8aac9876a",
        expected_crs="EPSG:4326",
        id_field="boundary_id",
        name_field="boundary_name",
        expected_feature_count=1105,
        expected_catalog_sha256="e175d902e48890e43299b7445c29af5eafbb0d4a5e5205a4ade0fd208ab91d3c",
        expected_geometry_collection_sha256="7c0aac724cababa2bfc69fefc4cd30eb16760fca6af4f06d235dff616b00c12d",
        feature_behavior="matching_frontend_identify_feature",
        required_fields=("MpCodigo", "MpNombre"),
        representative_geometry_sha256=(
            (
                "50001",
                "ebde28fab4da4d580ce601adcfa89508b3bc902b2c59eae04b7fe5a35a233e1b",
            ),
        ),
    ),
    "siraps": BoundarySourceSpec(
        geo_level="siraps",
        url=f"{PUBLIC_BLOB_HOST}/inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson",
        cache_filename="siraps_merged_polygon_v2.2a44a7a4.geojson",
        expected_sha256="2a44a7a4726448959432924a11703250a444fe9e06be3324563e7b89d14912de",
        expected_crs="EPSG:4326",
        id_field="sirap_id",
        name_field="sirap_name",
        expected_feature_count=10,
        expected_catalog_sha256="ded62832b2d97b3d47ff20299bf9c9399abda79a45400927b0bf4062faf73864",
        expected_geometry_collection_sha256="83d2003347811cc2aa7599abb535d029c68e8f680d136ca01a8877a7df717e8f",
        feature_behavior="whole_merged_feature_only",
        required_fields=("sirap_kind", "source_file"),
        representative_geometry_sha256=(
            (
                "territorial_territorial_amazonia_3",
                "b7927d0797463c7a35d02f38bf5c533cbd60a878b25389a607740cb7469ef2bb",
            ),
        ),
        allowed_geometry_types=("Polygon", "MultiPolygon"),
    ),
    "runaps": BoundarySourceSpec(
        geo_level="runaps",
        url=f"{PUBLIC_BLOB_HOST}/inputs/includes/runap_identify.geojson",
        cache_filename="runap_identify.b1c94022.geojson",
        expected_sha256="b1c940228b110e18b588ed2667b8d36f447c933a5f798adc024c51502c1a06a6",
        expected_crs="OGC:CRS84",
        id_field="runap_id",
        name_field="runap_name",
        expected_feature_count=1879,
        expected_catalog_sha256="ee492b9519252517a7f3589c385dda55daed31eef8b98d3ca242c1e90586c564",
        expected_geometry_collection_sha256="fa123bd47ad64c01a29dd5367680b2ab72da60324fbf554f8cc4b8366960652d",
        feature_behavior="matching_frontend_identify_feature",
        required_fields=("runap_category", "runap_status"),
        representative_geometry_sha256=(
            ("6", "0f8097533dfbb521046fcc1c12075db7f6430dafbe72a86124884fba99451223"),
        ),
    ),
    "omecs": BoundarySourceSpec(
        geo_level="omecs",
        url=f"{PUBLIC_BLOB_HOST}/inputs/includes/omecs_identify.geojson",
        cache_filename="omecs_identify.b22742c0.geojson",
        expected_sha256="b22742c079acbb09230daae68ecee09a4543765e3d4c88459f649f1e2d375b83",
        expected_crs="OGC:CRS84",
        id_field="SITE_ID",
        name_field="NAME",
        expected_feature_count=614,
        expected_catalog_sha256="34173a94279ad1b6b553ef2aefaa2cc4adba1fb298a91a1da9e9340ae2d699f5",
        expected_geometry_collection_sha256="3f516e4f4389a43afd21a11e7a11299f4c59c563eb9aa57b805667218e3fef40",
        feature_behavior="matching_frontend_identify_feature",
        required_fields=("DESIG", "STATUS", "GOV_TYPE"),
        representative_geometry_sha256=(
            (
                "555744954",
                "06d67df89ffcfdcaa4969aaea45c077bc191a03e444cd67cebd54668c8dc4b44",
            ),
        ),
    ),
}


def _http_get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(
        url, headers={"User-Agent": "dises-mec-boundaries/2.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            content_type = response.headers.get_content_type()
            if content_type not in {"application/geo+json", "application/json"}:
                raise BoundaryLoadError(
                    f"Boundary URL {url} returned unexpected content type "
                    f"{content_type!r}."
                )
            return response.read()
    except urllib.error.URLError as exc:
        raise BoundaryLoadError(
            f"Failed to download boundary source {url}: {exc}"
        ) from exc


def _geojson_source_crs(data: dict, geo_level: str) -> str:
    """Read a legacy GeoJSON CRS declaration, defaulting standard GeoJSON to WGS84."""
    declaration = data.get("crs")
    if declaration is None:
        return "EPSG:4326"

    value: Any = declaration
    if isinstance(declaration, dict):
        properties = declaration.get("properties") or {}
        if declaration.get("type") == "name":
            value = properties.get("name")
        elif declaration.get("type") == "EPSG":
            value = f"EPSG:{properties.get('code')}"

    try:
        return CRS.from_user_input(value).to_string()
    except Exception as exc:
        raise BoundaryLoadError(
            f"Invalid CRS declaration for {geo_level}: {declaration!r}"
        ) from exc


def canonical_geometry_sha256(geometry: dict) -> str:
    encoded = json.dumps(
        geometry,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def boundary_catalog_sha256(catalog: list[tuple[str, str]]) -> str:
    encoded = json.dumps(
        sorted(catalog),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def boundary_geometry_collection_sha256(
    features: list[tuple[str, str]],
) -> str:
    encoded = json.dumps(features, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _required_text(properties: dict, field: str, *, label: str) -> str:
    value = properties.get(field)
    if isinstance(value, str):
        value = value.strip()
        if value:
            return value
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    raise BoundaryLoadError(f"{label} has missing or empty required field {field!r}.")


def _require_field_present(properties: dict, field: str, *, label: str) -> None:
    if field not in properties:
        raise BoundaryLoadError(f"{label} is missing required field {field!r}.")


def _read_pinned_source(cache_path: Path, spec: BoundarySourceSpec) -> bytes:
    if cache_path.exists():
        raw = cache_path.read_bytes()
    else:
        print(f"[boundaries] downloading pinned {spec.geo_level} source…")
        raw = _http_get(spec.url)

    actual_sha256 = hashlib.sha256(raw).hexdigest()
    if actual_sha256 != spec.expected_sha256:
        location = f"cached file {cache_path}" if cache_path.exists() else spec.url
        raise BoundaryLoadError(
            f"{spec.geo_level} source checksum mismatch for {location}: "
            f"expected {spec.expected_sha256}, got {actual_sha256}."
        )

    if not cache_path.exists():
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(raw)
        print(f"[boundaries] cached pinned {spec.geo_level} → {cache_path}")
    return raw


def _validate_source_behavior(
    spec: BoundarySourceSpec,
    features: list[BoundaryFeature],
) -> None:
    if spec.feature_behavior != "whole_merged_feature_only":
        return
    for feature in features:
        if feature.properties.get("source_file") != "siraps_merged.shp":
            raise BoundaryLoadError(
                "SIRAP source contains a non-merged or partial feature: "
                f"{feature.boundary_id!r}."
            )
        if feature.properties.get("sirap_kind") not in {"territorial", "thematic"}:
            raise BoundaryLoadError(
                f"SIRAP {feature.boundary_id!r} has unexpected sirap_kind."
            )


def _load_geojson_source(
    cache_path: Path,
    spec: BoundarySourceSpec,
) -> list[BoundaryFeature]:
    raw = _read_pinned_source(cache_path, spec)
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BoundaryLoadError(
            f"{spec.geo_level} source is not valid UTF-8 GeoJSON: {exc}"
        ) from exc

    if data.get("type") != "FeatureCollection" or not isinstance(
        data.get("features"), list
    ):
        raise BoundaryLoadError(
            f"{spec.geo_level} source must be a GeoJSON FeatureCollection."
        )

    source_crs = _geojson_source_crs(data, spec.geo_level)
    if source_crs != spec.expected_crs:
        raise BoundaryLoadError(
            f"{spec.geo_level} source CRS mismatch: expected {spec.expected_crs}, "
            f"got {source_crs}."
        )

    source_features = data["features"]
    if len(source_features) != spec.expected_feature_count:
        raise BoundaryLoadError(
            f"{spec.geo_level} feature-count mismatch: expected "
            f"{spec.expected_feature_count}, got {len(source_features)}."
        )

    provisional: list[BoundaryFeature] = []
    catalog: list[tuple[str, str]] = []
    geometry_catalog: list[tuple[str, str]] = []
    seen_ids: set[str] = set()
    for index, source_feature in enumerate(source_features):
        properties = source_feature.get("properties")
        if not isinstance(properties, dict):
            raise BoundaryLoadError(
                f"{spec.geo_level} feature {index} has malformed properties."
            )
        boundary_id = _required_text(
            properties,
            spec.id_field,
            label=f"{spec.geo_level} feature {index}",
        )
        name = _required_text(
            properties,
            spec.name_field,
            label=f"{spec.geo_level} boundary {boundary_id!r}",
        )
        for field in spec.required_fields:
            _require_field_present(
                properties,
                field,
                label=f"{spec.geo_level} boundary {boundary_id!r}",
            )
        if boundary_id in seen_ids:
            raise BoundaryLoadError(
                f"{spec.geo_level} source has duplicate ID {boundary_id!r}."
            )
        seen_ids.add(boundary_id)

        geometry = source_feature.get("geometry")
        geometry_type = geometry.get("type") if isinstance(geometry, dict) else None
        if (
            spec.allowed_geometry_types
            and geometry_type not in spec.allowed_geometry_types
        ):
            raise BoundaryLoadError(
                f"{spec.geo_level} boundary {boundary_id!r} has unsupported geometry "
                f"type {geometry_type!r}; expected one of {spec.allowed_geometry_types}."
            )
        try:
            geometry_is_valid = isinstance(
                geometry, dict
            ) and rasterio.features.is_valid_geom(geometry)
        except (KeyError, TypeError, ValueError):
            geometry_is_valid = False
        if not geometry_is_valid:
            raise BoundaryLoadError(
                f"{spec.geo_level} boundary {boundary_id!r} has invalid geometry."
            )
        geometry_sha256 = canonical_geometry_sha256(geometry)
        catalog.append((boundary_id, name))
        geometry_catalog.append((boundary_id, geometry_sha256))
        provisional.append(
            BoundaryFeature(
                boundary_id=boundary_id,
                name=name,
                geo_level=spec.geo_level,
                geometry=geometry,
                properties=dict(properties),
                source_crs=source_crs,
                geometry_sha256=geometry_sha256,
            )
        )

    catalog_sha256 = boundary_catalog_sha256(catalog)
    if catalog_sha256 != spec.expected_catalog_sha256:
        raise BoundaryLoadError(
            f"{spec.geo_level} catalog mismatch: expected "
            f"{spec.expected_catalog_sha256}, got {catalog_sha256}."
        )
    geometry_collection_sha256 = boundary_geometry_collection_sha256(geometry_catalog)
    if geometry_collection_sha256 != spec.expected_geometry_collection_sha256:
        raise BoundaryLoadError(
            f"{spec.geo_level} geometry collection mismatch: expected "
            f"{spec.expected_geometry_collection_sha256}, got "
            f"{geometry_collection_sha256}."
        )

    features_by_id = {feature.boundary_id: feature for feature in provisional}
    for boundary_id, expected_hash in spec.representative_geometry_sha256:
        representative = features_by_id.get(boundary_id)
        if representative is None:
            raise BoundaryLoadError(
                f"{spec.geo_level} representative ID {boundary_id!r} is missing."
            )
        if representative.geometry_sha256 != expected_hash:
            raise BoundaryLoadError(
                f"{spec.geo_level} representative geometry mismatch for "
                f"{boundary_id!r}."
            )

    metadata = BoundarySourceMetadata(
        url=spec.url,
        sha256=spec.expected_sha256,
        crs=source_crs,
        feature_count=len(provisional),
        id_field=spec.id_field,
        name_field=spec.name_field,
        catalog_sha256=catalog_sha256,
        geometry_collection_sha256=geometry_collection_sha256,
        feature_behavior=spec.feature_behavior,
    )
    result = [
        BoundaryFeature(
            boundary_id=feature.boundary_id,
            name=feature.name,
            geo_level=feature.geo_level,
            geometry=feature.geometry,
            properties=feature.properties,
            source_crs=feature.source_crs,
            source_metadata=metadata,
            geometry_sha256=feature.geometry_sha256,
        )
        for feature in provisional
    ]
    _validate_source_behavior(spec, result)
    return result


def load_all_boundaries(
    cache_dir: Path,
) -> tuple[dict[str, list[BoundaryFeature]], dict[str, str]]:
    """Load independently validated, version-pinned boundary collections.

    Each level is attempted independently — a failed download for one level
    does not prevent the others from loading.

    Returns:
        (boundaries_by_level, errors_by_level) — errors_by_level maps level name
        to an error message for any level that failed to load.
    """
    bdir = cache_dir / "boundaries"

    result: dict[str, list[BoundaryFeature]] = {}
    errors: dict[str, str] = {}
    for level_name, spec in BOUNDARY_SOURCE_SPECS.items():
        try:
            result[level_name] = _load_geojson_source(
                bdir / spec.cache_filename,
                spec,
            )
        except BoundaryLoadError as exc:
            errors[level_name] = str(exc)
    return result, errors
