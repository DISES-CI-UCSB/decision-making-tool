#' Admin Management Modal UI
#'
#' Creates the admin management modal UI for managers
#'
#' @param id `character` identifier for the modal
#'
#' @return A `shiny.tag` object containing the admin modal UI
#'
#' @export
adminModal <- function(id) {
  assertthat::assert_that(
    assertthat::is.string(id),
    assertthat::noNA(id)
  )
  
  shiny::modalDialog(
    title = tags$p(
      "Project Management",
      style = "text-align:center; font-weight: bold; font-size: 20px;"
    ),
    easyClose = FALSE,
    fade = TRUE,
    
    # Main content - exactly like login modal structure
    tags$p(
      "Manage your projects and data layers",
      style = "text-align: center; font-weight: bold; margin-top: 10px;"
    ),
    
    # Main buttons (always visible)
    div(
      style = "display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 10px;",
      actionButton(paste0(id, "_create_project_btn"), "Create New Project", class = "btn btn-primary"),
      actionButton(paste0(id, "_refresh_btn"), "Refresh Projects", class = "btn btn-secondary")
    ),
    
    # Dynamic UI area - will show form when needed
    uiOutput(paste0(id, "_dynamic_content")),
    
    # Projects list (always visible)
    tags$div(
      id = paste0(id, "_projects_list"),
      style = "margin-top: 20px; padding: 10px; border: 1px solid #ddd; border-radius: 5px;",
      tags$h5("Current Projects:"),
      textOutput(paste0(id, "_projects_text"))
    ),
    
    footer = tagList(
      actionButton(paste0(id, "_back_to_import_btn"), "← Back to Import", 
                  class = "btn btn-secondary", icon = icon("arrow-left")),
      modalButton("Close")
    )
  )
}
