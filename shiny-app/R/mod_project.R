#' Project Module
#'
#' UI and server logic for project management
#'
#' @param id Module identifier
#' @param client GraphQL client
#' @param auth_token Authentication token reactive
#' @param user_info User information reactive
#' @param projects_data Projects data reactive
#'
#' @export
projectUI <- function(id) {
  ns <- shiny::NS(id)
  htmltools::tagList(
    htmltools::tags$h3("Proyectos"),
    DT::DTOutput(ns("projects_table")),
    shiny::uiOutput(ns("add_project_ui"))
  )
}

#' @export
projectServer <- function(id, client, auth_token, user_info, projects_data, refresh_trigger = NULL) {
  shiny::moduleServer(id, function(input, output, session) {
    ns <- session$ns

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

    add_project_mutation <- '
    mutation($input: ProjectInput!) {
      addProject(input: $input) {
        id
        title
      }
    }'

    add_file_mutation <- '
    mutation($uploaderId: ID!, $projectId: ID!, $path: String!, $name: String!, $description: String!) {
      addFile(uploaderId: $uploaderId, projectId: $projectId, path: $path, name: $name, description: $description) {
        id
      }
    }
    '

    delete_project_mutation <- '
    mutation($id: ID!) {
      deleteProject(id: $id)
    }
    '

    add_project_layer_mutation <- '
    mutation($input: ProjectLayerInput!) {
      addProjectLayer(input: $input) {
        id
      }
    }
    '

    update_project_mutation <- '
    mutation($id: ID!, $planningUnitId: ID!) {
      updateProject(id: $id, planningUnitId: $planningUnitId) {
        id
        title
        planning_unit {
          id
          name
        }
      }
    }
    '

    # Reactive to hold CSV + file info
    added_files <- shiny::reactiveVal(NULL)
    tmp_dir <- shiny::reactiveVal(NULL)
    base_folder <- shiny::reactiveVal(NULL) # base folder for zipped project file upload

    # Fetch projects
    fetch_projects <- function() {
      cat("*** FETCHING PROJECTS ***\n")
      
      # Choose query based on user type
      if (!is.null(user_info()) && !is.null(user_info()$type) && user_info()$type == "manager") {
        cat("*** Manager user - fetching ALL projects ***\n")
        query_name <- "all_projects"
        query_text <- all_projects_query
        data_field <- "all_projects"
      } else {
        cat("*** Public/Planner user - fetching PUBLIC projects ***\n")
        query_name <- "public_projects"
        query_text <- public_projects_query
        data_field <- "public_projects"
      }
      
      qry <- ghql::Query$new()
      qry$query(query_name, query_text)
      
      tryCatch({
        # Include auth header if available
        headers <- list()
        if (!is.null(auth_token()) && auth_token() != "public_token") {
          headers$Authorization <- paste("Bearer", auth_token())
        }
        
        res <- client$exec(qry$queries[[query_name]], headers = headers)
        cat("*** GraphQL Response:", res, "***\n")
        
        res_list <- jsonlite::fromJSON(res)
        cat("*** Parsed response structure:", str(res_list), "***\n")
        projects <- res_list$data[[data_field]]
        cat("*** Projects data:", str(projects), "***\n")
        
        if (!is.null(projects) && length(projects) > 0) {
          projects_df <- as.data.frame(projects)
          cat("*** Found", nrow(projects_df), "projects ***\n")
          cat("*** Project titles:", paste(projects_df$title, collapse = ", "), "***\n")
          projects_data(projects_df)
        } else {
          cat("*** No projects found ***\n")
          projects_data(data.frame())
        }
      }, error = function(e) {
        cat("*** Error fetching projects:", e$message, "***\n")
        shiny::showNotification(paste("Failed to fetch projects:", e$message), type = "error")
        projects_data(data.frame())
      })
    }

    shiny::observeEvent(auth_token(), { fetch_projects() })
    
    # Also refresh when refresh trigger changes
    if (!is.null(refresh_trigger)) {
      shiny::observeEvent(refresh_trigger(), { 
        fetch_projects() 
      }, ignoreInit = TRUE)
    }

    output$projects_table <- DT::renderDT({
      df <- projects_data()
      if (nrow(df) == 0) {
        return(DT::datatable(data.frame(Mensaje = "No se encontraron proyectos"), options = list(dom = 't')))
      }
      DT::datatable(df[, c("id", "title", "description")], 
                rownames = FALSE,
                colnames = c("ID", "Title", "Description"))
    })

    output$add_project_ui <- shiny::renderUI({
      shiny::req(user_info())
      shiny::actionButton(ns("show_add_project"), "Agregar Nuevo Proyecto")
    })

    # Show modal for new project
    shiny::observeEvent(input$show_add_project, {
      added_files(NULL)
      tmp_dir(NULL)
      
      # Clear the CSV preview table when opening modal
      output$csv_preview <- DT::renderDT({
        DT::datatable(data.frame(Mensaje = "Sube un archivo ZIP para previsualizar las capas"), 
                     options = list(dom = 't'))
      })
      
      # Set default user group to match current user's group
      default_user_group <- if (!is.null(user_info()) && !is.null(user_info()$userGroup)) {
        user_info()$userGroup
      } else {
        "public"
      }
      
      shiny::showModal(shiny::modalDialog(
        title = "Agregar Nuevo Proyecto",
        htmltools::tags$div(style = "height: 1px;"), # Invisible spacer
        shiny::textInput(ns("project_title"), "Título del Proyecto", value="National Test"),
        shiny::textAreaInput(ns("project_description"), "Descripción", value="Test description"),
        shiny::selectInput(
          ns("project_user_group"), 
          "Grupo de Usuario",
          choices = list(
            "Público" = "public",
            "Planificador" = "planner", 
            "Administrador" = "manager"
          ),
          selected = default_user_group
        ),

        htmltools::tags$h4("Archivo de Unidad de Planificación (Requerido)"),
        htmltools::tags$p("Sube el archivo .tif que define las unidades espaciales de planificación para este proyecto."),
        shiny::fileInput(ns("planning_unit_file"), "Seleccionar archivo .tif de Unidad de Planificación", accept = ".tif"),

        htmltools::tags$h4("Capas del Proyecto"),
        htmltools::tags$p("Sube un archivo ZIP que contenga layers.csv y los archivos de capas."),
        shiny::fileInput(ns("project_zip"), "Seleccionar archivo ZIP", accept = ".zip"),
        DT::DTOutput(ns("csv_preview")),

        # Progress indicator (initially hidden)
        htmltools::div(
          id = ns("upload_progress"),
          style = "display: none; margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px;",
          htmltools::div(
            style = "display: flex; align-items: center; gap: 10px;",
            htmltools::tags$i(class = "fa fa-spinner fa-spin", style = "color: #007bff;"),
            htmltools::tags$span("Creando proyecto y subiendo archivos...", style = "font-weight: bold;")
          ),
          htmltools::div(
            id = ns("progress_details"),
            style = "margin-top: 10px; font-size: 14px; color: #6c757d;"
          )
        ),

        footer = htmltools::tagList(
          shiny::modalButton("Cancelar"),
          shiny::actionButton(ns("submit_project"), "Crear Proyecto", class = "btn-primary")
        ),
        size = "l",
        easyClose = TRUE
      ))
    })

    # Handle ZIP upload
    shiny::observeEvent(input$project_zip, {
      shiny::req(input$project_zip)

      # Temp folder
      td <- tempfile()
      dir.create(td)
      tmp_dir(td)

      # Unzip
      unzip(input$project_zip$datapath, exdir = td)

      # Read layers.csv inside ZIP
       # Try to find layers.csv
      csv_path <- file.path(td, "layers.csv")
      if (!file.exists(csv_path)) {
      # Check if there is a single parent folder
        files_in_td <- list.files(td, full.names = TRUE)
        dir_in_td <- files_in_td[dir.exists(files_in_td)]
        if (length(dir_in_td) == 1) {
          csv_path <- file.path(dir_in_td, "layers.csv")
        }
      }
      shiny::req(file.exists(csv_path))  # Fail if not found anywhere

      # Set base folder as the folder containing layers.csv
      base_folder(dirname(csv_path))

      # Read CSV with UTF-8 encoding support (for Spanish accents)
      df <- read.csv(csv_path, stringsAsFactors = FALSE, fileEncoding = "UTF-8")
      
      cat("*** READ layers.csv ***\n")
      cat("*** Number of rows:", nrow(df), "***\n")
      cat("*** Columns:", paste(names(df), collapse=", "), "***\n")
      if (nrow(df) > 0) {
        cat("*** First row Type:", df$Type[1], "Theme:", df$Theme[1], "Name:", df$Name[1], "***\n")
      }

      # Add column to check file existence
      df$file_exists <- file.exists(file.path(base_folder(), df$File))
      cat("*** File existence check:", sum(df$file_exists), "out of", nrow(df), "files found ***\n")

      # Keep only ProjectLayers schema columns + File
      pl_columns <- c("Type", "Theme", "Name", "Legend", "Values", "Color",
                      "Labels", "Unit", "Provenance", "Order", "Visible",
                      "Hidden", "Downloadable", "File", "file_exists")
      df_subset <- df[, intersect(pl_columns, colnames(df)), drop = FALSE]

      added_files(df_subset)

      # Render preview DT
      output$csv_preview <- DT::renderDT({
        DT::datatable(df_subset, options = list(pageLength = 5, scrollX = TRUE))
      })
    })

    # Submit project + layers
    shiny::observeEvent(input$submit_project, {
      shiny::req(input$project_title)
      shiny::req(user_info())
      
      # Check if planning unit file is provided
      if (is.null(input$planning_unit_file)) {
        shiny::showNotification("Planning unit file (.tif) is required to create a project.", type = "error")
        return()
      }
      
      # Show progress indicator and disable submit button
      shinyjs::show("upload_progress")
      shinyjs::disable("submit_project")
      shinyjs::html("progress_details", "Validando archivos...")
      
      df <- added_files()
      td <- tmp_dir()
      if(is.null(df) || nrow(df) == 0) {
        shiny::showNotification("No layers to upload.", type = "error")
        # Reset UI state
        shinyjs::hide("upload_progress")
        shinyjs::enable("submit_project")
        return()
      }

      # Check all files exist
      missing_files <- df$File[!df$file_exists]
      if(length(missing_files) > 0) {
        shiny::showNotification(paste("Missing files in ZIP:", paste(missing_files, collapse = ", ")), type = "error")
        # Reset UI state
        shinyjs::hide("upload_progress")
        shinyjs::enable("submit_project")
        return()
      }

      tryCatch({
        # 1️⃣ First create project without planning unit to get project ID
        shinyjs::html("progress_details", "Creando proyecto en la base de datos...")
        qry_proj <- ghql::Query$new()
        qry_proj$query("addProject", add_project_mutation)
        temp_payload <- list(
          input = list(
            ownerId = as.character(user_info()$id),
            title = input$project_title,
            description = input$project_description,
            userGroup = input$project_user_group
            # No planningUnitId yet
          )
        )
        
        
        res_proj <- client$exec(
          qry_proj$queries$addProject,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = temp_payload
        )
        res_list <- jsonlite::fromJSON(res_proj)
        new_project_id <- res_list$data$addProject$id
        project_folder_name <- gsub(" ", "_", input$project_title)

        # 2️⃣ Now upload planning unit file with correct project ID
        if (file.exists("/.dockerenv") || Sys.getenv("DOCKER_CONTAINER") == "true") {
          # Running in Docker container
          upload_dir <- file.path("/app/uploads", paste0(project_folder_name, new_project_id))
        } else {
          # Running locally
          upload_dir <- file.path("uploads", paste0(project_folder_name, new_project_id))
        }
        if(!dir.exists(upload_dir)) dir.create(upload_dir, recursive = TRUE)
        
        planning_unit_path <- file.path(upload_dir, basename(input$planning_unit_file$name))
        
        # Load planning unit raster
        shinyjs::html("progress_details", "Procesando archivo de unidad de planificación...")
        pu_raster <- terra::rast(input$planning_unit_file$datapath)
        
        cat("*** Original PU - unique values:", paste(head(sort(unique(terra::values(pu_raster, na.rm=TRUE))), 20), collapse=", "), "***\n")
        cat("*** Original PU - NA count:", sum(is.na(terra::values(pu_raster))), "/ ", terra::ncell(pu_raster), "***\n")
        cat("*** Original PU - Non-NA count:", sum(!is.na(terra::values(pu_raster))), "***\n")
        
        # Don't convert anything - just save as-is
        # wheretowork will filter to cells with non-NA PU values
        
        # Save the planning unit raster
        shinyjs::html("progress_details", "Guardando unidad de planificación...")
        terra::writeRaster(pu_raster, planning_unit_path, overwrite = TRUE)
        
        cat("*** Saved PU with", sum(!is.na(terra::values(pu_raster))), "valid cells ***\n")
        
        
        # Add planning unit file to database
        qry_pu_file <- ghql::Query$new()
        qry_pu_file$query("addFile", add_file_mutation)
        pu_file_payload <- list(
          uploaderId = as.character(user_info()$id),
          projectId = as.character(new_project_id),
          path = if (file.exists("/.dockerenv") || Sys.getenv("DOCKER_CONTAINER") == "true") {
            sub("^/app/", "", planning_unit_path) # Store relative path in database (Docker)
          } else {
            sub(paste0("^", normalizePath(getwd(), winslash = "/"), "/"), "", normalizePath(planning_unit_path, winslash = "/")) # Store relative path (Local)
          },
          name = "Planning Units",
          description = "Planning unit spatial file for project"
        )
        res_pu_file <- client$exec(
          qry_pu_file$queries$addFile,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = pu_file_payload
        )
        
        res_pu_list <- jsonlite::fromJSON(res_pu_file)
        if (!is.null(res_pu_list$errors)) {
          stop("Error uploading planning unit file: ", res_pu_list$errors[[1]]$message)
        }
        
        planning_unit_file_id <- res_pu_list$data$addFile$id
        cat("*** Planning unit file ID:", planning_unit_file_id, "***\n")
        
        # 3️⃣ Update project with planning unit file ID
        qry_update <- ghql::Query$new()
        qry_update$query("updateProject", update_project_mutation)
        update_payload <- list(
          id = as.character(new_project_id),
          planningUnitId = as.character(planning_unit_file_id)
        )
        
        res_update <- client$exec(
          qry_update$queries$updateProject,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = update_payload
        )
        
        res_update_list <- jsonlite::fromJSON(res_update)
        if (!is.null(res_update_list$errors)) {
          stop("Error updating project with planning unit: ", res_update_list$errors[[1]]$message)
        }
        
        cat("*** Project updated with planning unit ID:", planning_unit_file_id, "***\n")

        # 4️⃣ Process each layer row
        shinyjs::html("progress_details", paste("Procesando capas del proyecto (0 de", nrow(df), ")..."))
        for(i in seq_len(nrow(df))){
          row <- df[i, ]
          shinyjs::html("progress_details", paste("Procesando capa", i, "de", nrow(df), ":", row$Name))

          # Copy file to uploads folder
          if (file.exists("/.dockerenv") || Sys.getenv("DOCKER_CONTAINER") == "true") {
            # Running in Docker container
            upload_dir <- file.path("/app/uploads", paste0(project_folder_name, new_project_id))
          } else {
            # Running locally
            upload_dir <- file.path("uploads", paste0(project_folder_name, new_project_id))
          }
          if(!dir.exists(upload_dir)) dir.create(upload_dir, recursive = TRUE)
          target_path <- file.path(upload_dir, basename(row$File))
          
          # Validate layer grid matches planning unit grid
          tryCatch({
            # Load planning unit raster (we just uploaded it)
            pu_path <- file.path(upload_dir, basename(input$planning_unit_file$name))
            
            if (file.exists(pu_path)) {
              # Load planning unit raster
              pu_raster <- terra::rast(pu_path)
              
              # Load layer raster
              layer_raster <- terra::rast(file.path(base_folder(), row$File))
              
              # Check if grids match
              if (!terra::compareGeom(pu_raster, layer_raster, stopOnError = FALSE)) {
                cat("*** Layer grid mismatch for:", row$Name, "***\n")
                cat("*** Attempting to align layer to planning unit grid ***\n")
                
                # Attempt to align layer to planning unit grid
                layer_raster <- terra::project(
                  x = layer_raster, 
                  y = pu_raster, 
                  method = "ngb"  # nearest neighbor for most layers
                )
                
                # Mask layer to planning unit and fill NAs inside PU
                # 1. Where PU is NA (outside): set layer to NA (transparent on map)
                layer_raster[is.na(pu_raster)] <- NA
                
                # 2. Where PU exists but layer is NA (inside PU): set to 0 
                # This ensures all layers have data wherever PU exists (required by wheretowork)
                pu_exists <- !is.na(pu_raster)
                layer_is_na <- is.na(layer_raster)
                layer_raster[pu_exists & layer_is_na] <- 0
                
                cat("*** Masked layer to planning unit and filled NAs inside PU with 0 ***\n")
                
                # For manual/binary layers, standardize to 0 and 1 only
                if (row$Legend == "manual" && !is.na(row$Values)) {
                  # Convert all values > 0 to 1 for binary layers
                  layer_raster[layer_raster > 0] <- 1
                  cat("*** Standardized manual layer to binary (0, 1) ***\n")
                }
                
                # Save the aligned raster temporarily
                temp_layer_path <- tempfile(fileext = ".tif")
                terra::writeRaster(layer_raster, temp_layer_path, overwrite = TRUE)
                
                # Copy the aligned version
                file.copy(temp_layer_path, target_path, overwrite = TRUE)
                unlink(temp_layer_path)
                
                cat("*** Layer aligned and saved ***\n")
              } else {
                # Grids match - mask layer to planning unit and fill NAs inside PU
                # 1. Where PU is NA (outside): set layer to NA (transparent on map)
                layer_raster[is.na(pu_raster)] <- NA
                
                # 2. Where PU exists but layer is NA (inside PU): set to 0
                # This ensures all layers have data wherever PU exists (required by wheretowork)
                pu_exists <- !is.na(pu_raster)
                layer_is_na <- is.na(layer_raster)
                layer_raster[pu_exists & layer_is_na] <- 0
                
                cat("*** Masked layer to planning unit and filled NAs inside PU with 0 ***\n")
                
                # For manual/binary layers, standardize to 0 and 1 only
                if (row$Legend == "manual" && !is.na(row$Values)) {
                  # Convert all values > 0 to 1 for binary layers
                  layer_raster[layer_raster > 0] <- 1
                  cat("*** Standardized manual layer to binary (0, 1) ***\n")
                }
                
                # Save the cleaned raster
                temp_layer_path <- tempfile(fileext = ".tif")
                terra::writeRaster(layer_raster, temp_layer_path, overwrite = TRUE)
                file.copy(temp_layer_path, target_path, overwrite = TRUE)
                unlink(temp_layer_path)
              }
            } else {
              # No planning unit found, copy as normal but warn
              cat("*** Warning: Planning unit not found for grid validation ***\n")
              file.copy(file.path(base_folder(), row$File), target_path, overwrite = TRUE)
            }
            
          }, error = function(e) {
            cat("*** Error during layer grid validation:", e$message, "***\n")
            cat("*** Copying layer without validation ***\n")
            file.copy(file.path(base_folder(), row$File), target_path, overwrite = TRUE)
          })

          # Add file via GraphQL
          qry_file <- ghql::Query$new()
          qry_file$query("addFile", add_file_mutation)
          file_payload <- list(
            uploaderId = as.character(user_info()$id),
            projectId = as.character(new_project_id),
            path = if (file.exists("/.dockerenv") || Sys.getenv("DOCKER_CONTAINER") == "true") {
              sub("^/app/", "", target_path) # Store relative path in database (Docker)
            } else {
              sub(paste0("^", normalizePath(getwd(), winslash = "/"), "/"), "", normalizePath(target_path, winslash = "/")) # Store relative path (Local)
            },
            name = row$Name,
            description = paste("Imported from ZIP:", row$Theme)
          )
          res_file <- client$exec(
            qry_file$queries$addFile,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = file_payload
          )
          new_file_id <- jsonlite::fromJSON(res_file)$data$addFile$id

          # formats incoming array fields for values, color, and labels ie: "0, 1" --> [0, 1]
          parse_array_field <- function(x) {
            if (is.na(x) || !nzchar(x)) return(list())
            # Split by comma, trim whitespace
            trimws(unlist(strsplit(x, ",")))
          }

          # Add ProjectLayer
          cat("*** CREATING PROJECT LAYER:", row$Name, "***\n")
          cat("*** Type:", row$Type, "Theme:", row$Theme, "***\n")
          cat("*** new_project_id variable:", new_project_id, "***\n")
          
          qry_layer <- ghql::Query$new()
          qry_layer$query("addProjectLayer", add_project_layer_mutation)
          layer_payload <- list(
            input = list(
              projectId = as.character(new_project_id),
              type = row$Type,
              theme = row$Theme,
              fileId = as.character(new_file_id),
              name = row$Name,
              legend = row$Legend,
              values = parse_array_field(row$Values),
              color = parse_array_field(row$Color),
              labels = parse_array_field(row$Labels),
              unit = row$Unit,
              provenance = row$Provenance,
              visible = as.logical(row$Visible),
              hidden = as.logical(row$Hidden),
              downloadable = as.logical(row$Downloadable)
            )
          )
          
          cat("*** Layer payload prepared ***\n")
          cat("***   projectId:", as.character(new_project_id), "***\n")
          cat("***   fileId:", as.character(new_file_id), "***\n")
          cat("***   values:", paste(parse_array_field(row$Values), collapse=", "), "***\n")
          cat("***   colors:", paste(parse_array_field(row$Color), collapse=", "), "***\n")
          cat("***   labels:", paste(parse_array_field(row$Labels), collapse=", "), "***\n")

          res_layer <- client$exec(
            qry_layer$queries$addProjectLayer,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = layer_payload
          )
          
          cat("*** ProjectLayer mutation response:", res_layer, "***\n")
          res_layer_parsed <- jsonlite::fromJSON(res_layer)
          
          if (!is.null(res_layer_parsed$errors)) {
            cat("*** ERROR CREATING PROJECT LAYER:", res_layer_parsed$errors, "***\n")
            stop(paste("Failed to create project layer:", row$Name, "-", res_layer_parsed$errors))
          } else if (!is.null(res_layer_parsed$data$addProjectLayer$id)) {
            cat("*** PROJECT LAYER CREATED SUCCESSFULLY with ID:", res_layer_parsed$data$addProjectLayer$id, "***\n")
          } else {
            cat("*** WARNING: Unexpected response structure for project layer creation ***\n")
          }
        }

        # Success state
        shinyjs::html("progress_details", "¡Proyecto creado exitosamente!")
        shinyjs::delay(1500, {
          shiny::showNotification(paste("Project created with", nrow(df), "layers."), type = "message")
          shiny::removeModal()
          
          # Clear the CSV preview table
          output$csv_preview <- DT::renderDT({
            DT::datatable(data.frame(Mensaje = "Sube un archivo ZIP para previsualizar las capas"), 
                         options = list(dom = 't'))
          })
        })

        # wait to make sure that projects are fully uploaded
        Sys.sleep(1)  # give the backend time to finish

        # fetch projects
        fetch_projects()

      }, error = function(e){
        # Log the actual error that caused upload to fail
        cat("*** UPLOAD ERROR OCCURRED ***\n")
        cat("*** Error message:", e$message, "***\n")
        cat("*** Error class:", class(e), "***\n")
        if (!is.null(e$call)) {
          cat("*** Error call:", deparse(e$call), "***\n")
        }
        
        # Reset UI state on error
        shinyjs::hide("upload_progress")
        shinyjs::enable("submit_project")
        
        # If we have a project ID, it means the project was created but something failed later
        # We should clean up the incomplete project
        if (exists("new_project_id") && !is.null(new_project_id)) {
          tryCatch({
            cat("*** CLEANUP: Deleting incomplete project with ID:", new_project_id, "***\n")
            
            # Execute delete project mutation
            qry_delete <- ghql::Query$new()
            qry_delete$query("deleteProject", delete_project_mutation)
            delete_payload <- list(id = as.character(new_project_id))
            
            delete_res <- client$exec(
              qry_delete$queries$deleteProject,
              headers = list(Authorization = paste("Bearer", auth_token())),
              variables = delete_payload
            )
            
            cat("*** CLEANUP: Project deletion result:", delete_res, "***\n")
            shiny::showNotification(
              paste("Error creating project:", e$message, "- Incomplete project has been cleaned up."), 
              type = "error"
            )
          }, error = function(cleanup_error) {
            cat("*** CLEANUP ERROR:", cleanup_error$message, "***\n")
            shiny::showNotification(
              paste("Error creating project:", e$message, "- Warning: Failed to clean up incomplete project."), 
              type = "error"
            )
          })
        } else {
          # Project creation failed before getting an ID, no cleanup needed
          shiny::showNotification(paste("Error creating project:", e$message), type = "error")
        }
      })
    })
  })
}
