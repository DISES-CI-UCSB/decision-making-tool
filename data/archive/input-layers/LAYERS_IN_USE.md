# App Input Layers Registry

Tracks what input layers are currently used (or intended) by the app during development.

This file is intentionally separate from the analytical/source codebooks in `data/metadata/`:

- **Authoritative source-of-truth:** `data/metadata/README_updated_031926.md` (Kevin + Mesa Nacional)
- **This file:** what the app is wired to use right now (can be temporarily out of sync)

---

## Quick Layer Summary

| Layer ID | UI Label | Domain | Runtime Source | Local Data Path | App Status | Last Verified | Notes |
|---|---|---|---|---|---|---|---|
| `aoi-sirap-colombia` | SIRAP Region | Administrative Boundary | Local GeoJSON | `eco-plan/public/data/sirap-regions.geojson` | Active | 2026-03-31 | Flagged in UCS-130; likely wrong geometry source |
| `aoi-departments-colombia` | ADM1 Departments | Administrative Boundary | ArcGIS FeatureServer (IGAC) | N/A | Active | 2026-03-31 | `.../limites/MapServer/2` |
| `aoi-municipalities-colombia` | ADM2 Municipalities | Administrative Boundary | ArcGIS FeatureServer (IGAC) | N/A | Active | 2026-03-31 | `.../limites/MapServer/1` |
| `overlay-runap` | Protected Areas (RUNAP) | Overlay | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Intended: Parques `runap/MapServer/0` |
| `overlay-omecs` | OMECs | Overlay | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Source still TBD |
| `layer-eco-types` | Ecosystem Types | Ecosystems | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-eco-paramos` | Paramos | Ecosystems | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-eco-wetlands` | Wetlands | Ecosystems | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-eco-dry-forest` | Dry Forest | Ecosystems | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-eco-mangroves` | Mangroves | Ecosystems | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-env-carbon` | Carbon Storage | Environmental Services | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-env-water` | Water Regulation | Environmental Services | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-cult-indigenous` | Indigenous Reserves | Cultural & Ethnic Territories | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-cult-afro` | Afro-Colombian Community Territories | Cultural & Ethnic Territories | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-soc-human-footprint` | Human Footprint | Socio-economic | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-soc-ag-opportunity-cost` | Agricultural Opportunity Cost | Socio-economic | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-soc-land-use` | Land Use | Socio-economic | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |
| `layer-conflict-zones` | Conflict Zones | Conflict & Security | Pending | N/A | Not wired (`mapUnavailable`) | 2026-03-31 | Placeholder row in sidebar |

---

## Canonical References

Use these as the first checkpoints when adding/replacing layers:

- `data/metadata/README_updated_031926.md` (authoritative data codebook)
- `data/README.md` (top-level data index)
- `eco-plan/src/app/features/map/services/admin-boundary.service.ts` (AOI boundary wiring)
- `eco-plan/src/app/features/left-sidebar/map-layers-panel/map-layers-panel.ts` (sidebar row IDs and placeholders)

---

## Runtime Source Details

### Administrative Boundaries (currently wired)

| Layer ID | URL / File | Authority | Created | Updated |
|---|---|---|---|---|
| `aoi-sirap-colombia` | `eco-plan/public/data/sirap-regions.geojson` | Unknown (needs verification) | Unknown | Unknown |
| `aoi-departments-colombia` | `https://mapas2.igac.gov.co/server/rest/services/limites/limites/MapServer/2` | IGAC | Unknown | Live service |
| `aoi-municipalities-colombia` | `https://mapas2.igac.gov.co/server/rest/services/limites/limites/MapServer/1` | IGAC | Unknown | Live service |

### Overlay Targets (planned / partially defined)

| Layer ID | Intended URL / File | Authority | Created | Updated | Status |
|---|---|---|---|---|---|
| `overlay-runap` | `https://mapas.parquesnacionales.gov.co/arcgis/rest/services/pnn/runap/MapServer/0` | Parques Nacionales Naturales de Colombia | Unknown | Live service | Not wired in app |
| `overlay-omecs` | TBD | TBD | Unknown | Unknown | Not wired in app |

---

## Sync Workflow (Source Truth vs App Truth)

1. **Update source truth first** (Kevin/Mesa) in `data/metadata/README_updated_031926.md`.
2. **Compare app wiring** against the source truth:
   - `admin-boundary.service.ts`
   - `map-layers-panel.ts`
   - local files in `eco-plan/public/data/`
3. **Record diffs here** in this file (especially status and notes columns).
4. **Open/refresh Linear issue** if mismatch impacts behavior (example: UCS-130).

---

## Current Mismatch Log

| ID | Issue | Impact | Status | Last Updated | Notes |
|---|---|---|---|---|---|
| `MM-001` | SIRAP boundary layer appears to use RUNAP-like polygons instead of 6 regional boundaries | Users see incorrect administrative boundary geometry | Open (UCS-130) | 2026-03-31 | Blocked external for authoritative SIRAP shapefile |

