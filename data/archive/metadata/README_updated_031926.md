# Data Codebook — `mesa_prioridades/data/`

**Project:** Colombia Conservation Prioritization (prioritizR)
**Last Updated:** 2026-02-27

---

## Directory Overview

| Path | Description |
|------|-------------|
| `cost_constraints_stack_1km.tif` | Multi-band GeoTIFF raster stack of costs and constraints used in prioritizR runs |
| `features/` | Conservation feature rasters commonly applied across prioritization runs |
| `Nacional_1km_solutions/` | Sample final prioritizR solution rasters and their summary statistics |
| `OMECs_2025/` | Shapefile of Other Effective area-based Conservation Measures (OMECs) in Colombia |
| `species(8700)/` | Individual species distribution rasters (8,751 files) |

---

## 1. `cost_constraints_stack_1km.tif`

A multi-band GeoTIFF raster stack containing the cost layers and spatial constraints fed into the prioritizR optimization. Each band represents a different cost surface or constraint used across prioritization scenarios.

### Raster Metadata

| Property | Value |
|----------|-------|
| Dimensions | 2,069 rows x 1,497 cols x 8 bands |
| Resolution | ~0.00833° x 0.00833° (~1 km) |
| CRS | WGS 84 (EPSG:4326) |
| Extent | xmin = -79.183, xmax = -66.708, ymin = -4.592, ymax = 12.650 |
| Format | GeoTIFF |

### Band Descriptions

| Band | Name | Description | Values | Role in prioritizR |
|------|------|-------------|--------|---------------------|
| 1 | `HF_2030` | Projected Human Footprint 2030 (conservationist scenario). Index of anticipated human impact. | 0–100 (continuous) | **Cost layer** — the solver minimizes total cost (human footprint) while meeting conservation targets |
| 2 | `RUNAP_23_mode` | National System of Protected Areas of Colombia (RUNAP), 2023. Categorical IDs for 15 protected area management categories. | 1–15 (categorical) | **Locked-in constraint** — forces already-protected planning units into the solution |
| 3 | `comunidades_mode` | Afro-Colombian community territories (*Comunidades Negras*). Binary indicator of community territory presence. | 0–1 (binary) | **Inclusion constraint** — can be locked into the solution |
| 4 | `Renta_agropecuaria` |aka Net Benefit Agricultural income/rent (*Renta Agropecuaria*). Monetary opportunity cost of converting land from agriculture to conservation. | 0–2.15e9 (continuous) | **Alternative cost layer** |
| 5 | `resguardo_mode` | Indigenous reserves (*Resguardos Indígenas*). Binary indicator of indigenous reserve presence. | 0–1 (binary) | **Inclusion constraint** — can be locked into the solution |
| 6 | `OMECS_mode` | Other Effective area-based Conservation Measures (OMECs/OECMs). WDPA/WDOECM management categories for non-PA sites with conservation outcomes. | 0–20 (categorical) | **Optional locked-in constraint** |
| 7 | `IHEH_2022` | Human Footprint Index 2022 (*Índice de Huella Espacial Humana*). Measured current human footprint. | 0–100 (continuous) | **Alternative cost layer** |
| 8 | `coca_muertes_1622` | Coca cultivation and conflict-related deaths composite index, 2016–2022. Measure of armed-conflict intensity. | 0–265.56 (continuous) | **Cost layer or exclusion constraint** |
| 9 | `climate_refugia` | Identifies specific geographical areas within Colombia expected to remain relatively buffered from, or resilient to, the impacts of climate change 2021-2040_ssp585_10 | (continuous) | 

---

## 2. `features/`

Conservation feature rasters commonly used across prioritization runs. These represent the biodiversity and ecosystem targets that the prioritizR solver aims to protect.

### `ecosistemas.tif`

| Property | Value |
|----------|-------|
| Description | Species richness layer  raster for Colombia. Each cell represents a continuous value for species richness. Used as the primary conservation feature in `Ecos17` and `Ecos30` scenarios. |
| Total amount | 358,015,939 (planning unit–cells) |
| Typical targets | 17% (`Ecos17` scenarios) or 30% (`Ecos30` scenarios) representation of high species richness |
| Format | GeoTIFF |

### `Ecos_Estrategico/` — Strategic Ecosystems

Rasters for four nationally strategic ecosystem types used in the `ESTR30` scenarios (30% representation target each).

| File | Description | Total Amount |
|------|-------------|-------------|
| `paramos.tif` | Páramo (high-altitude Andean grasslands) | 2,639,873 |
| `Manglares INVEMAR.tif` | Mangroves, mapped by INVEMAR (Institute of Marine and Coastal Research) | 3,179 |
| `humedales.tif` | Wetlands (*Humedales*) | 2,376,010 |
| `bosque_seco.tif` | Tropical dry forest (*Bosque Seco*) | 12,022 |

All strategic ecosystem rasters are binary (presence/absence) GeoTIFFs at ~1 km resolution, matching the planning unit grid.

---

## 3. `Nacional_1km_solutions/`

Contains a sample of final prioritizR solution rasters and summary statistics for multiple prioritization scenarios. Each scenario varies in the number of ecosystems targeted, cost layers used, and constraints applied.

### Solution Rasters (`.tif`)

Binary (0/1) raster outputs indicating which planning units were selected in each prioritization run. File names encode the scenario parameters:

| File | Ecosystems | Constraints | Cost |
|------|------------|-------------|------|
| `Ecos17+RUNAP_HF.tif` | 17 ecosystem targets | RUNAP locked-in | Human Footprint |
| `Ecos17+RUNAP_HF_comunidades.tif` | 17 ecosystem targets | RUNAP + Comunidades locked-in | Human Footprint |
| `Ecos17+RUNAP_CO.tif` | 17 ecosystem targets | RUNAP locked-in | Net Benefit |
| `Ecos17+RUNAP_comunidades_CO.tif` | 17 ecosystem targets | RUNAP + Comunidades locked-in | Net Benefit |
| `Ecos17+RUNAP+OMEC_HF.tif` | 17 ecosystem targets | RUNAP + OMECs locked-in | Human Footprint |
| `Ecos17+RUNAP+OMEC_CO.tif` | 17 ecosystem targets | RUNAP + OMECs locked-in | Net Benefit |
| `Ecos17+RUNAP_CONFLICTO.tif` | 17 ecosystem targets | RUNAP locked-in | Conflict (coca/deaths) |
| `Ecos30+RUNAP_HF.tif` | 30 ecosystem targets | RUNAP locked-in | Human Footprint |
| `Ecos30+RUNAP_HF_comunidades.tif` | 30 ecosystem targets | RUNAP + Comunidades locked-in | Human Footprint |
| `Ecos30+RUNAP_CO.tif` | 30 ecosystem targets | RUNAP locked-in | Net Benefit |
| `Ecos30+RUNAP+OMEC_HF.tif` | 30 ecosystem targets | RUNAP + OMECs locked-in | Human Footprint |
| `Ecos30+RUNAP+OMEC_CO.tif` | 30 ecosystem targets | RUNAP + OMECs locked-in | Net Benefit |
| `Ecos30+RUNAP_CONFLICTO.tif` | 30 ecosystem targets | RUNAP locked-in | Conflict (coca/deaths) |
| `ESTR30+RUNAP_HF.tif` | 30 strategic ecosystem targets (páramos, mangroves, wetlands, dry forest) | RUNAP locked-in | Human Footprint |

### Summary Statistics Files

#### `master_eval_summary.csv`

Aggregated evaluation summary across all scenarios.

| Column | Description |
|--------|-------------|
| `run` | Scenario name (matches solution raster filename prefix) |
| `n_selected` | Number of planning units selected in the solution |
| `cost` | Total cost of the solution (units depend on cost layer used) |
| `pct_targets_met` | Percentage of conservation targets met (always 100% for feasible solutions) |

#### `master_target_coverage.csv`

Feature-level target coverage across all scenarios.

| Column | Description |
|--------|-------------|
| `feature` | Conservation feature name (e.g., `ecosistemas`, `paramos`, `humedales`, `bosque_seco`, `Manglares INVEMAR`) |
| `met` | Whether the target was met (`TRUE`/`FALSE`) |
| `total_amount` | Total amount of the feature across all planning units |
| `absolute_target` | Absolute representation target for the feature |
| `absolute_held` | Absolute amount of the feature held in the solution |
| `absolute_shortfall` | Shortfall (difference between target and held, 0 if met) |
| `relative_target` | Target as a proportion of total (e.g., 0.17 = 17%, 0.30 = 30%) |
| `relative_held` | Proportion of the feature held in the solution |
| `relative_shortfall` | Proportional shortfall |
| `run` | Scenario name |


### Supporting Data Files

| File | Description |
|------|-------------|
| `species_names.rds` | R object containing the vector of species names used as conservation features |
| `species_rij_matrix.rds` | R object containing the species-by-planning-unit representation matrix (rij matrix) used by prioritizR |

---

## 4. `OMECs_2025/`

Shapefile of Other Effective area-based Conservation Measures (OMECs/OECMs) in Colombia, sourced from the WDPA/WDOECM database (February 2026 public release).

### Files

| File | Description |
|------|-------------|
| `WDPA_WDOECM_Feb2026_Public_COL_shp-polygons.shp` | Shapefile geometry |
| `WDPA_WDOECM_Feb2026_Public_COL_shp-polygons.dbf` | Attribute table |
| `WDPA_WDOECM_Feb2026_Public_COL_shp-polygons.shx` | Spatial index |
| `WDPA_WDOECM_Feb2026_Public_COL_shp-polygons.prj` | Projection definition |
| `WDPA_WDOECM_Feb2026_Public_COL_shp-polygons.cpg` | Character encoding |

### Metadata

| Property | Value |
|----------|-------|
| Source | World Database on Protected Areas / World Database on OECMs (WDPA/WDOECM) |
| Release | February 2026, Public |
| Country | Colombia (COL) |
| CRS | WGS 84 (GCS_WGS_1984) |
| Geometry | Polygons |

---

## 5. `species(8700)/`

Individual species distribution model (SDM) rasters for Colombia. Contains **8,751 GeoTIFF files**, each representing the predicted distribution of a single species.

### File Naming Convention

```
{Genus}_{species}_{threshold}_{algorithm}.tif
```

| Component | Description | Example |
|-----------|-------------|---------|
| `Genus` | Taxonomic genus | `Panthera` |
| `species` | Specific epithet | `onca` |
| `threshold` | Model threshold (10th percentile training presence) | `10` |
| `algorithm` | SDM algorithm used | `MAXENT` |

**Example:** `Panthera_onca_10_MAXENT.tif`

### Metadata

| Property | Value |
|----------|-------|
| Count | 8,751 raster files |
| Format | GeoTIFF |
| Source | BioModelos / MaxEnt species distribution models |
| Values | Binary (0/1) or continuous habitat suitability, thresholded at the 10th percentile |
| Taxonomic coverage | Plants, birds, mammals, reptiles, amphibians, freshwater fish |
| Resolution | ~1 km (matching planning unit grid) |

---

## Scenario Naming Key

The solution filenames follow a systematic naming convention:

| Abbreviation | Meaning |
|--------------|---------|
| `Ecos17` | 17 ecosystem representation targets (17% target per ecosystem) |
| `Ecos30` | 30 ecosystem representation targets (30% target per ecosystem) |
| `ESTR30` | 30% target for strategic ecosystems (páramos, mangroves, wetlands, dry forest) |
| `RUNAP` | RUNAP protected areas locked into solution |
| `OMEC` | OMECs additionally locked into solution |
| `HF` | Human Footprint used as cost layer |
| `CO` | Net Benefit (Renta_agropecuaria) used as cost layer |
| `CONFLICTO` | Conflict index (coca + deaths) used as cost layer |
| `comunidades` | Afro-Colombian community territories locked into solution |
