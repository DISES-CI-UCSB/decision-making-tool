# ============================================================================
# Extract Features from RIJ Matrix for ORINOQUIA (3km)
# ============================================================================

library(raster)
library(fst)
library(dplyr)

# ============================================================================
# 1. Setup Paths and Parameters
# ============================================================================

cat("\n============================================================================\n")
cat("ORINOQUIA Feature Extraction (3km resolution)\n")
cat("============================================================================\n\n")

# Set working directory to Cambio_Global root
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global")

# Define paths
pu_raster_file <- "./PUs/PUs_ORINOQUIA_3km.tif"
pu_csv_file <- "./input/PUs_ORINOQUIA_3km.csv"
rij_file <- "./input/rij_ORINOQUIA_3km.fst"
features_file <- "./input/features_v4_4_24_(MAPV).xlsx"
output_dir <- "./orinoquia_processing/extracted_features"

# Create output directory
if (!dir.exists(output_dir)) {
  dir.create(output_dir, recursive = TRUE)
}

# ============================================================================
# 2. Load Data
# ============================================================================

cat("Loading planning unit raster...\n")
pu_raster <- raster(pu_raster_file)
cat(sprintf("  Raster dimensions: %d x %d\n", ncol(pu_raster), nrow(pu_raster)))
cat(sprintf("  Resolution: %s\n", paste(res(pu_raster), collapse=" x ")))

cat("\nLoading planning unit CSV...\n")
pu_data <- read.csv(pu_csv_file)
cat(sprintf("  Planning units: %d\n", nrow(pu_data)))

cat("\nLoading RIJ matrix...\n")
rij <- read.fst(rij_file)
cat(sprintf("  RIJ records: %d\n", nrow(rij)))
cat(sprintf("  Unique species/features: %d\n", length(unique(rij$species))))

cat("\nLoading features metadata...\n")
features <- openxlsx::read.xlsx(features_file, sheet = 1)
cat(sprintf("  Total features in metadata: %d\n", nrow(features)))

# Filter to features in rij
features <- features %>% filter(id %in% unique(rij$species))
cat(sprintf("  Features in rij: %d\n", nrow(features)))

# ============================================================================
# Classify features as binary or continuous (following rij creation logic)
# ============================================================================

cat("\nClassifying features as binary vs continuous...\n")

# Group by archivo to detect layer types (following rij creation script logic)
cat_by_layer <- features %>%
  group_by(archivo, id_elemento_priorizacion) %>%
  summarise(
    count = n(),
    sum_id_original = sum(id_original, na.rm = TRUE),
    .groups = "drop"
  )

# ONE CATEGORY LAYERS (binary): count==1 & sum==1
# MULTIPLE CATEGORY LAYERS: count>1
# NUMERIC LAYERS: is.na(sum)

binary_elementos <- cat_by_layer %>%
  filter(count == 1 & sum_id_original == 1) %>%
  pull(id_elemento_priorizacion) %>%
  unique()

cat(sprintf("  Binary (ONE CATEGORY) elementos: %s\n", paste(binary_elementos, collapse=", ")))
cat("  These will be thresholded to 0/1 after extraction\n")

# ============================================================================
# 3. Define Feature Mapping from Scenarios Spreadsheet
# ============================================================================

# Load scenarios to get feature names
scenarios_file <- "./input/scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx"
cat("\nLoading scenarios to extract feature names...\n")
scenarios <- openxlsx::read.xlsx(scenarios_file, sheet = 1, detectDates = FALSE)

# Filter for ORINOQUIA scenarios if SIRAP column exists
if ("SIRAP" %in% names(scenarios)) {
  cat(sprintf("  Total scenarios in file: %d\n", nrow(scenarios)))
  scenarios <- scenarios[scenarios$SIRAP == "ORINOQUIA" | scenarios$SIRAP == "orinoquia" | scenarios$SIRAP == "Orinoquia", ]
  cat(sprintf("  Filtered to ORINOQUIA scenarios: %d\n", nrow(scenarios)))
} else {
  cat("  WARNING: No SIRAP column found. Using all scenarios.\n")
}

# If no ORINOQUIA scenarios found, use all unique features from rij
if (nrow(scenarios) == 0) {
  cat("  WARNING: No ORINOQUIA scenarios found in spreadsheet.\n")
  cat("  Will extract all unique id_elemento_priorizacion from rij/features metadata.\n")
  
  unique_elementos <- unique(features$id_elemento_priorizacion)
  unique_elementos <- unique_elementos[!is.na(unique_elementos)]
  
  # Create basic mapping from features metadata
  feature_id_to_name <- list()
  for (elem_id in unique_elementos) {
    elem_features <- features %>% filter(id_elemento_priorizacion == elem_id)
    if (nrow(elem_features) > 0) {
      # Use elemento_priorizacion if available, otherwise use generic name
      if ("elemento_priorizacion" %in% names(elem_features) && !is.na(elem_features$elemento_priorizacion[1])) {
        feature_id_to_name[[as.character(elem_id)]] <- elem_features$elemento_priorizacion[1]
      } else {
        feature_id_to_name[[as.character(elem_id)]] <- paste("Feature", elem_id)
      }
    }
  }
  
} else {
  # Extract all unique id_elemento values and their names from ORINOQUIA scenarios
  all_id_elementos <- c()
  all_elemento_names <- c()
  
  for (i in 1:nrow(scenarios)) {
    # Get comma-separated IDs
    ids_str <- as.character(scenarios$id_elemento_priorizacion[i])
    names_str <- as.character(scenarios$elemento_priorizacion[i])
    
    if (!is.na(ids_str) && !is.na(names_str)) {
      ids <- trimws(strsplit(ids_str, ",")[[1]])
      names <- trimws(strsplit(names_str, ",")[[1]])
      
      # Only use if lengths match
      if (length(ids) == length(names)) {
        all_id_elementos <- c(all_id_elementos, ids)
        all_elemento_names <- c(all_elemento_names, names)
      }
    }
  }
  
  # Create mapping from scenarios
  scenarios_mapping <- data.frame(
    id = all_id_elementos,
    name = all_elemento_names,
    stringsAsFactors = FALSE
  )
  scenarios_mapping <- unique(scenarios_mapping)
  
  cat(sprintf("  Extracted %d unique feature mappings from scenarios\n", nrow(scenarios_mapping)))
  
  # Get unique elementos that are actually in our rij/features
  unique_elementos <- unique(features$id_elemento_priorizacion)
  unique_elementos <- unique_elementos[!is.na(unique_elementos)]
  
  # Filter to only elementos in ORINOQUIA scenarios
  unique_elementos <- unique_elementos[as.character(unique_elementos) %in% scenarios_mapping$id]
  
  # Create feature ID to name mapping
  feature_id_to_name <- list()
  for (elem_id in unique_elementos) {
    id_str <- as.character(elem_id)
    mapping_row <- scenarios_mapping[scenarios_mapping$id == id_str, ]
    if (nrow(mapping_row) > 0) {
      feature_id_to_name[[id_str]] <- mapping_row$name[1]
    }
  }
}

cat(sprintf("  Will extract %d features for ORINOQUIA\n", length(unique_elementos)))
cat("  Feature ID to name mapping:\n")
for (id_str in names(feature_id_to_name)) {
  cat(sprintf("    %s -> %s\n", id_str, feature_id_to_name[[id_str]]))
}

# Build feature_name_map
simple_names <- c()
display_names <- c()

for (id in unique_elementos) {
  id_str <- as.character(id)
  
  if (id_str %in% names(feature_id_to_name)) {
    # Use name from mapping
    display_name <- feature_id_to_name[[id_str]]
    
    # Create simple name from display name with proper accent handling
    simple_name <- display_name
    # Transliterate accented characters to ASCII equivalents
    simple_name <- chartr("áéíóúñÁÉÍÓÚÑ", "aeiounAEIOUN", simple_name)
    # Replace other special chars with underscores
    simple_name <- tolower(gsub("[^A-Za-z0-9]", "_", simple_name))
    simple_name <- gsub("_+", "_", simple_name)  # Remove duplicate underscores
    simple_name <- gsub("^_|_$", "", simple_name)  # Remove leading/trailing underscores
    
    simple_names <- c(simple_names, simple_name)
    display_names <- c(display_names, display_name)
    cat(sprintf("  Mapped ID %s -> %s (file: %s.tif)\n", id_str, display_name, simple_name))
  } else {
    # Fallback if not found
    simple_names <- c(simple_names, paste0("feature_", sprintf("%02d", id)))
    display_names <- c(display_names, paste("Feature", id))
    cat(sprintf("  WARNING: No mapping for id_elemento %d\n", id))
  }
}

feature_name_map <- data.frame(
  id_elemento = sort(unique_elementos),
  simple_name = simple_names,
  display_name = display_names,
  stringsAsFactors = FALSE
)

cat("\nFinal feature mapping:\n")
print(feature_name_map)

# ============================================================================
# 4. Extract Features and Create Rasters
# ============================================================================

cat("\nExtracting features and creating rasters...\n")

for (i in 1:nrow(feature_name_map)) {
  feat_id_elemento <- feature_name_map$id_elemento[i]
  feat_simple_name <- feature_name_map$simple_name[i]
  feat_display_name <- feature_name_map$display_name[i]
  
  cat(sprintf("\nProcessing: %s (id_elemento: %d)\n", feat_display_name, feat_id_elemento))
  
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
  
  # Check if this is species data (typically has many features per elemento)
  is_species_richness <- length(feat_ids) > 100
  
  if (is_species_richness) {
    cat("  Aggregating to richness (large number of features)...\n")
    # Count number of species per planning unit
    feat_data <- feat_rij %>%
      group_by(pu) %>%
      summarise(richness = n_distinct(species)) %>%
      ungroup()
    
    # Create raster matching PU IDs to raster cell values (vectorized)
    r <- pu_raster
    pu_values <- values(pu_raster)
    
    # Use vectorized match
    match_idx <- match(pu_values, feat_data$pu)
    output_values <- feat_data$richness[match_idx]
    
    values(r) <- output_values
    
  } else {
    # For non-species features, sum amounts per planning unit
    feat_data <- feat_rij %>%
      group_by(pu) %>%
      summarise(total = sum(amount)) %>%
      ungroup()
    
    # Create raster matching PU IDs to raster cell values (vectorized)
    r <- pu_raster
    pu_values <- values(pu_raster)
    
    # Use vectorized match
    match_idx <- match(pu_values, feat_data$pu)
    output_values <- feat_data$total[match_idx]
    
    values(r) <- output_values
  }
  
  # Threshold binary layers (ONE CATEGORY layers should be 0/1)
  # BUT don't threshold species richness layers (they should be continuous)
  # ALSO don't threshold certain features that have fractional coverage values
  is_continuous_coverage <- grepl("Nucleo.*SIRAPO|Areas.*Nucleo", feat_display_name, ignore.case = TRUE)
  
  if (feat_id_elemento %in% binary_elementos && !is_species_richness && !is_continuous_coverage) {
    cat("  Thresholding to binary (0/1)...\n")
    r_values <- values(r)
    # Following rij creation logic: amount >= 1 means presence
    r_values[!is.na(r_values) & r_values >= 1] <- 1
    r_values[!is.na(r_values) & r_values < 1] <- 0
    # Clean up floating point precision issues - values very close to 0 should be exactly 0
    r_values[!is.na(r_values) & abs(r_values) < 1e-10] <- 0
    values(r) <- r_values
    cat(sprintf("  Unique values after threshold: %s\n", paste(sort(unique(na.omit(r_values))), collapse=", ")))
  } else if (is_continuous_coverage) {
    cat("  Keeping continuous coverage values (not thresholding)\n")
  }
  
  # Write raster - use special name for species richness to avoid conflicts
  if (is_species_richness) {
    output_file <- paste0(output_dir, "/especies_richness.tif")
  } else {
    output_file <- paste0(output_dir, "/", feat_simple_name, ".tif")
  }
  
  # Use appropriate datatype: INT1U for binary (0/1), FLT4S for continuous
  if (feat_id_elemento %in% binary_elementos && !is_species_richness && !is_continuous_coverage) {
    # Binary layers: use unsigned 8-bit integer (0-255 range, but we only use 0 and 1)
    writeRaster(r, output_file, overwrite = TRUE, 
                options = "COMPRESS=DEFLATE", 
                datatype = 'INT1U',
                NAflag = 255)
  } else {
    # Continuous layers: use floating point
    writeRaster(r, output_file, overwrite = TRUE, 
                options = "COMPRESS=DEFLATE", 
                datatype = 'FLT4S',
                NAflag = -9999)
  }
  
  cat(sprintf("  Saved: %s\n", output_file))
  
  # Clean up
  rm(r, feat_rij, feat_data)
  gc()
}

cat("\n============================================================================\n")
cat("Feature extraction complete!\n")
cat(sprintf("Output directory: %s\n", normalizePath(output_dir)))
cat("============================================================================\n")

