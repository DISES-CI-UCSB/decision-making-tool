# Species Richness Binary Thresholding Fix

## Problem
Species richness layers for Nacional and ORINOQUIA were being saved as binary (0/1) instead of continuous, unlike Eje Cafetero which was correct.

## Root Cause
In Nacional and ORINOQUIA processing scripts, there was logic to detect and threshold binary layers based on the `binary_elementos` list. The `is_species_richness` flag (based on `length(feat_ids) > 100`) was supposed to prevent species richness from being thresholded, but this wasn't reliable enough.

The species richness layer (ID 21, "Especies") was being incorrectly thresholded to binary values even though it should remain continuous (with counts of different species per planning unit).

## Solution
Added an **explicit check** to exclude `feat_id_elemento == 21` from binary thresholding in three places:

1. **Binary thresholding logic** - Added `&& feat_id_elemento != 21` check
2. **Filename assignment** - Force ID 21 to always save as `especies_richness.tif`
3. **Datatype selection** - Force ID 21 to always use `FLT4S` (floating point)

## Files Modified

### Nacional
- `Cambio_Global/nacional_processing/01_extract_features_from_rij.R`
  - Line ~282: Added `feat_id_elemento != 21` check to binary threshold condition
  - Line ~292: Added explicit logging when keeping ID 21 as continuous
  - Line ~298: Force ID 21 to use `especies_richness.tif` filename
  - Line ~305: Added `feat_id_elemento != 21` check to datatype selection

### ORINOQUIA
- `Cambio_Global/orinoquia_processing/01_extract_features_from_rij.R`
  - Line ~298: Added `feat_id_elemento != 21` check to binary threshold condition
  - Line ~310: Added explicit logging when keeping ID 21 as continuous
  - Line ~316: Force ID 21 to use `especies_richness.tif` filename
  - Line ~323: Added `feat_id_elemento != 21` check to datatype selection

## Why Eje Cafetero Didn't Have This Issue
The Eje Cafetero script (`eje_cafetero_processing/01_extract_features_from_rij.R`) doesn't have binary thresholding logic at all - it saves everything as `FLT4S`. This simpler approach worked correctly for species richness but meant other layers weren't properly optimized as binary.

Nacional and ORINOQUIA were improved to detect and optimize binary layers, but inadvertently caught species richness in the binary threshold logic.

## Next Steps

### 1. Regenerate Nacional Layers
```r
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global")
source("nacional_processing/00_run_all.R")
```

### 2. Regenerate ORINOQUIA Layers
```r
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global")
source("orinoquia_processing/00_run_all.R")
```

### 3. Re-upload to the Tool
- Delete existing Nacional and ORINOQUIA projects from the admin page
- Upload the newly regenerated projects with the fixed species richness layers

## Verification
After regeneration, verify:
1. `especies_richness.tif` contains continuous values (not just 0/1)
2. `layers.csv` shows `Legend=continuous` for species richness (not `Legend=manual`)
3. In the tool, species richness displays with a color gradient (not binary colors)
4. Species richness values range from 0 to hundreds (not just 0 to 1)

## Expected Output in Logs
When running the extraction scripts, you should now see:
```
Processing: Especies (id_elemento: 21)
  Found XXXX feature(s) in metadata
  Found YYYY records in rij matrix
  Aggregating to richness (large number of features)...
  Keeping as continuous (species richness)
  Saved: .../especies_richness.tif
```

The key message is: **"Keeping as continuous (species richness)"**


