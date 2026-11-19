"""Build a name → DANE/DIVIPOLA code crosswalk from IGAC attribute-only queries.

Used to remap GADM `GID_1` / `GID_2` boundary IDs to the official Colombian
DANE codes that the frontend selects (DeCodigo for departments, MpCodigo for
municipalities). Geometry queries against IGAC are unreliable (HTTP 500 above
~3 features per page), but attribute-only queries paginate fine.

Output keys are normalized aggressively to absorb the GADM vs. IGAC spelling
differences:
- diacritics stripped (NFD + combining marks removed)
- whitespace removed entirely (GADM stores "ElEncanto"; IGAC stores "El Encanto")
- lowercased

Municipality lookups are scoped by normalized department name to disambiguate
shared names (e.g. Córdoba exists as both a department and a municipality in
multiple departments).
"""

from __future__ import annotations

import json
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

IGAC_DEPT_URL = (
    "https://mapas2.igac.gov.co/server/rest/services/limites/limites/MapServer/2/query"
)
IGAC_MUNI_URL = (
    "https://mapas2.igac.gov.co/server/rest/services/limites/limites/MapServer/1/query"
)


class CrosswalkError(RuntimeError):
    pass


def normalize_name(label: str) -> str:
    """Diacritic-strip, keep only [a-z0-9], lowercase. Empty input returns ''.

    Drops whitespace, punctuation, and casing so that GADM's "BogotáD.C." and
    IGAC's "Bogotá, D.C." both collapse to "bogotadc".
    """
    if not label:
        return ""
    no_accents = "".join(
        ch for ch in unicodedata.normalize("NFD", label)
        if not unicodedata.combining(ch)
    )
    return "".join(ch for ch in no_accents.lower() if ch.isalnum())


def _http_get_json(url: str, params: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        url + params,
        headers={"User-Agent": "dises-tier1-metrics-igac-crosswalk/0.1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        raise CrosswalkError(f"IGAC fetch failed for {url}{params}: {exc}") from exc


def _fetch_paginated(url: str, out_fields: str, page_size: int = 1000) -> list[dict]:
    all_features: list[dict] = []
    offset = 0
    while True:
        params = (
            f"?where=1%3D1&outFields={out_fields}&returnGeometry=false&f=json"
            f"&resultOffset={offset}&resultRecordCount={page_size}"
        )
        data = _http_get_json(url, params)
        feats = data.get("features") or []
        if not feats:
            break
        all_features.extend(feats)
        if not data.get("exceededTransferLimit"):
            break
        offset += len(feats)
        if offset > 10_000:
            raise CrosswalkError(f"IGAC pagination exceeded safety cap at offset={offset}")
    return all_features


def fetch_igac_attributes(cache_dir: Path, *, force: bool = False) -> tuple[list[dict], list[dict]]:
    """Fetch (departments, municipalities) attribute-only records from IGAC, caching to disk."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    dept_cache = cache_dir / "igac_departments.json"
    muni_cache = cache_dir / "igac_municipalities.json"

    if not force and dept_cache.exists() and muni_cache.exists():
        depts = json.loads(dept_cache.read_text(encoding="utf-8"))
        munis = json.loads(muni_cache.read_text(encoding="utf-8"))
        return depts, munis

    print("[crosswalk] fetching IGAC department attributes…")
    dept_feats = _fetch_paginated(IGAC_DEPT_URL, "DeCodigo,DeNombre")
    depts = [feat.get("attributes") or {} for feat in dept_feats]
    dept_cache.write_text(json.dumps(depts, ensure_ascii=False, indent=2), encoding="utf-8")

    print("[crosswalk] fetching IGAC municipality attributes…")
    muni_feats = _fetch_paginated(IGAC_MUNI_URL, "MpCodigo,MpNombre,Depto")
    munis = [feat.get("attributes") or {} for feat in muni_feats]
    muni_cache.write_text(json.dumps(munis, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[crosswalk] cached {len(depts)} departments + {len(munis)} municipalities")
    return depts, munis


def build_crosswalks(
    cache_dir: Path,
) -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    """Return (dept_name_norm → DeCodigo, (dept_name_norm, muni_name_norm) → MpCodigo).

    Lookups are case- and whitespace-insensitive, accent-folded. Municipality
    lookups are department-scoped, so "Córdoba" in Nariño and "Córdoba" in
    Bolívar resolve to different MpCodigos.
    """
    depts, munis = fetch_igac_attributes(cache_dir)

    dept_lookup: dict[str, str] = {}
    for d in depts:
        code = d.get("DeCodigo")
        name = d.get("DeNombre")
        if code and name:
            dept_lookup[normalize_name(name)] = str(code)

    muni_lookup: dict[tuple[str, str], str] = {}
    for m in munis:
        code = m.get("MpCodigo")
        muni_name = m.get("MpNombre")
        dept_name = m.get("Depto")
        if code and muni_name and dept_name:
            muni_lookup[(normalize_name(dept_name), normalize_name(muni_name))] = str(code)

    return dept_lookup, muni_lookup
