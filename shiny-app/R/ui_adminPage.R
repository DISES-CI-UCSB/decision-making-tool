#' Admin Page UI
#'
#' Creates the admin page interface for managing projects
#'
#' @param id `character` identifier.
#'
#' @return A `shiny.tag` object.
#'
#' @export
adminPageUI <- function(id) {
  # assert arguments are valid
  assertthat::assert_that(
    assertthat::is.string(id),
    assertthat::noNA(id)
  )
  
  ns <- shiny::NS(id)
  
  htmltools::tags$div(
    class = "admin-page-container",
    style = "padding: 20px;",
    
    htmltools::tags$h2("Project Administration", class = "text-center mb-4"),
    
    # Navigation buttons
    htmltools::tags$div(
      class = "d-flex justify-content-between mb-3",
      shiny::actionButton(
        inputId = ns("back_to_map"),
        label = "Back to Map",
        class = "btn btn-secondary",
        icon = shiny::icon("arrow-left")
      ),
      shiny::actionButton(
        inputId = ns("refresh_projects"),
        label = "Refresh Projects",
        class = "btn btn-info",
        icon = shiny::icon("refresh")
      )
    ),
    
    # Management sections using Bootstrap panels instead of bslib cards
    htmltools::tags$div(
      class = "row",
      htmltools::tags$div(
        class = "col-md-6",
        htmltools::tags$div(
          class = "panel panel-default",
          htmltools::tags$div(
            class = "panel-heading",
            htmltools::tags$h4("Project Management", class = "panel-title")
          ),
          htmltools::tags$div(
            class = "panel-body",
            projectUI(ns("project_module"))
          )
        )
      ),
      htmltools::tags$div(
        class = "col-md-6",
        htmltools::tags$div(
          class = "panel panel-default",
          htmltools::tags$div(
            class = "panel-heading",
            htmltools::tags$h4("Solution Management", class = "panel-title")
          ),
          htmltools::tags$div(
            class = "panel-body",
            solutionUI(ns("solution_module"))
          )
        )
      )
    )
  )
}
