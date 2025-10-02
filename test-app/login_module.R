loginUI <- function(id) {
  ns <- NS(id)
  tagList(
    h3("Login"),
    textInput(ns("username"), "Username", value="manager_test"),
    passwordInput(ns("password"), "Password", value="password123"),
    actionButton(ns("login_btn"), "Login"),
    verbatimTextOutput(ns("login_status"))
  )
}

loginServer <- function(id, client, auth_token, user_info) {
  moduleServer(id, function(input, output, session) {
    ns <- session$ns

    login_mutation <- '
    mutation($username: String!, $password: String!) {
      userSignOn(username: $username, password: $password) {
        token
        user {
          id
          username
        }
      }
    }'

    output$login_status <- renderText("")

    observeEvent(input$login_btn, {
      # req(input$username, input$password)

      qry <- Query$new()
      qry$query("login", login_mutation)

      tryCatch({

        res <- client$exec(qry$queries$login, variables = list(
          username = input$username,
          password = input$password
        ))
        res_list <- jsonlite::fromJSON(res)

        if (!is.null(res_list$data$userSignOn$token)) {
          auth_token(res_list$data$userSignOn$token)
          user_info(res_list$data$userSignOn$user)
          output$login_status <- renderText(paste("Logged in as:", user_info()$username))
          showNotification("Login successful!", type = "message")
        } else {
          output$login_status <- renderText("Login failed: Invalid credentials")
          showNotification("Login failed", type = "error")
        }
      }, error = function(e) {
        output$login_status <- renderText(paste("Login error:", e$message))
        showNotification("Login error", type = "error")
      })
    })
  })
}
