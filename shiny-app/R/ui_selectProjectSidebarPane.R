
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
            htmltools::tags$h4("Seleccionar Proyecto", style = "margin-bottom: 15px;"),
            
            ## project dropdown
            shiny::selectizeInput(
                inputId = paste0(id, "_dropdown"),
                label = "Proyecto disponible:",
                choices = c(),
                multiple = FALSE,
                options = list(placeholder = "Seleccione un proyecto..."),
                width = "100%"
            ),
            
            ## project description
            htmltools::tags$div(
              id = paste0(id, "_description"),
              style = "margin-top: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 4px; border-left: 4px solid #3366CC;",
              htmltools::tags$h5("Descripción del Proyecto", style = "margin-top: 0; color: #3366CC;"),
              htmltools::tags$p(
                id = paste0(id, "_description_text"),
                "Seleccione un proyecto para ver su descripción.",
                style = "margin-bottom: 0; color: #666;"
              )
            ),
            
            ## load button
            htmltools::tags$div(
              style = "margin-top: 20px; text-align: center;",
              shiny::actionButton(
                paste0(id, "_load_btn"),
                "Cargar Proyecto",
                class = "btn btn-primary",
                style = "width: 100%; font-weight: 500;",
                disabled = TRUE
              )
            ),
            
            ## current project info
            htmltools::tags$div(
              id = paste0(id, "_current_project"),
              style = "margin-top: 20px; padding: 10px; background-color: #e8f5e8; border-radius: 4px; border-left: 4px solid #2E7D32; display: none;",
              htmltools::tags$h5("Proyecto Actual", style = "margin-top: 0; color: #2E7D32;"),
              htmltools::tags$p(
                id = paste0(id, "_current_project_text"),
                "",
                style = "margin-bottom: 0; color: #2E7D32; font-weight: 500;"
              )
            )
          )
        )
      )
    )

  # return result
  w

}