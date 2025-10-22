# Nacional RIJ and Shapefile Workflow Explained

## The Problem

When extracting features from the Nacional `rij` matrix, binary layers (like Bosque Seco) were coming out with continuous values (1.0, 1.5, 2.0, etc.) instead of just 0 and 1.

## Why This Happens

### 1. RIJ Creation Uses Shapefiles, Not Rasters

The Nacional prioritization workflow uses **shapefiles** for planning units, not rasters:

```r
# From 2_rij_more_than_1km.R
PUs_p=read_sf("PUS_Nacional_5km.shp")
```

### 2. exact_extract Calculates Coverage

When extracting raster values to shapefile polygons, `exact_extract` calculates how much of each raster cell overlaps with each planning unit polygon:

```r
# For binary layers
df=raster(i)
df[df!=1]=NA  # Keep only cells with value 1
df=exact_extract(df, PUs_p, fun='sum')  # Sum coverage across polygon
```

The result is a **coverage amount** that can be:
- `1.0` = exactly one raster cell overlaps
- `1.5` = one and a half raster cells overlap  
- `2.0` = two raster cells overlap
- etc.

### 3. Binary Layers Are Filtered

For ONE CATEGORY layers (binary presence/absence), the rij creation script filters to keep only planning units with sufficient coverage:

```r
df=df %>% filter(amount>0.1)  # Keep partial coverage during processing
# ...
rij_cat1=rij_cat1 %>% filter(amount>=1)  # Final filter: only keep full coverage
```

So the rij stores `amount >= 1` for binary layers, but these amounts can be > 1.

### 4. Reverse Engineering Requires Thresholding

When we extract from the rij back to rasters, we get those coverage amounts (1.0, 1.5, 2.0, etc.). To make binary layers truly binary again, we need to **threshold**:

```r
# Amount >= 1 means "present"
r_values[!is.na(r_values) & r_values >= 1] <- 1
# Amount < 1 means "absent" 
r_values[!is.na(r_values) & r_values < 1] <- 0
```

## Layer Type Classification

The rij creation script classifies features into three types:

### ONE CATEGORY (Binary)
- Criteria: `count==1 & sum(id_original)==1`
- Examples: Bosque Seco, Páramos, Manglares
- Stored in rij as: `amount >= 1` (thresholded)
- **Needs thresholding** after extraction

### MULTIPLE CATEGORY
- Criteria: `count>1`
- Examples: Ecosystems with multiple categories
- Stored in rij as: `amount >= 1` per category
- May need thresholding depending on use

### NUMERIC (Continuous)
- Criteria: `is.na(sum(id_original))`
- Examples: Carbon, Biomass, Species Richness
- Stored in rij as: actual measured values
- **No thresholding** needed

## Our Solution

1. **Classify features** using the same logic as rij creation:
   ```r
   cat_by_layer <- features %>%
     group_by(archivo, id_elemento_priorizacion) %>%
     summarise(count = n(), sum_id_original = sum(id_original))
   
   binary_elementos <- cat_by_layer %>%
     filter(count == 1 & sum_id_original == 1) %>%
     pull(id_elemento_priorizacion)
   ```

2. **Threshold after extraction** for binary features:
   ```r
   if (feat_id_elemento %in% binary_elementos) {
     r_values[!is.na(r_values) & r_values >= 1] <- 1
     r_values[!is.na(r_values) & r_values < 1] <- 0
     values(r) <- r_values
   }
   ```

## Why 5km Not 3km

Although the rij creation script shows `resolution="3km"`, the actual Nacional solutions are on a 5km grid. This is confirmed by:

1. The costs_and_constraints script uses `PUs_Nacional_5km.shp`
2. The output CSV is `PUs_Nacional_5km.csv`
3. The solutions in `output/Nacional/` are 5km resolution

The `resolution="3km"` in the script was likely a copy-paste error or the script was later re-run with 5km shapefiles.

## File Relationships

```
PUs_Nacional_5km.shp  (shapefile with planning unit polygons)
    ↓ (used by exact_extract)
rij_Nacional_5km.fst  (feature amounts per planning unit ID)
    ↓ (matched to)
PUs_Nacional_5km.csv  (costs/constraints per planning unit ID)
    ↓ (matched to)
PUs_Nacional_5km.tif  (raster with planning unit IDs as cell values)
```

All three use the same planning unit IDs in the `Id` or `id` field, allowing cross-referencing.

