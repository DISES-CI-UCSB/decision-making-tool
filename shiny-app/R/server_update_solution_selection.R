#' Server function: update solution selection modal
#'
#' Pre-renders HTML table of solutions for display in modal.
#'
#' @details
#' This object is designed to be used within [app_server] function.
#' Within the [app_server] function, it should be called like this:
#'
#' ```
#' eval(server_update_solution_selection)
#' ```
#'
#' @noRd
server_update_solution_selection <- quote({

  cat("*** server_update_solution_selection EVALUATED ***\n")

  # Reactive to hold pre-rendered HTML table
  solutions_html_table <- reactiveVal("")
  
  # This observer watches the same trigger that updates the dropdown
  # So the HTML table is generated at the same time as the dropdown
  shiny::observeEvent(solution_load_trigger(), {
    if (solution_load_trigger() == 0 || is.null(app_data$project_id)) {
      return()
    }
    
    cat("*** Generating HTML solutions table ***\n")
    
    # Fetch solutions (same query as dropdown update)
    solution_query <- '
      query($projectId: ID!) {
        solutions(projectId: $projectId) {
          id
          title
          description
          file {
            path
          }
          themes {
            goal
            project_layer {
              name
            }
          }
          weights {
            name
          }
          includes {
            name
          }
          excludes {
            name
          }
        }
      }'
    
    tryCatch({
      qry <- ghql::Query$new()
      qry$query("solutions", solution_query)
      
      res <- client$exec(
        qry$queries$solutions,
        headers = list(Authorization = paste("Bearer", auth_token())),
        variables = list(projectId = as.character(app_data$project_id))
      )
      
      solutions_raw <- jsonlite::fromJSON(res)$data$solutions
      
      if (is.null(solutions_raw) || nrow(solutions_raw) == 0) {
        solutions_html_table("")
        return()
      }
      
      cat("*** Building HTML table for", nrow(solutions_raw), "solutions ***\n")
      
      # Build HTML table
      table_html <- '<table class="table table-striped table-hover" style="font-size: 12px; width: 100%;">
        <thead>
          <tr>
            <th style="width: 20%;">Título</th>
            <th style="width: 25%;">Descripción</th>
            <th style="width: 35%;">Temas (Meta)</th>
            <th style="width: 10%;">Pesos</th>
            <th style="width: 10%;">Inclusiones</th>
          </tr>
        </thead>
        <tbody>'
      
      for (i in 1:nrow(solutions_raw)) {
        # Get themes
        themes_text <- if (is.null(solutions_raw$themes[[i]]) || !is.data.frame(solutions_raw$themes[[i]]) || 
                           nrow(solutions_raw$themes[[i]]) == 0) {
          "Ninguno"
        } else {
          themes_df <- solutions_raw$themes[[i]]
          paste(themes_df$project_layer$name, " (", round(themes_df$goal * 100), "%)", sep = "", collapse = "; ")
        }
        
        # Get weights
        weights_text <- if (is.null(solutions_raw$weights[[i]]) || !is.data.frame(solutions_raw$weights[[i]]) || 
                            nrow(solutions_raw$weights[[i]]) == 0) {
          "Ninguno"
        } else {
          paste(solutions_raw$weights[[i]]$name, collapse = "; ")
        }
        
        # Get includes
        includes_text <- if (is.null(solutions_raw$includes[[i]]) || !is.data.frame(solutions_raw$includes[[i]]) || 
                             nrow(solutions_raw$includes[[i]]) == 0) {
          "Ninguno"
        } else {
          paste(solutions_raw$includes[[i]]$name, collapse = "; ")
        }
        
        # Get description
        desc_text <- if (is.na(solutions_raw$description[i]) || solutions_raw$description[i] == "") {
          "Sin descripción"
        } else {
          solutions_raw$description[i]
        }
        
        # Add row
        table_html <- paste0(table_html, sprintf('
          <tr>
            <td><strong>%s</strong></td>
            <td>%s</td>
            <td>%s</td>
            <td>%s</td>
            <td>%s</td>
          </tr>',
          htmltools::htmlEscape(solutions_raw$title[i]),
          htmltools::htmlEscape(desc_text),
          htmltools::htmlEscape(themes_text),
          htmltools::htmlEscape(weights_text),
          htmltools::htmlEscape(includes_text)
        ))
      }
      
      table_html <- paste0(table_html, '</tbody></table>')
      
      # Add search box with explicit visibility styling
      full_html <- paste0('
        <div style="margin-bottom: 15px; display: block !important; visibility: visible !important;">
          <input type="text" id="solution_table_search" class="form-control" placeholder="Buscar en la tabla..." style="width: 100%; padding: 8px;">
        </div>
        <div style="max-height: 500px; overflow-y: auto; display: block !important; visibility: visible !important; min-height: 200px; background-color: white;">
          ', table_html, '
        </div>
        <script>
          console.log("*** Table HTML loaded - searching for table element ***");
          setTimeout(function() {
            var table = $(".table.table-striped");
            console.log("*** Table found:", table.length, "***");
            console.log("*** Table visible:", table.is(":visible"), "***");
            console.log("*** Table display:", table.css("display"), "***");
            console.log("*** Table height:", table.height(), "***");
          }, 100);
          
          $("#solution_table_search").on("keyup", function() {
            var value = $(this).val().toLowerCase();
            $(".table tbody tr").filter(function() {
              $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1)
            });
          });
        </script>
      ')
      
      solutions_html_table(full_html)
      cat("*** HTML table generated and stored ***\n")
      
    }, error = function(e) {
      cat("*** Error generating HTML table:", e$message, "***\n")
    })
  })
  
  # Show modal with pre-rendered HTML
  shiny::observeEvent(input$open_solutions_modal, {
    cat("*** Opening solutions info modal ***\n")
    
    if (solutions_html_table() == "") {
      shiny::showNotification("No hay información de soluciones disponible. Espere a que se cargue el proyecto.", type = "warning")
      return()
    }
    
    shiny::showModal(
      shiny::modalDialog(
        title = htmltools::h3("Información de Soluciones Disponibles", style = "margin: 0; font-weight: bold;"),
        size = "l",  # Large size
        easyClose = TRUE,
        
        htmltools::div(
          style = "min-height: 600px; display: block !important;",
          htmltools::p(
            "Esta tabla muestra todas las soluciones disponibles para este proyecto. Usa el menú desplegable 'Seleccionar solución' para cargar una solución en el mapa.",
            style = "color: #666; margin-bottom: 20px; padding: 10px; background-color: #f8f9fa; border-radius: 5px; border-left: 4px solid #007bff; font-size: 14px;"
          ),
          htmltools::div(
            style = "display: block !important; visibility: visible !important; overflow: visible !important;",
            htmltools::HTML(solutions_html_table())
          )
        ),
        
        footer = shiny::modalButton("Cerrar")
      )
    )
    
    # Force modal and table to be large, visible, and ON TOP
    shinyjs::runjs("
      setTimeout(function() {
        console.log('*** Forcing modal and table visibility ***');
        
        // Add sbs-modal class to get the right z-index from CSS
        $('.modal').last().addClass('sbs-modal');
        $('.modal-backdrop').last().addClass('sbs-modal-backdrop');
        
        // Also force z-index directly as backup
        $('.modal').last().css({
          'z-index': '999999 !important'
        });
        $('.modal-backdrop').last().css({
          'z-index': '999998 !important'
        });
        
        // Make modal wider
        $('.modal-dialog').last().css({
          'width': '95%',
          'max-width': '1400px'
        });
        
        // Force modal body to have height
        $('.modal-body').last().css({
          'min-height': '500px',
          'max-height': '80vh',
          'overflow-y': 'auto'
        });
        
        // Force table visibility
        $('.table.table-striped').css({
          'display': 'table !important',
          'visibility': 'visible !important',
          'height': 'auto !important',
          'opacity': '1',
          'width': '100%'
        });
        
        $('.table.table-striped').parent().css({
          'display': 'block !important',
          'visibility': 'visible !important',
          'height': 'auto !important',
          'min-height': '300px'
        });
        
        // Force all parent divs to be visible
        $('.table.table-striped').parents('div').each(function() {
          $(this).css({
            'display': 'block !important',
            'visibility': 'visible !important',
            'height': 'auto'
          });
        });
        
        console.log('*** Modal z-index:', $('.modal').last().css('z-index'), '***');
        console.log('*** Modal width:', $('.modal-dialog').last().width(), '***');
        console.log('*** Modal body height:', $('.modal-body').last().height(), '***');
        console.log('*** Table height after fix:', $('.table.table-striped').height(), '***');
        console.log('*** Table rows:', $('.table.table-striped tbody tr').length, '***');
      }, 300);
    ")
  })

})
