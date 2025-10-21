# ============================================================================
# Organize Eje Cafetero Data for Upload
# ============================================================================
# This script organizes all the Eje Cafetero data into the upload format:
# - Copies extracted features to layers folder
# - Copies solution outputs to solutions folder
# - Creates layers.csv metadata
# - Creates solutions.csv metadata

library(dplyr)
library(openxlsx)
library(raster)

# Set working directory
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global")

# Parameters
extension <- "EJE_CAFETERO"
resolution <- "1km"

# Directories
extracted_features_dir <- "./eje_cafetero_processing/extracted_features"
solutions_dir <- paste0("./output/", extension)
upload_dir <- "./eje_cafetero_processing/upload_ready"

# Create upload directory structure
if (!dir.exists(upload_dir)) {
  dir.create(upload_dir, recursive = TRUE)
}
layers_dir <- paste0(upload_dir, "/layers")
solutions_upload_dir <- paste0(upload_dir, "/solutions")
if (!dir.exists(layers_dir)) {
  dir.create(layers_dir, recursive = TRUE)
}
if (!dir.exists(solutions_upload_dir)) {
  dir.create(solutions_upload_dir, recursive = TRUE)
}

cat("============================================================================\n")
cat("Organizing Eje Cafetero data for upload\n")
cat("============================================================================\n\n")

# ============================================================================
# 1. Copy Planning Units Raster to Root of Upload Directory
# ============================================================================

cat("Copying planning units raster to root...\n")
file.copy(
  paste0("./features/PUs_", extension, "_", resolution, ".tif"),
  paste0(upload_dir, "/PU_", extension, "_", resolution, ".tif"),
  overwrite = TRUE
)

# ============================================================================
# 2. Copy Extracted Features to Layers
# ============================================================================

cat("Copying extracted features...\n")
feature_files <- list.files(extracted_features_dir, pattern = "\\.tif$", full.names = TRUE)
for (f in feature_files) {
  file.copy(f, paste0(layers_dir, "/", basename(f)), overwrite = TRUE)
  cat(sprintf("  Copied: %s\n", basename(f)))
}

# ============================================================================
# 2b. Extract Constraints and Weights from Planning Unit CSV
# ============================================================================

cat("\nExtracting constraint and weight layers from planning unit CSV...\n")

# Load planning unit raster template
pu_raster <- raster(paste0("./features/PUs_", extension, "_", resolution, ".tif"))

# Load planning unit CSV with all the constraint/weight columns
pu_data <- read.csv(paste0("./input/PUs_", extension, "_", resolution, ".csv"))

# Define which columns to extract and their types
constraint_weight_layers <- data.frame(
  column_name = c("Resguardos_Indígenas", "Comunidades_Negras", "RUNAP", 
                  "ECC_SIRAPEC", "OMECs", "IHEH_2022", "IHEH_2030_desarrollista", "Beneficio_neto"),
  output_name = c("resguardos_indigenas", "comunidades_negras", "RUNAP",
                  "ECC_SIRAPEC", "OMECs", "IHEH_2022", "IHEH_2030_desarrollista", "Beneficio_neto"),
  type = c("include", "include", "include", "include", "include", "weight", "weight", "weight"),
  is_binary = rep(NA, 8),  # Will be determined by checking actual data
  is_all_na = rep(FALSE, 8),  # Track layers with no data (all NAs)
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
      
      if (is_binary) {
        cat(sprintf("    Detected as BINARY (values: %s)\n", paste(sort(unique_vals), collapse=", ")))
      } else {
        cat(sprintf("    Detected as CONTINUOUS (range: %.2f to %.2f)\n", 
                    min(col_values, na.rm=TRUE), max(col_values, na.rm=TRUE)))
      }
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
    
    cat(sprintf("    Saved: %s\n", out_name, ".tif"))
    rm(r)
    gc()
  } else {
    cat(sprintf("  WARNING: Column '%s' not found in planning unit CSV\n", col_name))
  }
}

# ============================================================================
# 3. Create layers.csv Metadata
# ============================================================================

cat("\nCreating layers.csv metadata...\n")

# Hard-coded theme mapping based on Excel structure
# Feature ID -> Theme (grupo)
# NOTE: Manglares removed - coastal ecosystem not present in inland Eje Cafetero
feature_themes <- c(
  "Ecosistemas",                    # 1 - Ecosistemas IAVH
  "Ecosistemas estratégicos",       # 4 - Páramos
  "Ecosistemas estratégicos",       # 6 - Humedales
  "Ecosistemas estratégicos",       # 7 - Bosque Seco
  "Especies",                        # 21 - Riqueza de Especies
  "Servicios ecosistémicos",        # 11 - Carbono
  "Servicios ecosistémicos",        # 12 - Biomasa
  "Servicios ecosistémicos"         # 15 - Recarga
)

cat("  Using hard-coded theme mapping from Excel\n")

# Define layer metadata for feature layers
# Type options: theme, include, exclude, weight
# Legend options: manual, continuous
theme_layers <- data.frame(
  Type = rep("theme", 8),
  Theme = feature_themes,
  File = c(
    "ecosistemas_IAVH.tif",
    "paramos.tif",
    "humedales.tif",
    "bosque_seco.tif",
    "especies_richness.tif",
    "carbono_organico_suelos.tif",
    "biomasa_aerea_mas_subterranea.tif",
    "recarga_agua_subterranea.tif"
  ),
  Name = c(
    "Ecosistemas IAVH",
    "Páramos",
    "Humedales",
    "Bosque Seco",
    "Riqueza de Especies",
    "Carbono Orgánico Suelos",
    "Biomasa Aérea más Subterránea",
    "Recarga de Agua Subterránea"
  ),
  Legend = c(
    "continuous",  # Ecosistemas IAVH
    "manual",      # Páramos
    "manual",      # Humedales - only has value 1 (present everywhere)
    "manual",      # Bosque Seco
    "continuous",  # Riqueza de Especies
    "continuous",  # Carbono
    "continuous",  # Biomasa
    "manual"       # Recarga
  ),
  Values = c(
    "",        # Ecosistemas IAVH
    "0, 1",    # Páramos
    "1",       # Humedales - only value 1 exists
    "0, 1",    # Bosque Seco
    "",        # Riqueza de Especies
    "",        # Carbono
    "",        # Biomasa
    "0, 1"     # Recarga
  ),
  Color = c(
    "Greens",              # Ecosistemas IAVH
    "#00000000, #aaaa00", # Páramos
    "#00aaff",             # Humedales - single color for value 1
    "#00000000, #ffaa00", # Bosque Seco
    "BuPu",                # Riqueza de Especies
    "Greys",               # Carbono
    "BuGn",                # Biomasa
    "#00000000, #7897b9"  # Recarga
  ),
  Labels = c(
    "",                     # Ecosistemas IAVH
    "absence, presence",   # Páramos
    "presence",            # Humedales - single label for value 1
    "absence, presence",   # Bosque Seco
    "",                     # Riqueza de Especies
    "",                     # Carbono
    "",                     # Biomasa
    "absence, presence"    # Recarga
  ),
  Unit = rep("km2", 8),  # All theme layers use km2 for consistency
  Provenance = rep("national", 8),  # Use "national" - valid enum value
  Order = rep("", 8),
  Visible = rep("FALSE", 8),
  Hidden = rep("FALSE", 8),
  Goal = rep("0.3", 8),
  Downloadable = rep("TRUE", 8),
  stringsAsFactors = FALSE
)

# Add constraint and weight layers
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
                          "#00000000, #4a7c59", "#00000000, #3d6b4d", "#00000000, #2e5a41")
        color_palette[((j-1) %% 5) + 1]
      }
    } else {
      # Continuous layers get color ramp
      if (extracted_constraints$type[j] == "weight") {
        if (grepl("Beneficio", extracted_constraints$output_name[j])) {
          "Greens"
        } else {
          "Reds"
        }
      } else {
        "Greens"
      }
    }
  })
  
  # Dynamically build display names from column names
  display_names <- c(
    "Resguardos_Indígenas" = "Resguardos Indígenas",
    "Comunidades_Negras" = "Comunidades Negras",
    "RUNAP" = "RUNAP",
    "ECC_SIRAPEC" = "ECC SIRAPEC",
    "OMECs" = "OMECs",
    "IHEH_2022" = "IHEH 2022",
    "IHEH_2030_desarrollista" = "IHEH 2030",
    "Beneficio_neto" = "Beneficio Neto"
  )
  
  # Visible: TRUE for includes (except all-NA layers), FALSE for weights
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
  # Use "index" for unitless layers, "km2" for others
  units_for_constraints <- sapply(extracted_constraints$column_name, function(col_name) {
    display_name <- display_names[[col_name]]
    if (grepl("IHEH|Coca.*Muertes|Refugios.*Clima|Beneficio", display_name, ignore.case = TRUE)) {
      return("index")  # Unitless layers
    } else {
      return("km2")  # Everything else
    }
  }, USE.NAMES = FALSE)
  
  constraint_layers <- data.frame(
    Type = extracted_constraints$type,
    Theme = rep("", nrow(extracted_constraints)),
    File = paste0(extracted_constraints$output_name, ".tif"),
    Name = sapply(extracted_constraints$column_name, function(x) display_names[[x]]),
    Legend = legend_types,
    Values = legend_values,
    Color = colors,
    Labels = legend_labels,
    Unit = units_for_constraints,  # Proper units based on layer type
    Provenance = rep("national", nrow(extracted_constraints)),
    Order = rep("", nrow(extracted_constraints)),
    Visible = visible_values,
    Hidden = rep("FALSE", nrow(extracted_constraints)),
    Goal = rep("0.3", nrow(extracted_constraints)),
    Downloadable = rep("TRUE", nrow(extracted_constraints)),
    stringsAsFactors = FALSE
  )
} else {
  # No constraint/weight layers extracted
  constraint_layers <- data.frame()
}

# Combine theme and constraint layers
layers_metadata <- rbind(theme_layers, constraint_layers)

# Write layers.csv with UTF-8 encoding
write.csv(layers_metadata, 
          paste0(layers_dir, "/layers.csv"), 
          row.names = FALSE, 
          quote = TRUE,
          fileEncoding = "UTF-8")

cat("  layers.csv created\n")

# ============================================================================
# 4. Copy Solutions and Create solutions.csv
# ============================================================================

cat("\nProcessing solutions...\n")

# Read scenarios from Excel with proper encoding
# openxlsx handles UTF-8 by default, but ensure proper reading
options(encoding = "UTF-8")
scenarios <- read.xlsx("./input/Propuesta_Ejecafero_26625.xlsx", sheet = "escenarios_nuevos")

cat(sprintf("  Found %d scenarios in Excel file\n", nrow(scenarios)))

# Initialize solutions metadata data frame
solutions_metadata <- data.frame(
  description = character(),
  author_name = character(),
  author_email = character(),
  user_group = character(),
  scenario = character(),
  file_path = character(),
  themes = character(),
  targets = character(),
  weights = character(),
  includes = character(),
  excludes = character(),
  stringsAsFactors = FALSE
)

# Get list of available solution files
solution_files <- list.files(solutions_dir, pattern = "\\.tif$", full.names = FALSE)

cat(sprintf("  Found %d solution TIF files in output directory\n", length(solution_files)))

# Process each scenario
for (i in 1:nrow(scenarios)) {
  scenario_number <- scenarios$escenario[i]
  solution_file <- paste0(scenario_number, ".tif")
  
  # Check if solution file exists
  if (!solution_file %in% solution_files) {
    cat(sprintf("  WARNING: Solution file not found for scenario '%s'. Skipping...\n", scenario_number))
    next
  }
  
  # Copy solution file
  file.copy(
    paste0(solutions_dir, "/", solution_file),
    paste0(solutions_upload_dir, "/", solution_file),
    overwrite = TRUE
  )
  
  # Extract scenario information
  features_used <- scenarios$id_elemento_priorizacion[i]
  features_used <- paste(features_used, collapse = ',')
  features_used <- as.numeric(strsplit(features_used, ",")[[1]])
  
  # Get feature names for themes
  feature_names <- layers_metadata %>%
    filter(row_number() %in% match(features_used, c(1, 4, 24, 6, 7, 21, 11, 12, 15))) %>%
    pull(Name)
  themes_str <- paste(feature_names, collapse = ",")
  
  # Get targets
  targets_used <- scenarios$sensibilidad[i]
  targets_used <- paste(targets_used, collapse = ',')
  targets_used <- as.numeric(strsplit(targets_used, ",")[[1]])
  targets_str <- paste(targets_used / 100, collapse = ",")
  
  # Get cost/weight information and map to layer names
  cost_col <- scenarios$costo[i]
  
  # Map cost column names to display layer names
  cost_name_map <- c(
    "IHEH_2022" = "IHEH 2022",
    "IHEH_2030_desarrollista" = "IHEH 2030",
    "Beneficio_neto" = "Beneficio Neto"
    # Add more mappings as needed
  )
  
  # Short names for cost columns (for scenario name)
  cost_short_map <- c(
    "IHEH_2022" = "IHEH2022",
    "IHEH_2030_desarrollista" = "IHEH2030",
    "Beneficio_neto" = "BenNeto"
  )
  
  weights_str <- ""
  cost_short <- ""
  if (!is.na(cost_col) && cost_col != "") {
    if (cost_col %in% names(cost_name_map)) {
      weights_str <- cost_name_map[[cost_col]]
      cost_short <- cost_short_map[[cost_col]]
    } else {
      # If no mapping found, try to match by looking for the layer
      weights_str <- cost_col
      cost_short <- cost_col
      cat("  WARNING: No name mapping for cost column:", cost_col, "\n")
    }
  }
  
  # Get inclusion constraints and map to layer names
  includes_str <- ""
  constraint_short <- ""
  if (!is.na(scenarios$inclusion[i]) && scenarios$inclusion[i] != "") {
    # Split by comma to get individual constraint names
    inclusion_cols <- trimws(strsplit(scenarios$inclusion[i], ",")[[1]])
    
    # Map constraint column names to display layer names
    constraint_name_map <- c(
      "Resguardos_Indígenas" = "Resguardos Indígenas",
      "Comunidades_Negras" = "Comunidades Negras",
      "RUNAP" = "RUNAP",
      "ECC_SIRAPEC" = "ECC SIRAPEC",
      "OMECs" = "OMECs"
      # Add more mappings as needed
    )
    
    # Short names for constraints (for scenario name)
    constraint_short_map <- c(
      "Resguardos_Indígenas" = "ResInd",
      "Comunidades_Negras" = "ComNeg",
      "RUNAP" = "RUNAP",
      "ECC_SIRAPEC" = "ECC",
      "OMECs" = "OMECs"
    )
    
    # Map each constraint name
    mapped_includes <- sapply(inclusion_cols, function(col) {
      if (col %in% names(constraint_name_map)) {
        constraint_name_map[[col]]
      } else {
        cat("  WARNING: No name mapping for inclusion constraint:", col, "\n")
        col
      }
    })
    
    # Create short version for scenario name
    short_includes <- sapply(inclusion_cols, function(col) {
      if (col %in% names(constraint_short_map)) {
        constraint_short_map[[col]]
      } else {
        col
      }
    })
    
    includes_str <- paste(mapped_includes, collapse = ",")
    constraint_short <- paste(short_includes, collapse = "+")
  }
  
  # Create descriptive scenario name
  # Format: "S##_CostName_Constraints" (e.g., "S01_IHEH2022_RUNAP", "S02_IHEH2022_RUNAP+OMECs")
  scenario_name_parts <- c(sprintf("S%02d", scenario_number))
  if (cost_short != "") {
    scenario_name_parts <- c(scenario_name_parts, cost_short)
  }
  if (constraint_short != "") {
    scenario_name_parts <- c(scenario_name_parts, constraint_short)
  }
  scenario_name <- paste(scenario_name_parts, collapse = "_")
  
  # Create description
  description <- paste0("Eje Cafetero - Escenario ", scenario_number, 
                       if (cost_short != "") paste0(" - ", weights_str) else "",
                       if (constraint_short != "") paste0(" - ", includes_str) else "")
  
  # Add to solutions metadata
  solutions_metadata <- rbind(solutions_metadata, data.frame(
    description = description,
    author_name = "Cambio Global Project",
    author_email = "info@cambioglobal.org",
    user_group = "public",
    scenario = scenario_name,  # Now a descriptive string like "S01_IHEH2022_RUNAP"
    file_path = solution_file,
    themes = themes_str,
    targets = targets_str,
    weights = weights_str,
    includes = includes_str,
    excludes = "",
    stringsAsFactors = FALSE
  ))
  
  cat(sprintf("  Processed: %s -> %s\n", scenario_number, scenario_name))
}

# Write solutions.csv with UTF-8 encoding
write.csv(solutions_metadata, 
          paste0(solutions_upload_dir, "/solutions.csv"), 
          row.names = FALSE, 
          quote = TRUE,
          fileEncoding = "UTF-8")

cat(sprintf("\n  solutions.csv created with %d scenarios\n", nrow(solutions_metadata)))

# ============================================================================
# Summary
# ============================================================================

cat("\n============================================================================\n")
cat("Organization complete!\n")
cat(sprintf("Upload directory: %s\n", normalizePath(upload_dir)))
cat(sprintf("  - %d layer files\n", length(list.files(layers_dir, pattern = "\\.tif$"))))
cat(sprintf("  - %d solution files\n", length(list.files(solutions_upload_dir, pattern = "\\.tif$"))))
cat("============================================================================\n")

# ============================================================================
# 6. Create ZIP Files for Upload
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

