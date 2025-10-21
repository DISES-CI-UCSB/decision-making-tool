#' The application server-side
#'
#' @param input,output,session Internal parameters for {shiny}.
#'     DO NOT REMOVE.
#' @noRd
app_server <- function(input, output, session) {

  # initialization
  ## SESSION-SPECIFIC reactive values (critical for security and proper isolation!)
  ## Each user session gets its own isolated copies of these reactive values
  auth_token <- shiny::reactiveVal(NULL)
  user_info <- shiny::reactiveVal(NULL)
  projects_data <- shiny::reactiveVal(data.frame())
  solution_load_trigger <- shiny::reactiveVal(0)
  
  ## reactive values for sidebar project loading
  sidebar_project_to_load <- shiny::reactiveVal("")
  
  ## initialize app
  eval(server_initialize_app)
  
  ## login functionality (enabled for menu access only)
  eval(server_login)
  
  ## user menu functionality
  # Handle login button from menu
  shiny::observeEvent(input$menu_login_btn, {
    shiny::showModal(loginModal("loginModal"))
  })
  
  # Handle logout button from menu
  shiny::observeEvent(input$menu_logout_btn, {
    cat("*** USER LOGOUT - RESETTING APP STATE ***\n")
    
    # Clear authentication
    auth_token("")
    user_info(NULL)
    
    # Reset app environment to clear any loaded project data
    cat("*** CLEARING LOADED PROJECT DATA FOR SECURITY ***\n")
    app_data$dataset <- NULL
    app_data$themes <- NULL
    app_data$weights <- NULL
    app_data$includes <- NULL
    app_data$excludes <- NULL
    app_data$solutions <- list()
    app_data$solution_ids <- character(0)
    app_data$project_name <- NULL
    app_data$author_name <- NULL
    app_data$author_email <- NULL
    
    # Reset MapManager and SolutionSettings
    app_data$mm <- NULL
    app_data$ss <- NULL
    
    # Clear other project-dependent data
    app_data$bbox <- NULL
    app_data$theme_data <- NULL
    app_data$weight_data <- NULL
    app_data$include_data <- NULL
    app_data$exclude_data <- NULL
    app_data$area_data <- NULL
    app_data$boundary_data <- NULL
    
    # Clear map layers
    tryCatch({
      leaflet::leafletProxy("map") %>%
        leaflet::clearGroup("dataset") %>%
        leaflet::clearGroup("solutions") %>%
        leaflet::clearMarkers() %>%
        leaflet::clearShapes() %>%
        leaflet::clearControls()
      cat("*** MAP LAYERS CLEARED ON LOGOUT ***\n")
    }, error = function(e) {
      cat("*** ERROR CLEARING MAP ON LOGOUT:", e$message, "***\n")
    })
    
    # Clear UI elements
    tryCatch({
      # Clear map manager sidebar
      output$mapManagerPane_settings <- shiny::renderUI({
        shiny::div("No project loaded")
      })
      
      # Clear solution results
      output$solutionResultsPane_results <- shiny::renderUI({
        shiny::div("No project loaded")
      })
      
      # Clear export fields
      shiny::updateSelectizeInput(
        session = session,
        inputId = "exportPane_fields",
        choices = character(0)
      )
      
      cat("*** UI ELEMENTS CLEARED ON LOGOUT ***\n")
    }, error = function(e) {
      cat("*** ERROR CLEARING UI ON LOGOUT:", e$message, "***\n")
    })
    
    # Hide analysis sidebar (solutions)
    shinyjs::runjs("$('#analysisSidebar').css('display','none');")
    
    # Show notification and reset to public user
    shiny::showNotification("Sesión cerrada - Proyecto reiniciado por seguridad", type = "message", duration = 4)
    
    # Reset to public user
    user_info(list(id = "public", username = "public", userGroup = "public"))
    auth_token("public_token")
    
    # Ensure project selection sidebar is open for new user
    shinyjs::delay(500, {
      cat("*** OPENING PROJECT SELECTION SIDEBAR AFTER LOGOUT ***\n")
      tryCatch({
        map <- leaflet::leafletProxy("map")
        leaflet.extras2::openSidebar(
          map,
          id = "selectProjectPane", 
          sidebar_id = "dataSidebar"
        )
        cat("*** PROJECT SELECTION SIDEBAR OPENED AFTER LOGOUT ***\n")
      }, error = function(e) {
        cat("*** ERROR OPENING SIDEBAR AFTER LOGOUT:", e$message, "***\n")
        # Fallback to JavaScript
        shinyjs::runjs("
          $('#dataSidebar').sidebar('open');
          setTimeout(function() {
            $('#dataSidebar .sidebar-tabs a:first').click();
          }, 200);
        ")
      })
    })
  })
  
  # Conditionally show/hide menu items based on auth status
  shiny::observe({
    if (!is.null(auth_token()) && auth_token() != "" && auth_token() != "public_token") {
      # User is logged in with real credentials (not public)
      user_data <- user_info()
      
      # Hide login page, show logout
      shinyjs::hide(selector = "a[data-value='login_page']")
      shinyjs::show(selector = "a[data-value='logout_page']")
      
      # Show admin page only for managers/planners
      if (!is.null(user_data) && user_data$userGroup %in% c("manager", "planner")) {
        shinyjs::show(selector = "a[data-value='admin_page']")
      } else {
        shinyjs::hide(selector = "a[data-value='admin_page']")
      }
    } else {
      # User is not logged in OR is public user (treat both as "logged out" for menu purposes)
      shinyjs::show(selector = "a[data-value='login_page']")
      shinyjs::hide(selector = "a[data-value='logout_page']")
      shinyjs::hide(selector = "a[data-value='admin_page']")
    }
  })

  ## print debugging information
  if (isTRUE(wheretowork::get_golem_config("monitor"))) {
    shiny::observe({
      shiny::invalidateLater(3000)
      cli::cli_rule()
      golem::print_dev("Total memory used: ")
      golem::print_dev(lobstr::mem_used())
      golem::print_dev("  app_data")
      golem::print_dev(lobstr::obj_size(app_data))
    })
  }

  # import data
  ## import data using builtin import option
  eval(server_import_builtin_data)

  ## import data using manual import option
  eval(server_verify_manual_uploads)
  eval(server_import_manual_data)

  ## import data using spatial import option
  eval(server_verify_spatial_uploads)
  eval(server_import_spatial_data)

  ## import data using database option
  eval(server_import_projects_database)
  
  ## project selection sidebar
  eval(server_select_project)
  
  ## handle sidebar project loading
  shiny::observeEvent(sidebar_project_to_load(), {
    project_id_with_timestamp <- sidebar_project_to_load()
    if (project_id_with_timestamp != "") {
      # Extract project ID from timestamped value
      project_id <- strsplit(project_id_with_timestamp, "_")[[1]][1]
      cat("*** LOADING PROJECT FROM SIDEBAR:", project_id, "***\n")
      
      # Reset app environment for fresh project load
      cat("*** RESETTING APP ENVIRONMENT FOR FRESH PROJECT LOAD ***\n")
      
      # Clear existing project data
      app_data$dataset <- NULL
      app_data$themes <- NULL
      app_data$weights <- NULL
      app_data$includes <- NULL
      app_data$excludes <- NULL
      app_data$solutions <- list()
      app_data$solution_ids <- character(0)
      app_data$project_name <- NULL
      app_data$author_name <- NULL
      app_data$author_email <- NULL
      
      # Reset MapManager and SolutionSettings to prevent ID conflicts
      app_data$mm <- NULL
      app_data$ss <- NULL
      
      # Clear other data that depends on the project
      app_data$bbox <- NULL
      app_data$theme_data <- NULL
      app_data$weight_data <- NULL
      app_data$include_data <- NULL
      app_data$exclude_data <- NULL
      app_data$area_data <- NULL
      app_data$boundary_data <- NULL
      
      # Clear map layers and reset map
      tryCatch({
        leaflet::leafletProxy("map") %>%
          leaflet::clearGroup("dataset") %>%
          leaflet::clearGroup("solutions") %>%
          leaflet::clearMarkers() %>%
          leaflet::clearShapes() %>%
          leaflet::clearControls()
        cat("*** MAP LAYERS CLEARED ***\n")
      }, error = function(e) {
        cat("*** ERROR CLEARING MAP:", e$message, "***\n")
      })
      
      # Clear UI elements that depend on MapManager
      tryCatch({
        # Clear map manager sidebar
        output$mapManagerPane_settings <- shiny::renderUI({
          shiny::div("Loading project...")
        })
        
        # Clear solution results
        output$solutionResultsPane_results <- shiny::renderUI({
          shiny::div("No project loaded")
        })
        
        # Clear export fields
        shiny::updateSelectizeInput(
          session = session,
          inputId = "exportPane_fields",
          choices = character(0)
        )
        
        cat("*** UI ELEMENTS CLEARED ***\n")
      }, error = function(e) {
        cat("*** ERROR CLEARING UI ELEMENTS:", e$message, "***\n")
      })
      
      # Show loading spinner on map
      shinyjs::runjs("
        // Add loading spinner to map
        const mapContainer = document.getElementById('map');
        const spinner = document.createElement('div');
        spinner.id = 'project-loading-spinner';
        spinner.innerHTML = `
          <div style='
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255,255,255,0.9);
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            z-index: 1000;
            text-align: center;
            font-family: Work Sans, sans-serif;
          '>
            <div style='
              width: 40px;
              height: 40px;
              border: 4px solid #f3f3f3;
              border-top: 4px solid #3366CC;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin: 0 auto 10px auto;
            '></div>
            <div style='color: #3366CC; font-weight: 500;'>Cargando proyecto...</div>
          </div>
          <style>
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        `;
        mapContainer.appendChild(spinner);
      ")
      
      # Directly import the project using the proven import logic
      cat("*** DIRECTLY IMPORTING PROJECT:", project_id, "***\n")
      
      tryCatch({
        # Create project configuration from database (same as import modal logic)
        x <- create_project_from_database(project_id)
        
        # Store project ID for database solution loading
        app_data$project_id <- project_id
        
        # Import data using the proven import_data function
        environment(import_data) <- environment()
        import_data(x = x, mode = get_golem_config("mode"))
        
        # Trigger solution dropdown update
        shinyjs::delay(1000, {
          cat("*** Triggering solution dropdown update ***\n")
          solution_load_trigger(solution_load_trigger() + 1)
        })
        
        cat("*** PROJECT IMPORT COMPLETED SUCCESSFULLY ***\n")
        
        # Show success notification
        shiny::showNotification(
          "¡Proyecto cargado exitosamente!", 
          type = "message", 
          duration = 3
        )
        
      }, error = function(e) {
        cat("*** ERROR IMPORTING PROJECT:", e$message, "***\n")
        shiny::showNotification(
          paste("Error cargando proyecto:", e$message), 
          type = "error", 
          duration = 5
        )
      })
      
      # Remove spinner and show analysis sidebar after import completes
      shinyjs::delay(4000, {
        # Remove loading spinner
        shinyjs::runjs("
          const spinner = document.getElementById('project-loading-spinner');
          if (spinner) spinner.remove();
        ")
        
        # Show analysis sidebar and remove startup mode
        shinyjs::runjs("$('#analysisSidebar').css('display','block');")
        shinyjs::runjs("document.body.classList.remove('startup');")
      })
    }
  }, ignoreInit = TRUE)

  # update map
  eval(server_update_map)

  # update server_solution settings
  eval(server_update_solution_settings)

  # generate new solution using settings
  eval(server_generate_new_solution)

  # update solution results
  eval(server_update_solution_results)

  # export data
  eval(server_export_data)
  eval(server_export_spreadsheets)

  # load solution and settings previously generated
  eval(server_load_solution)
  
  # load solutions from database
  eval(server_load_solutions_database)
  
  # load database solutions
  eval(server_load_solution_database)

  # admin page management
  eval(server_adminPage)
  
  # AOI Selection Server Logic
  # @include server_aoiSelection.R
  aoi_server <- aoiSelectionServer("solutionResultsPane_results_aoi", app_data, session, map_id = "map")
}
