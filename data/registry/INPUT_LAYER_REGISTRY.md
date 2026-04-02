# Input Layer Registry

**Last Updated:** 2026-04-01
**Maintained By:** Will Overbye-Thompson (app), Kevin (data sources), Nick McManus (science)

This is the operational registry of all data layers relevant to the Decision Making Tool.
Copy-paste the table into Google Sheets for collaborative updates with Kevin and Nick.

## How to Use

1. **Kevin / Nick:** Update the Google Sheet when data sources change or new layers are identified
2. **Will / Cursor:** Sync the Google Sheet back to this markdown (CSV export → paste)
3. Cross-reference **MDD §4.11** for the full aspirational layer inventory

## Status Legend

| Status | Meaning |
|--------|---------|
| **active** | Data exists AND wired in the app AND working |
| **placeholder** | UI exists in the app but not wired to real map data |
| **data-only** | Data exists in the repo but not displayed in the app |
| **needed** | Required by metrics or design but data not yet available |
| **unknown** | Availability not yet verified |

## Type Legend

| Type | Meaning |
|------|---------|
| **cost** | Cost surface used by prioritizR optimizer (minimized) |
| **feature** | Conservation feature / target (what the solver tries to protect) |
| **feature-strategic** | Strategic ecosystem subset of features (páramos, mangroves, etc.) |
| **include** | Spatial constraint locked into or excluded from solutions |
| **admin** | Administrative or planning boundary (display-only, not in optimization) |
| **env-service** | Environmental service layer (carbon, water, etc.) |
| **socio-economic** | Socio-economic context layer |
| **conflict** | Conflict and security context layer |
| **cultural** | Cultural and ethnic territory layer |
| **species** | Individual species distribution raster |
| **solution** | PrioritizR solution output raster |
| **reference** | Supplementary/informational layer, not directly used in optimization |

---

## Registry Table

> **Tip:** Select this entire table and paste into Google Sheets. Use Data → Split text to columns (delimiter: pipe `|`) to separate columns.

| ID | Name | Type | Description | Source | Data Format | Repo Path | Band | App Status | App Location | MDD Ref | Notes |
|----|------|------|-------------|--------|-------------|-----------|------|------------|--------------|---------|-------|
| **COST LAYERS** | | | | | | | | | | | |
| `COST_HF_2030` | Human Footprint 2030 | cost | Projected human footprint index (conservationist scenario). Index 0–100 of anticipated human impact. | Humboldt (IAvH) | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 1 | active | solution-finder (cost choice) | `SOCIO_HF` | Primary cost layer. Solver minimizes this. |
| `COST_NET_BENEFIT` | Net Benefit (Renta Agropecuaria) | cost | Agricultural income / opportunity cost of converting land from ag to conservation. Values 0–2.15e9. | Humboldt (IAvH) | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 4 | active | solution-finder (cost choice) | `SOCIO_AG_COST` | Alternative cost layer. Also called "CO" in scenario naming. |
| `COST_CONFLICT` | Conflict (Coca + Deaths) | cost | Coca cultivation and conflict-related deaths composite index, 2016–2022. Values 0–265.56. | UNODC / Gov't | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 8 | active | solution-finder (cost choice) | `CONFLICT_ZONES` | Also called "CONFLICTO" in scenario naming. |
| `REF_IHEH_2022` | Human Footprint 2022 (IHEH) | reference | Measured current human footprint (not projected). Index 0–100. | Humboldt (IAvH) | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 7 | data-only | none | `SOCIO_HF` | Present in data stack but not used as a separate cost choice in the finder. |
| **INCLUDE / CONSTRAINT LAYERS** | | | | | | | | | | | |
| `INCL_RUNAP` | Protected Areas (RUNAP 2023) | include | National System of Protected Areas. 15 management categories (categorical 1–15). | PNNC / RUNAP | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 2 | active | solution-finder (always applied) | `PA_ALL` | Locked-in constraint on every scenario. See `data/metadata/RUNAP_categories.csv` for category lookup. |
| `INCL_COMUNIDADES` | Afro-Colombian Communities | include | Afro-Colombian community territories (Comunidades Negras). Binary 0/1. | ANT | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 3 | active | solution-finder (toggle) | `ETH_COUNCILS` | Optional lock-in constraint. |
| `INCL_RESGUARDOS` | Indigenous Reserves (Resguardos) | include | Indigenous reserve territories (Resguardos Indígenas). Binary 0/1. | ANT | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 5 | data-only | none | `ETH_INDIGENOUS` | Data exists in stack but NOT exposed as a toggle in the solution finder. Should it be? |
| `INCL_OMECS_RASTER` | OMECs (raster) | include | WDPA/WDOECM management categories for non-PA sites. Categorical 0–20. | WDPA / Protected Planet | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 6 | active | solution-finder (toggle) | `PA_OMEC` | Optional lock-in constraint. Raster version of the shapefile below. |
| `INCL_OMECS_VECTOR` | OMECs (shapefile) | include | Full WDPA/WDOECM polygon geometries for Colombia. Feb 2026 release. | WDPA / Protected Planet | Shapefile | `data/OMECs_2025/` | — | data-only | none | `PA_OMEC` | Vector format for potential map overlay. Updated from 2020 vintage per MDD §4.11.6. |
| **FEATURE / TARGET LAYERS** | | | | | | | | | | | |
| `FEAT_SPECIES_RICHNESS` | Species Richness (Ecosistemas) | feature | Continuous species richness layer. Primary conservation feature for Ecos17/Ecos30 scenarios. Total amount: 358,015,939. | Humboldt (BioModelos) | GeoTIFF | `data/features/ecosistemas.tif` | — | active | solution-finder (target type) | `ECO_TYPES` | Called "ecosistemas.tif" but actually represents species richness, not ecosystem types. |
| `FEAT_PARAMOS` | Páramos | feature-strategic | High-altitude Andean grasslands. Binary presence/absence. Total amount: 2,639,873. | Humboldt (IAvH) | GeoTIFF | `data/features/Ecos_Estrategico/paramos.tif` | — | active | solution-finder (ESTR30 target) | `ECO_TYPES` | 30% representation target in ESTR30 scenarios. |
| `FEAT_MANGROVES` | Mangroves (INVEMAR) | feature-strategic | Mangrove ecosystems mapped by INVEMAR. Binary. Total amount: 3,179. | INVEMAR | GeoTIFF | `data/features/Ecos_Estrategico/Manglares INVEMAR.tif` | — | active | solution-finder (ESTR30 target) | `MARINE_MANGROVE` | 30% representation target in ESTR30 scenarios. |
| `FEAT_WETLANDS` | Wetlands (Humedales) | feature-strategic | Wetland ecosystems. Binary. Total amount: 2,376,010. | IDEAM | GeoTIFF | `data/features/Ecos_Estrategico/humedales.tif` | — | active | solution-finder (ESTR30 target) | `ECO_TYPES` | 30% representation target in ESTR30 scenarios. |
| `FEAT_DRY_FOREST` | Dry Forest (Bosque Seco) | feature-strategic | Tropical dry forest. Binary. Total amount: 12,022. | IDEAM | GeoTIFF | `data/features/Ecos_Estrategico/bosque_seco.tif` | — | active | solution-finder (ESTR30 target) | `ECO_TYPES` | 30% representation target in ESTR30 scenarios. |
| `REF_CLIMATE_REFUGIA` | Climate Refugia | reference | Areas expected to remain buffered from climate change impacts (2021–2040, SSP585). | TBD | GeoTIFF band | `data/cost_constraints_stack_1km.tif` | 9 | data-only | none | — | Present in stack but role in prioritizR unclear. Not in any current scenario. |
| **SPECIES RASTERS** | | | | | | | | | | | |
| `SPECIES_ALL` | Individual Species Distributions (~8,700) | species | Per-species SDM rasters (BioModelos/MaxEnt). Binary/continuous, thresholded at 10th percentile. | Humboldt (BioModelos) | GeoTIFF (×8,751) | `data/species(8700)/` | — | placeholder | left-sidebar (taxon groups) | `BIO_SDM_*` | UI has 5 taxon groups (mammals, birds, amphibians, reptiles, plants) with sample species. All marked mapUnavailable. |
| **ADMINISTRATIVE BOUNDARIES** | | | | | | | | | | | |
| `ADMIN_DEPARTMENTS` | Colombia Departments | admin | Department-level administrative boundaries. | IGAC | ArcGIS FeatureServer | (remote) `mapas2.igac.gov.co/.../MapServer/2` | — | active | map (AOI selector) | `ADMIN_DEPT` | Click-to-select for AOI analysis. |
| `ADMIN_MUNICIPALITIES` | Colombia Municipalities | admin | Municipality-level administrative boundaries. | IGAC | ArcGIS FeatureServer | (remote) `mapas2.igac.gov.co/.../MapServer/1` | — | active | map (AOI selector) | `ADMIN_MUNI` | Click-to-select for AOI analysis. |
| `ADMIN_SIRAP` | SIRAP Regions | admin | Regional conservation planning areas. | MADS | GeoJSON | `eco-plan/public/data/sirap-regions.geojson` | — | active | map (AOI selector, default visible) | `ADMIN_SIRAP` | Multi-ring polygons with part/whole selection support. |
| **LEFT SIDEBAR — DISPLAY LAYERS (placeholders, not wired to map data)** | | | | | | | | | | | |
| `DISP_ECO_TYPES` | Ecosystem Types | env-service | Generic ecosystem type visualization. | TBD | TBD | — | — | placeholder | left-sidebar | `ECO_TYPES` | UI row exists (`layer-eco-types`), mapUnavailable: true. |
| `DISP_PARAMOS` | Páramos (display) | env-service | Páramo ecosystem overlay for map. | Humboldt (IAvH) | TBD | — | — | placeholder | left-sidebar | `ECO_TYPES` | Has data in `features/Ecos_Estrategico/paramos.tif` but not wired as map layer. |
| `DISP_WETLANDS` | Wetlands (display) | env-service | Wetland overlay for map. | IDEAM | TBD | — | — | placeholder | left-sidebar | `ECO_TYPES` | Has data in `features/Ecos_Estrategico/humedales.tif` but not wired. |
| `DISP_DRY_FOREST` | Dry Forest (display) | env-service | Dry forest overlay for map. | IDEAM | TBD | — | — | placeholder | left-sidebar | `ECO_TYPES` | Has data in `features/Ecos_Estrategico/bosque_seco.tif` but not wired. |
| `DISP_MANGROVES` | Mangroves (display) | env-service | Mangrove overlay for map. | INVEMAR | TBD | — | — | placeholder | left-sidebar | `MARINE_MANGROVE` | Has data in `features/Ecos_Estrategico/` but not wired. |
| `DISP_CARBON` | Carbon Storage | env-service | Above-ground biomass, soil organic carbon. | IDEAM | TBD | — | — | placeholder | left-sidebar | `ECO_CARBON_TOTAL` | No data in repo. |
| `DISP_WATER` | Water Regulation | env-service | Water regulation / watershed services. | IDEAM | TBD | — | — | placeholder | left-sidebar | `ECO_WATER_REG` | No data in repo. |
| `DISP_INDIGENOUS` | Indigenous Reserves (display) | cultural | Resguardos Indígenas overlay. | ANT | TBD | — | — | placeholder | left-sidebar | `ETH_INDIGENOUS` | Raster exists in stack band 5. Could wire. |
| `DISP_AFRO` | Afro-Colombian Territories (display) | cultural | Comunidades Negras overlay. | ANT | TBD | — | — | placeholder | left-sidebar | `ETH_COUNCILS` | Raster exists in stack band 3. Could wire. |
| `DISP_HF` | Human Footprint (display) | socio-economic | Human footprint visualization layer. | Humboldt (IAvH) | TBD | — | — | placeholder | left-sidebar | `SOCIO_HF` | Raster exists in stack bands 1, 7. Could wire. |
| `DISP_AG_COST` | Agricultural Opportunity Cost (display) | socio-economic | Renta agropecuaria visualization. | Humboldt (IAvH) | TBD | — | — | placeholder | left-sidebar | `SOCIO_AG_COST` | Raster exists in stack band 4. Could wire. |
| `DISP_LAND_USE` | Land Use | socio-economic | Land use classification. | IDEAM / UPRA | TBD | — | — | placeholder | left-sidebar | `SOCIO_LANDUSE` | No data in repo. |
| `DISP_CONFLICT` | Conflict Zones (display) | conflict | Armed conflict visualization. | UNODC / Gov't | TBD | — | — | placeholder | left-sidebar | `CONFLICT_ZONES` | Raster exists in stack band 8. Could wire. |
| `DISP_RUNAP` | Protected Areas — RUNAP (display) | include | RUNAP overlay for map visualization. | PNNC / RUNAP | TBD | — | — | placeholder | left-sidebar (overlay) | `PA_ALL` | Raster exists in stack band 2. Left sidebar has overlay row but mapUnavailable. |
| `DISP_OMECS` | OMECs (display) | include | OMEC overlay for map visualization. | WDPA / Protected Planet | Shapefile / TBD | `data/OMECs_2025/` | — | placeholder | left-sidebar (overlay) | `PA_OMEC` | Vector data exists. Left sidebar has overlay row but mapUnavailable. |
| **SOLUTION OUTPUTS** | | | | | | | | | | | |
| `SOL_NACIONAL_1KM` | Nacional 1km Solutions (14 scenarios) | solution | Binary solution rasters from prioritizR. Each encodes selected planning units. | PrioritizR model runs | GeoTIFF (×14) | `data/Nacional_1km_solutions/*.tif` | — | active | solution-finder → map | `SYS_SOLUTION` | Served from `eco-plan/public/data/solutions/` via sync script. |
| `SOL_EVAL_SUMMARY` | Solution Evaluation Summary | solution | Aggregated stats per scenario: n_selected, cost, pct_targets_met. | PrioritizR model runs | CSV | `data/Nacional_1km_solutions/master_eval_summary.csv` | — | active | solution-finder (match results) | `SYS_COSTS` | Currently hardcoded in SolutionCatalogService. Should load from JSON. |
| `SOL_TARGET_COVERAGE` | Solution Target Coverage | solution | Feature-level target coverage per scenario. | PrioritizR model runs | CSV | `data/Nacional_1km_solutions/master_target_coverage.csv` | — | data-only | none | `SYS_GOALS` | Available but not consumed by the app yet. |

---

## Summary

| Category | Count | Active | Placeholder | Data-Only | Needed/Unknown |
|----------|-------|--------|-------------|-----------|----------------|
| Cost Layers | 3 (+1 ref) | 3 | 0 | 1 | 0 |
| Include / Constraint | 5 | 3 | 0 | 2 | 0 |
| Feature / Target | 5 (+1 ref) | 5 | 0 | 1 | 0 |
| Species | 1 (×8,751 files) | 0 | 1 | 0 | 0 |
| Administrative | 3 | 3 | 0 | 0 | 0 |
| Display — Left Sidebar | 15 | 0 | 15 | 0 | 0 |
| Solution Outputs | 3 | 2 | 0 | 1 | 0 |
| **TOTAL** | **36** | **16** | **16** | **5** | **0** |

**Key gaps to resolve with Kevin/Nick:**
1. Several left-sidebar placeholder layers have backing data in the raster stack (bands 1–9) but are not wired to the map. Should we wire them?
2. `INCL_RESGUARDOS` (band 5) is in the data stack but not exposed as a toggle in the solution finder. Is it used in any scenarios?
3. `REF_CLIMATE_REFUGIA` (band 9) — what's its role? Is it a feature in any scenario?
4. Carbon Storage and Water Regulation have no data in the repo. Are these available from Kevin/Mesa?
5. Land Use layer — needed? What source?
6. MDD lists 49 required layers; 42 are still ❓ Unknown. Which ones are actually critical for v2?

---

## For the Google Sheet

**Tab 1: Required Layers** — copy the full table above, have Kevin/Nick fill in missing Source and Source URL fields, flag which layers are priorities.

**Tab 2: App Status** — filter to `active` and `placeholder` rows. This is what the app currently shows (or tries to show). Update as layers get wired.
