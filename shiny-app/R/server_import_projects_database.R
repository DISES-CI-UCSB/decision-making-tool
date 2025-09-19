#' Sever function: import projects from database
#'
#' Set behavior for importing projects using database option
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_import_projects_database)
#' ```
#'
#' @noRd
#' 

server_import_projects_database <- quote({
  
  # GraphQL queries/mutations
  public_projects_query <- '
  query {
    public_projects {
      id
      title
      description
      user_group
      planning_unit {
        id
        name
        path
      }
      owner {
        id
        username
        type
      }
    }
  }'
  
  all_projects_query <- '
  query {
    all_projects {
      id
      title
      description
      user_group
      planning_unit {
        id
        name
        path
      }
      owner {
        id
        username
        type
      }
    }
  }'

  # Fetch projects based on user type and access control
  fetch_projects <- function() {
    
    # Choose query based on user type
    if (!is.null(user_info()) && !is.null(user_info()$type) && user_info()$type == "manager") {
      query_name <- "all_projects"
      query_text <- all_projects_query
      data_field <- "all_projects"
    } else {
      query_name <- "public_projects"
      query_text <- public_projects_query
      data_field <- "public_projects"
    }
    
    qry <- ghql::Query$new()
    qry$query(query_name, query_text)
    tryCatch({
      res <- client$exec(qry$queries[[query_name]])
      cat("Projects response:", res, "\n")
      res_list <- jsonlite::fromJSON(res)
      
      projects <- res_list$data[[data_field]]
      if (!is.null(projects) && length(projects) > 0) {
        projects_df <- as.data.frame(projects)
        projects_data(projects_df)
        cat("*** Loaded", nrow(projects_df), "projects ***\n")
      } else {
        projects_data(data.frame())
        cat("*** No projects available ***\n")
      }
    }, error = function(e) {
      cat("Error fetching projects:", e$message, "\n")
      showNotification("Failed to fetch projects", type = "error")
      projects_data(data.frame())
    })
  }

  # Fetch projects when user info changes
  observeEvent(user_info(), { 
    if (!is.null(user_info())) {
      fetch_projects() 
    }
  })
  
  # Function to create project structure from database
  create_project_from_database <- function(project_id) {
    cat("*** Creating project from database ***\n")
    
    # GraphQL queries
    project_query <- '
    query($id: ID!) {
      project(id: $id) {
        id
        title
        description
        owner {
          id
          username
          type
        }
        planning_unit {
          id
          name
          path
        }
      }
    }'
    
    project_layers_query <- '
    query($projectId: ID!) {
      projectLayers(projectId: $projectId) {
        id
        name
        type
        theme
        legend
        values
        color
        labels
        unit
        provenance
        order
        visible
        downloadable
        file {
          id
          name
          path
        }
      }
    }'
    
    # Query project details
    qry_project <- ghql::Query$new()
    qry_project$query("project", project_query)
    res_project <- client$exec(
      qry_project$queries$project,
      variables = list(id = project_id)
    )
    
    res_project_list <- jsonlite::fromJSON(res_project)
    project_data <- res_project_list$data$project
    
    # Query project layers
    qry_layers <- ghql::Query$new()
    qry_layers$query("projectLayers", project_layers_query)
    res_layers <- client$exec(
      qry_layers$queries$projectLayers,
      variables = list(projectId = project_id)
    )
    
    res_layers_list <- jsonlite::fromJSON(res_layers)
    layers_data <- res_layers_list$data$projectLayers
    cat("*** Found", nrow(layers_data), "layers ***\n")
    
    # Create Dataset object using planning unit file and layer files
    if (is.null(project_data$planning_unit) || is.null(project_data$planning_unit$path)) {
      stop("Project does not have a planning unit file")
    }
    
    planning_unit_path <- project_data$planning_unit$path
    cat("*** Planning unit path:", planning_unit_path, "***\n")
    
    # Read the planning unit raster to create the base dataset
    pu_raster <- terra::rast(planning_unit_path)
    
    # Read all layer files and combine them into a single SpatRaster stack
    layer_paths <- layers_data$file$path
    cat("*** Reading", length(layer_paths), "layer files ***\n")
    
    # Read all layers
    layer_rasters <- lapply(layer_paths, function(path) {
      cat("*** Reading layer:", path, "***\n")
      terra::rast(path)
    })
    
    # Combine planning unit with all layers
    all_rasters <- c(pu_raster, do.call(c, layer_rasters))
    
    # Set names for the raster stack (planning unit + layer names)
    layer_names <- c("planning_unit", layers_data$name)
    names(all_rasters) <- make.names(layer_names)  # Ensure valid R names
    
    cat("*** Created raster stack with", terra::nlyr(all_rasters), "layers ***\n")
    cat("*** Layer names:", names(all_rasters), "***\n")
    
    # Create dataset from the combined raster stack
    dataset <- wheretowork::new_dataset_from_auto(all_rasters)
    
    # Create themes, weights, includes, excludes from layers
    themes <- list()
    weights <- list()
    includes <- list()
    excludes <- list()
    
    # Group theme layers by theme name
    theme_groups <- list()
    
    for (i in seq_len(nrow(layers_data))) {
      layer <- layers_data[i, ]
      
      # Use the layer name as index (it's now a column in the dataset)
      # Add 1 to index because planning_unit is at index 1
      layer_index <- i + 1  # planning_unit is at index 1, layers start at index 2
      layer_name <- make.names(layer$name)  # Ensure valid R name
      
      cat("*** Creating variable for layer", i, ":", layer$name, "using index", layer_index, "***\n")
      
      # Create variable from layer using column index
      # Handle color and labels which are stored as lists in the data frame
      layer_colors <- if (length(layer$color[[1]]) > 0) layer$color[[1]] else "random"
      layer_labels <- if (length(layer$labels[[1]]) > 0) layer$labels[[1]] else "missing"
      
      cat("*** Layer colors:", paste(layer_colors, collapse = ", "), "***\n")
      cat("*** Layer labels:", paste(layer_labels, collapse = ", "), "***\n")
      
      variable <- wheretowork::new_variable_from_auto(
        dataset = dataset,
        index = layer_index,  # Use column index instead of file path
        units = if (is.null(layer$unit)) "" else layer$unit,
        type = if (layer$legend == "continuous") "continuous" else if (layer$legend == "manual") "manual" else "auto",
        colors = layer_colors,
        labels = layer_labels
      )
      
      # Add to appropriate category based on type
      if (layer$type == "theme") {
        # Create feature for this layer
        feature <- wheretowork::new_feature(
          name = layer$name,
          variable = variable,
          goal = 0.3,  # Default goal
          status = TRUE,
          current = 0,
          visible = as.logical(layer$visible)
        )
        
        # Group features by theme name
        theme_name <- layer$theme
        if (is.null(theme_groups[[theme_name]])) {
          theme_groups[[theme_name]] <- list()
        }
        theme_groups[[theme_name]][[length(theme_groups[[theme_name]]) + 1]] <- feature
        
      } else if (layer$type == "weight") {
        weights[[length(weights) + 1]] <- wheretowork::new_weight(
          name = layer$name,
          variable = variable,
          factor = 1,  # Default factor
          status = FALSE,
          visible = as.logical(layer$visible)
        )
      } else if (layer$type == "include") {
        includes[[length(includes) + 1]] <- wheretowork::new_include(
          name = layer$name,
          variable = variable,
          status = FALSE,
          visible = as.logical(layer$visible)
        )
      } else if (layer$type == "exclude") {
        excludes[[length(excludes) + 1]] <- wheretowork::new_exclude(
          name = layer$name,
          variable = variable,
          status = FALSE,
          visible = as.logical(layer$visible)
        )
      }
    }
    
    # Create themes from grouped features
    for (theme_name in names(theme_groups)) {
      themes[[length(themes) + 1]] <- wheretowork::new_theme(
        name = theme_name,
        feature = theme_groups[[theme_name]]
      )
    }
    
    # Return project structure matching read_project output
    list(
      name = project_data$title,
      author_name = project_data$owner$username,
      author_email = "database@project.com",  # Default email
      wheretowork_version = utils::packageVersion("wheretowork"),
      prioritizr_version = utils::packageVersion("prioritizr"),
      mode = "advanced",  # Default mode
      dataset = dataset,
      themes = themes,
      weights = weights,
      includes = includes,
      excludes = excludes
    )
  }
  
  # Handle database project import when import button is clicked
  observeEvent(input$importModal_builtin_button, {
    ## specify dependencies
    shiny::req(input$importModal_builtin_button)
    shiny::req(input$importModal_name)

    ## update import button
    disable_html_element("importModal_builtin_button")

    # Check if this is a database project (numeric ID)
    project_id <- input$importModal_name
    
    if (grepl("^[0-9]+$", project_id)) {
      # This is a database project ID
      cat("Importing project:", project_id, "\n")
      
      ## import configuration
      x <- try(
        create_project_from_database(project_id),
        silent = TRUE
      )

      ## throw error if needed
      if (inherits(x, c("try-error", "error"))) {
        ## prepare download link
        download_link <- htmltools::tags$a(
          "download here",
          href = "#",
          onclick = paste0(
            "var element = document.createElement('a');",
            "element.setAttribute('href', 'data:text/plain;charset=utf-8,",
            utils::URLencode(paste(c(
              paste("Database project import failed for project ID:", project_id),
              paste("Error:", as.character(x))
            ), collapse = "\\n"), reserved = TRUE),
            "');",
            "element.setAttribute('download', 'error-log.txt');",
            "element.style.display = 'none';",
            "document.body.appendChild(element);",
            "element.click();",
            "document.body.removeChild(element);"
          )
        )

        ## show error modal
        shiny::showModal(
          shiny::modalDialog(
            title = "Import failed",
            htmltools::tags$p(
              "Oops... Something went wrong when importing this project.",
              "This is likely due to a mistake in the project data.",
              "To resolve this issue, please download the error log (",
              download_link,
              ") and email it to Richard Schuster",
              "(",
              htmltools::tags$a(
                "richard.schuster@natureconservancy.ca",
                href = "mailto:richard.schuster@natureconservancy.ca"
              ),
              ")."
            ),
            footer = shiny::modalButton("Dismiss"),
            easyClose = TRUE
          )
        )

        ## reset import button
        shinyFeedback::resetLoadingButton("importModal_builtin_button")
        enable_html_element("importModal_builtin_button")

        ## exit
        return()
      }

      ## store project ID for database solution loading
      app_data$project_id <- project_id
      
      ## import data
      environment(import_data) <- environment()
      import_data(x = x, mode = get_golem_config("mode"))

      ## remove data modal
      shiny::removeModal(session)
      
      # add side-bar spinner
      shinyjs::runjs(
        "const sidebarSpinner = document.createElement('div');
         sidebarSpinner.classList.add('sidebar-spinner');
         const mapManagerPane_settings = document.querySelector('#mapManagerPane_settings');
         mapManagerPane_settings.appendChild(sidebarSpinner);"
      )    

      ## show help modal if beginner
      if (identical(app_data$mode, "beginner")) {
        shinyBS::toggleModal(session, modalId = "helpModal", toggle = "open")
      }
      
      ## Trigger solution dropdown update now that project is loaded
      shinyjs::delay(1000, {
        cat("*** Triggering solution dropdown update ***\n")
        solution_load_trigger(solution_load_trigger() + 1)
      })
      
      ## Show success notification and close import modal
      shiny::showNotification("Database project imported successfully!", type = "message", duration = 3)
      shiny::removeModal()
      
      cat("*** DATABASE PROJECT IMPORT COMPLETED SUCCESSFULLY ***\n")
    } else {
      ## This is not a database project - let the legacy handler deal with it
      ## Reset the button since we're not handling this case
      shinyFeedback::resetLoadingButton("importModal_builtin_button")
      enable_html_element("importModal_builtin_button")
    }
  })
  
})