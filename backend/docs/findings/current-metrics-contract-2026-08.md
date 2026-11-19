# Current metric formulas, inputs, and availability — August 2026

This document records what the analysis pipeline currently calculates, what each metric appears intended to communicate, which inputs it uses, and whether those inputs are available for national and SIRAP solutions. It is an audit of the implemented system, not a claim that every current label or formula is scientifically approved.

The primary implementation authority is `data/metrics/python/metrics_pipeline/metric_definitions.py` together with its calculators. The older design inventory, `docs/design/DISES Metrics - Finalized Metrics.csv`, is useful historical context but is not an accurate description of every current formula.

## How to read this document

- **Available and used** means the current pipeline has an input binding and calculation path.
- **Available but not bound** means the data exists, but the fail-closed SIRAP policy currently prevents the pipeline from using it.
- **Present, meaning unresolved** means a plausible file exists but its scientific meaning, units, or lineage have not been confirmed.
- **Incoming** means the science team has said the layer is being prepared but it was not in the audited delivery.
- **Not applicable** means the metric should not be evaluated for that domain or regional product.
- **Decision required** means the issue is the metric definition—not a missing file.

The active catalog contains **41 canonical metric definitions**: 38 per-solution definitions and three live pairwise-comparison definitions. Metric number #36 has separate land and marine definitions, so metric number alone is not a unique identifier.

## Current metric comparison

| # | Current metric | Current implemented formula | What it appears intended to communicate | Current inputs | National data | SIRAP data | Notes and recommended direction |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `conservation_goals_met` — Conservation Goals Met | Percentage supplied by the solution summary; for regional summaries, `target rows marked met ÷ targetable rows × 100`. | How many modeled conservation targets the solution achieved. | Prioritizr solution summary / authoritative regional summary CSV. | Available and used. | Available and used. | Post-hoc rows without targets must not be counted as target successes or failures. |
| 2 | `species_groups_protected` — Species Groups Protected | Numeric value is the count of species whose in-scope range coverage meets the configured target; details split outcomes by taxonomic bucket and IUCN status. | Target attainment across modeled species, summarized by species group. | Species range matrices, scientific name, taxonomic class, IUCN status, and species target policy. | Available and used through the national species catalog and matrices. | Available as post-hoc 17% and 30% reference outcomes (`partial`), not solver-target attainment. | All 8,129 regional matrix names join uniquely to the pinned national taxonomy/IUCN lookup. The label says “groups,” but each reference value is a species count. |
| 3 | `threatened_species_secured` — Threatened Species Secured | Count CR/EN/VU non-fish species where `selected in-scope range area ÷ total in-scope range area × 100 ≥ target %`. | Number of threatened species meeting a defined representation target in the selected area. | Species matrices, national taxonomy/IUCN lookup, and target policy. | Available and used. | Available as post-hoc 17% and 30% reference outcomes (`partial`). | Regional species were not solver targets, so the release reports explicit reference thresholds without claiming target attainment. |
| 4 | `ecosystem_coverage` — Ecosystem Coverage | Area of selected cells whose IAvH `biome_id` is in 1–430. | Selected area overlapping mapped ecosystem classes. | IAvH 2024 categorical ecosystem raster. | Available and used. | Regional 300 m / 500 m ecosystem rasters exist. | This is km² of mapped ecosystems, not a percentage and not a count of ecosystem types. |
| 5 | `carbon_storage_biomass` — Carbon Storage Capacity | `Σ(selected biomass-carbon density × pixel area in km²)`, using the established national unit convention. | A total of combined above- and below-ground biomass carbon in selected cells. | National `biomasa_areara+subterranea_1km.tif`; regional `carbono_EC.tif` and `carbono_orinoquia.tif`. | Available and used. | `not_applicable`. | Exact duplicate of #39; SIRAP emits only Total Carbon Biomass Conserved. |
| 6 | `water_regulation_area` — Water Regulation Services Area | Area of `selected cells ∩ moderate/high groundwater-recharge mask`. | How much selected area overlaps mapped moderate-to-high groundwater recharge potential. | Binary `recarga_agua_subterranea_moderado_alto` layer. | Available and used. | Treated as available by the current SIRAP calculation path. | This is an area-overlap metric, not water volume or modeled regulation capacity. |
| 9 | `agricultural_area` — Conservation Area on Agricultural Land | Area of `selected cells ∩ Level-1 land-cover class 2`. | Selected area classified as agricultural territory. | IDEAM 2022 Level-1 land-cover raster and class legend. | Available and used. | Available and used through an explicit checksum-pinned national-reference binding. | `ideam_clc_2022_level1_national.tif` is aligned categorically with nearest-neighbor to each SIRAP grid. |
| 17 | `national_contribution` — National Contribution | `selected solution area ÷ total valid area in the same solution raster × 100`. | Intended nationally as the share of Colombia’s valid planning surface selected. | Solution raster only. | Available and used. | `not_applicable`; #19 is used for SIRAP contribution. | A regional percentage is not labeled National Contribution. |
| 18 | `priority_area_in_region` — Priority Area (Selected) | Sum of the area of selected solution cells. | Total selected priority area in the current scope. | Solution raster. | Available and used. | Available and used. | The scope determines whether this means Colombia, a SIRAP, or a nested AOI. |
| 19 | `priority_area_pct_of_region` — Priority Area % of Region | `selected area ÷ valid area in the current boundary × 100`. | Share of the current AOI or SIRAP selected as priority area. | Solution raster and scope mask. | Not applicable at national scope because it duplicates #17. | Available and used. | This is the clearest existing formula for “SIRAP contribution.” |
| 21 | `species_richness_mammals` — Species Richness: Mammals | Count Mammalia species with any range overlap with selected cells in scope. | Mammal species represented by the selected area. | Species range matrices and taxonomic class. | Available and used. | Available where the regional packet declares a mammal matrix. | Verify matrix completeness by region; no separate national denominator is needed. |
| 22 | `species_richness_birds` — Species Richness: Birds | Count Aves species with any range overlap with selected cells in scope. | Bird species represented by the selected area. | Species range matrices and taxonomic class. | Available and used. | Available where the regional packet declares a bird matrix. | Verify matrix completeness by region. |
| 23 | `species_richness_amphibians` — Species Richness: Amphibians | Count Amphibia species with any range overlap with selected cells in scope. | Amphibian species represented by the selected area. | Species range matrices and taxonomic class. | Available and used. | Available where the regional packet declares an amphibian matrix. | Verify matrix completeness by region. |
| 24 | `species_richness_reptiles` — Species Richness: Reptiles | Count Squamata and Crocodylia species with any range overlap with selected cells in scope. | Reptile species represented by the selected area. | Species range matrices and taxonomic class. | Available and used. | Available where the regional packet declares reptile matrices. | Verify matrix completeness by region. |
| 25 | `species_richness_plants` — Species Richness: Plants | Count Magnoliopsida species with any range overlap with selected cells in scope. | Plant species represented by the selected area. | Species range matrices and taxonomic class. | Available and used. | Available; the separate Orinoquía matrices passed parity checks. | The audited RDS matrices carry names but not IUCN fields; taxonomy/IUCN can be joined from the national lookup. |
| 26 | `threatened_species_count` — Threatened Species Count | Count CR/EN/VU non-fish species with any range overlap with selected cells in scope. | Threatened species represented by the selected area, regardless of target attainment. | Species matrices plus national taxonomy/IUCN lookup. | Available and used. | Available and used. | The release uses the exact, fail-closed regional-name join to pinned national IUCN metadata. |
| 28 | `species_pct_of_national` — % of National Species Total | `non-fish species represented in scope ÷ 8,300 × 100`. | Representation relative to the pipeline’s national non-fish species universe. | Species matrices and national species catalog; Actinopteri excluded. | Available and used. | Available and used with the pinned 8,300-species national denominator. | The regional numerator comes only from packet SMSP cells; the denominator is explicitly bound rather than implicitly fetched. |
| 30 | `ecosystem_coverage_paramo` — Ecosystem Coverage: Páramo | Area of `selected cells ∩ páramo mask`. | Selected priority area overlapping páramo. | Binary páramo layer. | Available and used. | Regional layer available and used by the SIRAP model/pipeline. | Distinct from the general ecosystem raster. |
| 31 | `ecosystem_coverage_dry_forest` — Ecosystem Coverage: Dry Forest | Area of `selected cells ∩ dry-forest mask`. | Selected priority area overlapping tropical dry forest. | Binary dry-forest layer. | Available and used. | Regional layer treated as available by the current SIRAP path. | Distinct from Level-1 land-cover forest class. |
| 32 | `ecosystem_coverage_wetlands` — Ecosystem Coverage: Wetlands | Area of `selected cells ∩ strategic-wetlands mask`. | Selected priority area overlapping strategic wetland data. | Binary wetlands layer. | Available and used. | Available according to the SIRAP model delivery and Nick. | This is not #55. #32 uses a strategic wetlands layer; #55 uses the wetlands class in complete Level-1 land cover. |
| 35 | `coral_reef_coverage` — Coral Reef Coverage | Area of selected marine cells whose ecosystem class is one of 23, 32, 89, 108, 118, or 140. | Coral formations represented by a marine solution. | Categorical marine ecosystem raster. | Available and used for marine solutions. | Not applicable to the two land SIRAPs. | Keep domain-specific. |
| 36 | `mangrove_coverage` — Mangrove Coverage (land) | Area of `selected cells ∩ strategic mangrove mask`. | Mangrove overlap for land solutions. | Binary national strategic mangrove layer. | Available and used. | `not_applicable`. | These two land SIRAP products explicitly exclude mangrove reporting. |
| 36 | `marine_mangrove_coverage` — Marine Mangrove Coverage | Area of selected marine cells whose ecosystem class is one of 55, 56, 72, or 80. | Mangrove ecosystems represented by a marine solution. | Categorical marine ecosystem raster. | Available and used for marine solutions. | Not applicable to the two land SIRAPs. | Same metric number as land mangroves but a distinct metric ID and input. |
| 37 | `seagrass_coverage` — Seagrass Bed Coverage | Area of selected marine cells whose ecosystem class is one of 86, 88, or 117. | Seagrass beds represented by a marine solution. | Categorical marine ecosystem raster. | Available and used for marine solutions. | Not applicable to the two land SIRAPs. | Keep domain-specific. |
| 39 | `carbon_biomass_total` — Total Carbon Biomass Conserved | `Σ(selected biomass-carbon density × pixel area in km²)`, using the established national unit convention. | Total combined above- and below-ground biomass carbon conserved in selected cells. | National combined source; checksum-pinned regional `carbono_EC.tif` / `carbono_orinoquia.tif` for SIRAP. | Available and used. | Available and used (`ready`). | This is the sole SIRAP carbon outcome. |
| 41 | `soil_organic_carbon` — Soil Organic Carbon | `Σ(selected SOC raster value × pixel area in km²)`. | Soil organic carbon represented by selected cells. | National `carbono_organico.tif`. | Available and used. | Not applicable to approved SIRAP reporting. | **SOC means soil organic carbon.** Nick confirmed this is not part of the intended SIRAP carbon metric; retire/hide it for SIRAP rather than request a regional SOC raster. |
| 43 | `carbon_pct_of_national` — % of National Carbon | `selected biomass weighted sum ÷ weighted sum of all finite cells in the biomass raster × 100`. | A percentage comparison to the national combined biomass total. | Same biomass raster as #5/#39. | Available and used. | Not applicable to the approved one-number SIRAP reporting scope. | This is a second statistic, not a second carbon pool. Retire/hide it for SIRAP if “one metric” excludes national-share reporting. |
| 44 | `water_regulation_pct` — Water Regulation Capacity | `area(selected ∩ recharge mask) ÷ selected area × 100`. | Share of selected area with moderate/high recharge potential. | Same binary recharge layer as #6. | Available and used. | Treated as available by the current SIRAP path. | The label “capacity” overstates a binary spatial-overlap calculation. Currently cached/exportable but not visibly presented in the dashboard. |
| 51 | `land_use_forests_and_semi_natural_areas_pct` — Forests and Semi-natural Areas | `area(selected ∩ Level-1 class 3) ÷ selected area × 100`. | Land-cover composition of the selected area. | IDEAM 2022 Level-1 raster and 1–5 legend. | Available and used. | Available and used through the pinned Level-1 binding. | Categorical nearest-neighbor alignment; Level 1 combines forest and semi-natural areas. |
| 52 | `land_use_agricultural_areas_pct` — Agricultural Areas | `area(selected ∩ Level-1 class 2) ÷ selected area × 100`. | Agricultural share of selected area. | IDEAM 2022 Level-1 raster and legend. | Available and used. | Available and used through the pinned Level-1 binding. | Level 1 combines pasture and crops; it cannot support separate pasture/crop metrics. |
| 54 | `land_use_artificial_surfaces_pct` — Artificial Surfaces | `area(selected ∩ Level-1 class 1) ÷ selected area × 100`. | Artificial-surface share of selected area. | IDEAM 2022 Level-1 raster and legend. | Available and used. | Available and used through the pinned Level-1 binding. | The implementation supersedes the older “Land Use: Other” definition. |
| 55 | `land_use_wetlands_pct` — Wetlands | `area(selected ∩ Level-1 class 4) ÷ selected area × 100`. | Wetland share within complete Level-1 land-cover composition. | IDEAM 2022 Level-1 raster and legend. | Available and used. | Available and used through the pinned Level-1 binding. | Distinct from the strategic wetlands layer used by #32. |
| 56 | `land_use_water_bodies_pct` — Water Bodies | `area(selected ∩ Level-1 class 5) ÷ selected area × 100`. | Water-body share within complete Level-1 land-cover composition. | IDEAM 2022 Level-1 raster and legend. | Available and used. | Available and used through the pinned Level-1 binding. | Part of the five-class composition. |
| 59 | `indigenous_reservations_area` — Indigenous Reservations Area | Area of `selected cells ∩ resguardos mask`. | Selected priority area overlapping legally recognized Indigenous territories. | Binary `resguardos` layer. | Available and used. | Treated as available by the current SIRAP path. | Coordinate public terminology with #66. |
| 60 | `community_councils_area` — Community Councils Area | Area of `selected cells ∩ comunidades mask`. | Selected priority area overlapping Afro-Colombian collective territories. | Binary `comunidades` layer. | Available and used. | Treated as available by the current SIRAP path. | Confirm preferred public terminology. |
| 63 | `protected_area_runap_km2` — Total Protected Area in AOI (RUNAP) | Area of selected cells overlapping any valid RUNAP cell/category. | Existing protected-area overlap across all RUNAP categories. | RUNAP raster treated as a presence mask. | Available and used. | Regional `runap` presence masks are available. | The regional files support “any RUNAP overlap” even though they cannot identify category 3. |
| 64 | `national_parks_pct` — % Overlap with National Parks | `area(selected ∩ RUNAP category 3) ÷ selected area × 100`. | Share of selected area overlapping Parque Nacional Natural. | National categorical RUNAP raster plus legend; class 3. | Available and used. | Available and used through an explicit checksum-pinned national-reference binding. | Category 3 is aligned to each regional grid with nearest-neighbor resampling; the regional any-RUNAP mask remains separate. |
| 66 | `indigenous_territory_pct` — % Overlap with Indigenous Territories | `area(selected ∩ resguardos) ÷ selected area × 100`. | Proportion of selected area overlapping Indigenous territories. | Same `resguardos` layer as #59. | Available and used. | Treated as available by the current SIRAP path. | Percentage companion to #59. |
| 70 | `agreement_area` — Agreement Area | Area selected in both solution A and solution B. | Spatial agreement between two solutions. | Two solution rasters on the same grid. | Available through live comparison. | Available through live comparison of two SIRAP solutions. | Deliberately not stored in per-solution metric caches. |
| 71 | `unique_to_solution_a` — Unique to Solution A | Area selected in A but not B. | Priority area unique to the baseline solution. | Two solution rasters on the same grid. | Available through live comparison. | Available through live comparison. | Deliberately computed from the selected pair. |
| 72 | `unique_to_solution_b` — Unique to Solution B | Area selected in B but not A. | Priority area unique to the comparison solution. | Two solution rasters on the same grid. | Available through live comparison. | Available through live comparison. | Deliberately computed from the selected pair. |

## Carbon discrepancy

### What the project originally described

The finalized design CSV proposed several carbon concepts:

- #5 Carbon Storage Capacity
- #39 Total Carbon Biomass
- #40 Above-ground Carbon
- #41 Soil Organic Carbon
- #43 % of National Carbon

This list described desired reporting concepts; it did not prove that five distinct source datasets or scientifically independent calculations existed.

### What the pipeline actually implemented

The implementation added four carbon entries:

1. **#5 and #39 use the same source and the same formula.** Both sum the combined above- plus below-ground biomass raster over selected cells. They are duplicate calculations with different labels/UI contexts.
2. **#40 was never implemented.** There is no separate above-ground-only metric because the named national biomass file is already combined above + below ground.
3. **#41 uses a distinct national file, `carbono_organico.tif`.** SOC means soil organic carbon; it is a different carbon pool from above-/below-ground biomass.
4. **#43 is a percentage derived from the same biomass source as #5/#39.** It compares selected biomass with the weighted total across all finite cells in the national biomass raster.

The older R/Shiny processing path confirms that the operational inputs were also two pools—not separate above- and below-ground outputs:

- `agb_plus_bgb_spawn_2020_fixed_1km.tif` became one combined `biomasa_aerea_mas_subterranea.tif` product.
- `GSOC_v1.5_fixed_1km.tif` became a distinct `carbono_organico_suelos.tif` product.

This evidence appears in `legacy-r-shiny-app/Cambio_Global/*_processing/01_extract_features_from_rij.R` and the accompanying Eje Cafetero processing explanation. A separate above-ground value existed in product specifications and mockups, but not in the implemented national data path.

The current raw output unit is also unresolved. The calculators emit `raster value × km²`. If the raster is in Mg/ha, the result must be multiplied by 100 to report total Mg because one km² equals 100 ha. The pipeline currently does not apply that conversion.

### What exists for SIRAP

- Eje Cafetero: `inputs/features/ecosystem_services/carbono_EC.tif`, 300 m.
- Orinoquía: `inputs/features/ecosystem_services/carbono_orinoquia.tif`, 500 m.

Both files align to their regional grids. Their embedded metadata identifies them only as `carbono`; it does not establish their source lineage, units, represented carbon pool, or whether they were derived from the national biomass raster.

### Confirmed SIRAP carbon contract

Nick confirmed that `carbono_EC.tif` and `carbono_orinoquia.tif` represent **combined above- and below-ground biomass carbon density**. They are the regional equivalent of the national combined biomass source, not SOC.

For SIRAP reporting:

1. Calculate one value by summing the regional biomass-carbon density across selected cells, using the established national unit convention.
2. Retain one canonical metric named **Total Carbon Biomass Conserved**; map it to current metric ID `carbon_biomass_total` (#39).
3. Retire/hide duplicate #5 for SIRAP.
4. Mark #41 Soil Organic Carbon and #43 % of National Carbon as `not_applicable` for SIRAP unless the science team later requests them separately.

## Corrected SIRAP implementation

The SIRAP pipeline still fails closed: if a layer is not explicitly bound in the regional input packet, it refuses to fall back to a national source. Corrected packet format `sirap-metric-input-packet-v2` now binds every approved regional or national-reference input with its checksum, authority, source scope, target regional grid, and alignment policy.

The corrected implementation establishes:

- **Explicit shared-source bindings:** IDEAM 2022 Level-1 land cover and its 1–5 legend, national taxonomy/IUCN metadata and 8,300-species denominator, and national categorical RUNAP category 3.
- **Explicit regional bindings:** combined biomass-carbon density, ecosystem and strategic-ecosystem layers, any-category RUNAP overlap, and regional SMSP matrices.
- **Exact species join:** Eje Cafetero and Orinoquía each contain 8,129 unique matrix species; all 8,129 match the national lookup, with zero unmatched names, normalized duplicates, or taxonomic-class mismatches.
- **Post-hoc outcomes:** species coverage uses separate 17% and 30% reference outcomes (`partial`), because regional species were not solver targets. MEC ecosystem coverage is published for national, department, municipality, SIRAP, RUNAP, and OMEC scopes without target-attainment claims.
- **Explicit exclusions:** #5, #17, land mangroves, #41, and #43 are `not_applicable` for SIRAP; #19 represents SIRAP contribution.

## Verification and publication

- [x] Targeted automated tests passed, including packet provenance, forbidden fallback, categorical alignment/class selection, RUNAP category 3, status semantics, species joins, species details, MEC semantics, and release assembly.
- [x] Representative Eje Cafetero and Orinoquía metric/species preflights passed with complete 8,129-species processing.
- [x] MEC preflights passed across all six geography levels in both regions.
- [x] The full sequential build produced 56 regular metric artifacts, 168 species-detail partitions, and 336 MEC partitions with zero calculation failures.
- [x] Immutable release `sirap-2026-08-31-v3` assembled 841 release artifacts and remotely verified 844 uploaded objects, including its catalog, manifest, and inventory.
- [x] Catalog release `catalog-v3-0-2-20260901` activates the corrected SIRAP manifest in production.

Published manifest: `https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/sirap-2026-08-31-v3/manifest.json`

## Implementation evidence

- Active catalog: `data/metrics/python/metrics_pipeline/metric_definitions.py`
- Metric dispatch and SIRAP hard-coded blocks: `data/metrics/python/metrics_pipeline/main.py`
- Layer resolution and national-fallback prohibition: `data/metrics/python/metrics_pipeline/blob_manifest.py`
- Carbon formulas: `data/metrics/python/metrics_pipeline/calculators/carbon.py`
- Species formulas: `data/metrics/python/metrics_pipeline/calculators/species.py`
- Land-cover formulas: `data/metrics/python/metrics_pipeline/calculators/land_cover.py`
- Area formulas: `data/metrics/python/metrics_pipeline/calculators/area.py`
- Older design inventory: `docs/design/DISES Metrics - Finalized Metrics.csv`
- National input inventory: `data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv`
- Prior SIRAP blocker inventory: `docs/findings/sirap-missing-metric-inputs-2026-08.md`
