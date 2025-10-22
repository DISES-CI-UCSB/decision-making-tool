#' Sever function: initialize application
#'
#' Set behavior for initializing the application.
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_initialize_app)
#' ```
#'
#' @noRd
server_initialize_app <- quote({

  # define application data
  ## note that we use an environment here because they are mutable objects and
  ## so we don't have to worry about using the super-assignment operator
  app_data <- list2env(
    list(
      ## file paths
      configuration_path = NULL,
      spatial_path = NULL,
      boundary_path = NULL,
      attribute_path = NULL,
      ## settings
      project_name = NULL,
      author_name = NULL,
      author_email = NULL,
      mode = NULL,
      wheretowork_version = NULL,
      prioritizr_version = NULL,
      ## objects
      dataset = NULL,
      themes = NULL,
      weights = NULL,
      includes = NULL,
      excludes = NULL,
      solutions = list(),
      cache = cachem::cache_mem(),
      ## data
      bbox = NULL,
      theme_data = NULL,
      weight_data = NULL,
      include_data = NULL,
      exclude_data = NULL,
      area_data = NULL,
      boundary_data = NULL,
      solution_ids = character(0),
      ## widgets
      mm = NULL,
      ss = NULL,
      ## state variables
      new_solution_id = NULL,
      new_load_solution_id = NULL,
      task = NULL,
      ## database projects
      projects_data = data.frame()
    )
  )

  # activate start up mode
  ## hides leaflet buttons + scalebar
  shinyjs::runjs("document.body.classList.add('startup');")

  # make analysis sidebar hidden initially (solutions panel)
  shinyjs::runjs("$('#analysisSidebar').css('display','none');")
  
  # show data sidebar (project selection should be visible)
  shinyjs::runjs("$('#dataSidebar').css('display','block');")
  
  # automatically set public user access
  user_info(list(id = "public", username = "public", userGroup = "public"))
  auth_token("public_token")
  cat("*** AUTO-LOGIN: Set as public user ***\n")
  
  # automatically open the project selection sidebar pane using the proven method
  shinyjs::delay(500, {
    cat("*** OPENING PROJECT SELECTION SIDEBAR ***\n")
    
    # Use the same method that worked in import_data
    tryCatch({
      map <- leaflet::leafletProxy("map")
      leaflet.extras2::openSidebar(
        map,
        id = "selectProjectPane", 
        sidebar_id = "dataSidebar"
      )
      cat("*** PROJECT SELECTION SIDEBAR OPENED SUCCESSFULLY ***\n")
    }, error = function(e) {
      cat("*** ERROR OPENING SIDEBAR:", e$message, "***\n")
      
      # Fallback to JavaScript method
      shinyjs::runjs("
        console.log('*** FALLBACK: Using JavaScript method ***');
        $('#dataSidebar').sidebar('open');
        setTimeout(function() {
          $('#dataSidebar .sidebar-tabs a:first').click();
        }, 300);
      ")
    })
  })
  
  # Flag to prevent multiple modal transitions
  modal_transitioned <- FALSE
  
  shiny::observeEvent(auth_token(), {
    if (!is.null(auth_token()) && !modal_transitioned) {
      modal_transitioned <<- TRUE
      
      # No modal needed - project selection is in sidebar
      cat("*** AUTH TOKEN SET - Project selection available in sidebar ***\n")
    }
  }, ignoreNULL = TRUE)

  # initialize map
  output$map <- leaflet::renderLeaflet({
    leaflet_map(c("dataSidebar", "analysisSidebar"))
  })

  # initialize spatial import settings
  output$importModal_spatial_settings <- renderImportSettings({
    importSettings(buttonId = "importModal_spatial_button")
  })

  # initialize widgets
  output$solutionResultsPane_results <- renderSolutionResults({
    solutionResults()
  })

  # update project selection when database projects are available
  observeEvent(projects_data(), {
    cat("*** IMPORT MODAL: Updating dropdown with projects_data() ***\n")
    if (nrow(projects_data()) > 0) {
      # Create choices from database projects only
      db_choices <- stats::setNames(projects_data()$id, projects_data()$title)
      cat("*** IMPORT MODAL: Updated select input with", length(db_choices), "database projects ***\n")
      
      # Update the select input
      shiny::updateSelectInput(
        inputId = "importModal_name",
        choices = db_choices
      )
      
      # Enable the import button
      enable_html_element("importModal_builtin_button")
      cat("*** IMPORT MODAL: Enabled import button ***\n")
    } else {
      cat("*** IMPORT MODAL: No projects available, disabling import button ***\n")
      # Disable import button since no available projects
      disable_html_element("importModal_builtin_button")
      
      # Clear the select input
      shiny::updateSelectInput(
        inputId = "importModal_name",
        choices = c("No projects available" = "NA")
      )
    }
  })

  # Check if user is manager
  output$user_is_manager <- reactive({
    !is.null(user_info()) && user_info()$userGroup == "manager"
  })
  outputOptions(output, "user_is_manager", suspendWhenHidden = FALSE)

  # Check if no projects are available
  output$no_projects_available <- reactive({
    nrow(projects_data()) == 0
  })
  outputOptions(output, "no_projects_available", suspendWhenHidden = FALSE)

  # Handle go to admin page button click
  observeEvent(input$importModal_go_to_admin_btn, {
    # Close import modal and navigate to admin page
    shiny::removeModal()
    shiny::updateNavbarPage(session, "navbar", selected = "admin_page")
  })

  # disable buttons that require inputs
  disable_html_element("importModal_manual_button")
  disable_html_element("importModal_spatial_button")
  shinyjs::disable("exportPane_button")
  shinyjs::disable("newSolutionPane_settings_stop_button")

  # Solution results tab is now the only analysis tab (tab 1, always enabled)
  # No need to disable it since users can load existing solutions
  # disable_html_css_selector("#analysisSidebar li:nth-child(2)")

  # manually update solution settings sidebar content,
  # if can't manually stop processing
  if (!identical(strategy, "multicore")) {
    # hide solution stop button if not supported
    shinyjs::runjs("$('.solution-footer-stop-button').hide()")
    # resize the start button
    shinyjs::runjs(
      "$('#newSolutionPane_settings_start_button').css('width','150px;')"
    )
  }

  # hide elements
  shinyjs::hideElement("importModal_spatial_text")

  # add help modal button trigger
  shiny::observeEvent(input$help_button, {
    shinyBS::toggleModal(
      session = session, modalId = "helpModal", toggle = "open"
    )
  })


  # enable load solution button when a solution is selected
  shiny::observeEvent(input$load_solution_list, {
      if (input$load_solution_list == "") {
          disable_html_element("load_solution_button")
      } else {
          enable_html_element("load_solution_button")
      }
  })

})
