#' Login users
#'
#' Authorizes user logins
#'
#' @details
#' This object is designed to be used within [app_server] function
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_login)
#' ```
#'
#' @return Invisible `TRUE`.
#'
#' @export

server_login <- quote({
  
  # set up error messages
  login_error <- reactiveVal("")
  
  # watch admin logged in
  values <- reactiveValues(adminLoggedIn = FALSE)
  
  
  ## setup graphql client
  client <- ghql::GraphqlClient$new(url = "http://localhost:3001/graphql")
  # watch for login fields
  
  ## if public access move on to importModal and set user_groups to "public"
  shiny::observeEvent(input$loginModal_public_btn, {
    user_type("public")
    shiny::removeModal()
    shiny::showModal(importModal(id = "importModal"))
  })
  
  shiny::observeEvent(input$loginModal_login_submit, {

    ## if admin choice, watch for submission
    req(input$loginModal_admin_username, input$loginModal_admin_password)

    ## write mutation for logging in
    mutation <- '
          mutation($username: String!, $password: String!) {
            userSignOn(username: $username, password: $password) {
              token
              user {
                username
              }
            }
          }
        '
    
    qry <- ghql::Query$new()
    qry$query("loginMutation", mutation)
    
    # execute login mutation
    result <- tryCatch({
      client$exec(
        qry$queries$loginMutation,
        variables = list(
          username = input$loginModal_admin_username,
          password = input$loginModal_admin_password
        )
      )
    }, error = function(e) {
      print(paste("GraphQL error:", e$message))
      showNotification("Error contacting server", type = "error")
      NULL
    })
    
    # if there was no error, read the result and store the token
    if (!is.null(result)) {
      parsed <- jsonlite::fromJSON(result)
      token <- parsed$data$userSignOn$token
      auth_token(token)
      if (is_authenticated()) {
        showNotification("Admin login successful", type = "message")
        
        values$adminLoggedIn <- TRUE
        
      } else {
        showNotification("Invalid credentials", type = "error")
        login_error("Invalid username or password.")
        
      }
    }
    
  })
  
  output$loginModal_admin_options_ui <- renderUI({
    req(values$adminLoggedIn)
    div(
      style = "display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 10px;",
      actionButton("loginModal_import_existing_btn", "Import Existing Project"),
      actionButton("loginModal_add_new_project_btn", "Add New Project")
    )
  })
  shiny::observeEvent(input$loginModal_import_existing_btn, {
    shiny::removeModal()
    shiny::showModal(importModal(id = "importModal"))
  })
  
  shiny::observeEvent(input$loginModal_add_new_project_btn, {
    shiny::removeModal()
    shiny::showModal(createProjectModal(id = "createProjectModal"))
  })
  
  output$loginModal_login_error_text <- renderText({
    login_error()
  })
  
  
})