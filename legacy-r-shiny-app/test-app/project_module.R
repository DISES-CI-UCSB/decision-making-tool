
projectUI <- function(id) {
  ns <- NS(id)
  tagList(
    h3("Projects"),
    DTOutput(ns("projects_table")),
    uiOutput(ns("add_project_ui"))
  )
}

projectServer <- function(id, client, auth_token, user_info, projects_data) {
  moduleServer(id, function(input, output, session) {
    ns <- session$ns

    # GraphQL queries/mutations
    projects_query <- '
    query {
      projects {
        id
        title
        description
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
    added_files <- reactiveVal(NULL)
    tmp_dir <- reactiveVal(NULL)
    base_folder <- reactiveVal(NULL) # base folder for zipped project file upload

    # Fetch projects
    fetch_projects <- function() {
      qry <- Query$new()
      qry$query("projects", projects_query)
      tryCatch({
        res <- client$exec(qry$queries$projects)
        print(res)
        res_list <- fromJSON(res)
        projects <- res_list$data$projects
        projects_data(as.data.frame(projects))
      }, error = function(e) {
        showNotification("Failed to fetch projects", type = "error")
      })
    }

    observeEvent(auth_token(), { fetch_projects() })

    output$projects_table <- renderDT({
      df <- projects_data()
      if (nrow(df) == 0) {
        return(datatable(data.frame(Message = "No projects found"), options = list(dom = 't')))
      }
      datatable(df[, c("id", "title", "description")], 
                rownames = FALSE,
                colnames = c("ID", "Title", "Description"))
    })

    output$add_project_ui <- renderUI({
      req(user_info())
      actionButton(ns("show_add_project"), "Add New Project")
    })

    # Show modal for new project
    observeEvent(input$show_add_project, {
      added_files(NULL)
      tmp_dir(NULL)
      showModal(modalDialog(
        title = "Add New Project",
        textInput(ns("project_title"), "Project Title", value="National Test"),
        textAreaInput(ns("project_description"), "Description", value="Test description"),
        textInput(ns("project_user_group"), "User Group", value = "public"),

        tags$h4("Upload ZIP containing layers.csv and layer files"),
        fileInput(ns("project_zip"), "Choose ZIP file", accept = ".zip"),
        DTOutput(ns("csv_preview")),

        footer = tagList(
          modalButton("Cancel"),
          actionButton(ns("submit_project"), "Submit Project")
        ),
        size = "l",
        easyClose = TRUE
      ))
    })

    # Handle ZIP upload
    observeEvent(input$project_zip, {
      req(input$project_zip)

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
      req(file.exists(csv_path))  # Fail if not found anywhere

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
      output$csv_preview <- renderDT({
        datatable(df_subset, options = list(pageLength = 5, scrollX = TRUE))
      })
    })

    # Submit project + layers
    observeEvent(input$submit_project, {
      req(input$project_title)
      req(user_info())
      df <- added_files()
      td <- tmp_dir()
      if(is.null(df) || nrow(df) == 0) {
        showNotification("No layers to upload.", type = "error")
        return()
      }

      # Check all files exist
      missing_files <- df$File[!df$file_exists]
      if(length(missing_files) > 0) {
        showNotification(paste("Missing files in ZIP:", paste(missing_files, collapse = ", ")), type = "error")
        return()
      }

      # 1️⃣ Add Project
      qry_proj <- Query$new()
      qry_proj$query("addProject", add_project_mutation)
      payload <- list(
        input = list(
          ownerId = as.character(user_info()$id),
          title = input$project_title,
          description = input$project_description,
          userGroup = input$project_user_group
        )
      )



      tryCatch({
        res_proj <- client$exec(
          qry_proj$queries$addProject,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = payload
        )
        res_list <- fromJSON(res_proj)
        new_project_id <- res_list$data$addProject$id
        project_folder_name <- gsub(" ", "_", input$project_title)
        print("added project!")
        print(new_project_id)

        # 2️⃣ Process each row
        for(i in seq_len(nrow(df))){
          row <- df[i, ]

          # Copy file to uploads folder
          upload_dir <- file.path("uploads", paste0(project_folder_name, new_project_id))
          if(!dir.exists(upload_dir)) dir.create(upload_dir, recursive = TRUE)
          target_path <- file.path(upload_dir, basename(row$File))
          file.copy(file.path(base_folder(), row$File), target_path, overwrite = TRUE)

          print("copied file")
          print(row$File)

          # Add file via GraphQL
          qry_file <- Query$new()
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
          new_file_id <- fromJSON(res_file)$data$addFile$id

          print("added new file")

          # formats incoming array fields for values, color, and labels ie: "0, 1" --> [0, 1]
          parse_array_field <- function(x) {
            if (is.na(x) || !nzchar(x)) return(list())
            # Split by comma, trim whitespace
            trimws(unlist(strsplit(x, ",")))
          }


          # Add ProjectLayer
          qry_layer <- Query$new()
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
          print("project layer details")
          print(layer_payload)

          variables <- toJSON(layer_payload, auto_unbox = TRUE)
          print(variables)

          client$exec(
            qry_layer$queries$addProjectLayer,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = layer_payload
          )

          print("added new Project layer")
        }

        showNotification(paste("Project created with", nrow(df), "layers."), type = "message")
        removeModal()

        # wait to make sure that projects are fully uploaded
        Sys.sleep(1)  # give the backend time to finish

        # fetch projects
        fetch_projects()

      }, error = function(e){
        showNotification(paste("Error creating project:", e$message), type = "error")
      })
    })
  })
}



# projectUI <- function(id) {
#   ns <- NS(id)
#   tagList(
#     h3("Projects"),
#     DTOutput(ns("projects_table")),
#     uiOutput(ns("add_project_ui"))
#   )
# }

# projectServer <- function(id, client, auth_token, user_info, projects_data) {
#   moduleServer(id, function(input, output, session) {
#     ns <- session$ns

#     projects_query <- '
#     query {
#       projects {
#         id
#         title
#         description
#       }
#     }'

#     add_project_mutation <- '
#     mutation($input: ProjectInput!) {
#       addProject(input: $input) {
#         id
#         title
#       }
#     }'

#     add_file_mutation <- '
#     mutation($uploaderId: ID!, $projectId: ID!, $path: String!, $name: String!, $description: String!) {
#         addFile(uploaderId: $uploaderId, projectId: $projectId, path: $path, name: $name, description: $description) {
#         id
#         }
#     }
#     '
#     add_project_layer_mutation <- '
#     mutation($input: ProjectLayerInput!) {
#         addProjectLayer(input: $input) {
#             id
#         }
#     }
#     '


#     added_files <- reactiveVal(list())

#     fetch_projects <- function() {
#       qry <- Query$new()
#       qry$query("projects", projects_query)
#       tryCatch({
#         res <- client$exec(qry$queries$projects)
#         res_list <- jsonlite::fromJSON(res)
#         projects <- res_list$data$projects
#         projects_data(as.data.frame(projects))
#       }, error = function(e) {
#         showNotification("Failed to fetch projects", type = "error")
#       })
#     }

#     observeEvent(auth_token(), {
#       fetch_projects()
#     })

#     output$projects_table <- renderDT({
#       df <- projects_data()
#       if (nrow(df) == 0) {
#         return(datatable(data.frame(Message = "No projects found"), options = list(dom = 't')))
#       }
#       datatable(df[, c("id", "title", "description")], 
#                 rownames = FALSE,
#                 colnames = c("ID", "Title", "Description"))
#     })

#     output$add_project_ui <- renderUI({
#       req(user_info())
#       actionButton(ns("show_add_project"), "Add New Project")
#     })

#     observeEvent(input$show_add_project, {
#       added_files(list())  # reset stored files
#       showModal(modalDialog(
#         title = "Add New Project",
#         textInput(ns("project_title"), "Project Title"),
#         textAreaInput(ns("project_description"), "Description", ""),
#         textInput(ns("project_user_group"), "User Group", value = "public"),

#         tags$h4("Add Project Layers"),
#         fileInput(ns("file_upload"), "Choose File"),
#         textInput(ns("file_name"), "File Name"),
#         textInput(ns("file_desc"), "File Description"),

#         # ProjectLayer fields
#         selectInput(ns("layer_type"), "Layer Type", choices = c("theme", "weight", "include", "exclude")),
#         textInput(ns("layer_theme"), "Theme"),
#         selectInput(ns("layer_legend"), "Legend Type", choices = c("manual", "continuous")),
#         textInput(ns("layer_values"), "Values"),
#         textInput(ns("layer_color"), "Colors (comma-separated)"),
#         textInput(ns("layer_labels"), "Labels (comma-separated)"),
#         textInput(ns("layer_unit"), "Unit"),
#         textInput(ns("layer_provenance"), "Provenance"),
#         checkboxInput(ns("layer_visible"), "Visible", value = TRUE),
#         checkboxInput(ns("layer_downloadable"), "Downloadable", value = TRUE),

#         actionButton(ns("add_file_to_list"), "Add Layer"),

#         tags$h4("Layers to be uploaded:"),
#         DTOutput(ns("added_files_table")),

#         footer = tagList(
#           modalButton("Cancel"),
#           actionButton(ns("submit_project"), "Submit Project")
#         ),
#         size = "l",
#         easyClose = TRUE
#       ))
#     })

#     observeEvent(input$add_file_to_list, {
#         req(input$file_upload)
#         req(input$file_name)

#         files <- added_files()

#         new_file <- list(
#             datapath = input$file_upload$datapath,
#             name = input$file_name,
#             description = input$file_desc,
#             orig_name = input$file_upload$name,

#             # layer info
#             layer = list(
#             type = input$layer_type,
#             theme = input$layer_theme,
#             name = input$file_name, # link to file name
#             legend = input$layer_legend,
#             values = unlist(strsplit(input$layer_values, ",")),
#             color = unlist(strsplit(input$layer_color, ",")),
#             labels = unlist(strsplit(input$layer_labels, ",")),
#             unit = input$layer_unit,
#             provenance = input$layer_provenance,
#             visible = input$layer_visible,
#             downloadable = input$layer_downloadable
#             )
#         )

#         added_files(c(files, list(new_file)))

#         shinyjs::reset(ns("file_upload"))
#         shinyjs::reset(ns("file_name"))
#         shinyjs::reset(ns("file_desc"))
#         shinyjs::reset(ns("layer_theme"))
#         shinyjs::reset(ns("layer_legend"))
#         shinyjs::reset(ns("layer_values"))
#         shinyjs::reset(ns("layer_color"))
#         shinyjs::reset(ns("layer_labels"))
#         shinyjs::reset(ns("layer_unit"))
#         shinyjs::reset(ns("layer_provenance"))
#         })


#     output$added_files_table <- renderDT({
#         files <- added_files()
#         if (length(files) == 0) {
#             return(datatable(data.frame(Message = "No files added yet"), options = list(dom = 't')))
#         }
#         df <- data.frame(
#             `Original File Name` = sapply(files, function(x) x$orig_name),
#             `Layer Theme` = sapply(files, function(x) x$layer$theme),
#             `Layer Type` = sapply(files, function(x) x$layer$type),
#             stringsAsFactors = FALSE
#         )
#         datatable(df, rownames = FALSE, options = list(dom = 't'))
#     })


#     observeEvent(input$submit_project, {
#       req(input$project_title)
#       req(user_info())

#       files <- added_files()
#       if (length(files) == 0) {
#         showNotification("Please add at least one file before submitting.", type = "error")
#         return()
#       }
    
#         # add project
#       qry_proj <- Query$new()
#       qry_proj$query("addProject", add_project_mutation)

#       tryCatch({
#         payload <- list(
#           input = list(
#             ownerId = as.character(user_info()$id),
#             title = input$project_title,
#             description = input$project_description,
#             userGroup = input$project_user_group
#           )
#         )

#         res_proj <- client$exec(
#           qry_proj$queries$addProject,
#           headers = list(Authorization = paste("Bearer", auth_token())),
#           variables = payload
#         )
#         res_list <- jsonlite::fromJSON(res_proj)
#         new_project_id <- res_list$data$addProject$id

#         print("added new project")
#         print(new_project_id)

#         # now tryuploading files
#         upload_base_path <- "uploads"
#         proj_folder <- file.path(upload_base_path, paste0(gsub("[^A-Za-z0-9]", "_", input$project_title), "_files"))
#         if (!dir.exists(proj_folder)) {
#             dir.create(proj_folder, recursive = TRUE)
#         }

#         tryCatch({
#             for (file in files) {
#                 target_path <- file.path(proj_folder, file$orig_name)
#                 file.copy(file$datapath, target_path, overwrite = TRUE)
#                 path_to_store <- target_path

#                 # 1. Add file
#                 qry_file <- Query$new()
#                 qry_file$query("addFile", add_file_mutation)
#                 file_payload <- list(
#                     uploaderId = as.character(user_info()$id),
#                     path = path_to_store,
#                     name = file$name,
#                     description = file$description,
#                     projectId = as.character(new_project_id)
#                 )
#                 res_file <- client$exec(
#                     qry_file$queries$addFile,
#                     headers = list(Authorization = paste("Bearer", auth_token())),
#                     variables = file_payload
#                 )
#                 res_file_list <- jsonlite::fromJSON(res_file)
#                 new_file_id <- res_file_list$data$addFile$id
#                 print(new_file_id)

#                 # 2. Add layer (linked to file)
#                 qry_layer <- Query$new()
#                 qry_layer$query("addProjectLayer", add_project_layer_mutation)
#                 layer_payload <- list(
#                     input = c(file$layer, list(fileId = as.character(new_file_id)))
#                 )
#                 print(layer_payload)
#                 res_layer <- client$exec(
#                     qry_layer$queries$addProjectLayer,
#                     headers = list(Authorization = paste("Bearer", auth_token())),
#                     variables = layer_payload
#                 )
#                 }

#             }, error = function(e) {
#             showNotification(paste("Error adding file:", e$message), type = "error")
#             })
#         showNotification(paste("Project created and files uploaded:", res_list$data$addProject$title), type = "message")
#         removeModal()
#         fetch_projects()
        
#       }, error = function(e) {
#         showNotification(paste("Error creating project:", e$message), type = "error")
#       })

      
      
#     })
#   })
# }
