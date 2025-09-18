#' Server function: login logic
#'
#' Handles user authentication and modal transitions.
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_login)
#' ```
#'
#' @noRd
server_login <- quote({

  ## public access button
  shiny::observeEvent(input$loginModal_public_btn, {
    cat("*** PUBLIC ACCESS BUTTON CLICKED ***\n")
    # Set user as public user
    user_info(list(id = "public", username = "public", userGroup = "public"))
    cat("*** SETTING AUTH TOKEN TO public_token ***\n")
    auth_token("public_token")
    cat("*** AUTH TOKEN SET - VALUE IS:", auth_token(), "***\n")

  })

  ## admin login button
  shiny::observeEvent(input$loginModal_login_submit, {
    req(input$loginModal_admin_username, input$loginModal_admin_password)
    
    # Attempt to connect to GraphQL server
    cat("Attempting to connect to GraphQL server...\n")
    cat("Username:", input$loginModal_admin_username, "\n")
    
    tryCatch({
      # Define login mutation
      login_mutation <- '
        mutation userSignOn($username: String!, $password: String!) {
          userSignOn(username: $username, password: $password) {
            token
            user {
              id
              username
              type
            }
          }
        }
      '
      
      # Create query
      qry <- ghql::Query$new()
      qry$query('login', login_mutation)
      
      # Execute query
      res <- client$exec(qry$queries$login, 
                        variables = list(
                          username = input$loginModal_admin_username,
                          password = input$loginModal_admin_password
                        ))
      
      cat("GraphQL response received\n")
      
      # Parse response
      res_list <- jsonlite::fromJSON(res)
      cat("Response parsed successfully\n")
      
      # Check for errors
      if (!is.null(res_list$errors)) {
        error_msg <- paste("GraphQL Error:", res_list$errors[[1]]$message)
        cat("GraphQL Error:", error_msg, "\n")
        shiny::showNotification(error_msg, type = "error")
        return()
      }
      
      # Check if login was successful
      if (!is.null(res_list$data$userSignOn)) {
        # Store authentication token and user info
        auth_token(res_list$data$userSignOn$token)
        
        # Map 'type' to 'userGroup' for consistency
        user_data <- res_list$data$userSignOn$user
        user_data$userGroup <- user_data$type
        user_info(user_data)
        
        # Auth token will trigger modal transition in server_initialize_app.R
        cat("Login successful - auth token set\n")
        
        shiny::showNotification("¡Inicio de sesión exitoso!", type = "message")
      } else {
        error_msg <- "Error: Credenciales inválidas"
        cat("Login failed:", error_msg, "\n")
        shiny::showNotification(error_msg, type = "error")
      }
      
    }, error = function(e) {
      error_msg <- paste("Error de conexión:", e$message)
      cat("Connection error:", error_msg, "\n")
      shiny::showNotification(error_msg, type = "error")
    })
  })

})
