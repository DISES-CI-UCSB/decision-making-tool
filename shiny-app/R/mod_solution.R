#' Solution Module
#'
#' UI and server logic for solution management
#'
#' @export
solutionUI <- function(id) {
  ns <- NS(id)
  tagList(
    h3("Soluciones"),
    shiny::selectInput(ns("project_select"), "Seleccionar Proyecto", choices = NULL),
    shiny::uiOutput(ns("add_solutions_ui")),
    DT::DTOutput(ns("solutions_table"))
  )
}

#' @export
solutionServer <- function(id, client, auth_token, user_info, projects_data, refresh_trigger = NULL) {
  shiny::moduleServer(id, function(input, output, session) {
    ns <- session$ns

    solutions_data <- reactiveVal(data.frame())

    # GraphQL query/mutation
    solutions_query <- '
      query($projectId: ID!) {
        solutions(projectId: $projectId) {
          id
          title
          description
          author_email
          author_name
          user_group
        }
      }'
    
    project_layers_query <- '
    query($projectId: ID!) {
      projectLayers(projectId: $projectId) {
      id,
      name  
      }
    }'

    add_file_mutation <- '
    mutation($uploaderId: ID!, $projectId: ID!, $path: String!, $name: String!, $description: String!) {
      addFile(uploaderId: $uploaderId, projectId: $projectId, path: $path, name: $name, description: $description) {
        id
      }
    }
    '

    add_solution_mutation <- '
      mutation($input: SolutionInput!) {
        addSolution(input: $input) {
          id
          title
        }
      }'

    # Reactive to hold CSV + file info
    added_solutions <- reactiveVal(NULL)
    tmp_dir <- reactiveVal(NULL)
    base_folder <- reactiveVal(NULL) # base folder for zipped solution file upload

    project_folder_name <- reactiveVal(NULL)
    project_layers_data <- reactiveVal(NULL) # queried project layers dataframe 

    # Update projects dropdown
    shiny::observeEvent(projects_data(), {
      proj_df <- projects_data()
      if (nrow(proj_df) > 0) {
        choices <- setNames(proj_df$id, proj_df$title)
        updateSelectInput(session, "project_select", choices = choices)
      }
    }, ignoreNULL = FALSE)

    # Create dedicated fetch function
    fetch_solutions <- function() {
      req(input$project_select)
      qry <- Query$new()
      qry$query("solutions", solutions_query)

      tryCatch({
        res <- client$exec(
          qry$queries$solutions,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = list(projectId = as.character(input$project_select))
        )
        res_list <- jsonlite::fromJSON(res)
        solutions_data(as.data.frame(res_list$data$solutions))
        cat("*** SOLUTIONS REFRESHED: Found", nrow(res_list$data$solutions), "solutions ***\n")
      }, error = function(e) {
        showNotification(paste("Failed to fetch solutions:", e$message), type = "error")
      })
    }

    # Fetch solutions when project changes
    shiny::observeEvent(input$project_select, {
      req(input$project_select)
      
      # Fetch solutions
      fetch_solutions()
      
      # get folder name with project ID (to match project module structure)
      proj_df <- projects_data()
      project_title <- proj_df$title[proj_df$id == input$project_select]
      folder_name <- gsub(" ", "_", project_title)
      folder_name_with_id <- paste0(folder_name, input$project_select)
      # Update reactiveVal
      project_folder_name(folder_name_with_id)
    })

    # Also refresh when refresh trigger changes
    if (!is.null(refresh_trigger)) {
      shiny::observeEvent(refresh_trigger(), { 
        if (!is.null(input$project_select)) {
          # Directly call fetch function
          fetch_solutions()
        }
      }, ignoreInit = TRUE)
    }

    output$solutions_table <- DT::renderDT({
      df <- solutions_data()
      if (nrow(df) == 0) {
        return(DT::datatable(data.frame(Mensaje = "No se encontraron soluciones"), options = list(dom = 't')))
      }
      DT::datatable(df[, c("id", "title", "description", "author_name", "author_email", "user_group")],
        rownames = FALSE,
        colnames = c("ID", "Title", "Description", "Author", "Author Email", "Visibility")
      )
    })

    output$add_solutions_ui <- renderUI({
      req(user_info())
      req(input$project_select)
      actionButton(ns("show_add_solution"), "Agregar Nueva Solución")
    })

    shiny::observeEvent(input$show_add_solution, {
      cat("*** SHOWING SOLUTION MODAL ***\n")
      added_solutions(NULL)
      tmp_dir(NULL)
      
      # Clear the CSV preview table when opening modal
      output$csv_preview <- DT::renderDT({
        DT::datatable(data.frame(Mensaje = "Sube un archivo ZIP para previsualizar las soluciones"), 
                     options = list(dom = 't'))
      })
      
      shiny::showModal(shiny::modalDialog(
        title = "Agregar Nuevas Soluciones al Proyecto",
        htmltools::tags$div(style = "height: 1px;"), # Invisible spacer
        htmltools::tags$h4("Sube un archivo ZIP que contenga solutions.csv y archivos de soluciones"),
        shiny::fileInput(ns("solution_zip"), "Seleccionar archivo ZIP", accept = ".zip"),
        DT::DTOutput(ns("csv_preview")),

        # Progress indicator (initially hidden)
        htmltools::div(
          id = ns("upload_progress"),
          style = "display: none; margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px;",
          htmltools::div(
            style = "display: flex; align-items: center; gap: 10px;",
            htmltools::tags$i(class = "fa fa-spinner fa-spin", style = "color: #007bff;"),
            htmltools::tags$span("Subiendo soluciones...", style = "font-weight: bold;")
          ),
          htmltools::div(
            id = ns("progress_details"),
            style = "margin-top: 10px; font-size: 14px; color: #6c757d;"
          )
        ),

        footer = htmltools::tagList(
          shiny::modalButton("Cancelar"),
          shiny::actionButton(ns("add_solutions"), "Agregar Soluciones", class = "btn-primary")
        ),
        size = "l",
        easyClose = TRUE
      ))
    })

    # Handle ZIP upload
    shiny::observeEvent(input$solution_zip, {
      req(input$solution_zip)

      # Temp folder
      td <- tempfile()
      dir.create(td)
      tmp_dir(td)

      # Unzip
      unzip(input$solution_zip$datapath, exdir = td)

      # Read solutions.csv inside ZIP
       # Try to find solutions.csv
      csv_path <- file.path(td, "solutions.csv")
      if (!file.exists(csv_path)) {
      # Check if there is a single parent folder
        files_in_td <- list.files(td, full.names = TRUE)
        dir_in_td <- files_in_td[dir.exists(files_in_td)]
        if (length(dir_in_td) == 1) {
          csv_path <- file.path(dir_in_td, "solutions.csv")
        }
      }
      req(file.exists(csv_path))  # Fail if not found anywhere

      # Set base folder as the folder containing solutions.csv
      base_folder(dirname(csv_path))

      tryCatch({
        df <- read.csv(csv_path, stringsAsFactors = FALSE)
        cat("*** CSV loaded with", nrow(df), "rows ***\n")
      }, error = function(e) {
        cat("*** ERROR reading CSV:", e$message, "***\n")
        shiny::showNotification(paste("Error reading solutions.csv:", e$message), type = "error")
        return()
      })

      # Add column to check file existence
      df$file_exists <- file.exists(file.path(base_folder(), df$file_path))

      # Keep only SolutionLayers schema columns + File
      pl_columns <- c("scenario", "description", "author_name", "author_email", 
        "user_group", "file_path", "file_exists",
        "themes","targets","weights","includes","excludes")
      df_subset <- df[, intersect(pl_columns, colnames(df)), drop = FALSE]

      added_solutions(df_subset)

      # Render preview DT
      output$csv_preview <- DT::renderDT({
        DT::datatable(df_subset, options = list(pageLength = 5, scrollX = TRUE))
      })
    })

    # Upload solution ZIP
    shiny::observeEvent(input$add_solutions, {
      req(input$solution_zip, input$project_select, user_info())
      
      # Show progress indicator and disable submit button
      shinyjs::show("upload_progress")
      shinyjs::disable("add_solutions")
      shinyjs::html("progress_details", "Validando archivos de soluciones...")
      
      df <- added_solutions()
      td <- tmp_dir()
      if(is.null(df) || nrow(df) == 0) {
        showNotification("No solutions to upload.", type = "error")
        # Reset UI state
        shinyjs::hide("upload_progress")
        shinyjs::enable("add_solutions")
        return()
      }

      # Check all files exist
      missing_files <- df$file_path[!df$file_exists]
      if(length(missing_files) > 0) {
        showNotification(paste("Missing solution files in ZIP:", paste(missing_files, collapse = ", ")), type = "error")
        # Reset UI state
        shinyjs::hide("upload_progress")
        shinyjs::enable("add_solutions")
        return()
      }

      # Check that all themes, weights, includes, and excludes exist in ProjectLayers
      shinyjs::html("progress_details", "Verificando capas del proyecto...")
      
      cat("*** FETCHING PROJECT LAYERS FOR VALIDATION ***\n")
      cat("*** Project ID:", input$project_select, "***\n")
      
      layer_qry <- Query$new()
      layer_qry$query("projectLayers", project_layers_query)
      
      fetch_result <- tryCatch({
        res <- client$exec(
          layer_qry$queries$projectLayers,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = list(projectId = as.character(input$project_select))
        )
        
        cat("*** ProjectLayers response received ***\n")
        cat("*** Response:", substr(res, 1, 500), "...\n")
        
        res_list <- fromJSON(res)
        
        # Check for errors in response
        if (!is.null(res_list$errors)) {
          cat("*** ERROR in projectLayers query:", res_list$errors[[1]]$message, "***\n")
          stop(paste("GraphQL error:", res_list$errors[[1]]$message))
        }
        
        layers_data <- res_list$data$projectLayers
        
        if (is.null(layers_data) || nrow(layers_data) == 0) {
          cat("*** ERROR: No project layers found for project", input$project_select, "***\n")
          stop("No project layers found. Please ensure the project has layers uploaded.")
        }
        
        cat("*** Found", nrow(layers_data), "project layers ***\n")
        cat("*** Layer names:", paste(layers_data$name, collapse=", "), "***\n")
        
        project_layers_data(as.data.frame(layers_data))
        TRUE
        
      }, error = function(e) {
        cat("*** ERROR FETCHING PROJECT LAYERS ***\n")
        cat("*** Error message:", e$message, "***\n")
        cat("*** Error class:", class(e), "***\n")
        
        showNotification(
          paste("Failed to fetch project layers:", e$message), 
          type = "error",
          duration = 10
        )
        
        # Reset UI state
        shinyjs::hide("upload_progress")
        shinyjs::enable("add_solutions")
        
        FALSE
      })
      
      # If fetch failed, stop here
      if (!fetch_result) {
        return()
      }

      layers_df <- project_layers_data()
      req(layers_df)  # ensure it's not NULL
      
      cat("*** VALIDATING LAYER REFERENCES IN SOLUTIONS ***\n")
      cat("*** Available layer names in project:", paste(layers_df$name, collapse=", "), "***\n")
      cat("*** Number of solutions to validate:", nrow(df), "***\n")

      # --- Helper to check validity ---
      parse_and_check <- function(col_values, valid_names) {
        if (is.null(col_values) || all(is.na(col_values))) return(character(0))
        col_values <- as.character(col_values)
        all_names <- unlist(strsplit(col_values, ","))
        all_names <- trimws(all_names)
        all_names <- all_names[nzchar(all_names)] # drop empties
        bad_names <- setdiff(all_names, valid_names)
        return(bad_names)
      }

      # --- Loop over rows in CSV ---
      invalid_refs <- list()
      for (i in seq_len(nrow(df))) {
        row <- df[i, ]
        
        cat("*** Validating solution:", row$scenario, "***\n")
        cat("***   themes:", row$themes, "***\n")
        cat("***   weights:", row$weights, "***\n")
        cat("***   includes:", row$includes, "***\n")
        cat("***   excludes:", row$excludes, "***\n")

        # check each type
        bad_themes   <- parse_and_check(row$themes,   layers_df$name)
        bad_weights  <- parse_and_check(row$weights,  layers_df$name)
        bad_includes <- parse_and_check(row$includes, layers_df$name)
        bad_excludes <- parse_and_check(row$excludes, layers_df$name)
        
        if (length(bad_themes) > 0) cat("***   BAD themes:", paste(bad_themes, collapse=", "), "***\n")
        if (length(bad_weights) > 0) cat("***   BAD weights:", paste(bad_weights, collapse=", "), "***\n")
        if (length(bad_includes) > 0) cat("***   BAD includes:", paste(bad_includes, collapse=", "), "***\n")
        if (length(bad_excludes) > 0) cat("***   BAD excludes:", paste(bad_excludes, collapse=", "), "***\n")

        if (length(c(bad_themes, bad_weights, bad_includes, bad_excludes)) > 0) {
          invalid_refs[[row$scenario]] <- list(
            themes = bad_themes,
            weights = bad_weights,
            includes = bad_includes,
            excludes = bad_excludes
          )
        }
      }

      # If anything invalid, stop + notify
      if (length(invalid_refs) > 0) {
        cat("*** VALIDATION FAILED - Invalid layer references found ***\n")
        
        msg <- lapply(names(invalid_refs), function(scn) {
          bads <- invalid_refs[[scn]]
          paste0("Scenario '", scn, "' references non-existent layers:\n",
                paste(
                  unlist(mapply(function(type, vals) {
                    if (length(vals) > 0) paste0("  ", type, ": [", paste(vals, collapse = ", "), "]")
                  },
                  names(bads), bads, SIMPLIFY = FALSE)),
                  collapse = "\n"
                ))
        })
        
        full_msg <- paste(
          "Layer validation failed!\n\n",
          paste(msg, collapse = "\n\n"),
          "\n\nAvailable layers:", paste(layers_df$name, collapse=", ")
        )
        
        showNotification(full_msg, type = "error", duration = NULL)
        
        # Reset UI state
        shinyjs::hide("upload_progress")
        shinyjs::enable("add_solutions")
        
        return()
      }

      # ✅ if here, all layers referenced are valid
      cat("*** VALIDATION PASSED - All layer references are valid ***\n")
      showNotification("All layer references valid!", type = "message")

      # Add solutions to database
      tryCatch({
      
        # add each solution referenced in csv
        shinyjs::html("progress_details", paste("Procesando soluciones (0 de", nrow(df), ")..."))
        for (i in seq_len(nrow(df))) {
          row <- df[i, ]
          shinyjs::html("progress_details", paste("Procesando solución", i, "de", nrow(df), ":", row$scenario))

          # Copy solution file to uploads folder
          cat("*** SOLUTION UPLOAD DEBUG ***\n")
          cat("*** Selected project ID:", input$project_select, "***\n")
          cat("*** Project folder name:", project_folder_name(), "***\n")
          
          if (file.exists("/.dockerenv") || Sys.getenv("DOCKER_CONTAINER") == "true") {
            # Running in Docker container
            upload_dir <- file.path("/app/uploads", project_folder_name(), "solutions")
          } else {
            # Running locally
            upload_dir <- file.path("uploads", project_folder_name(), "solutions")
          }
          cat("*** Upload directory:", upload_dir, "***\n")
          
          if(!dir.exists(upload_dir)) dir.create(upload_dir, recursive = TRUE)
          target_path <- file.path(upload_dir, basename(row$file_path))
          cat("*** Target path:", target_path, "***\n")
          
          # Validate solution grid matches planning unit grid
          tryCatch({
            # Get planning unit file path for this project
            planning_unit_query <- '
              query($projectId: ID!) {
                project(id: $projectId) {
                  planning_unit {
                    path
                  }
                }
              }'
            
            qry_pu <- Query$new()
            qry_pu$query("project", planning_unit_query)
            res_pu <- client$exec(
              qry_pu$queries$project,
              headers = list(Authorization = paste("Bearer", auth_token())),
              variables = list(projectId = as.character(input$project_select))
            )
            
            pu_path <- fromJSON(res_pu)$data$project$planning_unit$path
            
            if (!is.null(pu_path) && file.exists(pu_path)) {
              # Load planning unit raster
              pu_raster <- terra::rast(pu_path)
              
              # Load solution raster
              solution_raster <- terra::rast(file.path(base_folder(), row$file_path))
              
              # Check if grids match
              if (!terra::compareGeom(pu_raster, solution_raster, stopOnError = FALSE)) {
                cat("*** Solution grid mismatch for:", row$scenario, "***\n")
                cat("*** Attempting to align solution to planning unit grid ***\n")
                
                # Attempt to align solution to planning unit grid
                solution_raster <- terra::project(
                  x = solution_raster, 
                  y = pu_raster, 
                  method = "ngb"  # nearest neighbor for binary solutions
                )
                
                # Convert NA values to 0s
                solution_raster[is.na(solution_raster)] <- 0
                
                # Save the aligned raster temporarily
                temp_solution_path <- tempfile(fileext = ".tif")
                terra::writeRaster(solution_raster, temp_solution_path, overwrite = TRUE)
                
                # Copy the aligned version
                file.copy(temp_solution_path, target_path, overwrite = TRUE)
                unlink(temp_solution_path)
                
                cat("*** Solution aligned and saved ***\n")
              } else {
                # Grids match, but still convert NA values to 0s
                solution_raster[is.na(solution_raster)] <- 0
                
                # Save the cleaned raster
                temp_solution_path <- tempfile(fileext = ".tif")
                terra::writeRaster(solution_raster, temp_solution_path, overwrite = TRUE)
                file.copy(temp_solution_path, target_path, overwrite = TRUE)
                unlink(temp_solution_path)
              }
            } else {
              # No planning unit found, copy as normal but warn
              cat("*** Warning: No planning unit found for grid validation ***\n")
              file.copy(file.path(base_folder(), row$file_path), target_path, overwrite = TRUE)
            }
            
          }, error = function(e) {
            cat("*** Error during grid validation:", e$message, "***\n")
            cat("*** Copying solution without validation ***\n")
            file.copy(file.path(base_folder(), row$file_path), target_path, overwrite = TRUE)
          })


          ### Add solution file via GraphQL
          cat("*** FILE UPLOAD DEBUG ***\n")
          cat("*** File exists at target path:", file.exists(target_path), "***\n")
          cat("*** File size:", if(file.exists(target_path)) file.size(target_path) else "N/A", "bytes ***\n")
          
          qry_file <- Query$new()
          qry_file$query("addFile", add_file_mutation)
          file_payload <- list(
            uploaderId = as.character(user_info()$id),
            projectId = as.character(input$project_select),
            path = if (file.exists("/.dockerenv") || Sys.getenv("DOCKER_CONTAINER") == "true") {
              sub("^/app/", "", target_path) # Store relative path in database (Docker)
            } else {
              sub(paste0("^", normalizePath(getwd(), winslash = "/"), "/"), "", normalizePath(target_path, winslash = "/")) # Store relative path (Local)
            },
            name = as.character(row$scenario),  # Ensure it's a string, not a number
            description = paste("Solution file imported from ZIP:", row$description)
          )
          
          cat("*** FILE GRAPHQL PAYLOAD ***\n")
          cat("*** Project ID:", file_payload$projectId, "***\n")
          cat("*** File path:", file_payload$path, "***\n")
          cat("*** File name:", file_payload$name, "***\n")
          
          res_file <- client$exec(
            qry_file$queries$addFile,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = file_payload
          )
          
          cat("*** FILE GRAPHQL RESPONSE:", res_file, "***\n")
          
          file_res_list <- fromJSON(res_file)
          
          # Check for file upload errors
          if (!is.null(file_res_list$errors)) {
            cat("*** FILE GRAPHQL ERROR:", file_res_list$errors[[1]]$message, "***\n")
            stop(paste("File GraphQL error:", file_res_list$errors[[1]]$message))
          }
          
          new_file_id <- file_res_list$data$addFile$id
          cat("*** FILE UPLOADED SUCCESSFULLY, ID:", new_file_id, "***\n")


          ### Build themes payload (SolutionLayers)
          str_to_array <- function(col_values) {
            # Handle NA, NULL, or empty string
            if (is.na(col_values) || is.null(col_values) || nchar(trimws(col_values)) == 0) {
              return(character(0))
            }
            list <- strsplit(as.character(col_values), ",")
            vec <- trimws(unlist(list))
            # Remove empty strings
            vec <- vec[nchar(vec) > 0]
            return(vec)
          }

          # get themes + targets
          themes_vec <- str_to_array(row$themes)
          targets_vec <- str_to_array(row$targets)
          
          cat("*** THEME MATCHING DEBUG ***\n")
          cat("*** Themes from CSV:", paste(themes_vec, collapse = ", "), "***\n")
          cat("*** Targets from CSV:", paste(targets_vec, collapse = ", "), "***\n")
          
          # Check if we have themes
          if (length(themes_vec) == 0) {
            cat("*** ERROR: No themes provided in solutions.csv ***\n")
            stop("Solution must have at least one theme. Check solutions.csv row ", idx)
          }
          
          if (length(themes_vec) != length(targets_vec)) {
            cat("*** ERROR: Number of themes (", length(themes_vec), ") != number of targets (", length(targets_vec), ") ***\n")
            stop("Themes and targets must have the same length. Check solutions.csv row ", idx)
          }

          # construct list of theme inputs for addSolution
          cat("*** THEME MATCHING DEBUG ***\n")
          cat("*** Processing", length(themes_vec), "themes ***\n")
          
          themes_payload <- lapply(seq_along(themes_vec), function(j) {
            proj_layer_id <- layers_df$id[match(themes_vec[[j]], layers_df$name)]
            cat("*** Theme:", themes_vec[[j]], "-> Layer ID:", proj_layer_id, "***\n")
            
            if (is.na(proj_layer_id)) {
              cat("*** WARNING: Theme", themes_vec[[j]], "not found in project layers! ***\n")
            }
            
            list(
              projectLayerId = proj_layer_id,
              goal = as.numeric(targets_vec[[j]])
            )
          })

          themes_payload <- unname(themes_payload)

          # helper to convert CSV -> ids safely
          get_layer_ids <- function(col_values, layers_df) {
            if (is.na(col_values) || col_values == "") return(NULL)   # empty column
            vec <- str_to_array(col_values)
            ids <- layers_df$id[match(vec, layers_df$name)]
            ids <- ids[!is.na(ids)]  # drop missing matches
            if (length(ids) == 0) return(NULL)
            return(as.list(ids))     # ensure it's a JSON array
          }

          # build ids
          weight_ids  <- get_layer_ids(row$weights, layers_df)
          include_ids <- get_layer_ids(row$includes, layers_df)
          exclude_ids <- get_layer_ids(row$excludes, layers_df)

          weight_ids  <- if (is.null(weight_ids))  list() else weight_ids
          include_ids <- if (is.null(include_ids)) list() else include_ids
          exclude_ids <- if (is.null(exclude_ids)) list() else exclude_ids

          ### Add the solution WITH its themes
          qry_sol <- Query$new()
          qry_sol$query("addSolution", add_solution_mutation)

          sol_payload <- list(
            input = list(
              projectId   = as.character(input$project_select),
              authorId    = as.character(user_info()$id),
              title       = as.character(row$scenario),  # Ensure string conversion
              description = as.character(row$description),
              authorName  = as.character(row$author_name),
              authorEmail = as.character(row$author_email),
              userGroup   = as.character(row$user_group),
              fileId      = as.character(new_file_id),
              weightIds = weight_ids,
              includeIds = include_ids,
              excludeIds = exclude_ids,
              themes = themes_payload
            )
          )
          
          cat("*** SOLUTION GRAPHQL PAYLOAD ***\n")
          cat("*** Project ID in payload:", sol_payload$input$projectId, "***\n")
          cat("*** Solution title:", sol_payload$input$title, "***\n")

          res_sol <- client$exec(
            qry_sol$queries$addSolution,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = sol_payload
          )
          
          cat("*** GRAPHQL RESPONSE:", res_sol, "***\n")
          
          res_list <- fromJSON(res_sol)
          
          # Check for GraphQL errors
          if (!is.null(res_list$errors)) {
            cat("*** GRAPHQL ERROR:", res_list$errors[[1]]$message, "***\n")
            stop(paste("GraphQL error:", res_list$errors[[1]]$message))
          }
          
          if (is.null(res_list$data) || is.null(res_list$data$addSolution)) {
            cat("*** GRAPHQL ERROR: No data returned ***\n")
            stop("GraphQL mutation returned no data")
          }
          
          new_sol_id <- res_list$data$addSolution$id

          cat("Added solution:", res_list$data$addSolution$title, "\n")
        }

        # Success state
        shinyjs::html("progress_details", "¡Soluciones agregadas exitosamente!")
        shinyjs::delay(1500, {
          showNotification(paste("Project created with", nrow(df), "solutions."), type = "message")
          removeModal()
          
          # Clear the CSV preview table
          output$csv_preview <- DT::renderDT({
            DT::datatable(data.frame(Mensaje = "Sube un archivo ZIP para previsualizar las soluciones"), 
                         options = list(dom = 't'))
          })
        })

        # wait to make sure that solutions are fully uploaded
        Sys.sleep(1)  # give the backend time to finish

        # refresh solutions directly
        fetch_solutions()

      }, error = function(e){
        # Reset UI state on error
        shinyjs::hide("upload_progress")
        shinyjs::enable("add_solutions")
        showNotification(paste("Error creating solutions:", e$message), type = "error")
      })
    })

  })
}