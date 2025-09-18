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

  # make sidebars hidden
  shinyjs::runjs("$('#dataSidebar').css('display','none');")
  shinyjs::runjs("$('#analysisSidebar').css('display','none');")

  # display login modal on start up
  shiny::showModal(loginModal(id = "loginModal"))
  
  # Flag to prevent multiple modal transitions
  modal_transitioned <- FALSE
  
  shiny::observeEvent(auth_token(), {
    if (!is.null(auth_token()) && !modal_transitioned) {
      modal_transitioned <<- TRUE
      
      # Close login modal and show import modal
      shiny::removeModal()
      shiny::showModal(importModal(id = "importModal"))
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

  # initialize built in projects
  if (nrow(project_data) > 0) {
    ## update select input with project names
    shiny::updateSelectInput(
      inputId = "importModal_name",
      choices = stats::setNames(project_data$path, project_data$name)
    )
  } else {
    ## disable import button since no available projects
    disable_html_element("importModal_builtin_button")
  }

  # update project selection when database projects are available
  observeEvent(app_data$projects_data, {
    if (nrow(app_data$projects_data) > 0) {
      # Create choices from database projects
      db_choices <- stats::setNames(app_data$projects_data$id, app_data$projects_data$title)
      
      # Combine with built-in projects if available
      if (nrow(project_data) > 0) {
        builtin_choices <- stats::setNames(project_data$path, project_data$name)
        all_choices <- c(builtin_choices, db_choices)
      } else {
        all_choices <- db_choices
      }
      
      # Update the select input
      shiny::updateSelectInput(
        inputId = "importModal_name",
        choices = all_choices
      )
      
      # Enable the import button
      enable_html_element("importModal_builtin_button")
    }
  })

  # Check if user is manager
  output$user_is_manager <- reactive({
    !is.null(user_info()) && user_info()$userGroup == "manager"
  })
  outputOptions(output, "user_is_manager", suspendWhenHidden = FALSE)

  # Check if no projects are available
  output$no_projects_available <- reactive({
    nrow(app_data$projects_data) == 0 && nrow(project_data) == 0
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

  # disable solution results sidebar button
  disable_html_css_selector("#analysisSidebar li:nth-child(2)")

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
