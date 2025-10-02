solutionUI <- function(id) {
  ns <- NS(id)
  tagList(
    h3("Solutions"),
    selectInput(ns("project_select"), "Select Project", choices = NULL),
    uiOutput(ns("add_solutions_ui")),
    DTOutput(ns("solutions_table"))
  )
}

solutionServer <- function(id, client, auth_token, user_info, projects_data) {
  moduleServer(id, function(input, output, session) {
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

      # addSolutionLayer(input: SolutionLayerInput!): SolutionLayer!

    add_solution_layer_mutation <- '
    mutation($input: SolutionLayerInput!) {
      addSolutionLayer(input: $input) {
        id
      }
    }'


    # Reactive to hold CSV + file info
    added_solutions <- reactiveVal(NULL)
    tmp_dir <- reactiveVal(NULL)
    base_folder <- reactiveVal(NULL) # base folder for zipped solution file upload

    project_folder_name <- reactiveVal(NULL)
    project_layers_data <- reactiveVal(NULL) # queried project layers dataframe 


    # Update projects dropdown
    observeEvent(projects_data(), {
      proj_df <- projects_data()
      if (nrow(proj_df) > 0) {
        choices <- setNames(proj_df$id, proj_df$title)
        updateSelectInput(session, "project_select", choices = choices)
      }
    }, ignoreNULL = FALSE)

    # Fetch solutions when project changes
    observeEvent(input$project_select, {
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
      }, error = function(e) {
        showNotification(paste("Failed to fetch solutions:", e$message), type = "error")
      })
      
      # get folder name
      proj_df <- projects_data()
      project_title <- proj_df$title[proj_df$id == input$project_select]
      folder_name <- gsub(" ", "_", project_title)
      # Update reactiveVal
      project_folder_name(folder_name)
      
    })

    output$solutions_table <- renderDT({
      df <- solutions_data()
      if (nrow(df) == 0) {
        return(datatable(data.frame(Message = "No solutions found"), options = list(dom = 't')))
      }
      datatable(df[, c("id", "title", "description", "author_name", "author_email", "userGroup")],
        rownames = FALSE,
        colnames = c("ID", "Title", "Description", "Author", "Author Email", "Visibility")
      )
    })

    output$add_solutions_ui <- renderUI({
      req(user_info())
      req(input$project_select)
      actionButton(ns("show_add_solution"), "Add New Solution")
    })

    observeEvent(input$show_add_solution, {
      added_solutions(NULL)
      tmp_dir(NULL)
      showModal(modalDialog(
        title = "Add New Solutions to Project",

        tags$h4("Upload ZIP containing solutions.csv and soultion files"),
        fileInput(ns("solution_zip"), "Choose ZIP file", accept = ".zip"),
        DTOutput(ns("csv_preview")),

        footer = tagList(
          modalButton("Cancel"),
          actionButton(ns("add_solutions"), "Add Solutions")
        ),
        size = "l",
        easyClose = TRUE
      ))
    })

    # Handle ZIP upload
    observeEvent(input$solution_zip, {
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

      df <- read.csv(csv_path, stringsAsFactors = FALSE)

      # Add column to check file existence
      df$file_exists <- file.exists(file.path(base_folder(), df$file_path))

      # Keep only SolutionLayers schema columns + File
      pl_columns <- c("scenario", "description", "author_name", "author_email", 
        "user_group", "file_path", "file_exists",
        "themes","targets","weights","includes","excludes")
      df_subset <- df[, intersect(pl_columns, colnames(df)), drop = FALSE]

      added_solutions(df_subset)

      # Render preview DT
      output$csv_preview <- renderDT({
        datatable(df_subset, options = list(pageLength = 5, scrollX = TRUE))
      })
    })

    # Upload solution ZIP
    observeEvent(input$add_solutions, {
      req(input$solution_zip, input$project_select, user_info())
      df <- added_solutions()
      td <- tmp_dir()
      if(is.null(df) || nrow(df) == 0) {
        showNotification("No solutions to upload.", type = "error")
        return()
      }

      # Check all files exist
      missing_files <- df$file_path[!df$file_exists]
      if(length(missing_files) > 0) {
        showNotification(paste("Missing solution files in ZIP:", paste(missing_files, collapse = ", ")), type = "error")
        return()
      }

      # Check that all themes, weights, includes, and excludes exist in ProjectLayers
      layer_qry <- Query$new()
      layer_qry$query("projectLayers", project_layers_query)
      tryCatch({
        res <- client$exec(
          layer_qry$queries$projectLayers,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = list(projectId = as.character(input$project_select))
          )        
        print(res)
        res_list <- fromJSON(res)
        project_layers_data(as.data.frame(res_list$data$projectLayers))
      
      }, error = function(e) {
        showNotification("Failed to fetch project layers", type = "error")
        return()
      })

      layers_df <- project_layers_data()
      req(layers_df)  # ensure it's not NULL
      print(layers_df)

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

        # check each type
        bad_themes   <- parse_and_check(row$themes,   layers_df$name)
        bad_weights  <- parse_and_check(row$weights,  layers_df$name)
        bad_includes <- parse_and_check(row$includes, layers_df$name)
        bad_excludes <- parse_and_check(row$excludes, layers_df$name)

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
        msg <- lapply(names(invalid_refs), function(scn) {
          bads <- invalid_refs[[scn]]
          paste0("Scenario '", scn, "' invalid: ",
                paste(
                  unlist(mapply(function(type, vals) {
                    if (length(vals) > 0) paste0(type, " [", paste(vals, collapse = ", "), "]")
                  },
                  names(bads), bads, SIMPLIFY = FALSE)),
                  collapse = "; "
                ))
        })
        showNotification(paste(msg, collapse = " | "), type = "error", duration = NULL)
        return()
      }

      # ✅ if here, all layers referenced are valid
      showNotification("All layer references valid!", type = "message")

      # Add solutions to database

      tryCatch({
      
        # add each solution referenced in csv
        for (i in seq_len(nrow(df))) {
          row <- df[i, ]

          # Copy solution file to uploads folder
          upload_dir <- file.path("uploads", project_folder_name(), "solutions")
          if(!dir.exists(upload_dir)) dir.create(upload_dir, recursive = TRUE)
          target_path <- file.path(upload_dir, basename(row$file_path))
          file.copy(file.path(base_folder(), row$file_path), target_path, overwrite = TRUE)

          print("copied solution file")
          print(row$file_path)

          ### Add solution file via GraphQL
          qry_file <- Query$new()
          qry_file$query("addFile", add_file_mutation)
          file_payload <- list(
            uploaderId = as.character(user_info()$id),
            projectId = as.character(input$project_select),
            path = target_path,
            name = row$scenario,
            description = paste("Solution file imported from ZIP:", row$description)
          )
          res_file <- client$exec(
            qry_file$queries$addFile,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = file_payload
          )
          new_file_id <- fromJSON(res_file)$data$addFile$id

          print("added new file")

          ### Build themes payload (SolutionLayers)
          str_to_array <- function(col_values) {
            list <- strsplit(col_values, ",")
            vec <- trimws(unlist(list))
            return(vec)
          }

          # get themes + targets
          themes_vec <- str_to_array(row$themes)
          targets_vec <- str_to_array(row$targets)

          # construct list of theme inputs for addSolution
          themes_payload <- lapply(seq_along(themes_vec), function(j) {
            proj_layer_id <- layers_df$id[match(themes_vec[[j]], layers_df$name)]
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
              title       = row$scenario,
              description = row$description,
              authorName  = row$author_name,
              authorEmail = row$author_email,
              userGroup   = row$user_group,
              fileId      = as.character(new_file_id),
              weightIds = weight_ids,
              includeIds = include_ids,
              excludeIds = exclude_ids,
              themes = themes_payload
            )
          )

          print("solution payload")
          print(sol_payload)

          variables <- toJSON(sol_payload, auto_unbox = TRUE)
          print(variables)

          res_sol <- client$exec(
            qry_sol$queries$addSolution,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = sol_payload
          )
                    
          print("solution made?")
          print(res_sol)
          res_list <- fromJSON(res_sol)
          print(res_list)
          new_sol_id <- res_list$data$addSolution$id

          print("added solution")

          print(paste("Added solution", new_sol_id, "with", length(themes_payload), "themes"))
        }

      }, error = function(e){
        showNotification(paste("Error adding solutions:", e$message), type = "error")
      })
        
        # input SolutionInput {
        #   projectId: ID! 
        #   authorId: ID! 
        #   title: String!
        #   description: String!
        #   authorName: String!
        #   authorEmail: String!
        #   userGroup: String!
        #   fileId: ID
        #   weightIds: [ID!]   
        #   includeIds: [ID!]  
        #   excludeIds: [ID!] 
        # }

        # Get projectlayer ids for themes, 
        # Build input payload
      #   payload <- list(
      #     input = list(
      #       projectId   = as.character(input$project_select),
      #       title       = row$scenario,
      #       description = row$description,
      #       authorName  = row$author_name,
      #       authorEmail = row$author_email,
      #       userGroup   = row$user_group,
      #       # attach the path of the uploaded solution file
      #       filePath    = file.path(base_folder(), row$file_path)
      #     )
      #   )

      #   # Run mutation
      #   tryCatch({
      #     res <- client$exec(
      #       qry_sol$queries$addSolution,
      #       headers = list(Authorization = paste("Bearer", auth_token())),
      #       variables = payload
      #     )
      #     res_list <- jsonlite::fromJSON(res)
      #     showNotification(paste("✅ Added solution:", res_list$data$addSolution$title))
      #   }, error = function(e) {
      #     showNotification(paste("❌ Failed to add solution", row$scenario, ":", e$message), type = "error")
      #   })
      # }

      # sol_csv <- file.path(tmpdir, "solution.csv")
      # if (!file.exists(sol_csv)) {
      #   showNotification("solution.csv not found in ZIP", type = "error")
      #   return()
      # }

      # sol_meta <- read.csv(sol_csv, stringsAsFactors = FALSE)

      # # Expected: columns like type, file_id, theme, goal, etc.
      # # Split them into groups
      # weights <- sol_meta$file_id[sol_meta$type == "weight"]
      # includes <- sol_meta$file_id[sol_meta$type == "include"]
      # excludes <- sol_meta$file_id[sol_meta$type == "exclude"]

      # themes <- sol_meta[sol_meta$type == "theme", ]
      # theme_ids <- themes$file_id
      # targets <- themes$goal

      # # Grab global metadata (assume first row carries title/desc/user_group)
      # sol_title <- sol_meta$title[1]
      # sol_desc <- sol_meta$description[1]
      # sol_group <- ifelse(!is.null(sol_meta$user_group[1]), sol_meta$user_group[1], "public")

      # qry_sol <- Query$new()
      # qry_sol$query("addSolution", add_solution_mutation)

      # solution_payload <- list(
      #   input = list(
      #     projectId = as.character(input$project_select),
      #     authorId = as.character(user_info()$id),
      #     title = sol_title,
      #     description = sol_desc,
      #     authorName = user_info()$username,
      #     authorEmail = user_info()$email,
      #     userGroup = sol_group,
      #     themeIds = as.list(theme_ids),
      #     targets = as.list(targets),
      #     weightIds = as.list(weights),
      #     includeIds = as.list(includes),
      #     excludeIds = as.list(excludes)
      #   )
      # )

      # tryCatch({
      #   client$exec(
      #     qry_sol$queries$addSolution,
      #     headers = list(Authorization = paste("Bearer", auth_token())),
      #     variables = solution_payload
      #   )
      #   showNotification("Solution uploaded successfully!", type = "message")

      #   # refresh
      #   updateSelectInput(session, "project_select", selected = input$project_select)

      # }, error = function(e) {
      #   showNotification(paste("Error uploading solution:", e$message), type = "error")
      # })
    })

  })
}



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




