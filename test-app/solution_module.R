solutionUI <- function(id) {
  ns <- NS(id)
  tagList(
    h3("Solutions"),
    selectInput(ns("project_select"), "Select Project", choices = NULL),
    uiOutput(ns("add_solution_ui")),
    DTOutput(ns("solutions_table"))
  )
}

solutionServer <- function(id, client, auth_token, user_info, projects_data) {
  moduleServer(id, function(input, output, session) {
    ns <- session$ns

    solutions_data <- reactiveVal(data.frame())

     # GraphQL query to get files by project ID
    solutions_query <- '
        query($projectId: ID!) {
        solutions(projectId: $projectId) {
            id
            title
            description
            author_email
            author_name
            userGroup
        }
        }'

    # Update dropdown choices when projects_data changes
    observeEvent(projects_data(), {
      proj_df <- projects_data()
      if (nrow(proj_df) > 0) {
        choices <- setNames(proj_df$id, proj_df$title)
        updateSelectInput(session, "project_select", choices = choices)
      }
    }, ignoreNULL = FALSE)

    observeEvent(input$project_select, {
      req(input$project_select)
        print(input$project_select)
    
      qry <- Query$new()
      qry$query("solutions", solutions_query)
 
      tryCatch({
        res <- client$exec(
          qry$queries$solutions,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = list(projectId = as.character(input$project_select))
        )
        res_list <- jsonlite::fromJSON(res)
        print(res_list)
        # Extract solutions
        solutions <- res_list$data$solutions
        solutions_data(as.data.frame(solutions))

      }, error = function(e) {
        showNotification(paste("Failed to fetch solutions for project:", e$message), type = "error")

      })
    })

    output$solutions_table <- renderDT({
      df <- solutions_data()
      if (nrow(df) == 0) {
        return(datatable(data.frame(Message = "No solutions found"), options = list(dom = 't')))
      }
      datatable(df[, c("id", "title", "description", "author_name", "author_email", "user_group")], 
                rownames = FALSE,
                colnames = c("ID", "Title", "Description", "Author", "Author Email", "Visibility"))

    })

    output$add_solution_ui <- renderUI({
      req(user_info())
      actionButton(ns("show_add_solution"), "Add New Solution")
    })

    observeEvent(input$show_add_solution, {
        # Reset stored layers
        solution_layers <- reactiveVal(data.frame(
            type = character(),
            theme = character(),
            file_id = character(),
            name = character(),
            legend = character(),
            values = I(list()),
            color = I(list()),
            labels = I(list()),
            unit = character(),
            provenance = character(),
            order = integer(),
            visible = logical(),
            hidden = logical(),
            goal = numeric(),
            downloadable = logical(),
            stringsAsFactors = FALSE
        ))

        # Get files for the current project
        files_qry <- Query$new()
        files_qry$query("project_files", '
            query($projectId: ID!) {
            project_files(projectId: $projectId) {
                id
                name
            }
            }')

        files_res <- client$exec(
            files_qry$queries$project_files,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = list(projectId = as.character(input$project_select))
        )

        files_list <- jsonlite::fromJSON(files_res)$data$project_files
        files_df <- as.data.frame(files_list)

        showModal(modalDialog(
            title = "Add New Solution",
            textInput(ns("solution_title"), "Solution Title"),
            textAreaInput(ns("solution_description"), "Description", ""),
            textInput(ns("solution_user_group"), "User Group", value = "public"),

            tags$h4("Add Layer"),
            selectInput(ns("layer_type"), "Type", choices = c("theme", "weight", "include", "exclude")),
            textInput(ns("layer_theme"), "Theme"),
            selectInput(ns("layer_file"), "Select File", choices = setNames(files_df$id, files_df$name)),
            textInput(ns("layer_name"), "Layer Name (table of contents)"),
            selectInput(ns("layer_legend"), "Legend", choices = c("manual", "continuous")),
            textInput(ns("layer_values"), "Values (comma-separated)"),
            textInput(ns("layer_color"), "Colors (comma-separated HEX codes)"),
            textInput(ns("layer_labels"), "Labels (comma-separated)"),
            textInput(ns("layer_unit"), "Unit"),
            selectInput(ns("layer_provenance"), "Provenance", choices = c("regional", "national", "missing")),
            numericInput(ns("layer_order"), "Order", value = NA),
            checkboxInput(ns("layer_visible"), "Visible", value = TRUE),
            checkboxInput(ns("layer_hidden"), "Hidden", value = FALSE),
            numericInput(ns("layer_goal"), "Goal (0–1)", value = NA, min = 0, max = 1, step = 0.01),
            checkboxInput(ns("layer_downloadable"), "Downloadable", value = TRUE),
            actionButton(ns("add_layer"), "Add Layer"),
            br(),
            DTOutput(ns("layers_table")),

            footer = tagList(
            modalButton("Cancel"),
            actionButton(ns("submit_solution"), "Submit Solution")
            ),
            size = "l",
            easyClose = TRUE
        ))
    })

    observeEvent(input$add_layer, {
        req(input$layer_type, input$layer_name)

        current <- solution_layers()
        new_layer <- data.frame(
            type = input$layer_type,
            theme = input$layer_theme,
            file_id = input$layer_file,
            name = input$layer_name,
            legend = input$layer_legend,
            values = list(strsplit(input$layer_values, ",\\s*")[[1]]),
            color = list(strsplit(input$layer_color, ",\\s*")[[1]]),
            labels = list(strsplit(input$layer_labels, ",\\s*")[[1]]),
            unit = input$layer_unit,
            provenance = input$layer_provenance,
            order = ifelse(is.na(input$layer_order), NA, as.integer(input$layer_order)),
            visible = as.logical(input$layer_visible),
            hidden = as.logical(input$layer_hidden),
            goal = ifelse(is.na(input$layer_goal), NA, as.numeric(input$layer_goal)),
            downloadable = as.logical(input$layer_downloadable),
            stringsAsFactors = FALSE
        )

        solution_layers(rbind(current, new_layer))
    })

    output$layers_table <- renderDT({
        df <- solution_layers()
        if (nrow(df) == 0) {
            return(datatable(data.frame(Message = "No layers added"), options = list(dom = 't')))
        }
        datatable(df, rownames = FALSE)
    })



    # observeEvent(input$submit_solution, {
    #     req(input$solution_title)

    #     # 1. Create the solution
    #     mutation <- '
    #         mutation($projectId: ID!, $title: String!, $description: String!, $user_group: String!) {
    #         createSolution(
    #             projectId: $projectId,
    #             title: $title,
    #             description: $description,
    #             user_group: $user_group
    #         ) {
    #             id
    #         }
    #         }'

    #     create_qry <- Query$new()
    #     create_qry$query("create_solution", mutation)

    #     res <- client$exec(
    #         create_qry$queries$create_solution,
    #         headers = list(Authorization = paste("Bearer", auth_token())),
    #         variables = list(
    #         projectId = as.character(input$project_select),
    #         title = input$solution_title,
    #         description = input$solution_description,
    #         user_group = input$solution_user_group
    #         )
    #     )

    #     solution_id <- jsonlite::fromJSON(res)$data$createSolution$id

    #     # 2. Add layers for that solution
    #     layers_df <- solution_layers()
    #     if (nrow(layers_df) > 0) {
    #         for (i in seq_len(nrow(layers_df))) {
    #         lyr_mutation <- '
    #             mutation($solutionId: ID!, $fileId: ID!, $name: String!) {
    #             createLayer(
    #                 solutionId: $solutionId,
    #                 fileId: $fileId,
    #                 name: $name
    #             ) { id }
    #             }'

    #         lyr_qry <- Query$new()
    #         lyr_qry$query("create_layer", lyr_mutation)

    #         client$exec(
    #             lyr_qry$queries$create_layer,
    #             headers = list(Authorization = paste("Bearer", auth_token())),
    #             variables = list(
    #             solutionId = solution_id,
    #             fileId = layers_df$file_id[i],
    #             name = layers_df$layer_name[i]
    #             )
    #         )
    #         }
    #     }

    #     removeModal()
    #     showNotification("Solution added successfully", type = "message")
    #     })





  })
}