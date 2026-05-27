"""Download and cache administrative boundary GeoJSON for metric calculation.

Supported geography levels:
- departments:    Colombia departments from GADM 4.1 (gadm41_COL_1.json)
- municipalities: Colombia municipalities from GADM 4.1 (gadm41_COL_2.json)
- siraps:         Colombia SIRAPs from Vercel Blob (siraps_merged.geojson)
- runaps:         Individual RUNAP protected areas (Vercel runap_identify.geojson)
- omecs:          Individual OMEC polygons (Vercel omecs_identify.geojson)

IGAC ArcGIS REST (mapas2.igac.gov.co) is unreliable for full-geometry queries
(HTTP 500 for page sizes > 3), so GADM is used as the primary geometry source
for admin boundaries. IGAC attribute-only queries (returnGeometry=false) DO
paginate reliably, so we use those to build a name → DANE code crosswalk and
remap each GADM boundary_id to the official Colombian DANE code (DeCodigo for
departments, MpCodigo for municipalities). That keeps the frontend's AOI
lookups working with the same codes the IGAC map layers emit.

GADM features that fail to match an IGAC record (rare; usually corregimientos
in Amazonas / Vaupés / Guainía that aren't true municipalities) keep their
GADM ID as boundary_id and are flagged in properties.

All downloads are cached locally so subsequent pipeline runs skip the fetch.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from boundaries.igac_crosswalk import build_crosswalks, normalize_name

# Manual GADM → DANE overrides for features that IGAC and GADM name differently
# enough that whitespace+accent+punctuation normalization can't bridge them.
# Each key is (normalized GADM NAME_1, normalized GADM NAME_2 or None for dept).
#
# Bogotá D.C.: IGAC files it only as municipality 11001 under "Cundinamarca";
#   there is no separate IGAC department row, but DANE assigns dept code 11.
# San Andrés y Providencia: IGAC depto name is "San Andrés Providencia y Santa
#   Catalina" (no leading "y" before Providencia, plus a trailing "Santa
#   Catalina"); IGAC muni "Providencia y Santa Catalina" likewise gets a
#   trailing modifier vs GADM's "Providencia".
_GADM_TO_DANE_OVERRIDES: dict[tuple[str, str | None], str] = {
    ("bogotadc", None): "11",
    ("bogotadc", "bogotadc"): "11001",
    ("sanandresyprovidencia", None): "88",
    ("sanandresyprovidencia", "sanandres"): "88001",
    ("sanandresyprovidencia", "providencia"): "88564",
}

# GADM 4.1 direct-download GeoJSON for Colombia admin levels.
GADM_DEPT_URL = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_COL_1.json"
GADM_MUNI_URL = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_COL_2.json"
SIRAP_MERGED_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com"
    "/inputs/boundaries/sirap/siraps_merged.geojson"
)
RUNAP_IDENTIFY_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com"
    "/inputs/includes/runap_identify.geojson"
)
OMEC_IDENTIFY_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com"
    "/inputs/includes/omecs_identify.geojson"
)


class BoundaryLoadError(RuntimeError):
    pass


@dataclass(frozen=True)
class BoundaryFeature:
    boundary_id: str    # unique within geo_level
    name: str           # display name
    geo_level: str      # "departments", "municipalities", "siraps"
    geometry: dict      # GeoJSON geometry dict (WGS84 / EPSG:4326)
    properties: dict    # raw feature properties


def _http_get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(
        url, headers={"User-Agent": "dises-tier1-metrics-boundaries/0.1"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _write_cache(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _load_geojson_url(
    cache_path: Path,
    url: str,
    geo_level: str,
    id_fields: list[str],
    name_fields: list[str],
    extra_fields: list[str] | None = None,
) -> list[BoundaryFeature]:
    """Download (or load from cache) a GeoJSON file and return BoundaryFeature list."""
    if cache_path.exists():
        data = json.loads(cache_path.read_text(encoding="utf-8"))
    else:
        print(f"[boundaries] downloading {geo_level}…")
        try:
            raw = _http_get(url)
            data = json.loads(raw)
        except (urllib.error.URLError, json.JSONDecodeError) as exc:
            raise BoundaryLoadError(f"Failed to download {geo_level} from {url}: {exc}") from exc
        _write_cache(cache_path, data)
        print(f"[boundaries] cached {len(data.get('features') or [])} {geo_level} → {cache_path}")

    def _first_str(props: dict, fields: list[str]) -> str:
        for f in fields:
            v = props.get(f)
            if isinstance(v, str) and v.strip():
                return v.strip()
            if isinstance(v, (int, float)):
                return str(v)
        return ""

    result: list[BoundaryFeature] = []
    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        bid = _first_str(props, id_fields)
        name = _first_str(props, name_fields) or bid
        geom = feat.get("geometry")
        if not bid or not geom:
            continue
        result.append(
            BoundaryFeature(
                boundary_id=bid,
                name=name,
                geo_level=geo_level,
                geometry=geom,
                properties=dict(props),
            )
        )
    return result


def load_all_boundaries(
    cache_dir: Path,
) -> tuple[dict[str, list[BoundaryFeature]], dict[str, str]]:
    """Load all supported boundary levels, downloading and caching as needed.

    Each level is attempted independently — a failed download for one level
    does not prevent the others from loading.

    Returns:
        (boundaries_by_level, errors_by_level) — errors_by_level maps level name
        to an error message for any level that failed to load.
    """
    bdir = cache_dir / "boundaries"

    _levels: list[tuple[str, Any]] = [
        (
            "departments",
            lambda: _load_geojson_url(
                cache_path=bdir / "gadm_departments.geojson",
                url=GADM_DEPT_URL,
                geo_level="departments",
                id_fields=["GID_1"],
                name_fields=["NAME_1"],
            ),
        ),
        (
            "municipalities",
            lambda: _load_geojson_url(
                cache_path=bdir / "gadm_municipalities.geojson",
                url=GADM_MUNI_URL,
                geo_level="municipalities",
                id_fields=["GID_2"],
                name_fields=["NAME_2"],
            ),
        ),
        (
            "siraps",
            lambda: _load_geojson_url(
                cache_path=bdir / "siraps_merged.geojson",
                url=SIRAP_MERGED_URL,
                geo_level="siraps",
                id_fields=["sirap_id", "nombre", "sirap"],
                name_fields=["sirap_name", "nombre", "sirap"],
                extra_fields=["sirap_kind"],
            ),
        ),
        # Individual RUNAP protected areas (1,879 polygons) — clicking any
        # polygon in MapView opens the AOI panel and these per-RUNAP metrics
        # populate it. `runap_category` is surfaced as the AOI kicker.
        (
            "runaps",
            lambda: _load_geojson_url(
                cache_path=bdir / "runap_identify.geojson",
                url=RUNAP_IDENTIFY_URL,
                geo_level="runaps",
                id_fields=["runap_id"],
                name_fields=["runap_name"],
                extra_fields=[
                    "runap_category",
                    "runap_status",
                    "runap_area_ha",
                    "runap_dt",
                    "runap_sirap",
                ],
            ),
        ),
        # Individual OMEC polygons (Other Effective Conservation Measures).
        # `DESIG` is the designation; we surface it via the AOI subtype.
        (
            "omecs",
            lambda: _load_geojson_url(
                cache_path=bdir / "omecs_identify.geojson",
                url=OMEC_IDENTIFY_URL,
                geo_level="omecs",
                id_fields=["SITE_ID"],
                name_fields=["NAME"],
                extra_fields=["DESIG", "STATUS", "GOV_TYPE"],
            ),
        ),
    ]

    result: dict[str, list[BoundaryFeature]] = {}
    errors: dict[str, str] = {}
    for level_name, loader in _levels:
        try:
            result[level_name] = loader()
        except BoundaryLoadError as exc:
            errors[level_name] = str(exc)

    _apply_dane_crosswalk(result, bdir)

    return result, errors


def _apply_dane_crosswalk(
    by_level: dict[str, list[BoundaryFeature]],
    cache_dir: Path,
) -> None:
    """Remap department / municipality boundary_id from GADM IDs to DANE codes.

    Mutates `by_level` in place. SIRAPs are untouched (already use sirap_id).
    Unmatched features keep their GADM ID so the pipeline still runs end-to-end.
    """
    try:
        dept_lookup, muni_lookup = build_crosswalks(cache_dir)
    except Exception as exc:
        print(f"[boundaries] WARN: DANE crosswalk unavailable ({exc}); keeping GADM IDs.")
        return

    def dept_lookup_fn(feat):
        norm = normalize_name(feat.name)
        return dept_lookup.get(norm) or _GADM_TO_DANE_OVERRIDES.get((norm, None))

    def muni_lookup_fn(feat):
        norm_dept = normalize_name(feat.properties.get("NAME_1") or "")
        norm_muni = normalize_name(feat.name)
        return (
            muni_lookup.get((norm_dept, norm_muni))
            or _GADM_TO_DANE_OVERRIDES.get((norm_dept, norm_muni))
        )

    if "departments" in by_level:
        by_level["departments"], unmatched_depts = _remap_features(
            by_level["departments"], lookup_fn=dept_lookup_fn,
        )
        if unmatched_depts:
            print(f"[boundaries] WARN: {len(unmatched_depts)} dept(s) without DANE match: "
                  f"{[f.name for f in unmatched_depts[:5]]}")

    if "municipalities" in by_level:
        by_level["municipalities"], unmatched_munis = _remap_features(
            by_level["municipalities"], lookup_fn=muni_lookup_fn,
        )
        if unmatched_munis:
            total = len(by_level['municipalities'])
            print(f"[boundaries] WARN: {len(unmatched_munis)}/{total} municipality(ies) "
                  f"without DANE match (kept GADM ID); first few: "
                  f"{[(f.properties.get('NAME_1'), f.name) for f in unmatched_munis[:5]]}")


def _remap_features(
    features: list[BoundaryFeature],
    *,
    lookup_fn,
) -> tuple[list[BoundaryFeature], list[BoundaryFeature]]:
    """Return (remapped_features, unmatched_features). Unmatched keep original boundary_id."""
    remapped: list[BoundaryFeature] = []
    unmatched: list[BoundaryFeature] = []
    for feat in features:
        dane_code = lookup_fn(feat)
        if dane_code:
            enriched_props = dict(feat.properties)
            enriched_props["_gadm_id"] = feat.boundary_id
            enriched_props["_dane_code"] = dane_code
            remapped.append(BoundaryFeature(
                boundary_id=dane_code,
                name=feat.name,
                geo_level=feat.geo_level,
                geometry=feat.geometry,
                properties=enriched_props,
            ))
        else:
            unmatched.append(feat)
            remapped.append(feat)
    return remapped, unmatched
