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
                   "IHEH 2022", "Beneficio Neto", "IHEH 2030",
                   "Coca Muertes 2016-2022", "Refugios Clima 8.5"),
  type = c("include", "include", "include", "include",
           "weight", "weight", "weight",
           "weight", "weight"),
  is_binary = rep(NA, 9),  # Will be determined by checking actual data
  stringsAsFactors = FALSE
)

for (i in 1:nrow(constraint_weight_layers)) {
  col_name <- constraint_weight_layers$column_name[i]
  out_name <- constraint_weight_layers$output_name[i]
  
  if (col_name %in% names(pu_data)) {
    cat(sprintf("  Processing: %s\n", col_name))
    
    # Check if values are binary (only 0, 1, and NA)
    col_values <- pu_data[[col_name]]
    unique_vals <- unique(col_values[!is.na(col_values)])
    is_binary <- all(unique_vals %in% c(0, 1))
    constraint_weight_layers$is_binary[i] <- is_binary
    
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

# Create metadata for extracted features with proper display names
# Match filenames back to feature names from scenarios
display_names_for_layers <- c()
colors_for_layers <- c()
for (feat_file in extracted_files) {
  # Extract simple name without .tif
  simple_name <- gsub("\\.tif$", "", feat_file)
  
  # Try to find matching display name from feature_id_to_name
  # by comparing the transliterated version
  found_name <- NULL
  for (feat_id in names(feature_id_to_name)) {
    feat_display <- feature_id_to_name[[feat_id]]
    # Transliterate and clean to match filename
    feat_simple <- chartr("áéíóúñÁÉÍÓÚÑ", "aeiounAEIOUN", feat_display)
    feat_simple <- tolower(gsub("[^A-Za-z0-9]", "_", feat_simple))
    feat_simple <- gsub("_+", "_", feat_simple)
    feat_simple <- gsub("^_|_$", "", feat_simple)
    
    if (feat_simple == simple_name) {
      found_name <- feat_display
      break
    }
  }
  
  # Use found name or fallback to cleaned up filename
  if (!is.null(found_name)) {
    display_names_for_layers <- c(display_names_for_layers, found_name)
  } else {
    display_names_for_layers <- c(display_names_for_layers, gsub("_", " ", simple_name))
  }
}

# Create metadata with proper theme mapping and legend types
# Check actual raster values to determine binary vs continuous
themes_for_layers <- c()
legends_for_layers <- c()
values_for_layers <- c()
labels_for_layers <- c()

for (j in 1:length(display_names_for_layers)) {
  feat_name <- display_names_for_layers[j]
  feat_file <- extracted_files[j]
  
  # Map to theme based on feature name
  if (grepl("Ecosistemas IAVH", feat_name, ignore.case = TRUE)) {
    theme <- "Ecosistemas"
  } else if (grepl("Páramo|Manglar|Humedal|Bosque seco", feat_name, ignore.case = TRUE)) {
    theme <- "Ecosistemas estratégicos"
  } else if (grepl("Especie", feat_name, ignore.case = TRUE)) {
    theme <- "Especies"
  } else if (grepl("Carbono|Biomasa|Recarga", feat_name, ignore.case = TRUE)) {
    theme <- "Servicios ecosistémicos"
  } else {
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
      # Continuous layers use a color ramp name
      colors_for_layers <- c(colors_for_layers, "Greens")
      cat(sprintf("  %s: CONTINUOUS (legend=continuous, range: %.4f to %.4f)\n", 
                  feat_name, min(unique_vals), max(unique_vals)))
    }
    
    rm(r)  # Clean up raster object
  } else {
    # Fallback if file doesn't exist yet
    legends_for_layers <- c(legends_for_layers, "continuous")
    values_for_layers <- c(values_for_layers, "")
    labels_for_layers <- c(labels_for_layers, "")
    colors_for_layers <- c(colors_for_layers, "Greens")
    cat(sprintf("  WARNING: Raster file not found for %s, defaulting to continuous\n", feat_name))
  }
}

# Feature layers metadata
feature_layers_metadata <- data.frame(
  Type = rep("theme", length(extracted_files)),
  Theme = themes_for_layers,  # Use mapped themes
  File = extracted_files,
  Name = display_names_for_layers,  # Use proper display names with accents
  Legend = legends_for_layers,  # Detected from actual raster values
  Values = values_for_layers,  # "0, 1" for binary, "" for continuous
  Color = colors_for_layers,  # Two colors for binary, color ramp for continuous
  Labels = labels_for_layers,  # "absent, present" for binary, "" for continuous
  Unit = rep("km2", length(extracted_files)),
  Provenance = rep("national", length(extracted_files)),
  Order = rep("", length(extracted_files)),
  Visible = rep("TRUE", length(extracted_files)),
  Hidden = rep("FALSE", length(extracted_files)),
  Goal = rep("0.3", length(extracted_files)),
  Downloadable = rep("TRUE", length(extracted_files)),
  stringsAsFactors = FALSE
)

# Constraint/weight layers metadata using detected binary status
legend_types <- ifelse(constraint_weight_layers$is_binary, "manual", "continuous")
legend_values <- ifelse(constraint_weight_layers$is_binary, "0, 1", "")
legend_labels <- ifelse(constraint_weight_layers$is_binary, "not included, included", "")

# Color palette based on type and binary status
colors <- sapply(1:nrow(constraint_weight_layers), function(j) {
  if (constraint_weight_layers$is_binary[j]) {
    # Binary layers get transparent + color
    color_palette <- c("#00000000, #5ea53f", "#00000000, #86af43", 
                      "#00000000, #4a7c59", "#00000000, #3d6b4d")
    color_palette[((j-1) %% 4) + 1]
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

constraint_layers_metadata <- data.frame(
  Type = constraint_weight_layers$type,
  Theme = rep("", nrow(constraint_weight_layers)),
  File = paste0(constraint_weight_layers$output_name, ".tif"),
  Name = constraint_weight_layers$display_name,
  Legend = legend_types,
  Values = legend_values,
  Color = colors,
  Labels = legend_labels,
  Unit = rep("km2", nrow(constraint_weight_layers)),
  Provenance = rep("national", nrow(constraint_weight_layers)),
  Order = rep("", nrow(constraint_weight_layers)),
  Visible = ifelse(constraint_weight_layers$type == "include", "TRUE", "FALSE"),  # Includes visible, weights hidden
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
  
  # Get feature display names for themes using scenarios mapping
  feature_names <- c()
  for (feat_id in features_used) {
    feat_id_str <- as.character(feat_id)
    if (feat_id_str %in% names(feature_id_to_name)) {
      feature_names <- c(feature_names, feature_id_to_name[[feat_id_str]])
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
  
  # Map cost column names to display layer names
  cost_name_map <- c(
    "IHEH_2022" = "IHEH 2022",
    "IHEH_2030_desarrollista" = "IHEH 2030",
    "Beneficio_neto" = "Beneficio Neto",
    "Coca_Muertes_1622" = "Coca Muertes 2016-2022",
    "Refugios_Clima_8_5" = "Refugios Clima 8.5"
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
cat("Next steps:\n")
cat("  1. Review the generated layers.csv and solutions.csv\n")
cat("  2. Upload via the admin panel\n")
cat("============================================================================\n")

