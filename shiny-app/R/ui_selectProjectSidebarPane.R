
selectProjectSidebarPane <- function(id) {

    # assert arguments are valid
    assertthat::assert_that(
        assertthat::is.string(id),
        assertthat::noNA(id)
    )

    # create sidebar widget
    ## create sidebar

    w <-
    leaflet.extras2::sidebar_pane(
      title = "Choose a project",
      id = id,
      icon = NULL,
      htmltools::tags$div(
        class = "sidebar-pane-content",
        htmltools::tags$script(paste0("
          $('a[href=\"#", id, "\"]').tooltip({
            container: 'body',
            trigger: 'hover',
            placement: 'right',
            title: 'Open sidebar for choosing a project to load'
          });
        ")),
        htmltools::tags$div(
          class = "sidebar-pane-inner",
          htmltools::tags$div(
            class = "generic-container",
            ## select columns
            shiny::selectizeInput(
                inputId = paste0(id, "_fields"),
                label = "Select project to load",
                choices = c(),
                multiple = TRUE,
                options = list(placeholder = "select project (required)"),
                width = "100%"
            ),
          )
        )
      )
    )

  # return result
  w

}