# Data Directory

All geospatial data layers, solutions, and metadata for the Decision Making Tool.

## Folder Structure

| Folder | What's in it |
|--------|-------------|
| `inputs/` | Solver inputs grouped by role: `features/`, `costs/`, `includes_excludes/` |
| `boundaries/` | Administrative boundaries for display (not used in optimization) |
| `solutions/` | PrioritizR outputs, organized by scope (nacional, sirap) |
| `archive/` | Raw data deliveries, original multi-band stack, zips |

## Layer Registries

Deploy automation scripts now live in `frontend/scripts/data-deploy/`. They sync canonical solution and boundary assets from `data/` into `frontend/public/data/` during frontend build/deploy workflows.

Two CSVs at this level track non-solution layers (inputs, boundaries, and display overlays). These are manually synced with a shared Google Sheet maintained by Kevin.

| File | Purpose |
|------|---------|
| `layers_in_use.csv` | Non-solution layers currently available — name, type, path, app status |
| `layers_required.csv` | Non-solution layers still needed or not fully wired |

`layer_description` in both registries is intended to be user-facing UI copy (plain language). Use `notes` for internal implementation context.

### Layers In Use Snapshot (synced from `layers_in_use.csv`)

| layer_id | layer_name | layer_group | layer_subtype | scope | active_in_app | selectable_in_finder | repo_path | notes |
|---|---|---|---|---|---|---|---|---|
| `COST_HF_2030` | Human Footprint 2030 | cost | cost_surface | nacional | true | true | `data/inputs/costs/human_footprint_2030.tif` | Primary cost layer |
| `COST_NET_BENEFIT` | Net Benefit (Renta Agropecuaria) | cost | cost_surface | nacional | true | true | `data/inputs/costs/net_benefit.tif` | Alternative cost layer |
| `COST_CONFLICT` | Conflict (Coca + Deaths) | cost | cost_surface | nacional | true | true | `data/inputs/costs/conflict.tif` | Conflict-based cost |
| `INCL_RUNAP` | Protected Areas (RUNAP 2023) | includes_excludes | include | nacional | true | true | `data/inputs/includes_excludes/runap_protected_areas.tif` | Always applied include |
| `INCL_COMUNIDADES` | Afro-Colombian Communities | includes_excludes | include | nacional | true | true | `data/inputs/includes_excludes/comunidades.tif` | Optional include toggle |
| `INCL_RESGUARDOS` | Indigenous Reserves (Resguardos) | includes_excludes | include | nacional | false | false | `data/inputs/includes_excludes/resguardos.tif` | Data exists but not wired in UI |
| `INCL_OMECS` | OMECs (raster) | includes_excludes | include | nacional | true | true | `data/inputs/includes_excludes/omecs.tif` | Optional include toggle |
| `INCL_OMECS_VECTOR` | OMECs (vector) | includes_excludes | reference | nacional | false | false | `data/inputs/includes_excludes/omecs_vector/` | Vector overlay source |
| `FEAT_SPECIES_RICHNESS` | Species Richness (Ecosistemas) | features | ecosystems | nacional | true | true | `data/inputs/features/ecosystems/ecosistemas.tif` | Primary feature for Ecos17/Ecos30 runs |
| `FEAT_PARAMOS` | Paramos | features | strategic | nacional | true | true | `data/inputs/features/strategic/paramos.tif` | Strategic feature |
| `FEAT_MANGROVES` | Mangroves (INVEMAR) | features | strategic | nacional | true | true | `data/inputs/features/strategic/mangroves.tif` | Strategic feature |
| `FEAT_WETLANDS` | Wetlands (Humedales) | features | strategic | nacional | true | true | `data/inputs/features/strategic/humedales.tif` | Strategic feature |
| `FEAT_DRY_FOREST` | Dry Forest (Bosque Seco) | features | strategic | nacional | true | true | `data/inputs/features/strategic/bosque_seco.tif` | Strategic feature |
| `SPECIES_ALL` | Individual Species Distributions (~8751) | features | species | nacional | false | false | `data/inputs/features/species/` | Repository dataset for species-level future use |
| `ADMIN_SIRAP` | SIRAP Regions | boundaries | admin | nacional | true | true | `data/boundaries/sirap_regions.geojson` | AOI selector geometry |
| `ADMIN_DEPARTMENTS` | Colombia Departments | boundaries | admin | nacional | true | true | `(remote)` | AOI selector layer |
| `ADMIN_MUNICIPALITIES` | Colombia Municipalities | boundaries | admin | nacional | true | true | `(remote)` | AOI selector layer |

### Layers Required Snapshot (synced from `layers_required.csv`)

| layer_id | layer_name | target_scope | priority | required_for_release | current_status |
|---|---|---|---|---|---|
| `COST_HF_2030` | Human Footprint 2030 | nacional | high | true | available |
| `COST_NET_BENEFIT` | Net Benefit (Renta Agropecuaria) | nacional | high | true | available |
| `COST_CONFLICT` | Conflict (Coca + Deaths) | nacional | high | true | available |
| `INCL_RUNAP` | Protected Areas (RUNAP 2023) | nacional | high | true | available |
| `INCL_COMUNIDADES` | Afro-Colombian Communities | nacional | medium | true | available |
| `INCL_OMECS` | OMECs (raster) | nacional | medium | true | available |
| `FEAT_SPECIES_RICHNESS` | Species Richness (Ecosistemas) | nacional | high | true | available |
| `FEAT_PARAMOS` | Paramos | nacional | high | true | available |
| `FEAT_MANGROVES` | Mangroves (INVEMAR) | nacional | high | true | available |
| `FEAT_WETLANDS` | Wetlands (Humedales) | nacional | high | true | available |
| `FEAT_DRY_FOREST` | Dry Forest (Bosque Seco) | nacional | high | true | available |
| `ADMIN_SIRAP` | SIRAP Regions | nacional | high | true | available |
| `ADMIN_DEPARTMENTS` | Colombia Departments | nacional | high | true | available |
| `ADMIN_MUNICIPALITIES` | Colombia Municipalities | nacional | high | true | available |
| `DISP_ECO_TYPES` | Ecosystem Types Display | nacional | medium | false | missing |
| `DISP_PARAMOS` | Paramos Display | nacional | medium | false | available_not_wired |
| `DISP_WETLANDS` | Wetlands Display | nacional | medium | false | available_not_wired |
| `DISP_DRY_FOREST` | Dry Forest Display | nacional | medium | false | available_not_wired |
| `DISP_MANGROVES` | Mangroves Display | nacional | medium | false | available_not_wired |
| `DISP_CARBON` | Carbon Storage Display | nacional | medium | false | missing |
| `DISP_WATER` | Water Regulation Display | nacional | medium | false | missing |
| `DISP_INDIGENOUS` | Indigenous Reserves Display | nacional | medium | false | available_not_wired |
| `DISP_AFRO` | Afro Territories Display | nacional | medium | false | available_not_wired |
| `DISP_HF` | Human Footprint Display | nacional | medium | false | available_not_wired |
| `DISP_AG_COST` | Agricultural Opportunity Cost Display | nacional | medium | false | available_not_wired |
| `DISP_LAND_USE` | Land Use Display | nacional | medium | false | missing |
| `DISP_CONFLICT` | Conflict Zones Display | nacional | medium | false | available_not_wired |
| `DISP_RUNAP` | RUNAP Overlay Display | nacional | medium | false | available_not_wired |
| `DISP_OMECS` | OMECs Overlay Display | nacional | medium | false | available_not_wired |
| `INCL_RESGUARDOS` | Indigenous Reserves (Resguardos) | nacional | low | false | available_not_wired |
| `INCL_OMECS_VECTOR` | OMECs (vector) | nacional | low | false | available_not_wired |
| `SPECIES_ALL` | Individual Species Distributions (~8751) | nacional | low | false | available_not_wired |

Solution artifacts (`.tif` + same-name `.json`) are tracked in `data/solutions/` and companion collaboration tooling (Drive/Sheet tabs), not in layer registries.

## Inputs (`inputs/`)

Inputs are grouped by solver role. This reinforces the optimization mental model: these layers are the canonical data that feed scenario generation.

### Features (`inputs/features/`)

| Subfolder | Contents |
|-----------|----------|
| `ecosystems/` | Species richness layer (`ecosistemas.tif`) — primary Ecos17/Ecos30 target |
| `strategic/` | 4 nationally strategic ecosystem types (páramos, mangroves, wetlands, dry forest) — ESTR30 targets at 30% each |
| `species/` | ~8,700 individual species distribution model (SDM) rasters from BioModelos |

### Costs (`inputs/costs/`)

| File | Description | Values |
|------|-------------|--------|
| `human_footprint_2030.tif` | Projected human footprint index (conservationist scenario) | 0–100 continuous |
| `net_benefit.tif` | Agricultural income / opportunity cost (Renta Agropecuaria) | 0–2.15e9 continuous |
| `conflict.tif` | Coca cultivation + conflict-related deaths composite, 2016–2022 | 0–265.56 continuous |

### Includes & Excludes (`inputs/includes_excludes/`)

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
`solutions/nacional/` is the canonical source; deploy scripts copy required files from there to `frontend/public/data/solutions/`.
Canonical solution JSON metadata is provided by collaborators (for now, Kevin/Mesa workflow), not auto-generated in this repo.
Use `data/solutions/metadata/example_solution_metadata.json` and `data/solutions/metadata/example_solution_metadata_sirap.json` as the upload contract templates.

## Archive (`archive/`)

Original data deliveries and the multi-band stack before band extraction. Kept for reference but not used by the app.

## Origin of Extracted TIFs

All individual cost and include/exclude TIFs were extracted from the original 9-band `cost_constraints_stack_1km.tif` using GDAL. The original file is preserved in `archive/`.

| Band | Extracted to | Category |
|------|-------------|----------|
| 1 | `inputs/costs/human_footprint_2030.tif` | Cost |
| 2 | `inputs/includes_excludes/runap_protected_areas.tif` | Include |
| 3 | `inputs/includes_excludes/comunidades.tif` | Include |
| 4 | `inputs/costs/net_benefit.tif` | Cost |
| 5 | `inputs/includes_excludes/resguardos.tif` | Include |
| 6 | `inputs/includes_excludes/omecs.tif` | Include |
| 7 | `archive/human_footprint_2022.tif` | Unused (archived) |
| 8 | `inputs/costs/conflict.tif` | Cost |
| 9 | `archive/climate_refugia.tif` | Unused (archived) |
