# ============================================================================
# Master Script for Nacional Data Processing
# ============================================================================

cat("\n")
cat("================================================================================\n")
cat("  NACIONAL PROCESSING PIPELINE (5km)\n")
cat("================================================================================\n")
cat("\n")

# Set working directory
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global/nacional_processing")

# ============================================================================
# Step 1: Extract Features from RIJ
# ============================================================================

cat("STEP 1: Extracting features from rij matrix...\n")
cat("--------------------------------------------------------------------------------\n")

source("01_extract_features_from_rij.R")

cat("\n✓ Feature extraction complete!\n\n")

# ============================================================================
# Step 2: Organize for Upload  
# ============================================================================

cat("STEP 2: Organizing data for upload...\n")
cat("--------------------------------------------------------------------------------\n")

setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global/nacional_processing")
source("02_organize_for_upload.R")

cat("\n✓ Upload organization complete!\n\n")

# ============================================================================
# Summary
# ============================================================================

cat("================================================================================\n")
cat("  PROCESSING COMPLETE!\n")
cat("================================================================================\n")
cat("\n")
cat("Output location: ", normalizePath("./upload_ready"), "\n")
cat("\n")
cat("Next steps:\n")
cat("  1. Review the generated layers.csv and solutions.csv\n")
cat("  2. Check the extracted TIF files\n")
cat("  3. Upload via the admin panel\n")
cat("\n")

