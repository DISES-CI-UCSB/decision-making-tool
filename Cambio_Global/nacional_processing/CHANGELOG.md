# Nacional Processing - Changelog

## Issue: Binary Features Were Continuous

**Problem**: When extracting features like Bosque Seco from the rij matrix, they had continuous values (1.0, 1.5, 2.0, etc.) instead of binary 0/1, even though the source raster only had 0s and 1s.

**Root Cause**: The rij matrix is created using `exact_extract` on a **shapefile**, which calculates coverage amounts. A planning unit polygon can overlap with multiple raster cells, resulting in amounts > 1. The rij creation script filters to `amount >= 1` for binary layers but stores the actual coverage amounts.

## Changes Made (Latest Update)

### 1. Corrected Resolution: 3km → 5km

**Files Changed**:
- `01_extract_features_from_rij.R`
- `02_organize_for_upload.R`
- `README.md`

**Reason**: Although the rij creation script showed `resolution="3km"`, the actual Nacional solutions and planning units are 5km resolution, as confirmed by:
- `PUs_Nacional_5km.shp` used in costs_and_constraints script
- `PUs_Nacional_5km.csv` output file
- Solutions in `output/Nacional/` are 5km

### 2. Added Binary Feature Detection

**File**: `01_extract_features_from_rij.R`

**New Logic**:
```r
# Classify features following rij creation logic
cat_by_layer <- features %>%
  group_by(archivo, id_elemento_priorizacion) %>%
  summarise(
    count = n(),
    sum_id_original = sum(id_original, na.rm = TRUE)
  )

# ONE CATEGORY LAYERS (binary): count==1 & sum==1
binary_elementos <- cat_by_layer %>%
  filter(count == 1 & sum_id_original == 1) %>%
  pull(id_elemento_priorizacion) %>%
  unique()
```

This replicates the classification logic from `2_rij_more_than_1km.R` to identify which features should be binary.

### 3. Added Binary Thresholding

**File**: `01_extract_features_from_rij.R`

**New Logic** (applied after raster creation):
```r
# Threshold binary layers (ONE CATEGORY layers should be 0/1)
if (feat_id_elemento %in% binary_elementos) {
  cat("  Thresholding to binary (0/1)...\n")
  r_values <- values(r)
  # Following rij creation logic: amount >= 1 means presence
  r_values[!is.na(r_values) & r_values >= 1] <- 1
  r_values[!is.na(r_values) & r_values < 1] <- 0
  values(r) <- r_values
}
```

This ensures binary features are converted back to 0/1 after extraction.

### 4. Updated Documentation

**Files Created**:
- `SHAPEFILE_RIJ_EXPLANATION.md` - Detailed explanation of the shapefile/rij workflow
- `CHANGELOG.md` (this file) - Summary of changes

**Files Updated**:
- `README.md` - Added notes about binary feature thresholding and shapefile usage

## Testing

To verify the fix works:

1. Run the extraction script:
   ```r
   source("Cambio_Global/nacional_processing/01_extract_features_from_rij.R")
   ```

2. Check that binary features (like Bosque Seco) now have only 0 and 1 values:
   ```r
   library(raster)
   r <- raster("Cambio_Global/nacional_processing/extracted_features/bosque_seco.tif")
   unique(na.omit(values(r)))
   # Should return: [1] 0 1
   ```

3. Check that continuous features (like species richness) still have varied values:
   ```r
   r <- raster("Cambio_Global/nacional_processing/extracted_features/especies.tif")
   summary(na.omit(values(r)))
   # Should show range of values
   ```

## Files Changed Summary

```
Cambio_Global/nacional_processing/
├── 01_extract_features_from_rij.R     [MODIFIED] - Added classification and thresholding
├── 02_organize_for_upload.R           [MODIFIED] - Changed 3km → 5km paths
├── README.md                          [MODIFIED] - Updated resolution and added notes
├── SHAPEFILE_RIJ_EXPLANATION.md       [NEW] - Detailed workflow explanation
└── CHANGELOG.md                       [NEW] - This file
```

## Previous Changes (For Reference)

### Initial Implementation
- Created processing scripts for Nacional
- Implemented feature extraction from rij matrix
- Handled accent transliteration for filenames
- Added dynamic theme and legend detection

### Vectorization Performance Fix
- Replaced loop-based raster assignment with `match()` vectorization
- Significantly improved extraction speed

### Feature Filtering
- Only extract features used in Nacional scenarios
- Filter scenarios by `SIRAP == "Nacional"`
- Dynamic ID→name mapping from scenarios spreadsheet

