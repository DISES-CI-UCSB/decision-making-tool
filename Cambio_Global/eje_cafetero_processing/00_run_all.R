# ============================================================================
# Master Script: Run Complete Eje Cafetero Processing Workflow
# ============================================================================
# This script runs the complete workflow:
# 1. Extract features from rij matrix
# 2. Organize data for upload

cat("============================================================================\n")
cat("Eje Cafetero SIRAP - Complete Processing Workflow\n")
cat("============================================================================\n\n")

start_time <- Sys.time()

# Set working directory
setwd("C:/Users/danwillett/Code/SCALE/decision-making-tool/Cambio_Global/eje_cafetero_processing")

# ============================================================================
# Step 1: Extract Features from RIJ
# ============================================================================

cat("STEP 1: Extracting features from rij matrix...\n")
cat("----------------------------------------------------------------------------\n")
source("01_extract_features_from_rij.R", echo = FALSE)

cat("\n\n")

# ============================================================================
# Step 2: Organize for Upload
# ============================================================================

cat("STEP 2: Organizing data for upload...\n")
cat("----------------------------------------------------------------------------\n")
source("02_organize_for_upload.R", echo = FALSE)

# ============================================================================
# Summary
# ============================================================================

end_time <- Sys.time()
elapsed_time <- difftime(end_time, start_time, units = "mins")

cat("\n\n")
cat("============================================================================\n")
cat("COMPLETE WORKFLOW FINISHED!\n")
cat("============================================================================\n")
cat(sprintf("Total time: %.2f minutes\n", elapsed_time))
cat("\nNext steps:\n")
cat("  1. Review the output in: upload_ready/\n")
cat("  2. Zip the layers and solutions folders if needed\n")
cat("  3. Upload using the admin page in your tool\n")
cat("============================================================================\n")

