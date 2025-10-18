#' @include internal.R
NULL

#' Server logic for loading solutions from database
server_load_solutions_database <- quote({

#' Update solution dropdown with database solutions
#'
#' This function fetches solutions from the GraphQL database and updates
#' the solution dropdown in the main app interface.
#'
#' @details
#' This replaces the file-based solution loading with database queries.
#' Solutions are fetched based on the current project and user permissions.
update_solution_dropdown <- function() {
  
  # Check if we have project data and it's from database
  if (is.null(app_data$project_id)) {
    cat("*** No project ID found, skipping solution dropdown update ***\n")
    # Clear the dropdown
    shinyWidgets::updatePickerInput(
      session = session,
      inputId = "load_solution_list",
      choices = c("Select a solution to load" = ""),
      selected = "",
      choicesOpt = list(disabled = c(TRUE))
    )
    return()
  }
  
  # GraphQL query for solutions
  solutions_query <- '
    query($projectId: ID!) {
      solutions(projectId: $projectId) {
        id
        title
        description
        author_name
        user_group
        file {
          id
          path
        }
      }
    }'
  
  tryCatch({
    
    # Check authentication
    if (is.null(auth_token())) {
      stop("No authentication token available")
    }
    
    # Execute GraphQL query
    qry <- ghql::Query$new()
    qry$query("solutions", solutions_query)
    
    res <- client$exec(
      qry$queries$solutions,
      headers = list(Authorization = paste("Bearer", auth_token())),
      variables = list(projectId = as.character(app_data$project_id))
    )
    
    cat("*** GraphQL response:", res, "***\n")
    
    res_list <- jsonlite::fromJSON(res)
    
    # Check for GraphQL errors
    if (!is.null(res_list$errors)) {
      stop("GraphQL errors: ", paste(sapply(res_list$errors, function(e) e$message), collapse = "; "))
    }
    
    solutions <- res_list$data$solutions
    cat("*** Found", nrow(solutions), "solutions for project", app_data$project_id, "***\n")
    cat("*** Solutions structure:", str(solutions), "***\n")
    cat("*** Solutions file column class:", class(solutions$file), "***\n")
    if (nrow(solutions) > 0) {
      cat("*** First solution file:", str(solutions$file[[1]]), "***\n")
    }

    print(solutions)
    
    if (nrow(solutions) == 0) {
      # No solutions found
      shinyWidgets::updatePickerInput(
        session = session,
        inputId = "load_solution_list",
        choices = c("No solutions available" = ""),
        selected = "",
        choicesOpt = list(disabled = c(TRUE))
      )
    } else {
      # Create choices for dropdown
      # Check if solutions have files
      cat("*** Checking for valid solutions ***\n")
      cat("*** solutions$file type:", typeof(solutions$file), "***\n")
      cat("*** solutions$file length:", length(solutions$file), "***\n")
      
      # Handle the case where file is a data frame (nested JSON converted by jsonlite)
      if (is.data.frame(solutions$file)) {
        # File column is a data frame with id and path columns
        valid_solutions <- !is.na(solutions$file$path) & solutions$file$path != ""
        cat("*** File is data frame, valid solutions:", sum(valid_solutions), "***\n")
        
        if (any(valid_solutions)) {
          valid_solutions_df <- solutions[valid_solutions, ]
          
          # Ensure we have clean character vectors
          file_paths <- as.character(valid_solutions_df$file$path)
          solution_titles <- as.character(valid_solutions_df$title)
          
          # Clean up any problematic characters in titles for display
          clean_titles <- gsub("[^A-Za-z0-9 +-]", "_", solution_titles)
          
          solution_choices <- stats::setNames(file_paths, clean_titles)
          
          cat("*** File paths:", paste(file_paths, collapse = " | "), "***\n")
          cat("*** Clean titles:", paste(clean_titles, collapse = " | "), "***\n")
        } else {
          solution_choices <- c()
        }
      } else {
        # File column is a list (original approach)
        tryCatch({
          valid_solutions <- !sapply(solutions$file, is.null)
          cat("*** Valid solutions check successful ***\n")
          
          if (any(valid_solutions)) {
            valid_solutions_df <- solutions[valid_solutions, ]
            solution_choices <- stats::setNames(
              sapply(valid_solutions_df$file, function(f) f$path),  # File paths as values
              valid_solutions_df$title                              # Titles as display names
            )
          } else {
            solution_choices <- c()
          }
        }, error = function(e) {
          cat("*** Error in sapply:", e$message, "***\n")
          solution_choices <- c()
        })
      }
      
      # Check if we found any valid solutions
      if (length(solution_choices) == 0) {
        cat("*** Warning: Found", nrow(solutions), "solutions but none have valid files ***\n")
      }
      
      if (length(solution_choices) > 0) {
        # Add default option
        all_choices <- c("Select a solution to load" = "", solution_choices)
        
        cat("*** About to update dropdown with choices:", names(all_choices), "***\n")
        cat("*** Choice values:", all_choices, "***\n")
        
        # Check if the element exists and disable problematic tooltips
        shinyjs::runjs("
          // Disable problematic tooltips that are causing errors
          try {
            // Override tooltip function to prevent errors
            if (typeof $.fn.tooltip !== 'undefined') {
              var originalTooltip = $.fn.tooltip;
              $.fn.tooltip = function(options) {
                try {
                  return originalTooltip.call(this, options);
                } catch (e) {
                  console.log('Tooltip error caught and ignored:', e.message);
                  return this;
                }
              };
            }
          } catch (e) {
            console.log('Tooltip override failed:', e.message);
          }
          
          var element = document.getElementById('load_solution_list');
          if (element) {
            console.log('*** load_solution_list element found ***');
            console.log('Current options count:', element.options ? element.options.length : 'No options property');
          } else {
            console.log('*** load_solution_list element NOT found ***');
          }
        ")
        
        # Update with real solution data
        cat("*** Updating with real solution data ***\n")
        tryCatch({
          shinyWidgets::updatePickerInput(
            session = session,
            inputId = "load_solution_list",
            choices = all_choices,
            selected = "",
            choicesOpt = list(
              disabled = c(TRUE, rep(FALSE, length(solution_choices)))
            )
          )
          cat("*** Updated with shinyWidgets::updatePickerInput ***\n")
        }, error = function(e) {
          cat("*** shinyWidgets::updatePickerInput failed:", e$message, "***\n")
        })
        
        # Check if update was successful and force refresh
        shinyjs::runjs("
          setTimeout(function() {
            var element = document.getElementById('load_solution_list');
            if (element) {
              console.log('*** REAL UPDATE - After update - options count:', element.options ? element.options.length : 'No options property');
              console.log('*** REAL UPDATE - Element classes:', element.className);
              
              // Log all option values and text
              if (element.options) {
                for (var i = 0; i < element.options.length; i++) {
                  console.log('*** REAL UPDATE - Option', i, '- Value:', element.options[i].value, 'Text:', element.options[i].text);
                }
              }
              
              // Try multiple approaches to fix the picker
              try {
                // Method 1: Bootstrap selectpicker refresh
                if (typeof $(element).selectpicker === 'function') {
                  $(element).selectpicker('refresh');
                  console.log('*** REAL UPDATE - Called selectpicker refresh ***');
                }
              } catch (e) {
                console.log('*** selectpicker refresh failed:', e.message);
              }
              
              try {
                // Method 2: Force re-render by hiding/showing
                $(element).hide().show();
                console.log('*** REAL UPDATE - Forced hide/show ***');
              } catch (e) {
                console.log('*** hide/show failed:', e.message);
              }
              
              try {
                // Method 3: Trigger change and focus events
                $(element).trigger('change').trigger('focus').trigger('blur');
                console.log('*** REAL UPDATE - Triggered events ***');
              } catch (e) {
                console.log('*** event triggering failed:', e.message);
              }
              
              try {
                // Method 4: Force DOM update
                element.style.display = 'none';
                element.offsetHeight; // Force reflow
                element.style.display = '';
                console.log('*** REAL UPDATE - Forced DOM reflow ***');
              } catch (e) {
                console.log('*** DOM reflow failed:', e.message);
              }
            }
          }, 100);
        ")
        
        cat("*** Successfully updated solution dropdown with", length(solution_choices), "solutions ***\n")
      } else {
        # No valid solutions with files
        shinyWidgets::updatePickerInput(
          session = session,
          inputId = "load_solution_list",
          choices = c("Solutions found but no files available" = ""),
          selected = "",
          choicesOpt = list(disabled = c(TRUE))
        )
        
        cat("*** Solutions found but no files available ***\n")
      }
    }
    
  }, error = function(e) {
    cat("*** ERROR loading solutions:", e$message, "***\n")
    cat("*** Project ID:", app_data$project_id, "***\n")
    cat("*** Auth token present:", !is.null(auth_token()), "***\n")
    
    # Show user-friendly notification
    shiny::showNotification(
      paste("Failed to load solutions:", e$message), 
      type = "error", 
      duration = 5
    )
    
    # Clear dropdown on error
    shinyWidgets::updatePickerInput(
      session = session,
      inputId = "load_solution_list",
      choices = c("Error loading solutions" = ""),
      selected = "",
      choicesOpt = list(disabled = c(TRUE))
    )
  })
}

# Observer to watch for solution loading trigger
shiny::observeEvent(solution_load_trigger(), {
  cat("*** Observer triggered, solution_load_trigger value:", solution_load_trigger(), "***\n")
  if (solution_load_trigger() > 0) {
    cat("*** Solution load trigger fired:", solution_load_trigger(), "***\n")
    tryCatch({
      update_solution_dropdown()
      cat("*** update_solution_dropdown completed successfully ***\n")
    }, error = function(e) {
      cat("*** Error in update_solution_dropdown:", e$message, "***\n")
    })
  }
}, ignoreInit = TRUE)

})
