# ============================================================================
# Extract Features from RIJ Matrix for Eje Cafetero
# ============================================================================
# This script reads the rij matrix for Eje Cafetero and extracts features
# as TIF rasters. Species distributions are aggregated into species richness.

library(fst)
library(raster)
library(dplyr)
library(openxlsx)

# Set working directory
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global")


# Parameters
extension <- "EJE_CAFETERO"
resolution <- "1km"

# Output directory for extracted features (clean it first if it exists)
output_dir <- paste0("./eje_cafetero_processing/extracted_features")
if (dir.exists(output_dir)) {
  cat("Cleaning existing extracted features directory...\n")
  unlink(output_dir, recursive = TRUE)
  cat("  ✓ Old files deleted\n")
}
dir.create(output_dir, recursive = TRUE)

# ============================================================================
# 1. Load Data
# ============================================================================

cat("Loading planning units raster...\n")
# Load planning units raster template
pu_raster <- raster(paste0("./features/PUs_", extension, "_", resolution, ".tif"))

cat("Loading rij matrix...\n")
# Load rij matrix
rij <- read.fst(paste0("./input/rij_", extension, "_", resolution, ".fst"))

cat("Loading features metadata...\n")
# Load features metadata to get names
features <- read.xlsx("./input/features_v4_4_24_(MAPV).xlsx")
features <- features[-which(features$id_original == 0), ]

# ============================================================================
# 2. Define Feature IDs to Extract
# ============================================================================

# Primary features (from id_elemento_priorizacion):
# 1  - Ecosistemas IAVH
# 4  - Páramo
# 24 - Manglar
# 6  - Humedales
# 7  - Bosque seco
# 21 - Especies (~8700 species - will aggregate to richness)
# 11 - Carbono orgánico en suelos
# 12 - Biomasa aérea más biomasa subterránea
# 15 - Recarga de agua subterránea

primary_features <- c(1, 4, 24, 6, 7, 21, 11, 12, 15)

# ============================================================================
# 3. Create Mapping of Feature Names
# ============================================================================

# Create simplified feature name mapping
# source_file: path to TIF file if not in rij matrix (use NA if in rij)
feature_name_map <- data.frame(
  id_elemento = primary_features[primary_features != 24],  # Remove 24 (Manglares - coastal, not in Eje Cafetero)
  simple_name = c(
    "ecosistemas_IAVH",
    "paramos",
    "humedales",
    "bosque_seco",
    "especies_richness",
    "carbono_organico_suelos",
    "biomasa_aerea_mas_subterranea",
    "recarga_agua_subterranea"
  ),
  display_name = c(
    "Ecosistemas IAVH",
    "Páramos",
    "Humedales",
    "Bosque Seco",
    "Riqueza de Especies",
    "Carbono Orgánico Suelos (t C/ha)",
    "Biomasa Aérea más Subterránea (t C/ha)",
    "Recarga de Agua Subterránea"
  ),
  source_file = c(
    "./features/ecosistemas.tif",
    NA,  # In rij
    NA,  # In rij
    NA,  # In rij
    NA,  # In rij
    "./features/GSOC_v1.5_fixed_1km.tif",
    "./features/agb_plus_bgb_spawn_2020_fixed_1km.tif",
    "./features/recarga_agua_subterranea_moderado_alto.tif"
  ),
  stringsAsFactors = FALSE
)

# ============================================================================
# 4. Extract Features and Create Rasters
# ============================================================================

cat("\nExtracting features and creating rasters...\n")

for (i in 1:nrow(feature_name_map)) {
  feat_id_elemento <- feature_name_map$id_elemento[i]
  feat_simple_name <- feature_name_map$simple_name[i]
  feat_display_name <- feature_name_map$display_name[i]
  feat_source_file <- feature_name_map$source_file[i]
  
  cat(sprintf("\nProcessing: %s (id_elemento: %d)\n", feat_display_name, feat_id_elemento))
  
  # Check if this feature has a direct source file (not in rij)
  if (!is.na(feat_source_file)) {
    cat(sprintf("  Source: Direct file (%s)\n", basename(feat_source_file)))
    
    # Load the raster file
    if (!file.exists(feat_source_file)) {
      cat(sprintf("  ERROR: Source file not found: %s\n", feat_source_file))
      next
    }
    
    r <- raster(feat_source_file)
    
    # Check if it needs reprojection
    test <- try(compareRaster(r, pu_raster, extent = TRUE, rowcol = TRUE, 
                              crs = TRUE, res = TRUE), silent = TRUE)
    
    if (class(test) == "try-error") {
      cat("  Reprojecting to match planning units...\n")
      r <- projectRaster(r, pu_raster, method = "ngb")
    } else {
      cat("  Raster already matches planning units\n")
    }
    
    # Fill NAs inside planning unit with 0 (represents absence)
    # This ensures all layers have data wherever PU exists (required by wheretowork)
    r_values <- values(r)
    pu_values <- values(pu_raster)
    pu_exists <- !is.na(pu_values)
    data_is_na <- is.na(r_values)
    r_values[pu_exists & data_is_na] <- 0
    values(r) <- r_values
    cat("  Filled NAs inside planning unit with 0\n")
    
  } else {
    # Extract from rij matrix
    cat("  Source: RIJ matrix\n")
    
    # Get all feature IDs for this id_elemento_priorizacion
    feat_ids <- features %>%
      filter(id_elemento_priorizacion == feat_id_elemento) %>%
      pull(id)
    
    cat(sprintf("  Found %d feature(s) in metadata\n", length(feat_ids)))
    
    # Filter rij for these features
    feat_rij <- rij %>%
      filter(species %in% feat_ids)
    
    cat(sprintf("  Found %d records in rij matrix\n", nrow(feat_rij)))
    
    if (nrow(feat_rij) == 0) {
      cat("  WARNING: No data found in rij. Skipping...\n")
      next
    }
    
    # Handle species differently - aggregate to richness
    if (feat_id_elemento == 21) {
      cat("  Aggregating species to richness...\n")
      # Count number of species per planning unit
      feat_data <- feat_rij %>%
        group_by(pu) %>%
        summarise(richness = n_distinct(species)) %>%
        ungroup()
      
      # Create raster matching PU IDs to raster cell values (vectorized)
      r <- pu_raster
      pu_values <- values(pu_raster)
      
      # Use vectorized match: for each cell in raster, find its value in feat_data
      match_idx <- match(pu_values, feat_data$pu)
      output_values <- feat_data$richness[match_idx]  # NA where no match
      
      # Fill NAs inside planning unit with 0 (represents absence)
      # This ensures all layers have data wherever PU exists (required by wheretowork)
      pu_exists <- !is.na(pu_values)
      data_is_na <- is.na(output_values)
      output_values[pu_exists & data_is_na] <- 0
      
      values(r) <- output_values
      
    } else {
      # For non-species features, use presence (amount = 1)
      # Sum amounts per planning unit (in case multiple features map to same id_elemento)
      feat_data <- feat_rij %>%
        group_by(pu) %>%
        summarise(total = sum(amount)) %>%
        ungroup()
      
      # Create raster matching PU IDs to raster cell values (vectorized)
      r <- pu_raster
      pu_values <- values(pu_raster)
      
      # Use vectorized match: for each cell in raster, find its value in feat_data
      match_idx <- match(pu_values, feat_data$pu)
      output_values <- feat_data$total[match_idx]  # NA where no match
      
      # Fill NAs inside planning unit with 0 (represents absence)
      # This ensures all layers have data wherever PU exists (required by wheretowork)
      pu_exists <- !is.na(pu_values)
      data_is_na <- is.na(output_values)
      output_values[pu_exists & data_is_na] <- 0
      
      values(r) <- output_values
      # cleanup values greater than 1
      r_values <- values(r)
      # Following rij creation logic: amount >= 1 means presence
      r_values[!is.na(r_values) & r_values >= 1] <- 1
      r_values[!is.na(r_values) & r_values < 1] <- 0
      # Clean up floating point precision issues - values very close to 0 should be exactly 0
      r_values[!is.na(r_values) & abs(r_values) < 1e-10] <- 0
      values(r) <- r_values
      cat(sprintf("  Unique values after threshold: %s\n", paste(sort(unique(na.omit(r_values))), collapse=", ")))
    }
    
    # Clean up intermediate data
    rm(feat_rij, feat_data)
  }
  
  # Write raster
  output_file <- paste0(output_dir, "/", feat_simple_name, ".tif")
  writeRaster(r, output_file, overwrite = TRUE, 
              options = "COMPRESS=DEFLATE", 
              datatype = 'FLT4S',
              NAflag = -9999)
  
  cat(sprintf("  Saved: %s\n", output_file))
  
  # Clean up
  rm(r)
  gc()
}

cat("\n============================================================================\n")
cat("Feature extraction complete!\n")
cat(sprintf("Output directory: %s\n", normalizePath(output_dir)))
cat("============================================================================\n")

