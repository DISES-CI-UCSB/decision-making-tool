#' @include internal.R
NULL

#' Server logic for loading solutions from database
server_load_solution_database <- quote({

  # Database solution loading when load_solution_button pressed
  shiny::observeEvent(input$load_solution_button, {
    
    # Only handle database solutions (file paths starting with "uploads/")
    if (!grepl("^uploads/", input$load_solution_list)) {
      return() # Let the original server_load_solution handle file-based solutions
    }
    
    ## specify dependencies
    shiny::req(input$load_solution_list)
    shiny::req(input$load_solution_color)
    shiny::req(input$load_solution_button)

    cat("*** Loading database solution:", input$load_solution_list, "***\n")

    ## update generate solution inputs
    disable_html_element("load_solution_list")
    disable_html_element("load_solution_color")
    disable_html_element("load_solution_button")

    ## add map spinner
    shinyjs::runjs(
      "const mapSpinner = document.createElement('div');
      mapSpinner.classList.add('map-spinner');
      document.body.appendChild(mapSpinner);"
    )

    ## solution id
    curr_id <- uuid::UUIDgenerate()
    app_data$new_load_solution_id <- curr_id

    # Extract solution filename to match with database
    solution_filename <- basename(input$load_solution_list)
    solution_title <- gsub("-solution\\.tif$", "-solution", solution_filename)
    
    cat("*** Looking for solution:", solution_title, "***\n")
    
    # GraphQL query to get solution with all parameters
    solution_query <- '
      query($projectId: ID!) {
        solutions(projectId: $projectId) {
          id
          title
          description
          author_name
          user_group
          file {
            id
            path
          }
          themes {
            id
            goal
            project_layer {
              id
              name
              theme
              type
            }
          }
          weights {
            id
            name
            theme
            type
          }
          includes {
            id
            name
            theme
            type
          }
          excludes {
            id
            name
            theme
            type
          }
        }
      }'
    
    tryCatch({
      # Execute GraphQL query
      qry <- ghql::Query$new()
      qry$query("solution", solution_query)
      
      res <- client$exec(
        qry$queries$solution,
        headers = list(Authorization = paste("Bearer", auth_token())),
        variables = list(
          projectId = as.character(app_data$project_id)
        )
      )
      
      cat("*** Solution query response:", res, "***\n")
      
      res_list <- jsonlite::fromJSON(res)
      
      # Check for GraphQL errors
      if (!is.null(res_list$errors)) {
        stop("GraphQL errors: ", paste(sapply(res_list$errors, function(e) e$message), collapse = "; "))
      }
      
      solutions <- res_list$data$solutions
      
      # Find the specific solution by title
      solution <- solutions[solutions$title == solution_title, ]
      
      if (nrow(solution) == 0) {
        stop("Solution not found: ", solution_title)
      }
      
      cat("*** Found solution:", solution$title[1], "***\n")
      
      # Parse solution parameters from database
      solution_data <- solution[1, ]  # Get first (and should be only) matching solution
      
      cat("*** Solution has", nrow(solution_data$themes[[1]]), "theme goals ***\n")
      
      # Check if weights/includes/excludes exist and are data frames
      tryCatch({
        if (is.null(solution_data$weights[[1]])) {
          cat("*** Weights is NULL ***\n")
        } else if (is.data.frame(solution_data$weights[[1]])) {
          cat("*** Solution has", nrow(solution_data$weights[[1]]), "weights ***\n")
        } else {
          cat("*** Weights is not a data frame, type:", class(solution_data$weights[[1]]), "***\n")
        }
      }, error = function(e) {
        cat("*** Error checking weights:", e$message, "***\n")
      })
      
      tryCatch({
        if (is.null(solution_data$includes[[1]])) {
          cat("*** Includes is NULL ***\n")
        } else if (is.data.frame(solution_data$includes[[1]])) {
          cat("*** Solution has", nrow(solution_data$includes[[1]]), "includes ***\n")
        } else {
          cat("*** Includes is not a data frame, type:", class(solution_data$includes[[1]]), "***\n")
        }
      }, error = function(e) {
        cat("*** Error checking includes:", e$message, "***\n")
      })
      
      tryCatch({
        if (is.null(solution_data$excludes[[1]])) {
          cat("*** Excludes is NULL ***\n")
        } else if (is.data.frame(solution_data$excludes[[1]])) {
          cat("*** Solution has", nrow(solution_data$excludes[[1]]), "excludes ***\n")
        } else {
          cat("*** Excludes is not a data frame, type:", class(solution_data$excludes[[1]]), "***\n")
        }
      }, error = function(e) {
        cat("*** Error checking excludes:", e$message, "***\n")
      })
      
        # Debug: Print the actual theme data
        if (nrow(solution_data$themes[[1]]) > 0) {
          cat("*** Theme data structure: ***\n")
          print(str(solution_data$themes[[1]]))
          themes_df <- solution_data$themes[[1]]
          for (i in seq_len(nrow(themes_df))) {
            cat("*** Theme", i, ":", themes_df$project_layer$name[i], "goal:", themes_df$goal[i], "***\n")
          }
        }
      
      # Apply solution parameters to app_data$ss first, then update UI
      tryCatch({
        # Update theme goals in the SolutionSettings object first
        # First, get all theme names that are in the solution
        solution_theme_names <- c()
        if (nrow(solution_data$themes[[1]]) > 0) {
          themes_df <- solution_data$themes[[1]]
          solution_theme_names <- themes_df$project_layer$name
        }
        
        # Update all themes - set goals for those in solution, turn off others
        for (theme in app_data$themes) {
          for (feature in theme$feature) {
            # Check if this feature is in the solution
            if (feature$name %in% solution_theme_names) {
              # Find the goal for this feature
              theme_row <- which(themes_df$project_layer$name == feature$name)
              if (length(theme_row) > 0) {
                theme_goal <- themes_df$goal[theme_row[1]]
                cat("*** Updating theme goal for:", feature$name, "to", theme_goal * 100, "% ***\n")
                feature$set_goal(theme_goal)
                feature$set_status(TRUE)  # Enable the feature
              }
            } else {
              # Feature not in solution - turn it off
              cat("*** Disabling theme:", feature$name, "***\n")
              feature$set_goal(0)  # Set goal to 0
              feature$set_status(FALSE)  # Disable the feature
            }
          }
        }
        
        # Update weights status in the SolutionSettings object
        if (!is.null(solution_data$weights[[1]]) && is.data.frame(solution_data$weights[[1]]) && nrow(solution_data$weights[[1]]) > 0) {
          weights_df <- solution_data$weights[[1]]
          if ("name" %in% colnames(weights_df)) {
            weight_names <- weights_df$name
            cat("*** Weight names from database:", paste(weight_names, collapse = ", "), "***\n")
            for (i in seq_along(app_data$weights)) {
              weight_status <- app_data$weights[[i]]$name %in% weight_names
              if (weight_status) {
                cat("*** Enabling weight:", app_data$weights[[i]]$name, "***\n")
              }
              # Update the underlying SolutionSettings object
              app_data$ss$weights[[i]]$set_setting("status", weight_status)
            }
          } else {
            cat("*** Weights data frame missing 'name' column ***\n")
          }
        } else {
          cat("*** No weights found in solution data ***\n")
        }
        
        # Update includes status in the SolutionSettings object
        if (!is.null(solution_data$includes[[1]]) && is.data.frame(solution_data$includes[[1]]) && nrow(solution_data$includes[[1]]) > 0) {
          includes_df <- solution_data$includes[[1]]
          if ("name" %in% colnames(includes_df)) {
            include_names <- includes_df$name
            cat("*** Include names from database:", paste(include_names, collapse = ", "), "***\n")
            for (i in seq_along(app_data$includes)) {
              include_status <- app_data$includes[[i]]$name %in% include_names
              if (include_status) {
                cat("*** Enabling include:", app_data$includes[[i]]$name, "***\n")
              }
              # Update the underlying SolutionSettings object
              app_data$ss$includes[[i]]$set_setting("status", include_status)
            }
          } else {
            cat("*** Includes data frame missing 'name' column ***\n")
          }
        } else {
          cat("*** No includes found in solution data ***\n")
        }
        
        # Update excludes status in the SolutionSettings object
        if (!is.null(solution_data$excludes[[1]]) && is.data.frame(solution_data$excludes[[1]]) && nrow(solution_data$excludes[[1]]) > 0) {
          excludes_df <- solution_data$excludes[[1]]
          if ("name" %in% colnames(excludes_df)) {
            exclude_names <- excludes_df$name
            cat("*** Exclude names from database:", paste(exclude_names, collapse = ", "), "***\n")
            for (i in seq_along(app_data$excludes)) {
              exclude_status <- app_data$excludes[[i]]$name %in% exclude_names
              if (exclude_status) {
                cat("*** Enabling exclude:", app_data$excludes[[i]]$name, "***\n")
              }
              # Update the underlying SolutionSettings object
              app_data$ss$excludes[[i]]$set_setting("status", exclude_status)
            }
          } else {
            cat("*** Excludes data frame missing 'name' column ***\n")
          }
        } else {
          cat("*** No excludes found in solution data ***\n")
        }
        
        cat("*** Updated SolutionSettings object, now updating UI ***\n")
        
        # Now update the UI to reflect the changes (similar to original server_load_solution.R)
        # Update theme/feature goals
        tryCatch({
          cat("*** Updating theme UI settings ***\n")
          vapply(app_data$themes, FUN.VALUE = logical(1), function(x) {
            tryCatch({
              feature_goals <- x$get_feature_goal()
              cat("*** Theme", x$id, "has", length(feature_goals), "feature goals ***\n")
              
              if (length(feature_goals) == 0) {
                cat("*** Warning: Theme", x$id, "has no feature goals, skipping ***\n")
                return(TRUE)
              }
              
              if ((length(unique(feature_goals)) == 1) & (length(feature_goals) > 1)) {
                #### update group goal
                updateSolutionSettings(
                  session = session,
                  inputId = "newSolutionPane_settings",
                  value = list(
                    id = x$id,
                    setting = "group_goal",
                    value = unique(feature_goals),
                    type = "theme"
                  )
                )
                ### update view to group tab
                updateSolutionSettings(
                  session = session,
                  inputId = "newSolutionPane_settings",
                  value = list(
                    id = x$id,
                    setting = "view",
                    value = "group",
                    type = "theme"
                  )
                )
              } else {
                ### update feature goal
                updateSolutionSettings(
                  session = session,
                  inputId = "newSolutionPane_settings",
                  value = list(
                    id = x$id,
                    setting = "feature_goal",
                    value = feature_goals,
                    type = "theme"
                  )
                )
                ### update view to single tab
                updateSolutionSettings(
                  session = session,
                  inputId = "newSolutionPane_settings",
                  value = list(
                    id = x$id,
                    setting = "view",
                    value = "single",
                    type = "theme"
                  )
                )
              }
              #### return success
              TRUE
            }, error = function(e) {
              cat("*** Error updating theme", x$id, ":", e$message, "***\n")
              return(TRUE)  # Continue with other themes
            })
          })
        }, error = function(e) {
          cat("*** Error in theme UI updates:", e$message, "***\n")
        })
        
        ### update weights status and factors
        lapply(seq_along(app_data$weights), function(i) {
          # Update status
          updateSolutionSettings(
            session = session,
            inputId = "newSolutionPane_settings",
            value = list(
              id = app_data$ss$weights[[i]]$id,
              setting = "status",
              value = app_data$ss$weights[[i]]$status,
              type = "weight"
            )
          )
          
          # Update factor (set to -100.0 for enabled weights, matching example solutions)
          if (app_data$ss$weights[[i]]$status) {
            # Set default factor of -100.0 for enabled weights (matches example YAML files)
            app_data$ss$weights[[i]]$set_setting("factor", -100.0)
            updateSolutionSettings(
              session = session,
              inputId = "newSolutionPane_settings",
              value = list(
                id = app_data$ss$weights[[i]]$id,
                setting = "factor",
                value = -100.0,
                type = "weight"
              )
            )
          }
        })
        
        ### update includes status
        lapply(seq_along(app_data$includes), function(i) {
          updateSolutionSettings(
            session = session,
            inputId = "newSolutionPane_settings",
            value = list(
              id = app_data$ss$includes[[i]]$id,
              setting = "status",
              value = app_data$ss$includes[[i]]$status,
              type = "include"
            )
          )
        })
        
        ### update excludes status
        lapply(seq_along(app_data$excludes), function(i) {
          updateSolutionSettings(
            session = session,
            inputId = "newSolutionPane_settings",
            value = list(
              id = app_data$ss$excludes[[i]]$id,
              setting = "status",
              value = app_data$ss$excludes[[i]]$status,
              type = "exclude"
            )
          )
        })
        
        cat("*** Solution parameters applied successfully ***\n")
        
      }, error = function(e) {
        cat("*** Error applying solution parameters:", e$message, "***\n")
        cat("*** Continuing with solution loading... ***\n")
      })
      
      # Load the TIF file directly
      solution_path <- input$load_solution_list
      # Convert relative path to absolute path based on environment
      if (!startsWith(solution_path, "/")) {
        if (file.exists("/.dockerenv") || Sys.getenv("DOCKER_CONTAINER") == "true") {
          # Running in Docker container
          solution_path <- file.path("/app", solution_path)
        } else {
          # Running locally - use current working directory
          solution_path <- file.path(getwd(), solution_path)
        }
      }
      solution_raster <- terra::rast(solution_path)
      
      # Get solution color and name
      curr_color <- input$load_solution_color
      curr_name <- gsub("-", " ", tools::file_path_sans_ext(basename(input$load_solution_list)))
      
      # Extract solution values from raster
      # Since we now convert NA values to 0s during upload, this should be straightforward
      solution_values <- as.vector(solution_raster)
      
      cat("*** Extracted solution values from raster ***\n")
      
      # Check if solution values match dataset dimensions
      expected_length <- nrow(app_data$dataset$attribute_data)
      actual_length <- length(solution_values)
      
      cat("*** Expected length:", expected_length, ", Actual length:", actual_length, "***\n")
      
      if (actual_length != expected_length) {
        stop("Solution dimensions don't match dataset. This should have been fixed during upload. Expected: ", expected_length, ", Got: ", actual_length)
      }
      
      # Generate index for storing data in dataset
      idx <- dplyr::last(make.names(c(app_data$dataset$get_names(), curr_name), unique = TRUE))
      idx <- gsub(".", "_", idx, fixed = TRUE)
      
      # Add solution data to dataset
      app_data$dataset$add_index(index = idx, values = solution_values)
      
      # Create variable for the solution
      v <- new_variable(
        dataset = app_data$dataset,
        index = idx,
        total = sum(solution_values),
        units = "",
        legend = new_manual_legend(
          values = c(0, 1),
          colors = c("#00FFFF00", scales::alpha(curr_color, 0.8)),
          labels = c("not selected", "selected")
        )
      )
      
        # Create basic statistics for the solution
        total_selected <- sum(solution_values > 0.5, na.rm = TRUE)
        total_units <- length(solution_values)
        area_data <- app_data$dataset$get_planning_unit_areas()
        total_area <- sum(area_data[solution_values > 0.5], na.rm = TRUE)
        total_area_all <- sum(area_data, na.rm = TRUE)
        
        statistics_list <- list(
          new_statistic(
            name = "Total number of planning units",
            value = total_selected,
            units = "",
            proportion = total_selected / total_units
          ),
          new_statistic(
            name = "Total area",
            value = total_area * 1e-6,  # Convert to km²
            units = stringi::stri_unescape_unicode("km\\u00B2"),
            proportion = total_area / total_area_all
          )
        )
        
        # Create theme results based on database solution data
        theme_results_list <- list()
        if (nrow(solution_data$themes[[1]]) > 0) {
          themes_df <- solution_data$themes[[1]]
          for (i in seq_len(nrow(themes_df))) {
            # Find matching theme in app_data
            theme_name <- themes_df$project_layer$name[i]
            matching_theme <- NULL
            for (theme in app_data$themes) {
              if (any(sapply(theme$feature, function(f) f$name == theme_name))) {
                matching_theme <- theme
                break
              }
            }
            
            if (!is.null(matching_theme)) {
              # Create feature results for ALL features in the theme (not just matching ones)
              feature_results_list <- list()
              for (feature in matching_theme$feature) {
                # Calculate how much of this feature is held by the solution
                feature_data <- feature$variable$values
                feature_held <- sum(feature_data[solution_values > 0.5], na.rm = TRUE)
                feature_total <- feature$variable$total
                held_proportion <- if (feature_total > 0) feature_held / feature_total else 0
                
                feature_results_list <- append(feature_results_list, list(
                  new_feature_results(
                    feature = feature,
                    held = held_proportion
                  )
                ))
              }
              
              # Create theme results (only if we haven't already added this theme)
              theme_already_added <- any(sapply(theme_results_list, function(tr) tr$theme$id == matching_theme$id))
              if (!theme_already_added && length(feature_results_list) > 0) {
                theme_results_list <- append(theme_results_list, list(
                  new_theme_results(
                    theme = matching_theme,
                    feature_results = feature_results_list
                  )
                ))
              }
            }
          }
        }
        
        # Create weight results based on database solution data
        weight_results_list <- list()
        if (!is.null(solution_data$weights[[1]]) && is.data.frame(solution_data$weights[[1]]) && nrow(solution_data$weights[[1]]) > 0) {
          weights_df <- solution_data$weights[[1]]
          if ("name" %in% colnames(weights_df)) {
            weight_names <- weights_df$name
            for (weight in app_data$weights) {
              if (weight$name %in% weight_names) {
                # Calculate how much of this weight is held by the solution
                weight_data <- weight$variable$values
                weight_held <- sum(weight_data[solution_values > 0.5], na.rm = TRUE)
                weight_total <- weight$variable$total
                held_proportion <- if (weight_total > 0) weight_held / weight_total else 0
                
                weight_results_list <- append(weight_results_list, list(
                  new_weight_results(
                    weight = weight,
                    held = held_proportion
                  )
                ))
              }
            }
          }
        }
        
        # Create include results based on database solution data
        include_results_list <- list()
        if (!is.null(solution_data$includes[[1]]) && is.data.frame(solution_data$includes[[1]]) && nrow(solution_data$includes[[1]]) > 0) {
          includes_df <- solution_data$includes[[1]]
          if ("name" %in% colnames(includes_df)) {
            include_names <- includes_df$name
            for (include in app_data$includes) {
              if (include$name %in% include_names) {
                # Calculate how much of this include is held by the solution
                include_data <- include$variable$values
                include_held <- sum(include_data[solution_values > 0.5], na.rm = TRUE)
                include_total <- include$variable$total
                held_proportion <- if (include_total > 0) include_held / include_total else 0
                
                include_results_list <- append(include_results_list, list(
                  new_include_results(
                    include = include,
                    held = held_proportion
                  )
                ))
              }
            }
          }
        }
        
        # Create exclude results based on database solution data
        exclude_results_list <- list()
        if (!is.null(solution_data$excludes[[1]]) && is.data.frame(solution_data$excludes[[1]]) && nrow(solution_data$excludes[[1]]) > 0) {
          excludes_df <- solution_data$excludes[[1]]
          if ("name" %in% colnames(excludes_df)) {
            exclude_names <- excludes_df$name
            for (exclude in app_data$excludes) {
              if (exclude$name %in% exclude_names) {
                # Calculate how much of this exclude is held by the solution
                exclude_data <- exclude$variable$values
                exclude_held <- sum(exclude_data[solution_values > 0.5], na.rm = TRUE)
                exclude_total <- exclude$variable$total
                held_proportion <- if (exclude_total > 0) exclude_held / exclude_total else 0
                
                exclude_results_list <- append(exclude_results_list, list(
                  new_exclude_results(
                    exclude = exclude,
                    held = held_proportion
                  )
                ))
              }
            }
          }
        }
        
        # Create solution object directly (bypassing Result class)
        s <- new_solution(
          name = curr_name,
          pane = paste(uuid::UUIDgenerate(), v$index, sep = "-"),
          variable = v,
          visible = if (app_data$ss$get_parameter("solution_layer_parameter")$status) FALSE else TRUE,
          invisible = NA_real_,
          loaded = TRUE,
          parameters = lapply(app_data$ss$parameters, function(x) x$clone()),  # Current parameters after loading
          statistics = statistics_list,
          theme_results = theme_results_list,
          weight_results = weight_results_list,
          include_results = include_results_list,
          exclude_results = exclude_results_list,
          id = uuid::UUIDgenerate(),
          hidden = app_data$ss$get_parameter("solution_layer_parameter")$status,
          downloadable = TRUE
        )
      
      cat("*** Database solution created successfully ***\n")
      
      tryCatch({
        ## make leaflet proxy
        map <- leaflet::leafletProxy("map")

        ## store solution
        cat("*** Adding solution to app_data$solutions ***\n")
        app_data$solutions <- append(app_data$solutions, list(s))

        ## store solution id and names
        cat("*** Adding solution to app_data$solution_ids ***\n")
        app_data$solution_ids <-
          c(app_data$solution_ids, stats::setNames(s$id, s$name))

        ## add new solution to the map
        cat("*** Adding solution to map ***\n")
        app_data$mm$add_layer(s, map)

        ## add new solution to map manager widget
        cat("*** Adding to map manager ***\n")
        addMapManagerLayer(
          session = session,
          inputId = "mapManagerPane_settings",
          value = s
        )

        ## add new solution to solution results widget
        cat("*** Adding to solution results ***\n")
        addSolutionResults(
          session = session,
          inputId = "solutionResultsPane_results",
          value = s
        )

        ## add new solution to export sidebar
        cat("*** Adding to export sidebar ***\n")
        shiny::updateSelectizeInput(
          session = session,
          inputId = "exportPane_fields",
          choices = stats::setNames(
            app_data$mm$get_layer_indices(download_only = TRUE),
            app_data$mm$get_layer_names(download_only = TRUE)
          ),
          selected = app_data$mm$get_layer_indices(download_only = TRUE)
        )

        ## add new solution to solution results modal
        shinyWidgets::updatePickerInput(
          session = session,
          inputId = "solutionResultsPane_results_modal_select",
          choices = app_data$solution_ids,
          selected = dplyr::last(app_data$solution_ids)
        )

        ## show the new solution in the results widget
        shinyWidgets::updatePickerInput(
          session = session,
          inputId = "solutionResultsPane_results_select",
          choices = app_data$solution_ids,
          selected = dplyr::last(app_data$solution_ids)
        )
        showSolutionResults(
          session = session,
          inputId = "solutionResultsPane_results",
          value = dplyr::last(app_data$solution_ids)
        )
        
        ## show solution results sidebar (this opens the evaluation pane!)
        map <- leaflet::leafletProxy("map")
        leaflet.extras2::openSidebar(
          map,
          id = "solutionResultsPane", sidebar_id = "analysisSidebar"
        )
        
        ## enable solution results modal button after generating first solution
        if (length(app_data$solutions) == 1) {
          enable_html_css_selector("#analysisSidebar li:nth-child(2)")
        }
        
        ## remove map spinner
        shinyjs::runjs(
          "document.querySelector('.map-spinner').remove();"
        )
        
        ### reset buttons
        shinyFeedback::resetLoadingButton("load_solution_button")
        enable_html_element("load_solution_list")
        enable_html_element("load_solution_color")
        # select the default item "" in the pickerInput load_solution_list
        shinyWidgets::updatePickerInput(
          session = session,
          inputId = "load_solution_list",
          selected = ""
        )
        disable_html_element("load_solution_button")
        
        cat("*** All solution integration completed successfully ***\n")
        
      }, error = function(e) {
        cat("*** Error in solution integration:", e$message, "***\n")
        cat("*** Error occurred at:", deparse(e$call), "***\n")
      })
      
    }, error = function(e) {
      cat("*** Error loading database solution:", e$message, "***\n")
      
      # Show error notification
      shiny::showNotification(
        paste("Failed to load solution:", e$message),
        type = "error",
        duration = 5
      )
      
      ## remove map spinner on error
      shinyjs::runjs(
        "document.querySelector('.map-spinner').remove();"
      )

      ## reset buttons on error
      shinyFeedback::resetLoadingButton("load_solution_button")
      enable_html_element("load_solution_list")
      enable_html_element("load_solution_color")
      enable_html_element("load_solution_button")
    })

    ## remove map spinner
    shinyjs::runjs(
      "document.querySelector('.map-spinner').remove();"
    )

    ### reset buttons
    shinyFeedback::resetLoadingButton("load_solution_button")
    enable_html_element("load_solution_list")
    enable_html_element("load_solution_color")
    # select the default item "" in the pickerInput load_solution_list
    shinyWidgets::updatePickerInput(
      session = session,
      inputId = "load_solution_list",
      selected = ""
    )
    disable_html_element("load_solution_button")
    
  })

})