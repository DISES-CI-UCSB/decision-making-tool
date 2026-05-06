# ORINOQUIA Processing Workflow

This folder contains scripts to process ORINOQUIA prioritization data for upload to the decision-making tool.

## Overview

The ORINOQUIA project uses **3km resolution** planning units covering the Orinoquia region of Colombia. Note that the rij matrix is created using a shapefile with `exact_extract`, not directly from rasters.

## Data Sources

- **Planning Units**: `PUs/PUs_ORINOQUIA_3km.tif` and `input/PUs_ORINOQUIA_3km.csv`
- **RIJ Matrix**: `input/rij_ORINOQUIA_3km.fst` (created from shapefile using `exact_extract`)
- **Features Metadata**: `input/features_v4_4_24_(MAPV).xlsx`
- **Scenarios**: `input/scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx` (contains ORINOQUIA scenarios)
- **Solutions**: `output/ORINOQUIA/*.tif`

## Important Notes

- **Binary Features**: Features classified as "ONE CATEGORY" layers (where `count==1` and `sum(id_original)==1`) are automatically thresholded to 0/1 after extraction to ensure they remain binary, even though the rij stores coverage amounts that may be > 1.

- **Solution Naming**: ORINOQUIA solutions have a unique naming convention (e.g., `R1O_Especies focales+RUNAP_HF_30.tif`). The script matches these to scenarios in `scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx` to extract themes, targets, weights, and includes/excludes. Manual review is recommended to verify the mapping is correct.

- **No ORINOQUIA-specific scripts**: Unlike Nacional and Eje Cafetero, there are no original processing scripts that explicitly reference ORINOQUIA. This pipeline is reverse-engineered based on available data files.

## Scripts

1. **`01_extract_features_from_rij.R`**: Extracts feature layers from the rij matrix
   - Auto-detects binary vs continuous layers
   - Thresholds binary layers to 0/1
   - Handles accent transliteration for filenames
   
2. **`02_organize_for_upload.R`**: Organizes layers and solutions into upload-ready format
   - Generates layers.csv with dynamic legend/color detection
   - Parses ORINOQUIA solution filenames
   - **Outputs solutions.csv that requires manual review**
   
3. **`00_run_all.R`**: Master script to run the entire workflow

## Output Structure

```
upload_ready/
├── PU_ORINOQUIA_3km.tif
├── layers/
│   ├── [feature].tif
│   └── layers.csv           (inside layers folder)
└── solutions/
    ├── [scenario].tif
    └── solutions.csv         (inside solutions folder)
```

## Usage

```r
# Run the entire workflow
source("00_run_all.R")

# Or run scripts individually
source("01_extract_features_from_rij.R")
source("02_organize_for_upload.R")
```

## Manual Review Recommended

After running the scripts, **review** `upload_ready/solutions/solutions.csv`:

1. **themes**: Verify feature names from scenarios are correctly mapped
2. **targets**: Check that targets from `sensibilidad` column are correct (auto-converted from percentages)
3. **weights**: Confirm cost layers from `costo` column are properly mapped to display names
4. **includes/excludes**: Verify constraint layers from `inclusion`/`exlusion` columns match scenario intent

The script extracts these from `scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx` and maps solution files by scenario number (R1O, R3O, etc.).

## Solution Filename Patterns

Common patterns in ORINOQUIA filenames:

- `R[#]O`: Scenario ID (e.g., R1O, R3O, R5O)
- `Especies focales`: Focal species
- `Especies17`: Species with 17% target
- `Ecos17`: Ecosystems with 17% target  
- `ESTR30`: Strategic ecosystems with 30% target
- `RUNAP`: Protected areas (include)
- `Comunidades`: Black communities (include)
- `OMECs`: Marine areas (include)
- `HF` or `HF_30`: Human footprint (weight - IHEH 2022)
- `RC`: Climate refuges (weight)
- `CO`: Opportunity cost (weight - Beneficio Neto)
- `CONFLICTO`: Conflict zones (weight)

## Theme Mappings

ORINOQUIA uses specific theme categorization for features:

| Feature Name | Theme | Legend Type |
|--------------|-------|-------------|
| Especies Focales | Especies / Focales | Binary |
| Habitat_condor | Especies / Focales | Binary |
| Especies(8700) | Especies / Focales | Continuous (richness) |
| especies_richness.tif | Especies / Focales | Continuous (richness) |
| Ecosistemas IAvH | Ecosistemas | Binary |
| Páramo | Ecosistemas estratégicos | Binary |
| Bosque seco | Ecosistemas estratégicos | Binary |
| HumedalesCOL_EC | Ecosistemas estratégicos | Binary |
| Congriales | Ecosistemas estratégicos | Binary |
| Áreas NucleoSIRAPO | Ecosistemas estratégicos regionales | **Continuous (coverage)** |

## Differences from Nacional/Eje Cafetero

1. **No source scripts**: ORINOQUIA not referenced in original processing scripts
2. **Different solution naming**: Uses descriptive names (R1O_...) vs simple numbers (1.tif)
3. **Resolution**: 3km (vs 5km for Nacional, 1km for Eje Cafetero)
4. **Manual review needed**: Solution metadata parsing is more uncertain
5. **Unique themes**: Includes "Especies / Focales" and "Ecosistemas estratégicos regionales"

## Testing

After generation, verify:

```r
# Check binary features have only 0/1
library(raster)
r <- raster("orinoquia_processing/extracted_features/bosque_seco.tif")
unique(na.omit(values(r)))  # Should be: [1] 0 1

# Check planning unit alignment
pu <- raster("orinoquia_processing/upload_ready/PU_ORINOQUIA_3km.tif")
extent(pu)  # Should cover Orinoquia region

# Review solutions.csv manually
read.csv("orinoquia_processing/upload_ready/solutions.csv")
```

