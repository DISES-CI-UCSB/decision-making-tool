#' AOI Selection UI
#'
#' Creates the Area of Interest (AOI) selection interface
#'
#' @param id `character` identifier.
#'
#' @return A `shiny.tag` object.
#'
#' @export
aoiSelectionUI <- function(id) {
  ns <- shiny::NS(id)
  
  htmltools::tags$div(
    class = "aoi-selection-panel",
    style = "margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; background-color: #f9f9f9;",
    
    # AOI Selection Header
    htmltools::tags$div(
      class = "aoi-header",
      htmltools::tags$h4(
        shiny::icon("map-marked-alt"),
        "Area of Interest (AOI) Analysis",
        style = "margin-bottom: 10px; color: #2c3e50;"
      ),
      
      # AOI Selection Buttons
      htmltools::tags$div(
        class = "aoi-buttons",
        style = "display: flex; flex-direction: column; gap: 8px; margin-bottom: 15px;",
        
        # Drawing Mode Buttons
        htmltools::tags$div(
          style = "display: flex; gap: 5px;",
          shiny::actionButton(
            inputId = ns("start_draw_polygon_btn"),
            label = "Draw Polygon",
            icon = shiny::icon("draw-polygon"),
            class = "btn btn-success btn-sm",
            style = "flex: 1; font-size: 11px;"
          ),
          shiny::actionButton(
            inputId = ns("start_draw_rectangle_btn"),
            label = "Draw Rectangle",
            icon = shiny::icon("square"),
            class = "btn btn-success btn-sm",
            style = "flex: 1; font-size: 11px;"
          ),
          shiny::actionButton(
            inputId = ns("start_draw_circle_btn"),
            label = "Draw Circle",
            icon = shiny::icon("circle"),
            class = "btn btn-success btn-sm",
            style = "flex: 1; font-size: 11px;"
          )
        ),
        
        # Action Buttons
        htmltools::tags$div(
          style = "display: flex; gap: 5px;",
          shiny::actionButton(
            inputId = ns("use_drawn_shape_btn"),
            label = "Use Drawn Shape",
            icon = shiny::icon("check"),
            class = "btn btn-primary btn-sm",
            style = "flex: 1; font-size: 11px;",
            disabled = TRUE
          ),
          shiny::actionButton(
            inputId = ns("upload_aoi_btn"),
            label = "Upload Shapefile",
            icon = shiny::icon("upload"),
            class = "btn btn-info btn-sm",
            style = "flex: 1; font-size: 11px;"
          ),
          shiny::actionButton(
            inputId = ns("clear_aoi_btn"),
            label = "Clear",
            icon = shiny::icon("trash"),
            class = "btn btn-warning btn-sm",
            style = "flex: 0 0 auto; font-size: 11px;"
          )
        )
      ),
      
      # AOI Status Display
      htmltools::tags$div(
        id = ns("aoi_status"),
        class = "aoi-status",
        style = "margin-bottom: 10px; padding: 8px; background-color: #e9ecef; border-radius: 3px; font-size: 12px;",
        htmltools::tags$span(
          id = ns("aoi_status_text"),
          "Click a drawing button above to start drawing on the map, then click 'Use Drawn Shape'"
        )
      )
    ),
    
    # AOI Analysis Panel (initially hidden)
    htmltools::tags$div(
      id = ns("aoi_analysis_panel"),
      class = "aoi-analysis-panel",
      style = "display: none;",
      
      # AOI Statistics
      htmltools::tags$div(
        class = "aoi-statistics",
        style = "background-color: #f8f9fa; padding: 10px; border-radius: 5px; margin-bottom: 15px;",
        htmltools::tags$h5("AOI Statistics", style = "color: #2c3e50; margin-bottom: 10px;"),
        htmltools::tags$div(
          class = "stats-content",
          htmltools::tags$p(
            style = "margin: 5px 0;",
            htmltools::tags$strong("AOI Area: "),
            htmltools::tags$span(id = ns("aoi_area_text"), "N/A")
          ),
          htmltools::tags$p(
            style = "margin: 5px 0;",
            htmltools::tags$strong("Solution Coverage: "),
            htmltools::tags$span(id = ns("aoi_solution_coverage_text"), "N/A")
          )
        )
      ),
      
      # AOI Charts
      htmltools::tags$div(
        class = "aoi-charts",
        style = "margin-top: 15px;",
        htmltools::tags$h5("Theme Analysis", style = "color: #2c3e50; margin-bottom: 10px;"),
        htmltools::tags$div(
          id = ns("aoi_loading"),
          style = "display: none; text-align: center; padding: 20px;",
          htmltools::tags$div(
            class = "spinner-border text-primary",
            role = "status",
            style = "width: 2rem; height: 2rem;",
            htmltools::tags$span(class = "sr-only", "Loading...")
          ),
          htmltools::tags$p("Analyzing themes...", style = "margin-top: 10px; color: #7f8c8d;")
        ),
        shiny::uiOutput(ns("aoi_theme_overlap_chart"))
      )
    )
  )
}
