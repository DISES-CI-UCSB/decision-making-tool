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
  
  bslib::page_fillable(
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
      
      # Project management section
      htmltools::tags$div(
        class = "row",
        htmltools::tags$div(
          class = "col-12",
          bslib::card(
            bslib::card_header("Project Management"),
            bslib::card_body(
              projectUI(ns("project_module"))
            )
          )
        )
      )
    )
  )
}
