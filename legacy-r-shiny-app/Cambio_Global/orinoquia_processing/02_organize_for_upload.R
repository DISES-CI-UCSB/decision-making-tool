# ============================================================================
# Organize ORINOQUIA Data for Upload (3km)
# ============================================================================

library(raster)
library(dplyr)

cat("\n============================================================================\n")
cat("Organizing ORINOQUIA data for upload\n")
cat("============================================================================\n\n")

# Set working directory
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global")

# Define paths
pu_raster_file <- "./PUs/PUs_ORINOQUIA_3km.tif"
pu_csv_file <- "./input/PUs_ORINOQUIA_3km.csv"
features_file <- "./input/features_v4_4_24_(MAPV).xlsx"
scenarios_file <- "./input/scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx"
extracted_features_dir <- "./orinoquia_processing/extracted_features"
solutions_dir <- "./output/ORINOQUIA"
upload_dir <- "./orinoquia_processing/upload_ready"

# Create upload directory structure
layers_dir <- paste0(upload_dir, "/layers")
solutions_upload_dir <- paste0(upload_dir, "/solutions")

if (!dir.exists(upload_dir)) dir.create(upload_dir, recursive = TRUE)
if (!dir.exists(layers_dir)) dir.create(layers_dir, recursive = TRUE)
if (!dir.exists(solutions_upload_dir)) dir.create(solutions_upload_dir, recursive = TRUE)

# ============================================================================
# 1. Copy Planning Unit Raster
# ============================================================================

cat("Copying planning unit raster to upload directory...\n")
file.copy(pu_raster_file, paste0(upload_dir, "/PU_ORINOQUIA_3km.tif"), overwrite = TRUE)
cat("  ✓ PU raster copied\n")

# ============================================================================
# 2. Load Metadata
# ============================================================================

cat("\nLoading metadata...\n")
pu_raster <- raster(pu_raster_file)
pu_data <- read.csv(pu_csv_file)
cat(sprintf("  Planning units: %d\n", nrow(pu_data)))

# Load scenarios
cat("\nLoading scenarios...\n")
scenarios <- openxlsx::read.xlsx(scenarios_file, sheet = 1, detectDates = FALSE)

# Filter for ORINOQUIA if SIRAP column exists
if ("SIRAP" %in% names(scenarios)) {
  scenarios <- scenarios[scenarios$SIRAP == "ORINOQUIA" | scenarios$SIRAP == "orinoquia" | scenarios$SIRAP == "Orinoquia", ]
  cat(sprintf("  Filtered to %d ORINOQUIA scenarios\n", nrow(scenarios)))
} else {
  cat("  WARNING: No SIRAP column found\n")
}

# Create feature ID to name mapping from scenarios (if available)
feature_id_to_name <- list()

if (nrow(scenarios) > 0 && "id_elemento_priorizacion" %in% names(scenarios) && "elemento_priorizacion" %in% names(scenarios)) {
  for (i in 1:nrow(scenarios)) {
    ids_str <- as.character(scenarios$id_elemento_priorizacion[i])
    names_str <- as.character(scenarios$elemento_priorizacion[i])
    
    if (!is.na(ids_str) && !is.na(names_str)) {
      ids <- trimws(strsplit(ids_str, ",")[[1]])
      names <- trimws(strsplit(names_str, ",")[[1]])
      
      if (length(ids) == length(names)) {
        for (j in 1:length(ids)) {
          feature_id_to_name[[ids[j]]] <- names[j]
        }
      }
    }
  }
  cat(sprintf("  Mapped %d features from scenarios\n", length(feature_id_to_name)))
}

# ============================================================================
# 3. Extract Constraint and Weight Layers
# ============================================================================

cat("\nExtracting constraint and weight layers from PU CSV...\n")

# Define which columns to extract and their types based on PUs_ORINOQUIA_3km.csv
# We'll need to check what columns exist
cat("  Available columns in PU CSV:\n")
cat(sprintf("    %s\n", paste(names(pu_data), collapse=", ")))

# Common constraint/weight columns (adjust based on what's actually in the CSV)
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
    "bosque_seco",
    "especies_focales",
    "especies_richness",
    "carbono_organico_suelos",
    "biomasa_aerea_mas_subterranea",
    "recarga_agua_subterranea",
    "areas_nucleoSIRAPO",
    "humadelesCOL_EC",
    "Congriales",
    "condor_habitat"
  ),
  display_name = c(
    "Ecosistemas IAVH",
    "Páramos",
    "Bosque Seco",
    "Especies Focales",
    "Riqueza de Especies",
    "Carbono Orgánico Suelos (t C/ha)",
    "Biomasa Aérea más Subterránea (t C/ha)",
    "Recarga de Agua Subterránea",
    "Áreas núcleo EEP Orinoquía",
    "Humedales + Humedales SIRAPEC", 
    "Distribucion Congriales",
    "Habitat Condor"
  ),
  stringsAsFactors = FALSE
)

# Create metadata for extracted features with proper display names
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

# Map themes based on feature names
themes_for_layers <- c()
legends_for_layers <- c()
values_for_layers <- c()
labels_for_layers <- c()

# Data dictionary: map display_name → theme
theme_dict <- data.frame(
  display_name = c(
    "Ecosistemas IAVH",
    "Páramos",
    "Bosque Seco",
    "Especies Focales",
    "Riqueza de Especies",
    "Carbono Orgánico Suelos (t C/ha)",
    "Biomasa Aérea más Subterránea (t C/ha)",
    "Recarga de Agua Subterránea",
    "Áreas núcleo EEP Orinoquía",
    "Humedales + Humedales SIRAPEC",
    "Distribucion Congriales",
    "Habitat Condor"
  ),
  theme = c(
    "Ecosistemas",
    "Ecosistemas estratégicos",
    "Ecosistemas estratégicos",
    "Especies / Focales",
    "Especies / Focales",
    "Servicios ecosistémicos",
    "Servicios ecosistémicos",
    "Servicios ecosistémicos",
    "Ecosistemas estratégicos regionales",
    "Ecosistemas estratégicos regionales",
    "Ecosistemas estratégicos regionales",
    "Especies / Focales"
  ),
  stringsAsFactors = FALSE
)


for (i in 1:length(extracted_files)) {
  feat_file <- extracted_files[i]
  feat_name <- display_names_for_layers[i]
  
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
  Theme = themes_for_layers,
  File = extracted_files,
  Name = display_names_for_layers,
  Legend = legends_for_layers,
  Values = values_for_layers,
  Color = colors_for_layers,  # Two colors for binary, color ramp for continuous
  Labels = labels_for_layers,
  Unit = units_for_layers,  # Proper units based on layer type
  Provenance = rep("national", length(extracted_files)),
  Order = rep("", length(extracted_files)),
  Visible = rep("FALSE", length(extracted_files)),  # Theme layers hidden by default
  Hidden = rep("FALSE", length(extracted_files)),
  Goal = rep("0.3", length(extracted_files)),
  Downloadable = rep("TRUE", length(extracted_files)),
  stringsAsFactors = FALSE
)

# Filter to only include layers that were actually extracted (is_binary is not NA)
extracted_constraints <- constraint_weight_layers[!is.na(constraint_weight_layers$is_binary), ]

if (nrow(extracted_constraints) > 0) {
  # Constraint/weight layers metadata using detected binary status
  legend_types <- ifelse(extracted_constraints$is_binary, "manual", "continuous")
  
  # For all-NA layers, only specify the values that actually exist (just 0)
  legend_values <- sapply(1:nrow(extracted_constraints), function(j) {
    if (extracted_constraints$is_binary[j]) {
      if (extracted_constraints$is_all_na[j]) {
        "0"  # All-NA layers only have 0 values
      } else {
        "0, 1"  # Normal binary layers
      }
    } else {
      ""  # Continuous layers
    }
  })
  
  # Use different labels for all-NA layers vs. normal binary layers
  legend_labels <- sapply(1:nrow(extracted_constraints), function(j) {
    if (extracted_constraints$is_binary[j]) {
      if (extracted_constraints$is_all_na[j]) {
        "0"  # All-NA layers - just label the 0 value
      } else {
        "not included, included"  # Normal binary layers
      }
    } else {
      ""  # Continuous layers
    }
  })
  
  # Color palette based on type and binary status
  colors <- sapply(1:nrow(extracted_constraints), function(j) {
    if (extracted_constraints$is_binary[j]) {
      # Check if layer is all NAs (no data)
      if (extracted_constraints$is_all_na[j]) {
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
      if (extracted_constraints$type[j] == "weight") {
        if (grepl("Beneficio", extracted_constraints$display_name[j])) {
          "Greens"
        } else if (grepl("Clima", extracted_constraints$display_name[j])) {
          "Blues"
        } else {
          "Reds"
        }
      } else {
        "Greens"
      }
    }
  })
  
  # Visible: TRUE for includes (except all-NA layers like Comunidades Negras), FALSE for weights
  visible_values <- sapply(1:nrow(extracted_constraints), function(j) {
    if (extracted_constraints$type[j] == "include") {
      # Hide all-NA layers (like Comunidades Negras)
      if (extracted_constraints$is_all_na[j]) {
        return("FALSE")
      } else {
        return("TRUE")
      }
    } else {
      return("FALSE")  # Weights hidden by default
    }
  })
  
  # Assign units for constraint/weight layers
  # Use "index" for unitless layers (IHEH, Coca Muertes, Refugios)
  # Use "km2" for others
  units_for_constraints <- sapply(extracted_constraints$display_name, function(name) {
    if (grepl("IHEH|Coca.*Muertes|Refugios.*Clima|Beneficio", name, ignore.case = TRUE)) {
      return("index")  # Unitless layers
    } else {
      return("km2")  # Everything else
    }
  }, USE.NAMES = FALSE)
  
  constraint_layers_metadata <- data.frame(
    Type = extracted_constraints$type,
    Theme = rep("", nrow(extracted_constraints)),
    File = paste0(extracted_constraints$output_name, ".tif"),
    Name = extracted_constraints$display_name,
    Legend = legend_types,
    Values = legend_values,
    Color = colors,
    Labels = legend_labels,
    Unit = units_for_constraints,  # Proper units based on layer type
    Provenance = rep("national", nrow(extracted_constraints)),
    Order = rep("", nrow(extracted_constraints)),
    Visible = visible_values,
    Hidden = rep("FALSE", nrow(extracted_constraints)),
    Goal = rep("", nrow(extracted_constraints)),
    Downloadable = rep("TRUE", nrow(extracted_constraints)),
    stringsAsFactors = FALSE
  )
} else {
  # No constraint/weight layers extracted
  constraint_layers_metadata <- data.frame()
}

# Combine all layers
layers_metadata <- rbind(feature_layers_metadata, constraint_layers_metadata)

# Write layers.csv with UTF-8 encoding (in the layers folder)
write.csv(layers_metadata, paste0(layers_dir, "/layers.csv"), 
          row.names = FALSE, fileEncoding = "UTF-8")

cat(sprintf("  ✓ Created layers.csv with %d layers\n", nrow(layers_metadata)))

# ============================================================================
# 6. Process Solutions
# ============================================================================

cat("\nProcessing solution files...\n")

# Get all solution TIF files
solution_files <- list.files(solutions_dir, pattern = "\\.tif$", full.names = FALSE)
# Filter out .aux.xml files
solution_files <- solution_files[!grepl("\\.aux\\.xml$", solution_files)]

cat(sprintf("  Found %d solution files\n", length(solution_files)))

# Create name mappings for weights and includes (CSV column names -> display names)
# Build name maps dynamically from extracted constraints only
cost_name_map <- c()
constraint_name_map <- c()

if (nrow(extracted_constraints) > 0) {
  for (i in 1:nrow(extracted_constraints)) {
    col_name <- extracted_constraints$column_name[i]
    display_name <- extracted_constraints$display_name[i]
    layer_type <- extracted_constraints$type[i]
    
    if (layer_type == "weight") {
      cost_name_map[col_name] <- display_name
    } else if (layer_type == "include") {
      constraint_name_map[col_name] <- display_name
    }
  }
}

cat(sprintf("\nAvailable weights for solutions: %s\n", paste(names(cost_name_map), collapse = ", ")))
cat(sprintf("Available includes for solutions: %s\n", paste(names(constraint_name_map), collapse = ", ")))

# Process each scenario from spreadsheet
solutions_metadata <- data.frame()

for (i in 1:nrow(scenarios)) {
  scenario_row <- scenarios[i, ]
  
  # Get escenario value - should match filename exactly (without .tif)
  if (!"escenario" %in% names(scenario_row) || is.na(scenario_row$escenario)) {
    cat(sprintf("  WARNING: Row %d has no escenario value, skipping\n", i))
    next
  }
  
  escenario_name <- as.character(scenario_row$escenario)
  
  # Expected filename is just escenario + .tif
  expected_filename <- paste0(escenario_name, ".tif")
  
  # Check if this file exists in our solution files
  if (!expected_filename %in% solution_files) {
    cat(sprintf("  WARNING: No solution file found for escenario '%s' (expected: %s)\n", 
                escenario_name, expected_filename))
    next
  }
  
  sol_file <- expected_filename
  
  # Extract scenario number for display
  scenario_num <- sub("R([0-9]+)O.*", "\\1", escenario_name)
  
  cat(sprintf("  Processing scenario %s: %s\n", scenario_num, sol_file))
  
  # Extract themes from id_elemento_priorizacion
  themes_ids_str <- as.character(scenario_row$id_elemento_priorizacion)
  themes_names_str <- as.character(scenario_row$elemento_priorizacion)
  
  # Hard-coded mapping dictionary: scenario names → database layer names WITH units
  # NOTE: Only include layers that actually exist in Orinoquia
  scenario_to_layer_map <- c(
    # Species
    "Especies(8700)" = "Riqueza de Especies",
    "Especies" = "Riqueza de Especies",
    "EspFocales" = "Especies Focales",
    "Especies Focales" = "Especies Focales",
    
    # Ecosystem services - map to names WITH units
    "Carbono Orgánico Suelos" = "Carbono Orgánico Suelos (t C/ha)",
    "carbono_organico_suelos" = "Carbono Orgánico Suelos (t C/ha)",
    "Biomasa Aérea más Subterránea" = "Biomasa Aérea más Subterránea (t C/ha)",
    "biomasa_aerea_mas_subterranea" = "Biomasa Aérea más Subterránea (t C/ha)",
    "Habitat_condor" = "Habitat Condor",
    "condor_habitat" = "Habitat Condor",
    
    # Ecosystems (NO Manglares - not in Orinoquia!)
    "Ecosistemas IAvH" = "Ecosistemas IAVH",
    "EcosIAvH" = "Ecosistemas IAVH",
    "Páramo" = "Páramos",
    "Paramo" = "Páramos",
    "HumedalesCOL_EC" = "Humedales + Humedales SIRAPEC",
    "humadelesCOL_EC" = "Humedales + Humedales SIRAPEC",
    "Bosque seco" = "Bosque Seco",
    "Bosqueseco" = "Bosque Seco",
    "Congriales" = "Distribucion Congriales",
    
    # Strategic ecosystems - regional
    "Áreas NucleoSIRAPO" = "Áreas núcleo EEP Orinoquía",
    "areas_nucleoSIRAPO" = "Áreas núcleo EEP Orinoquía",
    
    # Ecosystem services - already added above with units
    "Recarga de Agua Subterránea" = "Recarga de Agua Subterránea",
    "recarga_agua_subterranea" = "Recarga de Agua Subterránea"
  )
  
  themes_display <- c()
  if (!is.na(themes_names_str) && themes_names_str != "") {
    themes_raw <- trimws(strsplit(themes_names_str, ",")[[1]])
    # Map spreadsheet names to actual layer names in layers.csv
    themes_display <- sapply(themes_raw, function(theme_name) {
      # First try direct lookup in mapping dictionary
      if (theme_name %in% names(scenario_to_layer_map)) {
        return(scenario_to_layer_map[[theme_name]])
      }
      
      # Try case-insensitive match
      lower_name <- tolower(theme_name)
      lower_keys <- tolower(names(scenario_to_layer_map))
      case_insensitive_match <- match(lower_name, lower_keys)
      if (!is.na(case_insensitive_match)) {
        return(scenario_to_layer_map[[case_insensitive_match]])
      }
      
      # Fallback: look up in feature_name_map
      simple_match <- match(theme_name, feature_name_map$simple_name)
      if (!is.na(simple_match)) {
        return(feature_name_map$display_name[simple_match])
      }
      
      # Last resort: return as-is and warn
      cat(sprintf("    WARNING: No mapping found for theme '%s'\n", theme_name))
      return(theme_name)
    }, USE.NAMES = FALSE)
  }
  themes <- paste(themes_display, collapse = ",")
  
  # Extract targets from sensibilidad
  targets_str <- as.character(scenario_row$sensibilidad)
  targets <- ""
  if (!is.na(targets_str) && targets_str != "") {
    # Parse comma-separated targets
    target_vals <- trimws(strsplit(targets_str, ",")[[1]])
    # Convert to proportions if they're percentages (e.g., 30 -> 0.3)
    target_vals <- sapply(target_vals, function(x) {
      val <- as.numeric(x)
      if (!is.na(val) && val > 1) {
        return(val / 100)
      }
      return(val)
    })
    targets <- paste(target_vals, collapse = ",")
  }
  
  # Extract weights from costo
  weights_str <- as.character(scenario_row$costo)
  weights <- ""
  if (!is.na(weights_str) && weights_str != "") {
    weight_cols <- trimws(strsplit(weights_str, ",")[[1]])
    # Map to display names
    weight_display <- sapply(weight_cols, function(col) {
      if (col %in% names(cost_name_map)) {
        return(cost_name_map[[col]])
      }
      return(col)
    })
    weights <- paste(weight_display, collapse = ",")
  }
  
  # Extract includes from inclusion
  includes_str <- as.character(scenario_row$inclusion)
  includes <- ""
  if (!is.na(includes_str) && includes_str != "") {
    include_cols <- trimws(strsplit(includes_str, ",")[[1]])
    # Map to display names
    include_display <- sapply(include_cols, function(col) {
      if (col %in% names(constraint_name_map)) {
        return(constraint_name_map[[col]])
      }
      return(col)
    })
    includes <- paste(include_display, collapse = ",")
  }
  
  # Extract excludes from exlusion (note typo in column name)
  excludes_str <- ""
  if ("exlusion" %in% names(scenario_row)) {
    excludes_str <- as.character(scenario_row$exlusion)
  } else if ("exclusion" %in% names(scenario_row)) {
    excludes_str <- as.character(scenario_row$exclusion)
  }
  excludes <- ""
  if (!is.na(excludes_str) && excludes_str != "") {
    exclude_cols <- trimws(strsplit(excludes_str, ",")[[1]])
    # Map to display names
    exclude_display <- sapply(exclude_cols, function(col) {
      if (col %in% names(constraint_name_map)) {
        return(constraint_name_map[[col]])
      }
      return(col)
    })
    excludes <- paste(exclude_display, collapse = ",")
  }
  
  # Create descriptive scenario name
  scenario_name <- paste0("R", scenario_num, "O")
  if (!is.na(themes_names_str) && themes_names_str != "") {
    # Add abbreviated theme info
    theme_abbrev <- gsub("Ecosistemas", "Ecos", themes_names_str)
    theme_abbrev <- gsub("Especies", "Esp", theme_abbrev)
    theme_abbrev <- gsub(" ", "", theme_abbrev)
    if (nchar(theme_abbrev) > 30) {
      theme_abbrev <- substr(theme_abbrev, 1, 30)
    }
    scenario_name <- paste0(scenario_name, "_", theme_abbrev)
  }
  
  # Create description
  description <- paste("ORINOQUIA - Escenario", scenario_num)
  if (!is.na(weights_str) && weights_str != "") {
    description <- paste0(description, " - ", weights)
  }
  if (!is.na(includes_str) && includes_str != "") {
    description <- paste0(description, " - ", includes)
  }
  
  # Copy solution file
  file.copy(
    paste0(solutions_dir, "/", sol_file),
    paste0(solutions_upload_dir, "/", sol_file),
    overwrite = TRUE
  )
  
  # Add to metadata
  solutions_metadata <- rbind(solutions_metadata, data.frame(
    description = description,
    author_name = "Cambio Global Project",
    author_email = "info@cambioglobal.org",
    user_group = "public",
    scenario = scenario_name,
    file_path = sol_file,
    themes = themes,
    targets = targets,
    weights = weights,
    includes = includes,
    excludes = excludes,
    stringsAsFactors = FALSE
  ))
}

cat(sprintf("  ✓ Processed %d solutions\n", nrow(solutions_metadata)))

# Write solutions.csv with UTF-8 encoding (in the solutions folder)
write.csv(solutions_metadata, paste0(solutions_upload_dir, "/solutions.csv"), 
          row.names = FALSE, fileEncoding = "UTF-8")

cat(sprintf("  ✓ Created solutions.csv with %d solutions\n", nrow(solutions_metadata)))

cat("\n============================================================================\n")
cat("ORINOQUIA data organization complete!\n")
cat(sprintf("Upload directory: %s\n", normalizePath(upload_dir)))
cat("\n")
cat("NOTE: Review solutions.csv to verify:\n")
cat("  - Themes/targets extracted from scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx\n")
cat("  - Weights/includes mapped from column names to display names\n")
cat("  - Solution files matched correctly by scenario number (R#O)\n")
cat("\n")
cat("All metadata extracted from spreadsheet - manual review recommended.\n")
cat("============================================================================\n")

# ============================================================================
# 8. Create ZIP Files for Upload
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
cat("============================================================================\n")

