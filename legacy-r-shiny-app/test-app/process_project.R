library(terra)
library(dplyr)
library(tidyr)
library(assertthat)
library(yaml)
library(DBI)
library(RPostgres)

process_project <- function(data_dir, metadata_file, project_name, output_dir, db_con) {

  # 1. Read metadata
  metadata <- tibble::as_tibble(
    read.csv(metadata_file, stringsAsFactors = FALSE)
  )

  # Validate metadata
  assert_that(all(metadata$Type %in% c("theme", "include", "weight")))

  # 2. Create study area (first file is mask)
  study_area_file <- metadata$File[1]
  study_area_data <- terra::rast(file.path(data_dir, study_area_file))
  study_area_name <- tools::file_path_sans_ext(study_area_file)

  # 3. Prepare data layers
  theme_names <- c()
  weight_names <- c()
  include_names <- c()

  all_layers <- list()

  for (i in seq_len(nrow(metadata))) {
    file_path <- file.path(data_dir, metadata$File[i])
    raster <- terra::rast(file_path)

    # Align raster to study area
    if (!compareGeom(study_area_data, raster, stopOnError = FALSE)) {
      raster <- terra::project(raster, study_area_data, method = "near")
    }

    layer_name <- tools::file_path_sans_ext(metadata$File[i])
    layer_type <- metadata$Type[i]

    if (layer_type == "theme") {
      theme_names <- c(theme_names, layer_name)
    } else if (layer_type == "weight") {
      weight_names <- c(weight_names, layer_name)
    } else if (layer_type == "include") {
      include_names <- c(include_names, layer_name)
    }

    all_layers[[layer_name]] <- list(
      file = paste0(layer_name, ".tif"),
      type = layer_type,
      units = metadata$Units[i] %||% NA,
      goal = metadata$Goal[i] %||% NA,
      visible = TRUE
    )

    # Save raster to output_dir/project_name
    proj_dir <- file.path(output_dir, project_name)
    dir.create(proj_dir, recursive = TRUE, showWarnings = FALSE)
    terra::writeRaster(raster, file.path(proj_dir, paste0(layer_name, ".tif")), overwrite = TRUE)
  }

  # 4. Build YAML structure
  yaml_obj <- list(
    project = list(
      name = project_name,
      description = metadata$Description[1] %||% "",
      study_area = study_area_name
    ),
    themes = theme_names,
    weights = weight_names,
    includes = include_names,
    layers = all_layers
  )

  yaml_path <- file.path(output_dir, project_name, paste0(project_name, ".yaml"))
  yaml::write_yaml(yaml_obj, yaml_path)

  # 5. Save YAML text to database
  yaml_text <- paste(readLines(yaml_path), collapse = "\n")

  dbExecute(db_con,
    "INSERT INTO projects (title, description, owner_id, user_group, yaml)
     VALUES ($1, $2, $3, $4, $5)",
    params = list(
      project_name,
      metadata$Description[1] %||% "",
      1, # Example: owner_id = 1
      "public",
      yaml_text
    )
  )

  return(list(
    project_dir = file.path(output_dir, project_name),
    yaml_path = yaml_path
  ))
}
