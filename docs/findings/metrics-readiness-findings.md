# Metrics Readiness Findings

Date: 2026-03-04  
Scope: Data availability and calculability review for finalized DISES metrics in `docs/design/DISES Metrics - Finalized Metrics.csv`.

## What We Confirmed Exists in `data/`

- Scenario outputs: multiple solution rasters in `data/Nacional_1km_solutions/*.tif`
- Scenario summaries: `master_eval_summary.csv`, `master_target_coverage.csv`
- Species inputs: `species(8700)/`, `species_names.rds`, `species_rij_matrix.rds`
- Feature rasters: `features/ecosistemas.tif`, plus `features/Ecos_Estrategico/*.tif`
- Cost/constraint stack: `cost_constraints_stack_1km.tif`
- OMEC geometry: complete shapefile set in `OMECs_2025/`

## Metric Readiness Summary

- Total finalized metrics reviewed: **49**
- **Ready now:** 20
- **Ready with light derivation/crosswalk work:** 11
- **Blocked (additional source data needed):** 18

## Ready Now (20)

`#1, #4, #8, #13, #17, #18, #19, #30, #31, #32, #36, #55, #57, #59, #60, #63, #66, #70, #71, #72`

Notes:
- `#18` and `#19` depend on AOI boundaries being available in the data/API layer.
- `#59`, `#60`, `#66` depend on indigenous/community boundary availability in the data/API layer.

## Ready With Light Derivation (11)

`#2, #9, #21, #22, #23, #24, #25, #28, #29, #33, #64`

Typical derivation work:
- Crosswalk tables (ecosystem classes, parks subsets)
- Species taxonomy grouping (for taxa richness metrics)
- Ag-mask definition and denominator normalization rules

## Blocked by Missing Inputs (18)

`#3, #5, #6, #26, #27, #34, #35, #37, #38, #39, #40, #41, #43, #44, #51, #52, #53, #54`

Missing sources are mostly:
- Species status attributes (IUCN + endemic flags)
- Carbon layers/baselines (total, above-ground, soil, national denominator)
- Water regulation layer + units
- Land-use class layer for forest/pasture/crops/other
- Marine package (EEZ, MPA, coral, seagrass)

## Practical MVP Recommendation

1. Implement all **Ready now** metrics first to maximize visible progress.
2. Add **Derivation** metrics next once crosswalks/lookup tables are defined.
3. Keep **Blocked** metrics behind explicit `Data pending` UI states until inputs are delivered.

## Related Linear Tracking

- Canonical tracker: `UCS-82` (`ANL-24: Metric-by-metric display task tracker + data readiness mapping`)
- Existing Branch 3 implementation tasks remain the execution units (`ANL-06` through `ANL-21`), with per-metric readiness linked via comments.
