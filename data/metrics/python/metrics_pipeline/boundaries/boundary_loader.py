"""Download and cache administrative boundary GeoJSON for metric calculation.

Supported geography levels:
- departments:    Colombia departments from GADM 4.1 (gadm41_COL_1.json)
- municipalities: Colombia municipalities from GADM 4.1 (gadm41_COL_2.json)
- siraps:         Colombia SIRAPs from Vercel Blob (siraps_merged.geojson)

IGAC ArcGIS REST (mapas2.igac.gov.co) is unreliable for full-geometry queries
(HTTP 500 for page sizes > 3), so GADM is used as the primary source for admin
boundaries. GADM IDs (GID_1, GID_2) are used as boundary_id values in the
output; the IGAC DIVIPOLA codes can be added as a future enrichment if needed.

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

# GADM 4.1 direct-download GeoJSON for Colombia admin levels.
GADM_DEPT_URL = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_COL_1.json"
GADM_MUNI_URL = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_COL_2.json"
SIRAP_MERGED_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com"
    "/inputs/boundaries/sirap/siraps_merged.geojson"
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
    ]

    result: dict[str, list[BoundaryFeature]] = {}
    errors: dict[str, str] = {}
    for level_name, loader in _levels:
        try:
            result[level_name] = loader()
        except BoundaryLoadError as exc:
            errors[level_name] = str(exc)

    return result, errors
