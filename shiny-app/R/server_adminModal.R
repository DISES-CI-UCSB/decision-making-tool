#' Admin Management Modal Server
#'
#' Handles the admin management modal server logic
#'
#' @param id `character` identifier for the module
#' @param client `GraphqlClient` object for GraphQL communication
#' @param auth_token `reactiveVal` to store authentication token
#' @param user_info `reactiveVal` to store user information
#'
#' @export
adminModalServer <- function(id, client, auth_token, user_info) {
  moduleServer(id, function(input, output, session) {
    ns <- session$ns

    # Reactive values for admin data
    admin_projects <- reactiveVal(data.frame())
    admin_solutions <- reactiveVal(data.frame())
    admin_users <- reactiveVal(data.frame())

    # GraphQL queries
    projects_query <- '
    query($userGroup: String) {
      projects(userGroup: $userGroup) {
        id
        title
        description
        userGroup
        owner {
          id
          username
          type
        }
      }
    }'

    solutions_query <- '
    query {
      solutions {
        id
        title
        description
        author {
          id
          username
        }
        project {
          id
          title
        }
        user_group
      }
    }'

    users_query <- '
    query {
      users {
        id
        username
        type
      }
    }'

    # Fetch admin data
    fetch_admin_data <- function() {
      # Fetch projects
      tryCatch({
        qry <- ghql::Query$new()
        qry$query("projects", projects_query)
        res <- client$exec(qry$queries$projects, variables = list(userGroup = NULL))
        res_list <- jsonlite::fromJSON(res)
        if (!is.null(res_list$data$projects)) {
          admin_projects(as.data.frame(res_list$data$projects))
        }
      }, error = function(e) {
        cat("Error fetching projects:", e$message, "\n")
      })

      # Fetch solutions
      tryCatch({
        qry <- ghql::Query$new()
        qry$query("solutions", solutions_query)
        res <- client$exec(qry$queries$solutions)
        res_list <- jsonlite::fromJSON(res)
        if (!is.null(res_list$data$solutions)) {
          admin_solutions(as.data.frame(res_list$data$solutions))
        }
      }, error = function(e) {
        cat("Error fetching solutions:", e$message, "\n")
      })

      # Fetch users
      tryCatch({
        qry <- ghql::Query$new()
        qry$query("users", users_query)
        res <- client$exec(qry$queries$users)
        res_list <- jsonlite::fromJSON(res)
        if (!is.null(res_list$data$users)) {
          admin_users(as.data.frame(res_list$data$users))
        }
      }, error = function(e) {
        cat("Error fetching users:", e$message, "\n")
      })
    }

    # Fetch data when modal opens
    observeEvent(input$adminModal_tabs, {
      fetch_admin_data()
    }, once = TRUE)


    # Projects table
    output$adminModal_projects_table <- DT::renderDataTable({
      df <- admin_projects()
      if (nrow(df) == 0) {
        return(data.frame(Message = "No projects found"))
      }
      
      DT::datatable(
        df[, c("id", "title", "description", "userGroup")],
        colnames = c("ID", "Title", "Description", "User Group"),
        options = list(
          pageLength = 10,
          scrollY = "350px",
          scrollCollapse = TRUE,
          dom = 'Bfrtip',
          buttons = c('copy', 'csv', 'excel', 'pdf', 'print')
        ),
        extensions = 'Buttons',
        selection = 'single'
      )
    })

    # Solutions table
    output$adminModal_solutions_table <- DT::renderDataTable({
      df <- admin_solutions()
      if (nrow(df) == 0) {
        return(data.frame(Message = "No solutions found"))
      }
      
      DT::datatable(
        df[, c("id", "title", "description", "user_group")],
        colnames = c("ID", "Title", "Description", "User Group"),
        options = list(
          pageLength = 10,
          scrollY = "350px",
          scrollCollapse = TRUE,
          dom = 'Bfrtip',
          buttons = c('copy', 'csv', 'excel', 'pdf', 'print')
        ),
        extensions = 'Buttons',
        selection = 'single'
      )
    })

    # Users table
    output$adminModal_users_table <- DT::renderDataTable({
      df <- admin_users()
      if (nrow(df) == 0) {
        return(data.frame(Message = "No users found"))
      }
      
      DT::datatable(
        df[, c("id", "username", "type")],
        colnames = c("ID", "Username", "Type"),
        options = list(
          pageLength = 10,
          scrollY = "350px",
          scrollCollapse = TRUE,
          dom = 'Bfrtip',
          buttons = c('copy', 'csv', 'excel', 'pdf', 'print')
        ),
        extensions = 'Buttons',
        selection = 'single'
      )
    })

    # Projects text output (simple version for testing)
    output[[paste0(id, "_projects_text")]] <- renderText({
      df <- admin_projects()
      if (nrow(df) == 0) {
        "No projects found. Click 'Create New Project' to add one."
      } else {
        paste0("Found ", nrow(df), " projects: ", 
               paste(df$title, collapse = ", "))
      }
    })

    # Reactive value to track current view
    current_view <- reactiveVal("main")  # "main" or "form"
    
    # Dynamic UI content - only shows form when needed
    output[[paste0(id, "_dynamic_content")]] <- renderUI({
      if (current_view() == "form") {
        # Project creation form
        div(
          style = "margin-top: 20px; padding: 20px; border: 2px solid #007bff; border-radius: 10px; background-color: #f8f9fa;",
          
          tags$h4("Create New Project", style = "text-align: center; color: #007bff; margin-bottom: 15px;"),
          
          textInput(ns("new_project_title"), "Project Title", 
                   placeholder = "Enter a descriptive title"),
          
          textAreaInput(ns("new_project_description"), "Description", 
                       placeholder = "Optional project description",
                       rows = 3),
          
          selectInput(ns("new_project_user_group"), "User Group", 
                     choices = c("Public Access" = "public", 
                                "Planner Access" = "planner", 
                                "Manager Access" = "manager"),
                     selected = "public"),
          
          # Form buttons
          div(
            style = "text-align: center; margin-top: 15px;",
            actionButton(ns("cancel_form_btn"), "Cancel", 
                        class = "btn btn-secondary", style = "margin-right: 10px;"),
            actionButton(ns("save_project_btn"), "Create Project", 
                        class = "btn btn-primary", icon = icon("plus"))
          )
        )
      } else {
        # Empty div when in main view
        div()
      }
    })

    # Create project button - switch to form view
    observeEvent(input[[paste0(id, "_create_project_btn")]], {
      current_view("form")
    })
    
    # Cancel form button - switch back to main view
    observeEvent(input$cancel_form_btn, {
      current_view("main")
    })
    
    # Refresh button
    observeEvent(input[[paste0(id, "_refresh_btn")]], {
      fetch_admin_projects()
      showNotification("Projects refreshed!", type = "message")
    })

    # Save project
    observeEvent(input$save_project_btn, {
      req(input$new_project_title)
      
      # GraphQL mutation for creating project
      create_project_mutation <- '
      mutation($input: ProjectInput!) {
        addProject(input: $input) {
          id
          title
          description
          userGroup
        }
      }'
      
      tryCatch({
        qry <- ghql::Query$new()
        qry$query("addProject", create_project_mutation)
        
        payload <- list(
          input = list(
            title = input$new_project_title,
            description = if(is.null(input$new_project_description) || input$new_project_description == "") "No description" else input$new_project_description,
            userGroup = input$new_project_user_group
          )
        )
        
        res <- client$exec(
          qry$queries$addProject,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = payload
        )
        
        res_list <- jsonlite::fromJSON(res)
        
        if (!is.null(res_list$errors)) {
          showNotification(paste("Error creating project:", res_list$errors[[1]]$message), type = "error")
        } else {
          showNotification("Project created successfully!", type = "message")
          # Refresh projects table
          fetch_admin_projects()
          
          # Switch back to main view
          current_view("main")
        }
        
      }, error = function(e) {
        showNotification(paste("Error creating project:", e$message), type = "error")
      })
    })


    # Back to import button (from admin modal)
    observeEvent(input[[paste0(id, "_back_to_import_btn")]], {
      removeModal()  # Close admin modal
      # Show import modal again
      showModal(importModal(id = "importModal"))
    })

  })
}
