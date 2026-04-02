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
| `nacional/` | 14 national-level 1km scenarios + evaluation CSVs + species RDS files |
| `sirap/` | Regional SIRAP solutions (empty — future) |

Solution filenames encode scenario parameters. Example: `Ecos17+RUNAP_HF.tif` = 17% ecosystem target, RUNAP locked-in, Human Footprint cost.

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
