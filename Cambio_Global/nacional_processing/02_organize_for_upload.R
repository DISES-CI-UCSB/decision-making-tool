# ============================================================================
# Organize Nacional Data for Upload
# ============================================================================

library(raster)
library(dplyr)

cat("\n============================================================================\n")
cat("Organizing Nacional data for upload\n")
cat("============================================================================\n\n")

# Set working directory
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global")

# Define paths
pu_raster_file <- "./features/PUs_Nacional_5km.tif"
pu_csv_file <- "./input/PUs_Nacional_5km.csv"
features_file <- "./input/features_v4_4_24_(MAPV).xlsx"
scenarios_file <- "./input/scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx"
extracted_features_dir <- "./nacional_processing/extracted_features"
solutions_dir <- "./output/Nacional"
upload_dir <- "./nacional_processing/upload_ready"

# Create upload directory structure
layers_dir <- paste0(upload_dir, "/layers")
solutions_upload_dir <- paste0(upload_dir, "/solutions")

dir.create(upload_dir, showWarnings = FALSE, recursive = TRUE)
dir.create(layers_dir, showWarnings = FALSE, recursive = TRUE)
dir.create(solutions_upload_dir, showWarnings = FALSE, recursive = TRUE)

# ============================================================================
# 1. Copy Planning Unit Raster
# ============================================================================

cat("Copying planning unit raster to upload directory...\n")
file.copy(pu_raster_file, paste0(upload_dir, "/PU_Nacional_5km.tif"), overwrite = TRUE)
cat("  ✓ PU raster copied\n")

# ============================================================================
# 2. Load Metadata
# ============================================================================

cat("\nLoading metadata...\n")
pu_data <- read.csv(pu_csv_file)
pu_raster <- raster(pu_raster_file)
features <- openxlsx::read.xlsx(features_file, sheet = 1)

# Load scenarios spreadsheet
cat("  Loading scenarios from Excel...\n")
scenarios <- openxlsx::read.xlsx(scenarios_file, sheet = 1, detectDates = FALSE)
cat(sprintf("  Total scenarios in file: %d\n", nrow(scenarios)))
cat("  Scenario columns:", paste(names(scenarios), collapse=", "), "\n")

# Filter for Nacional scenarios if SIRAP column exists
if ("SIRAP" %in% names(scenarios)) {
  scenarios <- scenarios[scenarios$SIRAP == "Nacional" | scenarios$SIRAP == "nacional", ]
  cat(sprintf("  Filtered to Nacional scenarios: %d\n", nrow(scenarios)))
} else {
  cat("  WARNING: No SIRAP column found. Using all scenarios.\n")
}

# Extract feature name mapping from Nacional scenarios (same as in extraction script)
cat("  Extracting feature names from Nacional scenarios...\n")
all_id_elementos <- c()
all_elemento_names <- c()

for (i in 1:nrow(scenarios)) {
  ids_str <- as.character(scenarios$id_elemento_priorizacion[i])
  names_str <- as.character(scenarios$elemento_priorizacion[i])
  
  if (!is.na(ids_str) && !is.na(names_str)) {
    ids <- trimws(strsplit(ids_str, ",")[[1]])
    names <- trimws(strsplit(names_str, ",")[[1]])
    
    if (length(ids) == length(names)) {
      all_id_elementos <- c(all_id_elementos, ids)
      all_elemento_names <- c(all_elemento_names, names)
    }
  }
}

# Create feature mapping lookup
feature_id_to_name <- setNames(all_elemento_names, all_id_elementos)
# Remove duplicates, keeping first occurrence
feature_id_to_name <- feature_id_to_name[!duplicated(names(feature_id_to_name))]

cat(sprintf("  Created mapping for %d unique features\n", length(feature_id_to_name)))
cat("  Feature ID mappings:\n")
for (feat_id in names(feature_id_to_name)) {
  cat(sprintf("    ID %s -> %s\n", feat_id, feature_id_to_name[[feat_id]]))
}

# ============================================================================
# 3. Extract Constraint and Weight Layers from PU CSV
# ============================================================================

cat("\nExtracting constraint and weight layers from PU CSV...\n")

# Define which columns to extract and their types based on PUs_Nacional_5km.csv
# Available columns: OMECs, Comunidades_Negras, Resguardos_Indígenas, RUNAP, 
#                    Coca_Muertes_1622, IHEH_2022, Beneficio_neto, IHEH_2030_desarrollista, Refugios_Clima_8_5
constraint_weight_layers <- data.frame(
  column_name = c("Resguardos_Indígenas", "Comunidades_Negras", "RUNAP", "OMECs",
                  "IHEH_2022", "Beneficio_neto", "IHEH_2030_desarrollista", 
                  "Coca_Muertes_1622", "Refugios_Clima_8_5"),
  output_name = c("resguardos_indigenas", "comunidades_negras", "RUNAP", "OMECs",
                  "IHEH_2022", "beneficio_neto", "IHEH_2030",
                  "coca_muertes_1622", "refugios_clima"),
  display_name = c("Resguardos Indígenas", "Comunidades Negras", "RUNAP", "OMECs",
                   "IHEH 2022 (índice 0-100)", "Beneficio Neto (COP)", "IHEH 2030 (índice 0-100)",
                   "Coca Muertes 2016-2022 (# eventos)", "Refugios Clima 8.5 (# especies)"),
  type = c("include", "include", "include", "include",
           "weight", "weight", "weight",
           "weight", "weight"),
  is_binary = rep(NA, 9),  # Will be determined by checking actual data
  is_all_na = rep(FALSE, 9),  # Track layers with no data (all NAs)
  stringsAsFactors = FALSE
)

for (i in 1:nrow(constraint_weight_layers)) {
  col_name <- constraint_weight_layers$column_name[i]
  out_name <- constraint_weight_layers$output_name[i]
  
  if (col_name %in% names(pu_data)) {
    # Check if column has any non-NA values
    col_values <- pu_data[[col_name]]
    unique_vals <- unique(col_values[!is.na(col_values)])
    
    # Track if column is all NAs (no data for this region)
    is_all_na <- (length(unique_vals) == 0)
    
    if (is_all_na) {
      cat(sprintf("  Processing %s: column is all NAs (no data for this SIRAP) - will display as grey\n", col_name))
      # Treat as binary with only 0 values, NAs will become 0
      is_binary <- TRUE
      constraint_weight_layers$is_binary[i] <- is_binary
      constraint_weight_layers$is_all_na[i] <- TRUE
    } else {
      cat(sprintf("  Processing: %s\n", col_name))
      
      # Check if values are binary (only 0, 1, and NA)
      is_binary <- all(unique_vals %in% c(0, 1))
      constraint_weight_layers$is_binary[i] <- is_binary
    }
    
    if (is_binary) {
      cat(sprintf("    Detected as BINARY (values: %s)\n", paste(sort(unique_vals), collapse=", ")))
    } else {
      cat(sprintf("    Detected as CONTINUOUS (range: %.2f to %.2f)\n", 
                  min(col_values, na.rm=TRUE), max(col_values, na.rm=TRUE)))
    }
    
    # Create raster matching PU IDs to raster cell values (vectorized)
    r <- pu_raster
    pu_raster_values <- values(pu_raster)
    
    # Use vectorized match: for each cell in raster, find its PU ID in the data
    match_idx <- match(pu_raster_values, pu_data$id)
    output_values <- pu_data[[col_name]][match_idx]  # NA where no match
    
    # Fill NAs inside planning unit with 0 (represents "absent")
    # This ensures all layers have data wherever PU exists (required by wheretowork)
    # Fill where: (1) PU cell exists (not NA in raster), AND (2) data is NA (either no match or actual NA)
    pu_exists_in_raster <- !is.na(pu_raster_values)
    data_is_na <- is.na(output_values)
    output_values[pu_exists_in_raster & data_is_na] <- 0
    
    values(r) <- output_values
    
    # Write raster
    output_file <- paste0(layers_dir, "/", out_name, ".tif")
    writeRaster(r, output_file, overwrite = TRUE,
                options = "COMPRESS=DEFLATE",
                datatype = 'FLT4S',
                NAflag = -9999)
    
    cat(sprintf("    Saved: %s.tif\n", out_name))
    rm(r)
    gc()
  } else {
    cat(sprintf("  WARNING: Column '%s' not found in planning unit CSV\n", col_name))
  }
}

# ============================================================================
# 4. Copy Extracted Feature Layers
# ============================================================================

cat("\nCopying extracted feature layers...\n")

# Get list of extracted features
extracted_files <- list.files(extracted_features_dir, pattern = "\\.tif$", full.names = FALSE)
cat(sprintf("  Found %d extracted feature TIF files\n", length(extracted_files)))

# Copy feature files to layers directory
for (feat_file in extracted_files) {
  file.copy(
    paste0(extracted_features_dir, "/", feat_file),
    paste0(layers_dir, "/", feat_file),
    overwrite = TRUE
  )
}

cat(sprintf("  ✓ Copied %d feature layers\n", length(extracted_files)))

# ============================================================================
# 5. Create layers.csv
# ============================================================================

cat("\nCreating layers.csv...\n")

feature_name_map <- data.frame(
  simple_name = c(
    "ecosistemas_IAVH",
    "paramos",
    "manglares",
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
    "Manglares",
    "Humedales",
    "Bosque Seco",
    "Riqueza de Especies",
    "Carbono Orgánico Suelos (t C/ha)",
    "Biomasa Aérea más Subterránea (t C/ha)",
    "Recarga de Agua Subterránea"
  ),
  stringsAsFactors = FALSE
)

# Create metadata for extracted features with proper display names
# Match filenames back to feature names from scenarios
display_names_for_layers <- c()
colors_for_layers <- c()
for (feat_file in extracted_files) {
  # Extract simple name without .tif
  simple_name <- gsub("\\.tif$", "", feat_file)
  
  # Look up display name
  found_name <- feature_name_map$display_name[
    match(simple_name, feature_name_map$simple_name)
  ]
  
  # Use found name or fallback
  if (!is.na(found_name)) {
    display_names_for_layers <- c(display_names_for_layers, found_name)
  } else {
    display_names_for_layers <- c(display_names_for_layers, gsub("_", " ", simple_name))
  }
}
print(display_names_for_layers)

# Create metadata with proper theme mapping and legend types
# Check actual raster values to determine binary vs continuous
themes_for_layers <- c()
legends_for_layers <- c()
values_for_layers <- c()
labels_for_layers <- c()

# Data dictionary: map display_name → theme
theme_dict <- data.frame(
  display_name = c(
    "Ecosistemas IAVH",
    "Páramos",
    "Manglares",
    "Humedales",
    "Bosque Seco",
    "Riqueza de Especies",
    "Carbono Orgánico Suelos (t C/ha)",
    "Biomasa Aérea más Subterránea (t C/ha)",
    "Recarga de Agua Subterránea"
  ),
  theme = c(
    "Ecosistemas",
    "Ecosistemas estratégicos",
    "Ecosistemas estratégicos",
    "Ecosistemas estratégicos",
    "Ecosistemas estratégicos",
    "Especies",
    "Servicios ecosistémicos",
    "Servicios ecosistémicos",
    "Servicios ecosistémicos"
  ),
  stringsAsFactors = FALSE
)


for (j in 1:length(display_names_for_layers)) {
  feat_name <- display_names_for_layers[j]
  feat_file <- extracted_files[j]
  
  theme <- theme_dict$theme[match(feat_name, theme_dict$display_name)]
  
  # Handle case where no match found
  if (is.na(theme)) {
    theme <- "Features"
    cat(sprintf("  WARNING: No theme mapping for feature: %s\n", feat_name))
  }
  
  themes_for_layers <- c(themes_for_layers, theme)
  
  # Check actual raster values to determine legend type
  raster_file <- paste0(layers_dir, "/", feat_file)
  if (file.exists(raster_file)) {
    r <- raster(raster_file)
    r_values <- values(r)
    unique_vals <- unique(r_values[!is.na(r_values)])
    
    # Check if values are binary (only 0 and 1)
    is_binary <- all(unique_vals %in% c(0, 1))
    
    if (is_binary) {
      legends_for_layers <- c(legends_for_layers, "manual")
      values_for_layers <- c(values_for_layers, "0, 1")
      labels_for_layers <- c(labels_for_layers, "absent, present")
      # Binary layers need TWO colors: one for 0 (transparent/absent), one for 1 (present)
      colors_for_layers <- c(colors_for_layers, "#00000000, #2d6a4f")
      cat(sprintf("  %s: BINARY (legend=manual)\n", feat_name))
    } else {
      legends_for_layers <- c(legends_for_layers, "continuous")
      values_for_layers <- c(values_for_layers, "")
      labels_for_layers <- c(labels_for_layers, "")
      # Continuous layers use color ramp: BuPu default, Spectral for Ecosistemas IAVH
      color_palette <- if (feat_name == "Ecosistemas IAVH") "Spectral" else "BuPu"
      colors_for_layers <- c(colors_for_layers, color_palette)
      cat(sprintf("  %s: CONTINUOUS (legend=continuous, palette=%s, range: %.4f to %.4f)\n", 
                  feat_name, color_palette, min(unique_vals), max(unique_vals)))
    }
    
    rm(r)  # Clean up raster object
  } else {
    # Fallback if file doesn't exist yet
    legends_for_layers <- c(legends_for_layers, "continuous")
    values_for_layers <- c(values_for_layers, "")
    labels_for_layers <- c(labels_for_layers, "")
    # Default to BuPu, Spectral for Ecosistemas IAVH
    color_palette <- if (feat_name == "Ecosistemas IAVH") "Spectral" else "BuPu"
    colors_for_layers <- c(colors_for_layers, color_palette)
    cat(sprintf("  WARNING: Raster file not found for %s, defaulting to continuous with %s palette\n", feat_name, color_palette))
  }
}

# Feature layers metadata
# Assign units: km2 for all theme layers (ensures consistency within themes)
units_for_layers <- rep("km2", length(display_names_for_layers))

feature_layers_metadata <- data.frame(
  Type = rep("theme", length(extracted_files)),
  Theme = themes_for_layers,  # Use mapped themes
  File = extracted_files,
  Name = display_names_for_layers,  # Use proper display names with accents
  Legend = legends_for_layers,  # Detected from actual raster values
  Values = values_for_layers,  # "0, 1" for binary, "" for continuous
  Color = colors_for_layers,  # Two colors for binary, color ramp for continuous
  Labels = labels_for_layers,  # "absent, present" for binary, "" for continuous
  Unit = units_for_layers,  # Proper units based on layer type
  Provenance = rep("national", length(extracted_files)),
  Order = rep("", length(extracted_files)),
  Visible = rep("FALSE", length(extracted_files)),  # Theme layers hidden by default
  Hidden = rep("FALSE", length(extracted_files)),
  Goal = rep("0.3", length(extracted_files)),
  Downloadable = rep("TRUE", length(extracted_files)),
  stringsAsFactors = FALSE
)

# Constraint/weight layers metadata using detected binary status
legend_types <- ifelse(constraint_weight_layers$is_binary, "manual", "continuous")

# For all-NA layers, only specify the values that actually exist (just 0)
legend_values <- sapply(1:nrow(constraint_weight_layers), function(j) {
  if (constraint_weight_layers$is_binary[j]) {
    if (constraint_weight_layers$is_all_na[j]) {
      "0"  # All-NA layers only have 0 values
    } else {
      "0, 1"  # Normal binary layers
    }
  } else {
    ""  # Continuous layers
  }
})

  # Use different labels for all-NA layers vs. normal binary layers
legend_labels <- sapply(1:nrow(constraint_weight_layers), function(j) {
  if (constraint_weight_layers$is_binary[j]) {
    if (constraint_weight_layers$is_all_na[j]) {
      "0"  # All-NA layers - just label the 0 value
    } else {
      "not included, included"  # Normal binary layers
    }
  } else {
    ""  # Continuous layers
  }
})

# Color palette based on type and binary status
colors <- sapply(1:nrow(constraint_weight_layers), function(j) {
  if (constraint_weight_layers$is_binary[j]) {
    # Check if layer is all NAs (no data)
    if (constraint_weight_layers$is_all_na[j]) {
      # All-NA layers: transparent (hidden)
      "#00000000"  # Transparent
    } else {
      # Normal binary layers get transparent + color
      color_palette <- c("#00000000, #5ea53f", "#00000000, #86af43", 
                        "#00000000, #4a7c59", "#00000000, #3d6b4d")
      color_palette[((j-1) %% 4) + 1]
    }
  } else {
    # Continuous layers get color ramp
    if (constraint_weight_layers$type[j] == "weight") {
      if (grepl("Beneficio", constraint_weight_layers$display_name[j])) {
        "Greens"
      } else if (grepl("Clima", constraint_weight_layers$display_name[j])) {
        "Blues"
      } else {
        "Reds"
      }
    } else {
      "Greens"
    }
  }
})

# Visible: TRUE for includes (except all-NA layers), FALSE for weights
visible_values <- sapply(1:nrow(constraint_weight_layers), function(j) {
  if (constraint_weight_layers$type[j] == "include") {
    # Hide all-NA layers (like Comunidades Negras)
    if (constraint_weight_layers$is_all_na[j]) {
      return("FALSE")
    } else {
      return("TRUE")
    }
  } else {
    return("FALSE")  # Weights hidden by default
  }
})

# Assign units for constraint/weight layers
# Use "index" for unitless layers (IHEH, Coca Muertes, Refugios, Beneficio)
# Use "km2" for others
units_for_constraints <- sapply(constraint_weight_layers$display_name, function(name) {
  if (grepl("IHEH|Coca.*Muertes|Refugios.*Clima|Beneficio", name, ignore.case = TRUE)) {
    return("index")  # Unitless layers
  } else {
    return("km2")  # Everything else
  }
}, USE.NAMES = FALSE)

constraint_layers_metadata <- data.frame(
  Type = constraint_weight_layers$type,
  Theme = rep("", nrow(constraint_weight_layers)),
  File = paste0(constraint_weight_layers$output_name, ".tif"),
  Name = constraint_weight_layers$display_name,
  Legend = legend_types,
  Values = legend_values,
  Color = colors,
  Labels = legend_labels,
  Unit = units_for_constraints,  # Proper units based on layer type
  Provenance = rep("national", nrow(constraint_weight_layers)),
  Order = rep("", nrow(constraint_weight_layers)),
  Visible = visible_values,
  Hidden = rep("FALSE", nrow(constraint_weight_layers)),
  Goal = rep("0.3", nrow(constraint_weight_layers)),
  Downloadable = rep("TRUE", nrow(constraint_weight_layers)),
  stringsAsFactors = FALSE
)

# Combine all layers
layers_metadata <- rbind(feature_layers_metadata, constraint_layers_metadata)

cat(sprintf("  Created metadata for %d feature layers and %d constraint/weight layers\n", 
            nrow(feature_layers_metadata), nrow(constraint_layers_metadata)))

# Write layers.csv
write.csv(layers_metadata, 
          paste0(layers_dir, "/layers.csv"), 
          row.names = FALSE, 
          quote = TRUE,
          fileEncoding = "UTF-8")

cat(sprintf("  ✓ layers.csv created with %d features\n", nrow(layers_metadata)))

# ============================================================================
# 6. Process Solutions from Scenarios
# ============================================================================

cat("\nProcessing solutions from scenarios...\n")

# Get list of solution files
solution_files <- list.files(solutions_dir, pattern = "\\.tif$", full.names = FALSE)
cat(sprintf("  Found %d solution TIF files in output directory\n", length(solution_files)))

# Initialize solutions metadata
solutions_metadata <- data.frame()

# Process each scenario and match to solution file
for (i in 1:nrow(scenarios)) {
  # Get scenario name (assuming it matches filename)
  scenario_name <- scenarios$escenario[i]
  solution_file <- paste0(scenario_name, ".tif")
  
  # Check if solution file exists
  if (!solution_file %in% solution_files) {
    cat(sprintf("  WARNING: Solution file not found for scenario '%s'. Skipping...\n", scenario_name))
    next
  }
  
  # Copy solution file
  file.copy(
    paste0(solutions_dir, "/", solution_file),
    paste0(solutions_upload_dir, "/", solution_file),
    overwrite = TRUE
  )
  
  # Extract scenario information
  # Get feature IDs used in this scenario
  features_used <- scenarios$id_elemento_priorizacion[i]
  features_used <- paste(features_used, collapse = ',')
  features_used <- as.numeric(strsplit(features_used, ",")[[1]])
  
  # Hard-coded mapping dictionary: scenario names → database layer names
  scenario_to_layer_map <- c(
    # Species
    "Especies(8700)" = "Riqueza de Especies",
    "Especies (8700)" = "Riqueza de Especies",
    "Especies" = "Riqueza de Especies",
    "especies_richness" = "Riqueza de Especies",
    
    # Ecosystems
    "Ecosistemas IAvH" = "Ecosistemas IAVH",
    "Ecosistemas IAVH" = "Ecosistemas IAVH",
    "ecosistemas_IAVH" = "Ecosistemas IAVH",
    "Páramo" = "Páramos",
    "Paramo" = "Páramos",
    "paramos" = "Páramos",
    "Manglar" = "Manglares",
    "Manglares" = "Manglares",
    "manglares" = "Manglares",
    "Humedales" = "Humedales",
    "humedales" = "Humedales",
    "Bosque seco" = "Bosque Seco",
    "Bosque Seco" = "Bosque Seco",
    "bosque_seco" = "Bosque Seco",
    
    # Ecosystem services - map to new names WITH units
    "Carbono Orgánico Suelos" = "Carbono Orgánico Suelos (t C/ha)",
    "Carbono orgánico en suelos" = "Carbono Orgánico Suelos (t C/ha)",
    "carbono_organico_suelos" = "Carbono Orgánico Suelos (t C/ha)",
    "Biomasa Aérea más Subterránea" = "Biomasa Aérea más Subterránea (t C/ha)",
    "Biomasa aérea más biomasa subterránea" = "Biomasa Aérea más Subterránea (t C/ha)",
    "biomasa_aerea_mas_subterranea" = "Biomasa Aérea más Subterránea (t C/ha)",
    "Recarga de Agua Subterránea" = "Recarga de Agua Subterránea",
    "Recarga de agua subterranea" = "Recarga de Agua Subterránea",
    "recarga_agua_subterranea" = "Recarga de Agua Subterránea"
  )
  
  # Get feature display names for themes using scenarios mapping
  feature_names <- c()
  for (feat_id in features_used) {
    feat_id_str <- as.character(feat_id)
    if (feat_id_str %in% names(feature_id_to_name)) {
      feat_name <- feature_id_to_name[[feat_id_str]]
      
      # First try direct lookup in mapping dictionary
      if (feat_name %in% names(scenario_to_layer_map)) {
        feat_name <- scenario_to_layer_map[[feat_name]]
      } else {
        # Try case-insensitive match
        lower_name <- tolower(feat_name)
        lower_keys <- tolower(names(scenario_to_layer_map))
        case_insensitive_match <- match(lower_name, lower_keys)
        if (!is.na(case_insensitive_match)) {
          feat_name <- scenario_to_layer_map[[case_insensitive_match]]
        } else {
          # Look up in feature_name_map to get proper display name
          simple_match <- match(feat_name, feature_name_map$simple_name)
          if (!is.na(simple_match)) {
            feat_name <- feature_name_map$display_name[simple_match]
          }
        }
      }
      
      feature_names <- c(feature_names, feat_name)
    } else {
      cat(sprintf("  WARNING: No mapping for feature ID %d\n", feat_id))
      feature_names <- c(feature_names, paste("Feature", feat_id))
    }
  }
  themes_str <- paste(feature_names, collapse = ",")
  
  # Get targets
  targets_used <- scenarios$sensibilidad[i]
  targets_used <- paste(targets_used, collapse = ',')
  targets_used <- as.numeric(strsplit(targets_used, ",")[[1]])
  targets_str <- paste(targets_used / 100, collapse = ",")
  
  # Get cost/weight information and map column names to display names
  cost_col <- if (!is.null(scenarios$costo) && !is.na(scenarios$costo[i])) scenarios$costo[i] else ""
  
  # Map cost column names to display layer names (with units)
  cost_name_map <- c(
    "IHEH_2022" = "IHEH 2022 (índice 0-100)",
    "IHEH_2030_desarrollista" = "IHEH 2030 (índice 0-100)",
    "Beneficio_neto" = "Beneficio Neto (COP)",
    "Coca_Muertes_1622" = "Coca Muertes 2016-2022 (# eventos)",
    "Refugios_Clima_8_5" = "Refugios Clima 8.5 (# especies)"
  )
  
  weights_str <- ""
  if (nchar(cost_col) > 0) {
    if (cost_col %in% names(cost_name_map)) {
      weights_str <- cost_name_map[[cost_col]]
    } else {
      weights_str <- cost_col
      cat(sprintf("  WARNING: No name mapping for cost column: %s\n", cost_col))
    }
  }
  
  # Get inclusion constraints and map column names to display names
  includes_str <- ""
  if (!is.null(scenarios$inclusion) && !is.na(scenarios$inclusion[i]) && scenarios$inclusion[i] != "") {
    inclusion_cols <- trimws(strsplit(scenarios$inclusion[i], ",")[[1]])
    
    # Map constraint column names to display layer names
    constraint_name_map <- c(
      "Resguardos_Indígenas" = "Resguardos Indígenas",
      "Comunidades_Negras" = "Comunidades Negras",
      "RUNAP" = "RUNAP",
      "OMECs" = "OMECs"
    )
    
    # Map each constraint name
    mapped_includes <- sapply(inclusion_cols, function(col) {
      if (col %in% names(constraint_name_map)) {
        constraint_name_map[[col]]
      } else {
        cat(sprintf("  WARNING: No name mapping for inclusion constraint: %s\n", col))
        col
      }
    })
    
    includes_str <- paste(mapped_includes, collapse = ",")
  }
  
  # Create descriptive scenario name
  scenario_display_name <- as.character(scenario_name)
  
  # Create description
  description <- paste0("Nacional - ", scenario_display_name)
  if (nchar(weights_str) > 0) {
    description <- paste0(description, " - ", weights_str)
  }
  if (nchar(includes_str) > 0) {
    description <- paste0(description, " - ", includes_str)
  }
  
  # Add to solutions metadata
  solutions_metadata <- rbind(solutions_metadata, data.frame(
    description = description,
    author_name = "Cambio Global Project",
    author_email = "info@cambioglobal.org",
    user_group = "public",
    scenario = scenario_display_name,
    file_path = solution_file,
    themes = themes_str,
    targets = targets_str,
    weights = weights_str,
    includes = includes_str,
    excludes = "",
    stringsAsFactors = FALSE
  ))
  
  cat(sprintf("  Processed: %s\n", scenario_name))
}

# Write solutions.csv with UTF-8 encoding
write.csv(solutions_metadata, 
          paste0(solutions_upload_dir, "/solutions.csv"), 
          row.names = FALSE, 
          quote = TRUE,
          fileEncoding = "UTF-8")

cat(sprintf("\n  ✓ solutions.csv created with %d scenarios\n", nrow(solutions_metadata)))

# ============================================================================
# Summary
# ============================================================================

cat("\n============================================================================\n")
cat("Organization complete!\n")
cat(sprintf("Upload directory: %s\n", normalizePath(upload_dir)))
cat("\n")
cat("Created files:\n")
cat(sprintf("  - PU raster: %s\n", "PU_Nacional_5km.tif"))
cat(sprintf("  - Feature layers: %d TIF files\n", length(extracted_files)))
cat(sprintf("  - Constraint/weight layers: %d TIF files\n", nrow(constraint_weight_layers)))
cat(sprintf("  - Total layers: %d TIF files + layers.csv\n", nrow(layers_metadata)))
cat(sprintf("  - Solutions: %d TIF files + solutions.csv\n", nrow(solutions_metadata)))
cat("\n")
cat("Layer breakdown:\n")
cat("  Features:\n")
cat(sprintf("    - Ecosistemas (1)\n"))
cat(sprintf("    - Ecosistemas estratégicos (4): Páramo, Manglar, Humedales, Bosque seco\n"))
cat(sprintf("    - Especies (1)\n"))
cat(sprintf("    - Servicios ecosistémicos (3): Carbono, Biomasa, Recarga agua\n"))
cat("  Constraints (4): Resguardos, Comunidades, RUNAP, OMECs\n")
cat("  Weights (5): IHEH 2022, IHEH 2030, Beneficio Neto, Coca Muertes, Refugios Clima\n")
cat("\n")
cat("============================================================================\n")

# ============================================================================
# 7. Create ZIP Files for Upload
# ============================================================================

cat("\nCreating ZIP files...\n")

# Delete old ZIPs if they exist
old_layers_zip <- paste0(upload_dir, "/layers.zip")
old_solutions_zip <- paste0(upload_dir, "/solutions.zip")
if (file.exists(old_layers_zip)) {
  unlink(old_layers_zip)
  cat("  ✓ Deleted old layers.zip\n")
}
if (file.exists(old_solutions_zip)) {
  unlink(old_solutions_zip)
  cat("  ✓ Deleted old solutions.zip\n")
}

# Create layers ZIP (zip contents of layers folder)
cat("Creating layers.zip...\n")
layer_file_count <- length(list.files(layers_dir))
cat(sprintf("  Zipping %d files from layers/ folder\n", layer_file_count))

# Change to layers directory, zip all contents, then change back
old_wd <- getwd()
setwd(layers_dir)

zip_result <- tryCatch({
  all_files <- list.files()
  utils::zip(zipfile = file.path("..", "layers.zip"), files = all_files)
  TRUE
}, error = function(e) {
  cat("  ERROR creating ZIP:", e$message, "\n")
  FALSE
})

setwd(old_wd)

if (file.exists(old_layers_zip)) {
  cat(sprintf("  ✓ Created layers.zip (%s bytes)\n", 
              format(file.size(old_layers_zip), big.mark=",")))
} else {
  cat("  ✗ Failed to create layers.zip\n")
}

# Create solutions ZIP (zip contents of solutions folder)
cat("Creating solutions.zip...\n")
# First copy solutions.csv to solutions folder for convenience
file.copy(paste0(upload_dir, "/solutions.csv"), 
          paste0(solutions_upload_dir, "/solutions.csv"), 
          overwrite = TRUE)

solution_file_count <- length(list.files(solutions_upload_dir))
cat(sprintf("  Zipping %d files from solutions/ folder\n", solution_file_count))

if (solution_file_count > 0) {
  # Change to solutions directory, zip all contents, then change back
  old_wd <- getwd()
  setwd(solutions_upload_dir)
  
  zip_result <- tryCatch({
    all_files <- list.files()
    utils::zip(zipfile = file.path("..", "solutions.zip"), files = all_files)
    TRUE
  }, error = function(e) {
    cat("  ERROR creating ZIP:", e$message, "\n")
    FALSE
  })
  
  setwd(old_wd)
  
  if (file.exists(old_solutions_zip)) {
    cat(sprintf("  ✓ Created solutions.zip (%s bytes)\n", 
                format(file.size(old_solutions_zip), big.mark=",")))
  } else {
    cat("  ✗ Failed to create solutions.zip\n")
  }
} else {
  cat("  ! No solution files to zip\n")
}

cat("\n============================================================================\n")
cat("✓ Upload ready!\n")
if (file.exists(old_layers_zip)) {
  cat(sprintf("  - layers.zip: %s\n", old_layers_zip))
}
if (file.exists(old_solutions_zip)) {
  cat(sprintf("  - solutions.zip: %s\n", old_solutions_zip))
}
cat("\n")
cat("Next steps:\n")
cat("  1. Review the generated layers.csv and solutions.csv\n")
cat("  2. Upload ZIPs via the admin panel\n")
cat("============================================================================\n")

