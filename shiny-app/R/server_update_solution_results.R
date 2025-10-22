#' Sever function: update solution results
#'
#' Set behavior for updating the solution results sidebar content.
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_update_solution_results)
#' ```
#'
#' @noRd
server_update_solution_results <- quote({

  # update solution results sidebar content
  shiny::observeEvent(input$solutionResultsPane_results_select, {
    ## specify dependencies
    shiny::req(input$solutionResultsPane_results_select)
    if (
      !input$solutionResultsPane_results_select %in% app_data$solution_ids) {
      return()
    }
    ## show solution results
    showSolutionResults(
      session = session,
      inputId = "solutionResultsPane_results",
      value = input$solutionResultsPane_results_select
    )
  })

  # Also watch the modal's own dropdown for changes
  shiny::observeEvent(input$solutionResultsPane_results_modal_select, {
    cat("*** Modal dropdown changed to:", input$solutionResultsPane_results_modal_select, "***\n")
    
    if (!input$solutionResultsPane_results_modal_select %in% app_data$solution_ids) {
      return()
    }
    
    i <- which(app_data$solution_ids == input$solutionResultsPane_results_modal_select)
    if (length(i) == 0) return()
    
    cat("*** Rendering all tables for modal dropdown selection ***\n")
    
    # Force immediate render of all tables
    output$solutionResultsPane_results_modal_summary_table <<- DT::renderDT({
      app_data$solutions[[i]]$render_summary_results()
    })
    output$solutionResultsPane_results_modal_themes_table <<- DT::renderDT({
      app_data$solutions[[i]]$render_theme_results()
    })
    output$solutionResultsPane_results_modal_weights_table <<- DT::renderDT({
      app_data$solutions[[i]]$render_weight_results()
    })
    output$solutionResultsPane_results_modal_includes_table <<- DT::renderDT({
      app_data$solutions[[i]]$render_include_results()
    })
    output$solutionResultsPane_results_modal_excludes_table <<- DT::renderDT({
      app_data$solutions[[i]]$render_exclude_results()
    })
  }, ignoreNULL = TRUE, ignoreInit = FALSE)  # Fire even on first value
  
})
