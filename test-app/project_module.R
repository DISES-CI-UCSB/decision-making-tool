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


    added_files <- reactiveVal(list())

    fetch_projects <- function() {
      qry <- Query$new()
      qry$query("projects", projects_query)
      tryCatch({
        res <- client$exec(qry$queries$projects)
        res_list <- jsonlite::fromJSON(res)
        projects <- res_list$data$projects
        projects_data(as.data.frame(projects))
      }, error = function(e) {
        showNotification("Failed to fetch projects", type = "error")
      })
    }

    observeEvent(auth_token(), {
      fetch_projects()
    })

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

    observeEvent(input$show_add_project, {
      added_files(list())  # reset stored files
      showModal(modalDialog(
        title = "Add New Project",
        textInput(ns("project_title"), "Project Title"),
        textAreaInput(ns("project_description"), "Description", ""),
        textInput(ns("project_user_group"), "User Group", value = "public"),

        tags$h4("Add Project Layers"),
        fileInput(ns("file_upload"), "Choose File"),
        textInput(ns("file_name"), "File Name"),
        textInput(ns("file_desc"), "File Description"),

        # ProjectLayer fields
        selectInput(ns("layer_type"), "Layer Type", choices = c("theme", "weight", "include", "exclude")),
        textInput(ns("layer_theme"), "Theme"),
        selectInput(ns("layer_legend"), "Legend Type", choices = c("manual", "continuous")),
        textInput(ns("layer_values"), "Values"),
        textInput(ns("layer_color"), "Colors (comma-separated)"),
        textInput(ns("layer_labels"), "Labels (comma-separated)"),
        textInput(ns("layer_unit"), "Unit"),
        textInput(ns("layer_provenance"), "Provenance"),
        checkboxInput(ns("layer_visible"), "Visible", value = TRUE),
        checkboxInput(ns("layer_downloadable"), "Downloadable", value = TRUE),

        actionButton(ns("add_file_to_list"), "Add Layer"),

        tags$h4("Layers to be uploaded:"),
        DTOutput(ns("added_files_table")),

        footer = tagList(
          modalButton("Cancel"),
          actionButton(ns("submit_project"), "Submit Project")
        ),
        size = "l",
        easyClose = TRUE
      ))
    })

    observeEvent(input$add_file_to_list, {
        req(input$file_upload)
        req(input$file_name)

        files <- added_files()

        new_file <- list(
            datapath = input$file_upload$datapath,
            name = input$file_name,
            description = input$file_desc,
            orig_name = input$file_upload$name,

            # layer info
            layer = list(
            type = input$layer_type,
            theme = input$layer_theme,
            name = input$file_name, # link to file name
            legend = input$layer_legend,
            values = unlist(strsplit(input$layer_values, ",")),
            color = unlist(strsplit(input$layer_color, ",")),
            labels = unlist(strsplit(input$layer_labels, ",")),
            unit = input$layer_unit,
            provenance = input$layer_provenance,
            visible = input$layer_visible,
            downloadable = input$layer_downloadable
            )
        )

        added_files(c(files, list(new_file)))

        shinyjs::reset(ns("file_upload"))
        shinyjs::reset(ns("file_name"))
        shinyjs::reset(ns("file_desc"))
        shinyjs::reset(ns("layer_theme"))
        shinyjs::reset(ns("layer_legend"))
        shinyjs::reset(ns("layer_values"))
        shinyjs::reset(ns("layer_color"))
        shinyjs::reset(ns("layer_labels"))
        shinyjs::reset(ns("layer_unit"))
        shinyjs::reset(ns("layer_provenance"))
        })


    output$added_files_table <- renderDT({
        files <- added_files()
        if (length(files) == 0) {
            return(datatable(data.frame(Message = "No files added yet"), options = list(dom = 't')))
        }
        df <- data.frame(
            `Original File Name` = sapply(files, function(x) x$orig_name),
            `Layer Theme` = sapply(files, function(x) x$layer$theme),
            `Layer Type` = sapply(files, function(x) x$layer$type),
            stringsAsFactors = FALSE
        )
        datatable(df, rownames = FALSE, options = list(dom = 't'))
    })


    observeEvent(input$submit_project, {
      req(input$project_title)
      req(user_info())

      files <- added_files()
      if (length(files) == 0) {
        showNotification("Please add at least one file before submitting.", type = "error")
        return()
      }
    
        # add project
      qry_proj <- Query$new()
      qry_proj$query("addProject", add_project_mutation)

      tryCatch({
        payload <- list(
          input = list(
            ownerId = as.character(user_info()$id),
            title = input$project_title,
            description = input$project_description,
            userGroup = input$project_user_group
          )
        )

        res_proj <- client$exec(
          qry_proj$queries$addProject,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = payload
        )
        res_list <- jsonlite::fromJSON(res_proj)
        new_project_id <- res_list$data$addProject$id

        print("added new project")
        print(new_project_id)

        # now tryuploading files
        upload_base_path <- "uploads"
        proj_folder <- file.path(upload_base_path, paste0(gsub("[^A-Za-z0-9]", "_", input$project_title), "_files"))
        if (!dir.exists(proj_folder)) {
            dir.create(proj_folder, recursive = TRUE)
        }

        tryCatch({
            for (file in files) {
                target_path <- file.path(proj_folder, file$orig_name)
                file.copy(file$datapath, target_path, overwrite = TRUE)
                path_to_store <- target_path

                # 1. Add file
                qry_file <- Query$new()
                qry_file$query("addFile", add_file_mutation)
                file_payload <- list(
                    uploaderId = as.character(user_info()$id),
                    path = path_to_store,
                    name = file$name,
                    description = file$description,
                    projectId = as.character(new_project_id)
                )
                res_file <- client$exec(
                    qry_file$queries$addFile,
                    headers = list(Authorization = paste("Bearer", auth_token())),
                    variables = file_payload
                )
                res_file_list <- jsonlite::fromJSON(res_file)
                new_file_id <- res_file_list$data$addFile$id
                print(new_file_id)

                # 2. Add layer (linked to file)
                qry_layer <- Query$new()
                qry_layer$query("addProjectLayer", add_project_layer_mutation)
                layer_payload <- list(
                    input = c(file$layer, list(fileId = as.character(new_file_id)))
                )
                print(layer_payload)
                res_layer <- client$exec(
                    qry_layer$queries$addProjectLayer,
                    headers = list(Authorization = paste("Bearer", auth_token())),
                    variables = layer_payload
                )
                }

            }, error = function(e) {
            showNotification(paste("Error adding file:", e$message), type = "error")
            })
        showNotification(paste("Project created and files uploaded:", res_list$data$addProject$title), type = "message")
        removeModal()
        fetch_projects()
        
      }, error = function(e) {
        showNotification(paste("Error creating project:", e$message), type = "error")
      })

      
      
    })
  })
}
