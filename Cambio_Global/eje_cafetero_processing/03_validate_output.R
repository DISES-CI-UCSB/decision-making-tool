# ============================================================================
# Validate Upload Ready Output
# ============================================================================
# This script validates that the output structure is correct for upload

library(dplyr)

# Set working directory
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global")

cat("============================================================================\n")
cat("Validating Eje Cafetero Upload Output\n")
cat("============================================================================\n\n")

upload_dir <- "./eje_cafetero_processing/upload_ready"

# Check if output exists
if (!dir.exists(upload_dir)) {
  stop("Upload ready directory not found! Please run 02_organize_for_upload.R first.")
}

# ============================================================================
# 1. Check Planning Unit File in Root
# ============================================================================

cat("1. CHECKING PLANNING UNIT FILE...\n")
pu_file <- list.files(upload_dir, pattern = "^PU_.*\\.tif$", full.names = TRUE)

if (length(pu_file) == 0) {
  cat("   ❌ ERROR: Planning unit TIF not found in root directory\n")
} else if (length(pu_file) > 1) {
  cat("   ⚠️  WARNING: Multiple planning unit files found:\n")
  cat("  ", paste(basename(pu_file), collapse=", "), "\n")
} else {
  cat("   ✓ Planning unit file found:", basename(pu_file), "\n")
}

# ============================================================================
# 2. Check Layers Directory
# ============================================================================

cat("\n2. CHECKING LAYERS DIRECTORY...\n")
layers_dir <- file.path(upload_dir, "layers")

if (!dir.exists(layers_dir)) {
  stop("   ❌ ERROR: layers/ directory not found")
}

# Check for layers.csv
layers_csv <- file.path(layers_dir, "layers.csv")
if (!file.exists(layers_csv)) {
  stop("   ❌ ERROR: layers/layers.csv not found")
}
cat("   ✓ layers.csv found\n")

# Read and validate layers.csv
layers_df <- read.csv(layers_csv, stringsAsFactors = FALSE, fileEncoding = "UTF-8")
cat("   ✓ Read layers.csv with", nrow(layers_df), "rows\n")

# Check required columns
required_cols <- c("Type", "Theme", "File", "Name", "Legend", "Values", 
                   "Color", "Labels", "Unit", "Provenance", "Order", 
                   "Visible", "Hidden", "Downloadable")

missing_cols <- setdiff(required_cols, names(layers_df))
if (length(missing_cols) > 0) {
  cat("   ❌ ERROR: Missing required columns:", paste(missing_cols, collapse=", "), "\n")
  stop("layers.csv is missing required columns")
} else {
  cat("   ✓ All required columns present\n")
}

# Check for UTF-8 characters (accents)
has_accents <- any(grepl("[áéíóúñÁÉÍÓÚÑ]", layers_df$Theme))
if (has_accents) {
  cat("   ✓ UTF-8 characters (accents) detected and readable\n")
} else {
  cat("   ⚠️  No Spanish accents found in Theme column (expected: 'Ecosistemas estratégicos', 'Servicios ecosistémicos')\n")
}

# Check Type column values
valid_types <- c("theme", "include", "exclude", "weight")
invalid_types <- setdiff(unique(layers_df$Type), valid_types)
if (length(invalid_types) > 0) {
  cat("   ❌ ERROR: Invalid Type values found:", paste(invalid_types, collapse=", "), "\n")
} else {
  cat("   ✓ All Type values are valid\n")
}

# Count by type
type_counts <- table(layers_df$Type)
cat("   Layer counts by Type:\n")
for (type in names(type_counts)) {
  cat("     -", type, ":", type_counts[[type]], "\n")
}

# Check that all layer files exist
cat("\n3. CHECKING LAYER FILES...\n")
missing_files <- c()
for (i in 1:nrow(layers_df)) {
  layer_file <- file.path(layers_dir, layers_df$File[i])
  if (!file.exists(layer_file)) {
    missing_files <- c(missing_files, layers_df$File[i])
  }
}

if (length(missing_files) > 0) {
  cat("   ❌ ERROR: Missing layer files:\n")
  for (f in missing_files) {
    cat("     -", f, "\n")
  }
} else {
  cat("   ✓ All", nrow(layers_df), "layer files found\n")
}

# ============================================================================
# 4. Check Solutions Directory
# ============================================================================

cat("\n4. CHECKING SOLUTIONS DIRECTORY...\n")
solutions_dir <- file.path(upload_dir, "solutions")

if (!dir.exists(solutions_dir)) {
  cat("   ⚠️  WARNING: solutions/ directory not found\n")
} else {
  # Check for solutions.csv
  solutions_csv <- file.path(solutions_dir, "solutions.csv")
  if (!file.exists(solutions_csv)) {
    cat("   ⚠️  WARNING: solutions/solutions.csv not found\n")
  } else {
    cat("   ✓ solutions.csv found\n")
    
    # Read and validate solutions.csv
    solutions_df <- read.csv(solutions_csv, stringsAsFactors = FALSE, fileEncoding = "UTF-8")
    cat("   ✓ Read solutions.csv with", nrow(solutions_df), "rows\n")
    
    # Check solution files exist
    missing_solution_files <- c()
    for (i in 1:nrow(solutions_df)) {
      solution_file <- file.path(solutions_dir, solutions_df$file_path[i])
      if (!file.exists(solution_file)) {
        missing_solution_files <- c(missing_solution_files, solutions_df$file_path[i])
      }
    }
    
    if (length(missing_solution_files) > 0) {
      cat("   ⚠️  WARNING: Missing solution files:\n")
      for (f in head(missing_solution_files, 5)) {
        cat("     -", f, "\n")
      }
      if (length(missing_solution_files) > 5) {
        cat("     ... and", length(missing_solution_files) - 5, "more\n")
      }
    } else {
      cat("   ✓ All", nrow(solutions_df), "solution files found\n")
    }
  }
}

# ============================================================================
# 5. Summary
# ============================================================================

cat("\n============================================================================\n")
cat("VALIDATION SUMMARY\n")
cat("============================================================================\n")

all_valid <- length(pu_file) == 1 && 
             file.exists(layers_csv) && 
             length(missing_cols) == 0 &&
             length(invalid_types) == 0 &&
             length(missing_files) == 0

if (all_valid) {
  cat("✅ ALL CHECKS PASSED!\n")
  cat("The upload_ready directory is properly formatted.\n\n")
  cat("You can now:\n")
  cat("  1. Zip the entire 'upload_ready' folder\n")
  cat("  2. Upload via the admin page in your tool\n")
} else {
  cat("❌ VALIDATION FAILED\n")
  cat("Please fix the errors above before uploading.\n")
}

cat("============================================================================\n")

