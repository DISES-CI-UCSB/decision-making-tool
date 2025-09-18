#' Admin Page Server
#'
#' Server logic for the admin page
#'
#' @param id `character` identifier.
#' @param client GraphQL client object.
#' @param auth_token Reactive value containing authentication token.
#' @param user_info Reactive value containing user information.
#'
#' @return Server logic for admin page.
#'
#' @export
server_adminPage <- quote({
  
  # Initialize projects data reactive value
  projects_data <- shiny::reactiveVal(data.frame())
  
  # Create a reactive trigger for refreshing projects
  refresh_trigger <- shiny::reactiveVal(0)
  
  # Admin page server logic
  shiny::moduleServer("adminPage", function(input, output, session) {
    
    # Handle back to map navigation
    shiny::observeEvent(input$back_to_map, {
      shiny::updateNavbarPage(session, "navbar", selected = "map_page")
    })
    
    # Handle refresh projects
    shiny::observeEvent(input$refresh_projects, {
      shiny::showNotification("Refreshing projects...", type = "message")
      # Trigger refresh by incrementing the reactive trigger
      refresh_trigger(refresh_trigger() + 1)
    })
    
    # Initialize project module server
    projectServer("project_module", client, auth_token, user_info, projects_data, refresh_trigger)
  })
  
})
