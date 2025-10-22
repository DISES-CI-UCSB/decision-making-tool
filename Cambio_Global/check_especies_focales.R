# Quick diagnostic: Check Especies Focales (ID 20)
library(fst)
library(dplyr)

# Load rij
rij <- read.fst("./input/rij_ORINOQUIA_3km.fst")

# Check how many unique species are in ID 20
# First, we need to load features to map species IDs to id_elemento
# Try with readxl if openxlsx not available
if (requireNamespace("readxl", quietly = TRUE)) {
  features <- readxl::read_excel("./input/features_v4_4_24_(MAPV).xlsx")
} else if (requireNamespace("openxlsx", quietly = TRUE)) {
  features <- openxlsx::read.xlsx("./input/features_v4_4_24_(MAPV).xlsx")
} else {
  stop("Need either readxl or openxlsx package")
}

# Filter to ID 20
id20_features <- features %>% filter(id_elemento_priorizacion == 20)

cat(sprintf("\n=== ESPECIES FOCALES (ID 20) ANALYSIS ===\n"))
cat(sprintf("Number of features with id_elemento_priorizacion == 20: %d\n", nrow(id20_features)))

if (nrow(id20_features) > 0) {
  cat("\nFeature IDs:\n")
  print(id20_features$id)
  
  cat("\nFeature names (first 20):\n")
  print(head(id20_features$nombre, 20))
  
  # Check rij
  id20_species_ids <- id20_features$id
  id20_rij <- rij %>% filter(species %in% id20_species_ids)
  
  cat(sprintf("\nRecords in rij for ID 20: %d\n", nrow(id20_rij)))
  cat(sprintf("Unique species in rij: %d\n", n_distinct(id20_rij$species)))
  cat(sprintf("Unique planning units covered: %d\n", n_distinct(id20_rij$pu)))
  
  # Check for richness pattern
  richness_per_pu <- id20_rij %>%
    group_by(pu) %>%
    summarise(n_species = n_distinct(species), .groups = "drop")
  
  cat(sprintf("\nRichness statistics:\n"))
  cat(sprintf("  Min species per PU: %d\n", min(richness_per_pu$n_species)))
  cat(sprintf("  Max species per PU: %d\n", max(richness_per_pu$n_species)))
  cat(sprintf("  Mean species per PU: %.2f\n", mean(richness_per_pu$n_species)))
  
  if (max(richness_per_pu$n_species) > 1) {
    cat("\n*** CONCLUSION: ID 20 contains MULTIPLE species per PU ***\n")
    cat("*** It should be aggregated to richness like ID 21 ***\n")
  } else {
    cat("\n*** CONCLUSION: ID 20 has only 1 species per PU ***\n")
    cat("*** Binary treatment may be correct ***\n")
  }
}

# Also check ID 21 for comparison
id21_features <- features %>% filter(id_elemento_priorizacion == 21)
cat(sprintf("\n=== ESPECIES (ID 21) FOR COMPARISON ===\n"))
cat(sprintf("Number of features with id_elemento_priorizacion == 21: %d\n", nrow(id21_features)))

if (nrow(id21_features) > 0) {
  id21_species_ids <- id21_features$id
  id21_rij <- rij %>% filter(species %in% id21_species_ids)
  
  richness_per_pu_21 <- id21_rij %>%
    group_by(pu) %>%
    summarise(n_species = n_distinct(species), .groups = "drop")
  
  cat(sprintf("Max species per PU for ID 21: %d\n", max(richness_per_pu_21$n_species)))
}


