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
        
        # Predefined AOI Selection
        htmltools::tags$div(
          class = "predefined-aoi-section",
          style = "margin-bottom: 8px;",
          htmltools::tags$div(
            style = "display: flex; align-items: center; gap: 8px; margin-bottom: 5px;",
            htmltools::tags$label(
              "Seleccionar AOI Predefinido:",
              style = "font-size: 12px; font-weight: bold; color: #2c3e50; margin: 0;"
            ),
            htmltools::tags$div(
              id = ns("shapefile_loading_indicator"),
              style = "display: none;",
              htmltools::tags$div(
                class = "spinner-border spinner-border-sm text-primary",
                role = "status",
                style = "width: 1rem; height: 1rem;",
                htmltools::tags$span(class = "sr-only", "Cargando...")
              )
            )
          ),
          htmltools::tags$div(
            style = "display: flex; gap: 5px; margin-bottom: 5px;",
            shiny::selectInput(
              inputId = ns("predefined_aoi_type"),
              label = NULL,
              choices = c(
                "Elegir..." = "",
                "Departamentos" = "colombia_departments_2023",
                "SIRAPs" = "colombia_regions"
              ),
              selected = "",
              width = "50%"
            ),
            shiny::selectInput(
              inputId = ns("predefined_aoi_feature"),
              label = NULL,
              choices = c("Seleccionar..." = ""),
              selected = "",
              width = "50%"
            )
          ),
          # Button to apply selected AOI
          shiny::actionButton(
            inputId = ns("apply_predefined_aoi_btn"),
            label = "Analizar AOI Seleccionado",
            icon = shiny::icon("search"),
            class = "btn btn-primary btn-sm",
            style = "width: 100%; font-size: 11px;",
            disabled = TRUE
          )
        ),
        
        # Divider
        htmltools::tags$hr(style = "margin: 8px 0; border-top: 1px solid #ccc;"),
        
        # Drawing Mode Buttons
        htmltools::tags$label(
          "O Dibujar en el Mapa:",
          style = "font-size: 12px; font-weight: bold; color: #2c3e50; margin-bottom: 5px; display: block;"
        ),
        htmltools::tags$div(
          style = "display: flex; gap: 5px;",
          shiny::actionButton(
            inputId = ns("start_draw_polygon_btn"),
            label = "Dibujar Polígono",
            icon = shiny::icon("draw-polygon"),
            class = "btn btn-success btn-sm",
            style = "flex: 1; font-size: 11px;"
          )
          # Rectangle and Circle drawing temporarily disabled
          # ,
          # shiny::actionButton(
          #   inputId = ns("start_draw_rectangle_btn"),
          #   label = "Dibujar Rectángulo",
          #   icon = shiny::icon("square"),
          #   class = "btn btn-success btn-sm",
          #   style = "flex: 1; font-size: 11px;"
          # ),
          # shiny::actionButton(
          #   inputId = ns("start_draw_circle_btn"),
          #   label = "Dibujar Círculo",
          #   icon = shiny::icon("circle"),
          #   class = "btn btn-success btn-sm",
          #   style = "flex: 1; font-size: 11px;"
          # )
        ),
        
        # Action Buttons
        htmltools::tags$div(
          style = "display: flex; gap: 5px;",
          shiny::actionButton(
            inputId = ns("use_drawn_shape_btn"),
            label = "Usar Forma Dibujada",
            icon = shiny::icon("check"),
            class = "btn btn-primary btn-sm",
            style = "flex: 1; font-size: 11px;",
            disabled = TRUE
          ),
          shiny::actionButton(
            inputId = ns("upload_aoi_btn"),
            label = "Subir Shapefile",
            icon = shiny::icon("upload"),
            class = "btn btn-info btn-sm",
            style = "flex: 1; font-size: 11px;"
          ),
          shiny::actionButton(
            inputId = ns("clear_aoi_btn"),
            label = "Limpiar AOI",
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
          "Haga clic en un botón de dibujo arriba para comenzar a dibujar en el mapa, luego haga clic en 'Usar Forma Dibujada'"
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
        htmltools::tags$h5("Estadísticas del AOI", style = "color: #2c3e50; margin-bottom: 10px;"),
        htmltools::tags$div(
          class = "stats-content",
          htmltools::tags$p(
            style = "margin: 5px 0;",
            htmltools::tags$strong("Área del AOI: "),
            htmltools::tags$span(id = ns("aoi_area_text"), "N/A")
          ),
          htmltools::tags$p(
            style = "margin: 5px 0;",
            htmltools::tags$strong("Cobertura de la Solución: "),
            htmltools::tags$span(id = ns("aoi_solution_coverage_text"), "N/A")
          )
        )
      ),
      
      # AOI Charts
      htmltools::tags$div(
        class = "aoi-charts",
        style = "margin-top: 15px;",
        htmltools::tags$h5("Análisis de Temas", style = "color: #2c3e50; margin-bottom: 10px;"),
        htmltools::tags$div(
          id = ns("aoi_loading"),
          style = "display: none; text-align: center; padding: 20px;",
          htmltools::tags$div(
            class = "spinner-border text-primary",
            role = "status",
            style = "width: 2rem; height: 2rem;",
            htmltools::tags$span(class = "sr-only", "Cargando...")
          ),
          htmltools::tags$p("Analizando temas...", style = "margin-top: 10px; color: #7f8c8d;")
        ),
        shiny::uiOutput(ns("aoi_theme_overlap_chart"))
      )
    )
  )
}
