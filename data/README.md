# Data Directory

All geospatial data layers, solutions, and metadata for the Decision Making Tool.

## Folder Structure

| Folder | What's in it |
|--------|-------------|
| `features/` | Conservation targets — what the solver tries to protect |
| `costs/` | Cost surfaces — what the solver minimizes (soft tradeoff) |
| `includes_excludes/` | Hard constraints — areas locked in or locked out of solutions |
| `boundaries/` | Administrative boundaries for display (not used in optimization) |
| `solutions/` | PrioritizR outputs, organized by scope (nacional, sirap) |
| `frontend_deploy/` | Assets bundled into the Vercel build |
| `archive/` | Raw data deliveries, original multi-band stack, zips |

## Layer Registries

Two CSVs at this level track all data layers. These are manually synced with a shared Google Sheet maintained by Kevin.

| File | Purpose |
|------|---------|
| `layers_in_use.csv` | All layers we currently have — name, type, path, app status |
| `layers_required.csv` | Layers we still need but don't have yet |

### Layers In Use Snapshot (synced from `layers_in_use.csv`)

| layer_id | layer_name | layer_group | layer_subtype | scope | active_in_app | selectable_in_finder | repo_path | notes |
|---|---|---|---|---|---|---|---|---|
| `COST_HF_2030` | Human Footprint 2030 | cost | cost_surface | nacional | true | true | `data/costs/human_footprint_2030.tif` | Primary cost layer |
| `COST_NET_BENEFIT` | Net Benefit (Renta Agropecuaria) | cost | cost_surface | nacional | true | true | `data/costs/net_benefit.tif` | Alternative cost layer |
| `COST_CONFLICT` | Conflict (Coca + Deaths) | cost | cost_surface | nacional | true | true | `data/costs/conflict.tif` | Conflict-based cost |
| `INCL_RUNAP` | Protected Areas (RUNAP 2023) | includes_excludes | include | nacional | true | true | `data/includes_excludes/runap_protected_areas.tif` | Always applied include |
| `INCL_COMUNIDADES` | Afro-Colombian Communities | includes_excludes | include | nacional | true | true | `data/includes_excludes/comunidades.tif` | Optional include toggle |
| `INCL_RESGUARDOS` | Indigenous Reserves (Resguardos) | includes_excludes | include | nacional | false | false | `data/includes_excludes/resguardos.tif` | Data exists but not wired in UI |
| `INCL_OMECS` | OMECs (raster) | includes_excludes | include | nacional | true | true | `data/includes_excludes/omecs.tif` | Optional include toggle |
| `INCL_OMECS_VECTOR` | OMECs (vector) | includes_excludes | reference | nacional | false | false | `data/includes_excludes/omecs_vector/` | Vector overlay source |
| `FEAT_SPECIES_RICHNESS` | Species Richness (Ecosistemas) | features | ecosystems | nacional | true | true | `data/features/ecosystems/ecosistemas.tif` | Primary feature for Ecos17/Ecos30 runs |
| `FEAT_PARAMOS` | Paramos | features | strategic | nacional | true | true | `data/features/strategic/paramos.tif` | Strategic feature |
| `FEAT_MANGROVES` | Mangroves (INVEMAR) | features | strategic | nacional | true | true | `data/features/strategic/mangroves.tif` | Strategic feature |
| `FEAT_WETLANDS` | Wetlands (Humedales) | features | strategic | nacional | true | true | `data/features/strategic/humedales.tif` | Strategic feature |
| `FEAT_DRY_FOREST` | Dry Forest (Bosque Seco) | features | strategic | nacional | true | true | `data/features/strategic/bosque_seco.tif` | Strategic feature |
| `SPECIES_ALL` | Individual Species Distributions (~8751) | features | species | nacional | false | false | `data/features/species/` | Repository dataset for species-level future use |
| `ADMIN_SIRAP` | SIRAP Regions | boundaries | admin | nacional | true | true | `data/boundaries/sirap_regions.geojson` | AOI selector geometry |
| `ADMIN_DEPARTMENTS` | Colombia Departments | boundaries | admin | nacional | true | true | `(remote)` | AOI selector layer |
| `ADMIN_MUNICIPALITIES` | Colombia Municipalities | boundaries | admin | nacional | true | true | `(remote)` | AOI selector layer |

### Layers Required Snapshot (synced from `layers_required.csv`)

| layer_id | layer_name | layer_group | layer_subtype | target_scope | priority | current_status | target_app_surface | notes |
|---|---|---|---|---|---|---|---|---|
| `DISP_ECO_TYPES` | Ecosystem Types | boundaries_or_overlays | ecosystem_display | nacional | medium | missing | left-sidebar-map-layers | Placeholder row exists in UI but not wired |
| `DISP_CARBON` | Carbon Storage | features_or_services | environmental_service | nacional | medium | missing | left-sidebar-map-layers | Needed for environmental services visualization |
| `DISP_WATER` | Water Regulation | features_or_services | environmental_service | nacional | medium | missing | left-sidebar-map-layers | Needed for environmental services visualization |
| `DISP_LAND_USE` | Land Use | boundaries_or_overlays | socio_economic | nacional | medium | missing | left-sidebar-map-layers | Needed for contextual overlay |
| `SIRAP_SOLUTIONS` | Regional SIRAP Solutions | solutions | regional_solution | sirap | high | missing | solution-finder | Future regional scenario library |

## Features (`features/`)

| Subfolder | Contents |
|-----------|----------|
| `ecosystems/` | Species richness layer (`ecosistemas.tif`) — primary Ecos17/Ecos30 target |
| `strategic/` | 4 nationally strategic ecosystem types (páramos, mangroves, wetlands, dry forest) — ESTR30 targets at 30% each |
| `species/` | ~8,700 individual species distribution model (SDM) rasters from BioModelos |

## Costs (`costs/`)

| File | Description | Values |
|------|-------------|--------|
| `human_footprint_2030.tif` | Projected human footprint index (conservationist scenario) | 0–100 continuous |
| `net_benefit.tif` | Agricultural income / opportunity cost (Renta Agropecuaria) | 0–2.15e9 continuous |
| `conflict.tif` | Coca cultivation + conflict-related deaths composite, 2016–2022 | 0–265.56 continuous |

## Includes & Excludes (`includes_excludes/`)

| File | Description | Values |
|------|-------------|--------|
| `runap_protected_areas.tif` | RUNAP 2023 — 15 protected area categories | 1–15 categorical |
| `runap_categories.csv` | Lookup table for RUNAP category IDs | — |
| `comunidades.tif` | Afro-Colombian community territories | 0/1 binary |
| `resguardos.tif` | Indigenous reserves (Resguardos Indígenas) | 0/1 binary |
| `omecs.tif` | Other Effective Conservation Measures (raster) | 0–20 categorical |
| `omecs_vector/` | WDPA/WDOECM Feb 2026 shapefile for Colombia | Polygons |

## Administrative Boundaries (`boundaries/`)

| File | Description |
|------|-------------|
| `sirap_regions.geojson` | Local SIRAP regions GeoJSON used by AOI selector |
| `boundary_sources.csv` | Boundary source registry, including remote IGAC services for departments and municipalities |

## Solutions (`solutions/`)

| Subfolder | Contents |
|-----------|----------|
| `nacional/` | 14 national-level 1km scenarios (`.tif`) + sidecar metadata (`.json`) + manifest (`solution_manifest.csv`) + evaluation CSVs + species RDS files |
| `sirap/` | Regional SIRAP solutions (empty — future) |

Solution filenames encode scenario parameters. Example: `Ecos17+RUNAP_HF.tif` = 17% ecosystem target, RUNAP locked-in, Human Footprint cost.
Each solution has a same-name JSON file next to it (for provenance and input IDs), e.g. `Ecos17+RUNAP_HF.tif` + `Ecos17+RUNAP_HF.json`.

To regenerate sidecar metadata and manifest:

```bash
python3 data/solutions/generate_solution_metadata.py
```

## Archive (`archive/`)

Original data deliveries and the multi-band stack before band extraction. Kept for reference but not used by the app.

## Origin of Extracted TIFs

All individual cost and include/exclude TIFs were extracted from the original 9-band `cost_constraints_stack_1km.tif` using GDAL. The original file is preserved in `archive/`.

| Band | Extracted to | Category |
|------|-------------|----------|
| 1 | `costs/human_footprint_2030.tif` | Cost |
| 2 | `includes_excludes/runap_protected_areas.tif` | Include |
| 3 | `includes_excludes/comunidades.tif` | Include |
| 4 | `costs/net_benefit.tif` | Cost |
| 5 | `includes_excludes/resguardos.tif` | Include |
| 6 | `includes_excludes/omecs.tif` | Include |
| 7 | `archive/human_footprint_2022.tif` | Unused (archived) |
| 8 | `costs/conflict.tif` | Cost |
| 9 | `archive/climate_refugia.tif` | Unused (archived) |
