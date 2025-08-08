#' Sever function: import projects from database
#'
#' Set behavior for importing projects using database option
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_import_projects_database)
#' ```
#'
#' @noRd
#' 

server_import_projects_database <- quote({
  ## Store form state
  formData <- reactiveValues(
    project = list(),
    solutions = list(),
    currentSolutionIndex = NULL
  )
  
  
  ### Steps
  observeEvent(input$createProjectModal_next_btn, {
    current <- input$createProjectModal_modal_steps
    
    if (current == "project_step") {
      # Save project data
      formData$project <- list(
        title = input$createProjectModal_project_title,
        description = input$createProjectModal_project_description,
        user_group = input$createProjectModal_project_user_group
      )
      updateTabsetPanel(inputId = "createProjectModal_modal_steps", selected = "solutions_step")
      
    } else if (current == "solutions_step") {
      updateTabsetPanel(inputId = "createProjectModal_modal_steps", selected = "layers_step")
    }
  })
  
  observeEvent(input$createProjectModal_prev_btn, {
    current <- input$createProjectModal_modal_steps
    
    if (current == "layers_step") {
      updateTabsetPanel(inputId = "createProjectModal_modal_steps", selected = "solutions_step")
    } else if (current == "solutions_step") {
      updateTabsetPanel(inputId = "createProjectModal_modal_steps", selected = "project_step")
    }
  })
  
  ### Add solution
  observeEvent(input$createProjectModal_add_solution, {
    newIndex <- length(formData$solutions) + 1
    formData$solutions[[newIndex]] <- list(
      title = "",
      description = "",
      author_name = "",
      author_email = "",
      user_group = "",
      layers = list()
    )
  })
  
  
  output$createProjectModal_solutions_ui <- renderUI({
    if (length(formData$solutions) == 0) {
      return(tags$p("No solutions yet. Click 'Add Solution' to begin."))
    }
    
    tagList(
      lapply(seq_along(formData$solutions), function(i) {
        sol <- formData$solutions[[i]]
        wellPanel(
          h4(paste("Solution", i)),
          textInput(paste0("createProjectModal_solution_title_", i), "Title", value = sol$title),
          textAreaInput(paste0("createProjectModal_solution_description_", i), "Description", value = sol$description),
          textInput(paste0("createProjectModal_solution_author_name_", i), "Author Name", value = sol$author_name),
          textInput(paste0("createProjectModal_solution_author_email_", i), "Author Email", value = sol$author_email),
          selectInput(paste0("createProjectModal_solution_user_group_", i), "User Group", choices = c("public", "planner", "manager"), selected = sol$user_group),
          actionButton(paste0("createProjectModal_edit_layers_", i), "Edit Layers")
        )
      })
    )
  })
  
  ### When user clicks "Edit Layers for this Solution"
  observe({
    lapply(seq_along(formData$solutions), function(i) {
      observeEvent(input[[paste0("createProjectModal_edit_layers_", i)]], {
        formData$currentSolutionIndex <- i
        updateTabsetPanel(inputId = paste0("createProjectModal_modal_steps"), selected = "layers_step")
      }, ignoreInit = TRUE)
    })
  })
  
  
  ### Add layer to current solution
  observeEvent(input$createProjectModal_add_layer, {
    i <- formData$currentSolutionIndex
    if (is.null(i) || length(formData$solutions) < i) return(NULL)
    
    sol <- formData$solutions[[i]]
    newIndex <- length(sol$layers) + 1
    
    sol$layers[[newIndex]] <- list(
      name = "",
      type = "",
      file = NULL
    )
    
    formData$solutions[[i]] <- sol
  })
  
  output$createProjectModal_layers_ui <- renderUI({
    i <- formData$currentSolutionIndex
    if (is.null(i) || length(formData$solutions) < i) return(tags$p("No solution selected."))
    
    sol <- formData$solutions[[i]]
    
    if (length(sol$layers) == 0) {
      return(tags$p("No layers yet. Click 'Add Layer' to begin."))
    }
    
    tagList(
      lapply(seq_along(sol$layers), function(j) {
        layer <- sol$layers[[j]]
        wellPanel(
          h4(paste("Layer", j)),
          textInput(paste0("createProjectModal_layer_name_", i, "_", j), "Name", value = layer$name),
          selectInput(paste0("createProjectModal_layer_type_", i, "_", j), "Type", choices = c("theme", "weight", "include", "exclude"), selected = layer$type),
          fileInput(paste0("createProjectModal_layer_file_", i, "_", j), "Upload File")
        )
      })
    )
  })
  
  # observe({
  #   # Save all solution fields
  #   lapply(seq_along(formData$solutions), function(i) {
  #     sol <- formData$solutions[[i]]
  #     sol$title <- input$createProjectModal_solution_title_", i)]]
  #     sol$description <- input$createProjectModal_solution_description_", i)]]
  #     sol$author_name <- input$createProjectModal_solution_author_name_", i)]]
  #     sol$author_email <- input$createProjectModal_solution_author_email_", i)]]
  #     sol$user_group <- input$createProjectModal_solution_user_group_", i)]]
  #     
  #     # Layers
  #     lapply(seq_along(sol$layers), function(j) {
  #       sol$layers[[j]]$name <- input$createProjectModal_layer_name_", i, "_", j)]]
  #       sol$layers[[j]]$type <- input$createProjectModal_layer_type_", i, "_", j)]]
  #       sol$layers[[j]]$file <- input$createProjectModal_layer_file_", i, "_", j)]]
  #     })
  #     
  #     formData$solutions[[i]] <- sol
  #   })
  # })
  
  
})