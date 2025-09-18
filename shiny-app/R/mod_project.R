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
    htmltools::tags$h3("Projects"),
    DT::DTOutput(ns("projects_table")),
    shiny::uiOutput(ns("add_project_ui"))
  )
}

#' @export
projectServer <- function(id, client, auth_token, user_info, projects_data, refresh_trigger = NULL) {
  shiny::moduleServer(id, function(input, output, session) {
    ns <- session$ns

    # GraphQL queries/mutations
    projects_query <- '
    query($userGroup: String, $userType: String) {
      projects(userGroup: $userGroup, userType: $userType) {
        id
        title
        description
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

    add_project_layer_mutation <- '
    mutation($input: ProjectLayerInput!) {
      addProjectLayer(input: $input) {
        id
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
      qry <- ghql::Query$new()
      qry$query("projects", projects_query)
      
      # Prepare variables for the query
      variables <- list()
      
      # Always pass userType for proper access control
      if (!is.null(user_info()) && !is.null(user_info()$type)) {
        variables$userType <- user_info()$type
        cat("*** User Type:", user_info()$type, "***\n")
      } else {
        variables$userType <- "public"
        cat("*** Defaulting to public user type ***\n")
      }
      
      # For backwards compatibility, also pass userGroup if available
      if (!is.null(user_info()) && !is.null(user_info()$userGroup)) {
        variables$userGroup <- user_info()$userGroup
        cat("*** User Group:", user_info()$userGroup, "***\n")
      }
      
      cat("*** Query variables:", jsonlite::toJSON(variables), "***\n")
      
      tryCatch({
        # Include auth header if available
        headers <- list()
        if (!is.null(auth_token()) && auth_token() != "public_token") {
          headers$Authorization <- paste("Bearer", auth_token())
        }
        
        res <- client$exec(qry$queries$projects, variables = variables, headers = headers)
        cat("*** GraphQL Response:", res, "***\n")
        
        res_list <- jsonlite::fromJSON(res)
        projects <- res_list$data$projects
        
        cat("*** Found", nrow(projects), "projects ***\n")
        if (nrow(projects) > 0) {
          cat("*** Project titles:", paste(projects$title, collapse = ", "), "***\n")
        }
        
        projects_data(as.data.frame(projects))
      }, error = function(e) {
        cat("*** Error fetching projects:", e$message, "***\n")
        shiny::showNotification(paste("Failed to fetch projects:", e$message), type = "error")
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
        return(DT::datatable(data.frame(Message = "No projects found"), options = list(dom = 't')))
      }
      DT::datatable(df[, c("id", "title", "description")], 
                rownames = FALSE,
                colnames = c("ID", "Title", "Description"))
    })

    output$add_project_ui <- shiny::renderUI({
      shiny::req(user_info())
      shiny::actionButton(ns("show_add_project"), "Add New Project")
    })

    # Show modal for new project
    shiny::observeEvent(input$show_add_project, {
      added_files(NULL)
      tmp_dir(NULL)
      # Set default user group to match current user's group
      default_user_group <- if (!is.null(user_info()) && !is.null(user_info()$userGroup)) {
        user_info()$userGroup
      } else {
        "public"
      }
      
      shiny::showModal(shiny::modalDialog(
        title = "Add New Project",
        shiny::textInput(ns("project_title"), "Project Title", value="National Test"),
        shiny::textAreaInput(ns("project_description"), "Description", value="Test description"),
        shiny::textInput(ns("project_user_group"), "User Group", value = default_user_group),

        htmltools::tags$h4("Upload ZIP containing layers.csv and layer files"),
        shiny::fileInput(ns("project_zip"), "Choose ZIP file", accept = ".zip"),
        DT::DTOutput(ns("csv_preview")),

        footer = htmltools::tagList(
          shiny::modalButton("Cancel"),
          shiny::actionButton(ns("submit_project"), "Submit Project")
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

      df <- read.csv(csv_path, stringsAsFactors = FALSE)

      # Add column to check file existence
      df$file_exists <- file.exists(file.path(base_folder(), df$File))

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
      df <- added_files()
      td <- tmp_dir()
      if(is.null(df) || nrow(df) == 0) {
        shiny::showNotification("No layers to upload.", type = "error")
        return()
      }

      # Check all files exist
      missing_files <- df$File[!df$file_exists]
      if(length(missing_files) > 0) {
        shiny::showNotification(paste("Missing files in ZIP:", paste(missing_files, collapse = ", ")), type = "error")
        return()
      }

      # 1️⃣ Add Project
      qry_proj <- ghql::Query$new()
      qry_proj$query("addProject", add_project_mutation)
      payload <- list(
        input = list(
          ownerId = as.character(user_info()$id),
          title = input$project_title,
          description = input$project_description,
          userGroup = input$project_user_group
        )
      )
      
      cat("*** CREATING PROJECT ***\n")
      cat("*** Owner ID:", user_info()$id, "***\n")
      cat("*** Title:", input$project_title, "***\n")
      cat("*** User Group:", input$project_user_group, "***\n")

      tryCatch({
        res_proj <- client$exec(
          qry_proj$queries$addProject,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = payload
        )
        cat("*** Project creation response:", res_proj, "***\n")
        
        res_list <- jsonlite::fromJSON(res_proj)
        new_project_id <- res_list$data$addProject$id
        project_folder_name <- gsub(" ", "_", input$project_title)
        
        cat("*** New project ID:", new_project_id, "***\n")

        # 2️⃣ Process each row
        for(i in seq_len(nrow(df))){
          row <- df[i, ]

          # Copy file to uploads folder
          upload_dir <- file.path("uploads", paste0(project_folder_name, new_project_id))
          if(!dir.exists(upload_dir)) dir.create(upload_dir, recursive = TRUE)
          target_path <- file.path(upload_dir, basename(row$File))
          file.copy(file.path(base_folder(), row$File), target_path, overwrite = TRUE)

          # Add file via GraphQL
          qry_file <- ghql::Query$new()
          qry_file$query("addFile", add_file_mutation)
          file_payload <- list(
            uploaderId = as.character(user_info()$id),
            projectId = as.character(new_project_id),
            path = target_path,
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

          client$exec(
            qry_layer$queries$addProjectLayer,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = layer_payload
          )
        }

        shiny::showNotification(paste("Project created with", nrow(df), "layers."), type = "message")
        shiny::removeModal()

        # wait to make sure that projects are fully uploaded
        Sys.sleep(1)  # give the backend time to finish

        # fetch projects
        fetch_projects()

      }, error = function(e){
        shiny::showNotification(paste("Error creating project:", e$message), type = "error")
      })
    })
  })
}
