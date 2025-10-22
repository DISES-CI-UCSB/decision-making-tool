#' Server function: project selection sidebar
#'
#' Handles project selection from the sidebar pane.
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_select_project)
#' ```
#'
#' @noRd
server_select_project <- quote({

  # Reactive value to store available projects
  sidebar_projects_data <- shiny::reactiveVal(data.frame())
  
  # Function to fetch projects
  fetch_sidebar_projects <- function() {
    if (!is.null(auth_token()) && auth_token() != "") {
      user_data <- user_info()
      
      if (!is.null(user_data)) {
        cat("*** SIDEBAR: Fetching projects for user type:", user_data$userGroup, "***\n")
        
        tryCatch({
          # Use the same logic as the import modal
          if (user_data$userGroup == "public") {
            # Public users see only public projects
            projects_query <- '
              query {
                public_projects {
                  id
                  title
                  description
                  user_group
                  owner {
                    id
                    username
                    type
                  }
                }
              }'
          } else if (user_data$userGroup == "manager") {
            # Managers see all projects
            projects_query <- '
              query {
                all_projects {
                  id
                  title
                  description
                  user_group
                  owner {
                    id
                    username
                    type
                  }
                }
              }'
          } else if (user_data$userGroup == "planner") {
            # Planners see public and planner-specific projects
            cat("*** USER IS PLANNER - Fetching planner_projects ***\n")
            projects_query <- '
              query {
                planner_projects {
                  id
                  title
                  description
                  user_group
                  owner {
                    id
                    username
                    type
                  }
                }
              }'
          } else {
            # Other users see only public projects
            projects_query <- '
              query {
                public_projects {
                  id
                  title
                  description
                  user_group
                  owner {
                    id
                    username
                    type
                  }
                }
              }'
          }
          
          # Create and execute query
          qry <- ghql::Query$new()
          qry$query('projects', projects_query)
          res <- client$exec(qry$queries$projects)
          
          cat("*** GraphQL query executed ***\n")
          res_list <- jsonlite::fromJSON(res)
          
          if (!is.null(res_list$errors)) {
            cat("*** SIDEBAR: GraphQL Error:", res_list$errors[[1]]$message, "***\n")
            return()
          }
          
          # Extract projects data based on user type
          if (user_data$userGroup == "public") {
            projects_df <- res_list$data$public_projects
          } else if (user_data$userGroup == "planner") {
            projects_df <- res_list$data$planner_projects
          } else if (user_data$userGroup == "manager") {
            projects_df <- res_list$data$all_projects
          } else {
            projects_df <- res_list$data$public_projects  # Fallback
          }
          
          if (!is.null(projects_df) && nrow(projects_df) > 0) {
            cat("*** SIDEBAR: Found", nrow(projects_df), "projects ***\n")
            sidebar_projects_data(projects_df)
            
            # Update dropdown choices
            choices <- setNames(projects_df$id, projects_df$title)
            shiny::updateSelectizeInput(
              session, 
              "selectProjectPane_dropdown", 
              choices = choices
            )
          } else {
            cat("*** SIDEBAR: No projects found ***\n")
            sidebar_projects_data(data.frame())
            shiny::updateSelectizeInput(
              session, 
              "selectProjectPane_dropdown", 
              choices = c()
            )
          }
          
        }, error = function(e) {
          cat("*** SIDEBAR: Error fetching projects:", e$message, "***\n")
        })
      }
    } else {
      # Not logged in - clear projects
      sidebar_projects_data(data.frame())
      shiny::updateSelectizeInput(
        session, 
        "selectProjectPane_dropdown", 
        choices = c()
      )
    }
  }
  
  # Fetch projects when auth token changes
  shiny::observe({
    fetch_sidebar_projects()
  })
  
  # Also refresh when the global projects_data changes (e.g., when admin adds new project)
  shiny::observe({
    projects_data() # This creates a dependency on the global projects_data reactive
    # Add a small delay to ensure the database has been updated
    shinyjs::delay(500, {
      cat("*** SIDEBAR: Refreshing projects due to global projects_data change ***\n")
      fetch_sidebar_projects()
    })
  })
  
  # Update description when project is selected
  shiny::observeEvent(input$selectProjectPane_dropdown, {
    if (!is.null(input$selectProjectPane_dropdown) && input$selectProjectPane_dropdown != "") {
      projects_df <- sidebar_projects_data()
      
      if (nrow(projects_df) > 0) {
        selected_project <- projects_df[projects_df$id == input$selectProjectPane_dropdown, ]
        
        if (nrow(selected_project) > 0) {
          # Update description
          description <- if (!is.null(selected_project$description) && selected_project$description != "") {
            selected_project$description
          } else {
            "No hay descripción disponible para este proyecto."
          }
          
          shinyjs::html("selectProjectPane_description_text", description)
          
          # Enable load button
          shinyjs::enable("selectProjectPane_load_btn")
        }
      }
    } else {
      # No project selected
      shinyjs::html("selectProjectPane_description_text", "Seleccione un proyecto para ver su descripción.")
      shinyjs::disable("selectProjectPane_load_btn")
    }
  })
  
  # Handle load project button
  shiny::observeEvent(input$selectProjectPane_load_btn, {
    if (!is.null(input$selectProjectPane_dropdown) && input$selectProjectPane_dropdown != "") {
      cat("*** SIDEBAR: Loading project ID:", input$selectProjectPane_dropdown, "***\n")
      
      projects_df <- sidebar_projects_data()
      selected_project <- projects_df[projects_df$id == input$selectProjectPane_dropdown, ]
      
      if (nrow(selected_project) > 0) {
        # Show loading notification
        shiny::showNotification(
          paste("Cargando proyecto:", selected_project$title), 
          type = "message",
          duration = 5
        )
        
        # Trigger project loading via reactive value
        # Use timestamp to ensure the reactive value changes even for the same project
        sidebar_project_to_load(paste0(input$selectProjectPane_dropdown, "_", Sys.time()))
        
        # Update current project display
        shinyjs::show("selectProjectPane_current_project")
        shinyjs::html("selectProjectPane_current_project_text", selected_project$title)
      }
    }
  })

})
