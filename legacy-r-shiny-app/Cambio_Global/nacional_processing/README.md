# Nacional Processing Workflow

This folder contains scripts to process Nacional prioritization data for upload to the decision-making tool.

## Overview

The Nacional project uses **5km resolution** planning units covering the entire country of Colombia. Note that the rij matrix is created using a shapefile with `exact_extract`, not directly from rasters.

## Data Sources

- **Planning Units**: `input/PUs_Nacional_5km.csv` and corresponding TIF (created from `PUs_Nacional_5km.shp`)
- **RIJ Matrix**: `input/rij_Nacional_5km.fst` (created from shapefile using `exact_extract`)
- **Features Metadata**: `input/features_v4_4_24_(MAPV).xlsx`
- **Scenarios**: `input/scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx`
- **Solutions**: `output/Nacional/*.tif`

## Important Notes

- **Binary Features**: Features classified as "ONE CATEGORY" layers (where `count==1` and `sum(id_original)==1`) are automatically thresholded to 0/1 after extraction to ensure they remain binary, even though the rij stores coverage amounts that may be > 1.

## Scripts

1. **`01_extract_features_from_rij.R`**: Extracts feature layers from the rij matrix
2. **`02_organize_for_upload.R`**: Organizes layers and solutions into upload-ready format
3. **`00_run_all.R`**: Master script to run the entire workflow

## Output Structure

```
upload_ready/
├── PU_Nacional_5km.tif
├── layers/
│   ├── [feature].tif
│   └── layers.csv
└── solutions/
    ├── [scenario].tif
    └── solutions.csv
```

## Usage

```r
# Run the entire workflow
source("00_run_all.R")

# Or run scripts individually
source("01_extract_features_from_rij.R")
source("02_organize_for_upload.R")
```

