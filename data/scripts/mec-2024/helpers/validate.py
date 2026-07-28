"""Schema, geometry, and stable MEC category catalog validation."""

from __future__ import annotations

import csv
import hashlib
import math
import os
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from arcgis import (
    OID_FIELD,
    REQUIRED_FIELDS,
    atomic_write_json,
    canonical_json_bytes,
    load_json,
)

CATEGORY_FIELDS = (
    "tipo_ecos",
    "gran_bioma",
    "bioma_iavh",
    "ecos_sintesis",
    "ecos_general",
)
CROSSWALK_COLUMNS = (
    "rasterValue",
    "tipoEcosistema",
    "biomeFamily",
    "broadBiomeContext",
    "biomeRegion",
    "broadEcosystem",
    "detailedEcosystem",
)
BIOME_FAMILY_PREFIXES = (
    "Orobioma",
    "Zonobioma",
    "Hidrobioma",
    "Helobioma",
    "Peinobioma",
    "Litobioma",
    "Halobioma",
)
OTHER_BIOME_FAMILY = "Other/N.A."
BIOME_FAMILIES = (*BIOME_FAMILY_PREFIXES, OTHER_BIOME_FAMILY)
MAX_RASTER_VALUE = 65_535

CategoryTuple = tuple[str, str, str, str, str]


class ValidationError(ValueError):
    """Raised when source data cannot safely produce the MEC raster."""


@dataclass(frozen=True)
class CatalogRow:
    raster_value: int
    category: CategoryTuple

    @property
    def biome_family(self) -> str:
        return biome_family_for_label(self.category[2])

    def as_csv_row(self) -> dict[str, str | int]:
        tipo, broad_context, biome_region, broad_ecosystem, detailed = self.category
        return {
            "rasterValue": self.raster_value,
            "tipoEcosistema": tipo,
            "biomeFamily": self.biome_family,
            "broadBiomeContext": broad_context,
            "biomeRegion": biome_region,
            "broadEcosystem": broad_ecosystem,
            "detailedEcosystem": detailed,
        }


def biome_family_for_label(label: str) -> str:
    """Apply the established family rule without hiding unknown source labels."""

    for prefix in BIOME_FAMILY_PREFIXES:
        if label.startswith(prefix):
            return prefix
    if label.strip() == "N.A.":
        return OTHER_BIOME_FAMILY
    raise ValidationError(
        f"Unknown biome-family prefix in bioma_iavh label {label!r}; "
        f"expected one of {BIOME_FAMILY_PREFIXES} or the exact N.A. sentinel."
    )


def _category_sort_key(category: CategoryTuple) -> tuple[bytes, ...]:
    return tuple(value.encode("utf-8") for value in category)


def _require_label(properties: Mapping[str, Any], field: str, oid: int) -> str:
    value = properties.get(field)
    if not isinstance(value, str) or not value:
        raise ValidationError(
            f"Feature objectid={oid} has an empty or non-string {field!r} value."
        )
    return value


def category_from_properties(properties: Mapping[str, Any]) -> CategoryTuple:
    try:
        oid = int(properties[OID_FIELD])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValidationError("Feature has no valid objectid.") from exc
    return tuple(_require_label(properties, field, oid) for field in CATEGORY_FIELDS)  # type: ignore[return-value]


def _validate_ring(ring: Any, *, oid: int) -> None:
    if not isinstance(ring, list) or len(ring) < 4:
        raise ValidationError(
            f"Feature objectid={oid} has a polygon ring with fewer than 4 positions."
        )
    for position in ring:
        if (
            not isinstance(position, list)
            or len(position) < 2
            or not all(
                isinstance(coordinate, (int, float)) and math.isfinite(coordinate)
                for coordinate in position[:2]
            )
        ):
            raise ValidationError(
                f"Feature objectid={oid} has invalid polygon coordinates."
            )
    if ring[0][:2] != ring[-1][:2]:
        raise ValidationError(f"Feature objectid={oid} has an unclosed polygon ring.")


def validate_geometry(geometry: Any, *, oid: int) -> tuple[int, int]:
    """Validate Polygon/MultiPolygon structure and report part/hole counts."""

    if not isinstance(geometry, dict):
        raise ValidationError(f"Feature objectid={oid} has no geometry.")
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon":
        polygons = [coordinates]
    elif geometry_type == "MultiPolygon":
        polygons = coordinates
    else:
        raise ValidationError(
            f"Feature objectid={oid} has unsupported geometry type {geometry_type!r}."
        )
    if not isinstance(polygons, list) or not polygons:
        raise ValidationError(f"Feature objectid={oid} has empty polygon coordinates.")
    hole_count = 0
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            raise ValidationError(f"Feature objectid={oid} has an empty polygon part.")
        for ring in polygon:
            _validate_ring(ring, oid=oid)
        hole_count += len(polygon) - 1

    try:
        from rasterio.features import is_valid_geom
    except ImportError as exc:
        raise ValidationError(
            "rasterio is required for source geometry validation."
        ) from exc
    if not is_valid_geom(geometry):
        raise ValidationError(
            f"Feature objectid={oid} fails rasterio geometry validation."
        )
    return len(polygons), hole_count


def iter_features(page_paths: Iterable[Path]) -> Iterator[dict[str, Any]]:
    for path in page_paths:
        page = load_json(path)
        features = page.get("features")
        if not isinstance(features, list):
            raise ValidationError(f"{path} has no features array.")
        for feature in features:
            if not isinstance(feature, dict):
                raise ValidationError(f"{path} contains a non-object feature.")
            yield feature


def validate_source_metadata(metadata: Mapping[str, Any]) -> None:
    layer = metadata.get("layer")
    if not isinstance(layer, dict):
        raise ValidationError("Cached source metadata has no layer object.")
    fields = layer.get("fields")
    if not isinstance(fields, list):
        raise ValidationError("Layer metadata has no fields array.")
    available = {
        str(field.get("name", "")).casefold()
        for field in fields
        if isinstance(field, dict)
    }
    missing = sorted(set(REQUIRED_FIELDS) - available)
    if missing:
        raise ValidationError(f"Layer schema is missing required fields: {missing}")

    spatial_reference = (layer.get("extent") or {}).get("spatialReference") or {}
    wkid = spatial_reference.get("latestWkid", spatial_reference.get("wkid"))
    if int(wkid) != 4686:
        raise ValidationError(
            f"Expected the authoritative source CRS EPSG:4686, received {wkid!r}."
        )


def validate_features(
    page_paths: Iterable[Path],
    *,
    expected_source_count: int | None,
    expected_category_count: int | None,
    expected_biome_family_count: int | None,
) -> tuple[set[CategoryTuple], dict[str, Any]]:
    """Validate every feature and return its exact category set and diagnostics."""

    seen_oids: set[int] = set()
    categories: set[CategoryTuple] = set()
    biome_families: set[str] = set()
    part_count = 0
    multipart_count = 0
    hole_count = 0
    feature_count = 0

    for feature in iter_features(page_paths):
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            raise ValidationError("Feature properties must be an object.")
        missing = [field for field in REQUIRED_FIELDS if field not in properties]
        if missing:
            raise ValidationError(f"Feature is missing required fields: {missing}")
        try:
            oid = int(properties[OID_FIELD])
        except (TypeError, ValueError) as exc:
            raise ValidationError("Feature objectid must be an integer.") from exc
        if oid in seen_oids:
            raise ValidationError(f"Duplicate feature objectid={oid}.")
        seen_oids.add(oid)

        category = category_from_properties(properties)
        biome_families.add(biome_family_for_label(category[2]))
        categories.add(category)
        try:
            area_ha = float(properties["area_ha"])
        except (TypeError, ValueError) as exc:
            raise ValidationError(
                f"Feature objectid={oid} has a nonnumeric area_ha."
            ) from exc
        if not math.isfinite(area_ha) or area_ha <= 0:
            raise ValidationError(
                f"Feature objectid={oid} must have a positive finite area_ha."
            )

        feature_parts, feature_holes = validate_geometry(
            feature.get("geometry"),
            oid=oid,
        )
        part_count += feature_parts
        multipart_count += int(feature_parts > 1)
        hole_count += feature_holes
        feature_count += 1

    if expected_source_count is not None and feature_count != expected_source_count:
        raise ValidationError(
            f"Expected {expected_source_count:,} source features, found "
            f"{feature_count:,}."
        )
    if (
        expected_category_count is not None
        and len(categories) != expected_category_count
    ):
        raise ValidationError(
            f"Expected {expected_category_count:,} categories, found "
            f"{len(categories):,}."
        )
    if (
        expected_biome_family_count is not None
        and len(biome_families) != expected_biome_family_count
    ):
        raise ValidationError(
            f"Expected {expected_biome_family_count:,} biome families, found "
            f"{len(biome_families):,}: "
            f"{[family for family in BIOME_FAMILIES if family in biome_families]}."
        )

    diagnostics = {
        "featureCount": feature_count,
        "uniqueOidCount": len(seen_oids),
        "categoryCount": len(categories),
        "biomeFamilyCount": len(biome_families),
        "biomeFamilies": [
            family for family in BIOME_FAMILIES if family in biome_families
        ],
        "polygonPartCount": part_count,
        "multipartFeatureCount": multipart_count,
        "holeCount": hole_count,
        "minimumOid": min(seen_oids) if seen_oids else None,
        "maximumOid": max(seen_oids) if seen_oids else None,
    }
    return categories, diagnostics


def load_crosswalk(path: Path) -> list[CatalogRow]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            missing = set(CROSSWALK_COLUMNS) - set(reader.fieldnames or ())
            if missing:
                raise ValidationError(
                    f"Prior crosswalk {path} is missing columns: {sorted(missing)}"
                )
            rows = []
            for raw in reader:
                category = (
                    raw["tipoEcosistema"],
                    raw["broadBiomeContext"],
                    raw["biomeRegion"],
                    raw["broadEcosystem"],
                    raw["detailedEcosystem"],
                )
                row = CatalogRow(int(raw["rasterValue"]), category)
                if raw["biomeFamily"] != row.biome_family:
                    raise ValidationError(
                        f"Prior crosswalk row {row.raster_value} has an inconsistent "
                        "biomeFamily."
                    )
                rows.append(row)
    except (OSError, csv.Error, KeyError, ValueError) as exc:
        if isinstance(exc, ValidationError):
            raise
        raise ValidationError(f"Could not parse prior crosswalk {path}: {exc}") from exc

    ids = [row.raster_value for row in rows]
    categories = [row.category for row in rows]
    if len(ids) != len(set(ids)) or len(categories) != len(set(categories)):
        raise ValidationError(
            "Prior crosswalk contains duplicate IDs or category tuples."
        )
    if any(value < 1 or value > MAX_RASTER_VALUE for value in ids):
        raise ValidationError(
            "Prior crosswalk rasterValue must fit UInt16 and exclude 0."
        )
    return sorted(rows, key=lambda row: row.raster_value)


def build_catalog(
    categories: Iterable[CategoryTuple],
    *,
    prior_crosswalk: Path | None = None,
) -> tuple[list[CatalogRow], dict[str, Any]]:
    """Preserve old IDs and append new UTF-8 tuple-sorted categories."""

    prior_rows = load_crosswalk(prior_crosswalk) if prior_crosswalk else []
    by_category = {row.category: row for row in prior_rows}
    new_categories = sorted(
        set(categories) - set(by_category),
        key=_category_sort_key,
    )
    next_id = max((row.raster_value for row in prior_rows), default=0) + 1
    if next_id + len(new_categories) - 1 > MAX_RASTER_VALUE:
        raise ValidationError("MEC category IDs exceed the UInt16 range.")
    appended = [
        CatalogRow(next_id + index, category)
        for index, category in enumerate(new_categories)
    ]
    rows = sorted([*prior_rows, *appended], key=lambda row: row.raster_value)
    details = {
        "priorCrosswalk": str(prior_crosswalk) if prior_crosswalk else None,
        "priorRowCount": len(prior_rows),
        "newRowCount": len(appended),
        "rowCount": len(rows),
        "priorCrosswalkUsed": prior_crosswalk is not None,
    }
    return rows, details


def write_crosswalk(path: Path, rows: Iterable[CatalogRow]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=CROSSWALK_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.as_csv_row())
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def catalog_signature(rows: Iterable[CatalogRow]) -> str:
    payload = [
        {
            "rasterValue": row.raster_value,
            "category": list(row.category),
            "biomeFamily": row.biome_family,
        }
        for row in rows
    ]
    return hashlib.sha256(canonical_json_bytes(payload)).hexdigest()


def validate_and_catalog(
    *,
    metadata_path: Path,
    page_paths: list[Path],
    output_dir: Path,
    prior_crosswalk: Path | None,
    expected_source_count: int | None,
    expected_category_count: int | None,
    expected_biome_family_count: int | None,
) -> tuple[list[CatalogRow], dict[str, Any]]:
    metadata = load_json(metadata_path)
    validate_source_metadata(metadata)
    metadata_count = int(metadata["featureCount"])
    if expected_source_count is not None and metadata_count != expected_source_count:
        raise ValidationError(
            f"Source metadata count is {metadata_count:,}, expected "
            f"{expected_source_count:,}."
        )
    categories, diagnostics = validate_features(
        page_paths,
        expected_source_count=metadata_count,
        expected_category_count=expected_category_count,
        expected_biome_family_count=expected_biome_family_count,
    )
    rows, catalog_details = build_catalog(
        categories,
        prior_crosswalk=prior_crosswalk,
    )
    crosswalk_path = output_dir / "ecosistemas_IDs_IDEAM_MEC_2024.csv"
    crosswalk_sha256 = write_crosswalk(crosswalk_path, rows)
    report = {
        **diagnostics,
        **catalog_details,
        "expectedSourceCount": expected_source_count,
        "expectedCategoryCount": expected_category_count,
        "expectedBiomeFamilyCount": expected_biome_family_count,
        "canonicalBiomeFamilies": list(BIOME_FAMILIES),
        "crosswalk": str(crosswalk_path),
        "crosswalkSha256": crosswalk_sha256,
        "crosswalkSignature": catalog_signature(rows),
    }
    atomic_write_json(output_dir / "validation-catalog.json", report)
    return rows, report
