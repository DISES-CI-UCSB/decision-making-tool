#' Server function: admin management
#'
#' Set behavior for admin management functionality
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_admin_management)
#' ```
#'
#' @noRd
server_admin_management <- quote({

  # Initialize admin modal server
  adminModalServer("adminModal", client, auth_token, user_info)

  # Handle create project button from import modal
  observeEvent(input$importModal_create_project_btn, {
    shiny::showModal(adminModal(id = "adminModal"))
  })
})
