#' Sever function: import projects from database
#'
#' Set behavior for importing projects using database option
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_import_projects_database)
#' ```
#'
#' @noRd
#' 

server_import_projects_database <- quote({
  
  # GraphQL queries/mutations
  projects_query <- '
  query($userGroup: String, $userType: String) {
    projects(userGroup: $userGroup, userType: $userType) {
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

  # Fetch projects based on user type and access control
  fetch_projects <- function() {
    # Prepare variables for the query
    variables <- list()
    
    # Always pass userType for proper access control
    if (!is.null(user_info()) && !is.null(user_info()$type)) {
      variables$userType <- user_info()$type
      cat("*** Import: User Type:", user_info()$type, "***\n")
    } else {
      variables$userType <- "public"
      cat("*** Import: Defaulting to public user type ***\n")
    }
    
    # For backwards compatibility, also pass userGroup if available
    if (!is.null(user_info()) && !is.null(user_info()$userGroup)) {
      variables$userGroup <- user_info()$userGroup
      cat("*** Import: User Group:", user_info()$userGroup, "***\n")
    }
    
    qry <- ghql::Query$new()
    qry$query("projects", projects_query)
    tryCatch({
      res <- client$exec(qry$queries$projects, variables = variables)
      cat("Projects response:", res, "\n")
      res_list <- jsonlite::fromJSON(res)
      
      if (!is.null(res_list$data$projects)) {
        projects <- res_list$data$projects
        cat("Found", length(projects), "projects\n")
        app_data$projects_data <- as.data.frame(projects)
      } else {
        cat("No projects found\n")
        app_data$projects_data <- data.frame()
      }
    }, error = function(e) {
      cat("Error fetching projects:", e$message, "\n")
      showNotification("Failed to fetch projects", type = "error")
      app_data$projects_data <- data.frame()
    })
  }

  # Fetch projects when user info changes
  observeEvent(user_info(), { 
    if (!is.null(user_info())) {
      fetch_projects() 
    }
  })
  
})