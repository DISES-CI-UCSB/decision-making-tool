#' The application User-Interface
#'
#' @param request Internal parameter for `{shiny}`.
#'     DO NOT REMOVE.
#' @noRd
app_ui <- function(request) {
  htmltools::tagList(
    # add external resources
    golem_add_external_resources(),

    ## suppress dependencies that fail to import correctly
    htmltools::suppressDependencies("shinyBS"),
    htmltools::suppressDependencies("bootstrap-select"),

    ## manually insert code dependencies so they import correctly
    htmltools::tags$head(
      ### unblock mixed content
      htmltools::tags$meta(
        "http-equiv"="Content-Security-Policy", "content"="upgrade-insecure-requests"),
      ### shinyBS just doesn't work inside Docker containers
      htmltools::tags$script(src = "www/shinyBS-copy.js"),
      ### shinyWidgets has invalid SourceMap configuration
      htmltools::tags$script(src = "www/bootstrap-select-copy.min.js"),
      htmltools::tags$link(
        rel = "stylesheet",
        type = "text/css",
        href = "www/bootstrap-select-copy.min.css"
      ),
      # add Work Sans font from Google Fonts
      htmltools::tags$link(
        rel = "stylesheet",
        type = "text/css",
        href = "https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap"
      ),
      # Colombia navbar styles
      htmltools::tags$link(
        rel = "stylesheet",
        type = "text/css",
        href = "www/styles.css"
      ),
      # Sidebar styles
      htmltools::tags$link(
        rel = "stylesheet",
        type = "text/css",
        href = "www/sidebar.css"
      ),
    ),

    ## start up screen
    shinybusy::busy_start_up(
      loader = shinybusy::spin_epic("scaling-squares", color = "#FFF"),
      text = "Loading...",
      mode = "auto",
      color = "#FFF",
      background = "#001329"
    ),

    # Colombia navbar with integrated branding
    shiny::navbarPage(
      title = htmltools::div(
        style = "display: flex; align-items: center; height: 70px; width: 100%;",
        htmltools::img(
          src = "www/colombia/logo_pnn.webp", 
          style = "height: 50px; margin-right: 15px;"
        ),
        htmltools::span(
          "Priorizando la Naturaleza - Colombia",
          style = "color: white; font-weight: bold; font-size: 18px; flex: 1;"
        ),
        htmltools::img(
          src = "www/colombia/logo_gov.svg", 
          style = "height: 30px; margin-left: 15px;"
        )
      ),
      windowTitle = "Priorizando la Naturaleza - Colombia",
      id = "navbar",

      # Main Map Page
      shiny::tabPanel(
        title = "Map",
        value = "map_page",
        
        shiny::fillPage(

          ## leaflet map
          leaflet::leafletOutput("map", width = "100%", height = "100%"),

          ## help modal
          helpModal("helpModal", trigger = "help_button"),
          
          ## hidden import modal elements (for server logic compatibility)
          htmltools::div(
            style = "display: none;",
            shiny::selectInput("importModal_name", "Project", choices = c()),
            shiny::actionButton("importModal_builtin_button", "Import")
          ),

          ## data sidebar (appears on left)
          leaflet.extras2::sidebar_tabs(
            id = "dataSidebar",
            iconList = list(
              shiny::icon("folder-open"),
              shiny::icon("layer-group"),
              shiny::icon("download"),
              shiny::icon("envelope"),
              shiny::icon("heart")
            ),

            selectProjectSidebarPane(id = "selectProjectPane"),
            mapManagerSidebarPane(id = "mapManagerPane"),
            exportSidebarPane(id = "exportPane"),
            contactSidebarPane(id = "contactPane"),
            acknowledgmentsSidebarPane(id = "acknowledgmentsPane")
          ),

          ## analysis sidebar (appears on right)
          leaflet.extras2::sidebar_tabs(
            id = "analysisSidebar",
            iconList = list(
              shiny::icon("tachometer-alt")
            ),
            # newSolutionSidebarPane(id = "newSolutionPane"),  # HIDDEN - users shouldn't run prioritizations
            solutionResultsSidebarPane(id = "solutionResultsPane")
          )
        )
      ),

      # User menu dropdown
      shiny::navbarMenu(
        title = "Usuario",
        icon = shiny::icon("user"),
        
        # Login option (shown when not logged in)
        shiny::tabPanel(
          title = "Iniciar sesión",
          value = "login_page",
          htmltools::div(
            style = "padding: 20px; text-align: center;",
            htmltools::h3("Iniciar sesión"),
            htmltools::p("Haga clic en el botón para iniciar sesión"),
            shiny::actionButton("menu_login_btn", "Iniciar sesión", class = "btn btn-primary")
          )
        ),
        
        # Divider
        "----",
        
        # Admin page (will be conditionally shown)
        shiny::tabPanel(
          title = "Administración",
          value = "admin_page",
          adminPageUI("adminPage")
        ),
        
        # Logout option (will be conditionally shown)
        shiny::tabPanel(
          title = "Cerrar sesión",
          value = "logout_page",
          htmltools::div(
            style = "padding: 20px; text-align: center;",
            htmltools::h3("Cerrar sesión"),
            htmltools::p("¿Está seguro de que desea cerrar sesión?"),
            shiny::actionButton("menu_logout_btn", "Cerrar sesión", class = "btn btn-warning")
          )
        )
      )
    )
  )
}

#' Add external Resources to the Application
#'
#' This function is internally used to add external
#' resources inside the Shiny application.
#'
#' @details
#' This function can also add Google Analytics tracking to the web application.
#' To achieve this, you need to specify the Google Analytics Identifier using
#' the `GOOGLE_ANALYTICS_ID` environmental variable.
#'
#' @importFrom golem add_resource_path activate_js favicon bundle_resources
#' @noRd
golem_add_external_resources <- function() {
  # add resources
  golem::add_resource_path(
    "www", app_sys("app/www")
  )

  # define HTML tags in header
  htmltools::tags$head(
    ## bundle CSS and JS files
    golem::bundle_resources(
      path = app_sys("app/www"),
      app_title = "Priorizando la Naturaleza - Colombia"
    ),

    ## dependencies
    shinyFeedback::useShinyFeedback(),
    shinyjs::useShinyjs(),
  )
}
