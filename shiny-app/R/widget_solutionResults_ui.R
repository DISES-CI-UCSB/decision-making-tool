#' @include internal.R
#' @include ui_aoiSelection.R
NULL

#' Solution results
#'
#' Constructs a widget for displaying solution results.
#' This widget is designed to be used in conjunction with an existing
#' Leaflet Map within a Shiny web application.
#'
#' @param x `list` containing [Solution] objects.
#'   Defaults to an empty list object.
#'
#' @inheritParams solutionSettings
#'
#' @section Server value:
#' The widget does not send any server values.
#'
#' @rdname solutionResults-widget
#'
#' @examples
#' \dontrun{
#' # run Shiny app to demo the sidebar pane
#' if (interactive()) {
#'   runExample("solutionResults")
#' }
#' }
#'
#' @export
solutionResults <- function(x = list(), width = NULL, height = NULL,
                            elementId = NULL) {
  # assert arguments are valid
  assertthat::assert_that(is.list(x))
  if (length(x) > 0) {
    assertthat::assert_that(all_list_elements_inherit(x, "Solution"))
  }

  # prepare parameters
  if (length(x) > 0) {
    p <- list(
      api = list(),
      solutions = lapply(x, function(x) x$get_solution_results_widget_data())
    )
  } else {
    p <- list(api = list(), solutions = list())
  }

  # create widget
  htmlwidgets::createWidget(
    name = "solutionResults",
    p,
    width = width,
    height = height,
    package = "wheretowork",
    elementId = elementId,
    dependencies = c(
      htmltools::htmlDependencies(shiny::icon("map-marked-alt")),
      htmltools::htmlDependencies(shinyBS::bsCollapsePanel("id")),
      htmltools::htmlDependencies(shinyWidgets::pickerInput("id", "x", "y"))
    )
  )
}

#' Shiny bindings for `solutionResults`
#'
#' Use `solutionResultsOutput()` to create a user interface element,
#' and `renderSolutionResults()` to render the widget.
#'
#' @param outputId output variable to read from
#'
#' @param width,height Must be a valid CSS unit (like \code{"100\%"},
#'   \code{"400px"}, \code{"auto"}) or a number, which will be coerced to a
#'   string and have \code{"px"} appended.
#'
#' @param expr An expression that generates a [solutionResults()]
#'
#' @param env The environment in which to evaluate \code{expr}.
#'
#' @param quoted Is \code{expr} a quoted expression (with \code{quote()})? This
#'   is useful if you want to save an expression in a variable.
#'
#' @name solutionResults-shiny
#'
#' @export
solutionResultsOutput <- function(outputId, width = "100%", height = "auto") {
  htmlwidgets::shinyWidgetOutput(
    outputId, "solutionResults", width, height,
    package = "wheretowork"
  )
}

#' @rdname solutionResults-shiny
#' @export
renderSolutionResults <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) {
    expr <- substitute(expr)
  } # force quoted
  htmlwidgets::shinyRenderWidget(
    expr, solutionResultsOutput, env,
    quoted = TRUE
  )
}

# Add custom HTML for the widget (automatically used by htmlwidgets)
solutionResults_html <- function(id, style, class, ...) {
  # HTML scaffold
  x <-
    htmltools::tags$div(
      id = id, class = class, style = style,
      htmltools::div(
        class = "solution-results-container",
        
        # Load solution controls (always visible at top)
        htmltools::tags$div(
          style = "margin-bottom: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px;",
          htmltools::tags$h5("Cargar Solución", style = "margin-top: 0; margin-bottom: 12px; font-weight: 600;"),
          htmltools::tags$p("Selecciona una solución de la base de datos para cargarla en el mapa.", 
                           style = "font-size: 0.85em; color: #666; margin-bottom: 15px; line-height: 1.4;"),
          
          # Open solutions modal button
          htmltools::tags$div(
            style = "text-align: center;",
            shiny::actionButton(
              inputId = "open_solutions_modal",
              label = "Ver y Seleccionar Soluciones",
              icon = shiny::icon("table"),
              class = "btn btn-primary btn-block",
              style = "padding: 12px 20px; font-size: 16px; font-weight: 500;"
            )
          ),
          
          # Hidden simple inputs for JavaScript to populate (needed by load handler)
          htmltools::tags$div(
            style = "display: none;",
            shiny::textInput(
              inputId = "load_solution_list",
              label = NULL,
              value = ""
            ),
            shiny::textInput(
              inputId = "load_solution_color",
              label = NULL,
              value = "#228B22"
            ),
            shiny::actionButton(
              inputId = "load_solution_button",
              label = "Hidden Load"
            )
          )
        ),
        
        htmltools::div(
          class = "solution-results",
          # header
          htmltools::tags$div(
            class = "solution-results-header",
            style = "display: flex; flex-direction: column;",
            
            # View solution results section title
            htmltools::tags$div(
              style = "margin-bottom: 15px; padding-bottom: 15px; border-bottom: 2px solid #e0e0e0; display: block; width: 100%;",
              htmltools::tags$h5("Ver Resultados", style = "margin-top: 0; margin-bottom: 8px; font-weight: 600; font-size: 16px; display: block;"),
              htmltools::tags$p("Selecciona una solución cargada para ver sus estadísticas y análisis.", 
                               style = "font-size: 0.85em; color: #666; margin-bottom: 0; line-height: 1.4; display: block;")
            ),
            
            # Solution selector and button row
            htmltools::tags$div(
              style = "display: flex; gap: 10px; align-items: flex-end; width: 100%;",
              # Dropdown - basic selectInput (simplest approach)
              htmltools::tags$div(
                style = "flex: 1;",
                shiny::selectInput(
                  inputId = paste0(id, "_select"),
                  label = "Solución cargada:",
                  choices = c("Ninguna" = "NA"),
                  selected = "NA",
                  width = "100%"
                )
              ),
              # Table button (icon only, smaller)
              htmltools::tags$div(
                style = "flex: 0 0 auto; width: 40px;",
                `data-toggle` = "tooltip",
                `data-placement` = "top",
                title = "Ver resultados en tablas",
                htmltools::tags$label(style = "display: block; margin-bottom: 5px; color: transparent;", "."),
                shinyBS::bsButton(
                  inputId = paste0(id, "_button"),
                  label = "",
                  icon = shiny::icon("table"),
                  style = "primary",
                  type = "action",
                  size = "small"
                )
              )
            )
          ),
          # modals
          solutionResultsModal(
            id = paste0(id, "_modal"),
            trigger = paste0(id, "_button")
          ),
          
          # accordion panels
          htmltools::tags$div(
            class = "solution-results-main",
            shinyBS::bsCollapse(
              id = paste0(id, "_collapse"),
              multiple = FALSE,
              open = paste0(id, "_collapseStatisticPanel"),
              # Summary Panel
              shinyBS::bsCollapsePanel(
                title = htmltools::tags$span(
                  shinyBS::tipify(
                    el = htmltools::tags$span(
                      shiny::icon("chart-line"),
                      "Summary"
                    ),
                    title = paste(
                      "Summary of the solution. This panel shows the Settings",
                      "used to generate the solution, and statistics",
                      "that describe its spatial configuration."
                    ),
                    options = list(container = "body")
                  )
                ),
                value = paste0(id, "_collapseStatisticPanel"),
                htmltools::tags$div(
                  class = "panel-content-inner",
                  htmltools::tags$h4("Settings"),
                  htmltools::tags$div(class = "parameters"),
                  htmltools::tags$h4("Statistics"),
                  htmltools::tags$div(class = "statistics")
                )
              ),
              shinyBS::bsCollapsePanel(
                title = htmltools::tags$span(
                  shinyBS::tipify(
                    el = htmltools::tags$span(
                      shiny::icon("star", class = "fa-solid"),
                      "Themes"
                    ),
                    title = paste(
                      "Theme results for the solution.",
                      "This panel shows how well the Themes are covered",
                      "by the solution. It also shows how well the Themes are",
                      "covered by the Includes used to generate the solution,",
                      "and Theme goals used to generate the solution."
                    ),
                    options = list(container = "body")
                  )
                ),
                value = paste0(id, "_collapseThemePanel"),
                htmltools::tags$div(
                  htmltools::tags$div(
                    class = "panel-content-inner",
                    htmltools::tags$div(class = "themes")
                  ),
                  htmltools::tags$div(
                    class = "legend",
                    htmltools::tags$span(
                      class = "legend-item",
                      htmltools::tags$span(class = "legend-current-symbol"),
                      htmltools::tags$label(
                        class = "legend-current-label",
                        `data-toggle` = "tooltip",
                        `data-placement` = "top",
                        `data-container` = "body",
                        title = paste(
                          "Coverage by Includes used to generate solution"
                        ),
                        "Includes"
                      ),
                    ),
                    htmltools::tags$span(
                      class = "legend-item",
                      htmltools::tags$span(class = "legend-goal-symbol"),
                      htmltools::tags$label(
                        class = "legend-goal-label",
                        `data-toggle` = "tooltip",
                        `data-placement` = "top",
                        `data-container` = "body",
                        title = "Goal used to generate solution",
                        "Goal"
                      ),
                    ),
                    htmltools::tags$span(
                      class = "legend-item",
                      htmltools::tags$span(class = "legend-solution-symbol"),
                      htmltools::tags$label(
                        class = "legend-solution-label",
                        `data-toggle` = "tooltip",
                        `data-placement` = "top",
                        `data-container` = "body",
                        title = "Coverage by solution",
                        "Solution"
                      )
                    )
                  )
                )
              ),
              shinyBS::bsCollapsePanel(
                title = htmltools::tags$span(
                  shinyBS::tipify(
                    el = htmltools::tags$span(
                      shiny::icon("weight-hanging"),
                      "Weights"
                    ),
                    title = paste(
                      "Weight results for the solution.",
                      "This panel shows how much the Weights are covered",
                      "by the solution. It also shows how much the Weights are",
                      "covered by the Includes used to generate the solution,",
                      "and Weight factors used to generate the solution."
                    ),
                    options = list(container = "body")
                  )
                ),
                value = paste0(id, "_collapseWeightPanel"),
                htmltools::tags$div(
                  htmltools::tags$div(
                    class = "panel-content-inner",
                    htmltools::tags$div(class = "weights")
                  ),
                  htmltools::tags$div(
                    class = "legend",
                    htmltools::tags$span(
                      class = "legend-item",
                      htmltools::tags$span(class = "legend-current-symbol"),
                      htmltools::tags$label(
                        class = "legend-current-label",
                        `data-toggle` = "tooltip",
                        `data-placement` = "top",
                        `data-container` = "body",
                        title = paste(
                          "Coverage by Includes used to generate solution"
                        ),
                        "Includes"
                      ),
                    ),
                    htmltools::tags$span(
                      class = "legend-item",
                      htmltools::tags$span(class = "legend-solution-symbol"),
                      htmltools::tags$label(
                        class = "legend-solution-label",
                        `data-toggle` = "tooltip",
                        `data-placement` = "top",
                        `data-container` = "body",
                        title = "Coverage by solution",
                        "Solution"
                      )
                    )
                  )
                )
              ),
              shinyBS::bsCollapsePanel(
                title = htmltools::tags$span(
                  shinyBS::tipify(
                    el = htmltools::tags$span(
                      shiny::icon("lock"),
                      "Includes"
                    ),
                    title = paste(
                      "Includes results for the solution.",
                      "This panel shows how well the Includes are covered",
                      "by the solution."
                    ),
                    options = list(container = "body")
                  )
                ),
                value = paste0(id, "_collapseIncludePanel"),
                htmltools::tags$div(
                  htmltools::tags$div(
                    class = "panel-content-inner",
                    htmltools::tags$div(class = "includes")
                  ),
                  htmltools::tags$div(
                    class = "legend",
                    htmltools::tags$span(
                      class = "legend-item",
                      htmltools::tags$span(class = "legend-solution-symbol"),
                      htmltools::tags$label(
                        class = "legend-solution-label",
                        `data-toggle` = "tooltip",
                        `data-placement` = "top",
                        `data-container` = "body",
                        title = "Coverage by solution",
                        "Solution"
                      )
                    )
                  )
                )
              ),
              # AOI Selection Panel (moved to bottom)
              shinyBS::bsCollapsePanel(
                title = htmltools::tags$span(
                  shinyBS::tipify(
                    el = htmltools::tags$span(
                      shiny::icon("map-marked-alt"),
                      "Análisis de AOI"
                    ),
                    title = paste(
                      "Análisis de Área de Interés (AOI).",
                      "Dibuja o sube un polígono para analizar la cobertura de la solución",
                      "dentro de un área específica. Muestra estadísticas de cobertura de temas",
                      "y cálculos de área para la región seleccionada."
                    ),
                    options = list(container = "body")
                  )
                ),
                value = paste0(id, "_collapseAOIPanel"),
                htmltools::tags$div(
                  class = "panel-content-inner",
                  aoiSelectionUI(paste0(id, "_aoi"))
                )
              )
            )
          )
        )
      )
    )

  # add HTML template scaffolds for static content
  ## no weights specified
  x <-
    htmltools::tagAppendChild(
      x,
      htmltools::tags$template(
        class = "no-weights-template",
        htmltools::tags$div(
          class = paste("empty-result"),
          htmltools::tags$label(
            "No weights specified."
          )
        )
      )
    )
  ## no includes specified
  x <-
    htmltools::tagAppendChild(
      x,
      htmltools::tags$template(
        class = "no-includes-template",
        htmltools::tags$div(
          class = paste("empty-result"),
          htmltools::tags$label(
            "No includes specified."
          )
        )
      )
    )

  # return result
  x
}
