# ============================================================================
# Master Script - Run All ORINOQUIA Processing Steps
# ============================================================================
#
# This script runs the complete ORINOQUIA data processing pipeline:
# 1. Extract features from rij matrix
# 2. Organize data for upload (layers.csv + solutions.csv)
#
# ============================================================================

cat("\n")
cat("============================================================================\n")
cat("ORINOQUIA Data Processing Pipeline (3km Resolution)\n")
cat("============================================================================\n")
cat("\n")

# Set working directory to the processing folder
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global/orinoquia_processing")

# ============================================================================
# Step 1: Extract Features from RIJ Matrix
# ============================================================================

cat("\n--- STEP 1: Extracting Features from RIJ Matrix ---\n\n")

source("01_extract_features_from_rij.R")

cat("\n✓ Step 1 complete\n")

# ============================================================================
# Step 2: Organize for Upload
# ============================================================================

cat("\n--- STEP 2: Organizing Data for Upload ---\n\n")

source("02_organize_for_upload.R")

cat("\n✓ Step 2 complete\n")

# ============================================================================
# Summary
# ============================================================================

cat("\n")
cat("============================================================================\n")
cat("ORINOQUIA PROCESSING COMPLETE!\n")
cat("============================================================================\n")
cat("\n")
cat("Next steps:\n")
cat("  1. Review upload_ready/layers/layers.csv\n")
cat("  2. Review upload_ready/solutions/solutions.csv\n")
cat("     - Verify themes/targets from scenarios_to_run_4_24 _Iteraciones Prioritarias_v2.xlsx\n")
cat("     - Check that solution files matched correctly by scenario number\n")
cat("  3. Upload via admin page:\n")
cat("     - Project Name: ORINOQUIA SIRAP\n")
cat("     - Planning Units: upload_ready/PU_ORINOQUIA_3km.tif\n")
cat("     - Layers: upload_ready/layers/ folder (includes layers.csv)\n")
cat("     - Solutions: upload_ready/solutions/ folder (includes solutions.csv)\n")
cat("\n")
cat("Upload directory location:\n")
cat(sprintf("  %s\n", normalizePath("./upload_ready")))
cat("\n")
cat("============================================================================\n")

