#' AOI Selection Server
#'
#' Server logic for Area of Interest (AOI) selection and analysis
#'
#' @param id `character` identifier.
#' @param app_data `environment` containing application data.
#' @param session `ShinySession` object.
#' @param map_id `character` identifier for the map.
#'
#' @export
aoiSelectionServer <- function(id, app_data, session, map_id = "map") {
  shiny::moduleServer(id, function(input, output, session) {
    ns <- session$ns
    
    # Reactive values for AOI data
    aoi_data <- reactiveVal(NULL)
    aoi_geometry <- reactiveVal(NULL)
    aoi_analysis <- reactiveVal(NULL)
    drawing_mode <- reactiveVal("none")
    drawn_shape <- reactiveVal(NULL)
    
    # Reactive value to store loaded shapefiles
    predefined_shapefiles <- reactiveVal(list())
    
    # Reactive value to store pre-computed feature choices (for fast dropdown updates)
    predefined_feature_choices <- reactiveVal(list())
    
    # Load predefined shapefiles on initialization (store in memory, not on map yet)
    observe({
      shinyjs::show("shapefile_loading_indicator")
      
      shp_list <- list()
      choices_list <- list()
      
      # Load colombia_departments_2023
      dept_path <- system.file("extdata/aois/colombia_departments_2023/colombia_departments_2023.shp", package = "wheretowork")
      if (file.exists(dept_path)) {
        tryCatch({
          dept_sf <- sf::st_read(dept_path, quiet = TRUE)
          # Transform to WGS84 if needed
          if (!is.na(sf::st_crs(dept_sf)) && sf::st_crs(dept_sf)$input != "EPSG:4326") {
            dept_sf <- sf::st_transform(dept_sf, 4326)
          }
          shp_list$colombia_departments_2023 <- dept_sf
          
          # Pre-compute feature choices
          name_col <- "NOMBRE_DPT"
          if (!name_col %in% colnames(dept_sf)) {
            name_col <- names(dept_sf)[sapply(dept_sf, is.character)][1]
          }
          feature_names <- as.character(dept_sf[[name_col]])
          choices_list$colombia_departments_2023 <- setNames(seq_along(feature_names), feature_names)
        }, error = function(e) {
          cat("*** AOI: Error loading departments:", e$message, "***\n")
        })
      }
      
      # Load colombia_regions
      regions_path <- system.file("extdata/aois/colombia_regions/colombia_regions.shp", package = "wheretowork")
      if (file.exists(regions_path)) {
        tryCatch({
          regions_sf <- sf::st_read(regions_path, quiet = TRUE)
          # Transform to WGS84 if needed
          if (!is.na(sf::st_crs(regions_sf)) && sf::st_crs(regions_sf)$input != "EPSG:4326") {
            regions_sf <- sf::st_transform(regions_sf, 4326)
          }
          shp_list$colombia_regions <- regions_sf
          
          # Pre-compute feature choices
          name_col <- "region"
          if (!name_col %in% colnames(regions_sf)) {
            name_col <- names(regions_sf)[sapply(regions_sf, is.character)][1]
          }
          feature_names <- as.character(regions_sf[[name_col]])
          choices_list$colombia_regions <- setNames(seq_along(feature_names), feature_names)
        }, error = function(e) {
          cat("*** AOI: Error loading regions:", e$message, "***\n")
        })
      }
      
      predefined_shapefiles(shp_list)
      predefined_feature_choices(choices_list)
      shinyjs::hide("shapefile_loading_indicator")
    })
    
    # Fast update of feature dropdown using updateSelectInput (no renderUI lag!)
    observeEvent(input$predefined_aoi_type, {
      req(input$predefined_aoi_type)
      
      if (input$predefined_aoi_type == "") {
        # Reset dropdown if no type selected
        updateSelectInput(session, "predefined_aoi_feature", 
                         choices = c("Seleccionar..." = ""),
                         selected = "")
        shinyjs::disable("apply_predefined_aoi_btn")
      } else {
        # Get pre-computed choices (instant!)
        feature_choices <- predefined_feature_choices()[[input$predefined_aoi_type]]
        
        if (!is.null(feature_choices)) {
          updateSelectInput(session, "predefined_aoi_feature",
                           choices = c("Seleccionar..." = "", feature_choices),
                           selected = "")
        }
      }
    })
    
    # Enable/disable button when feature is selected
    observeEvent(input$predefined_aoi_feature, {
      if (!is.null(input$predefined_aoi_feature) && input$predefined_aoi_feature != "") {
        shinyjs::enable("apply_predefined_aoi_btn")
      } else {
        shinyjs::disable("apply_predefined_aoi_btn")
      }
    })
    
    # Handle predefined AOI button click
    observeEvent(input$apply_predefined_aoi_btn, {
      req(input$predefined_aoi_type)
      req(input$predefined_aoi_feature)
      req(input$predefined_aoi_feature != "")
      
      cat("*** AOI: Apply predefined AOI button clicked ***\n")
      cat("*** AOI: Type:", input$predefined_aoi_type, "***\n")
      cat("*** AOI: Feature index:", input$predefined_aoi_feature, "***\n")
      
      shp_data <- predefined_shapefiles()[[input$predefined_aoi_type]]
      feature_idx <- as.integer(input$predefined_aoi_feature)
      
      if (!is.null(shp_data) && feature_idx > 0 && feature_idx <= nrow(shp_data)) {
        # Extract selected feature
        selected_feature <- shp_data[feature_idx, ]
        
        # Transform to sf if not already
        if (!inherits(selected_feature, "sf")) {
          selected_feature <- sf::st_as_sf(selected_feature)
        }
        
        # Ensure CRS is set (assume WGS84 if not set)
        # Validate and fix geometry (same as drawn shapes)
        cat("*** AOI: Validating geometry ***\n")
        if (!sf::st_is_valid(selected_feature)) {
          cat("*** AOI: Geometry is invalid, attempting to fix ***\n")
          selected_feature <- sf::st_make_valid(selected_feature)
          cat("*** AOI: Geometry fixed ***\n")
        }
        
        # Set CRS to WGS84 if not set (SAME AS DRAWN SHAPES - lines 612-614)
        if (is.na(sf::st_crs(selected_feature))) {
          cat("*** AOI: Setting CRS to WGS84 (4326) ***\n")
          sf::st_crs(selected_feature) <- 4326
        } else if (sf::st_crs(selected_feature)$epsg != 4326) {
          cat("*** AOI: Transforming from CRS", sf::st_crs(selected_feature)$epsg, "to WGS84 (4326) ***\n")
          selected_feature <- sf::st_transform(selected_feature, 4326)
        }
        
        # Get bounding box for zooming
        bbox <- sf::st_bbox(selected_feature)
        
        # DEBUG: Check the feature
        cat("*** AOI DEBUG: Feature details ***\n")
        cat("  - Rows:", nrow(selected_feature), "\n")
        cat("  - Columns:", ncol(selected_feature), "\n")
        cat("  - CRS:", sf::st_crs(selected_feature)$input, "\n")
        cat("  - Geometry type:", as.character(sf::st_geometry_type(selected_feature)[1]), "\n")
        cat("  - Bounding box:", paste(bbox, collapse=", "), "\n")
        cat("  - Map ID being used:", map_id, "\n")
        
        # Convert to GeoJSON (same approach as drawn shapes)
        cat("*** AOI: Converting feature to GeoJSON ***\n")
        aoi_geojson <- geojsonsf::sf_geojson(selected_feature)
        cat("*** AOI: GeoJSON preview (first 500 chars):", substr(aoi_geojson, 1, 500), "\n")
        
        # Add to map using JavaScript with GeoJSON (handles MULTIPOLYGON correctly)
        cat("*** AOI: Adding boundary to map with JavaScript ***\n")
        
        # Simplify the geometry to reduce size (important for large regions)
        simple_feature <- sf::st_simplify(selected_feature, dTolerance = 0.05, preserveTopology = TRUE)
        cat("*** AOI: Original coords:", nrow(sf::st_coordinates(selected_feature)), "***\n")
        cat("*** AOI: Simplified coords:", nrow(sf::st_coordinates(simple_feature)), "***\n")
        
        # Convert to GeoJSON (already created above)
        # Escape single quotes and backslashes for JavaScript string
        geojson_for_js <- gsub("'", "\\\\'", aoi_geojson)
        geojson_for_js <- gsub("\\\\", "\\\\\\\\", geojson_for_js)
        
        # Use JavaScript to add the GeoJSON (EXACT SAME METHOD as drawn shapes at line 258-264)
        shinyjs::runjs(paste0("
          (function() {
            console.log('*** AOI: Getting map for predefined shape ***');
            var mapElement = document.getElementById('", map_id, "');
            
            // Get the Leaflet map from the HTMLWidgets binding (SAME AS LINE 258-264)
            var map = null;
            if (mapElement && HTMLWidgets && HTMLWidgets.find) {
              var widget = HTMLWidgets.find('#", map_id, "');
              if (widget && widget.getMap) {
                map = widget.getMap();
              }
            }
            
            console.log('Leaflet map:', map);
            
            if (map) {
              console.log('*** AOI: Adding predefined shape to map ***');
              
              // Remove existing AOI layer if present
              if (window.predefinedAoiLayer) {
                map.removeLayer(window.predefinedAoiLayer);
              }
              
              // Parse GeoJSON and add to map
              var geojson = ", aoi_geojson, ";
              console.log('GeoJSON type:', geojson.features ? geojson.features[0].geometry.type : 'unknown');
              
              window.predefinedAoiLayer = L.geoJSON(geojson, {
                style: {
                  color: '#e74c3c',
                  weight: 3,
                  fillColor: '#e74c3c',
                  fillOpacity: 0.1
                }
              }).addTo(map);
              
              console.log('*** AOI: Predefined shape added to map ***');
              
              // Zoom to bounds
              map.fitBounds(window.predefinedAoiLayer.getBounds());
            } else {
              console.error('Map not found:', '", map_id, "');
            }
          })();
        "))
        
        cat("*** AOI: JavaScript executed for map display ***\n")
        
        # Store AOI data (this is what perform_aoi_analysis expects)
        aoi_data(selected_feature)
        
        # Update status
        feature_name <- names(predefined_shapefiles()[[input$predefined_aoi_type]])[feature_idx]
        shinyjs::html("aoi_status_text", paste("AOI Seleccionado - Analizando..."))
        
        # Check if solution is loaded
        if (length(app_data$solution_ids) == 0) {
          cat("*** AOI: No solutions available ***\n")
          shiny::showNotification("No hay solución cargada. Por favor cargue una solución primero.", type = "warning")
          return()
        }
        
        # Perform analysis (no arguments - uses reactive values)
        cat("*** AOI: Performing analysis for predefined AOI ***\n")
        perform_aoi_analysis()
      }
    })
    
    # Start drawing polygon
    observeEvent(input$start_draw_polygon_btn, {
      cat("*** AOI: Starting polygon drawing mode ***\n")
      drawing_mode("polygon")
      
      # Enable drawing mode using JavaScript
      shinyjs::runjs(paste0("
        console.log('*** AOI: Polygon button clicked ***');
        var mapElement = document.getElementById('", map_id, "');
        console.log('Map element:', mapElement);
        
        // Get the Leaflet map from the HTMLWidgets binding
        var map = null;
        if (mapElement && HTMLWidgets && HTMLWidgets.find) {
          var widget = HTMLWidgets.find('#", map_id, "');
          if (widget && widget.getMap) {
            map = widget.getMap();
          }
        }
        
        console.log('Leaflet map:', map);
        
        if (map) {
          console.log('Leaflet map found:', map);
          
          // Clear any existing event handlers
          if (window.aoiClickHandler) {
            map.off('click', window.aoiClickHandler);
          }
          if (window.aoiDblClickHandler) {
            map.off('dblclick', window.aoiDblClickHandler);
          }
          
          // Initialize drawing state
          window.aoiDrawingMode = 'polygon';
          window.aoiPoints = [];
          console.log('Drawing mode set to polygon');
          
          // Define click handler
          window.aoiClickHandler = function(e) {
            console.log('Map clicked at:', e.latlng);
            if (window.aoiDrawingMode === 'polygon') {
              window.aoiPoints.push([e.latlng.lat, e.latlng.lng]);
              console.log('Point added, total points:', window.aoiPoints.length);
              
              // Add marker for each point
              L.marker([e.latlng.lat, e.latlng.lng], {
                icon: L.divIcon({
                  className: 'aoi-point-marker',
                  html: '<div style=\"background: #e74c3c; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;\"></div>',
                  iconSize: [14, 14]
                })
              }).addTo(map);
              
              // Draw lines between points
              if (window.aoiPoints.length > 1) {
                L.polyline(window.aoiPoints, {
                  color: '#e74c3c',
                  weight: 2,
                  dashArray: '5, 5'
                }).addTo(map);
              }
              
              // Update status
              var statusEl = document.getElementById('", ns("aoi_status_text"), "');
              if (statusEl) {
                statusEl.textContent = 'Points: ' + window.aoiPoints.length + ' - Double-click to finish';
              }
            }
          };
          
          // Define double-click handler
          window.aoiDblClickHandler = function(e) {
            console.log('Map double-clicked');
            if (window.aoiDrawingMode === 'polygon' && window.aoiPoints && window.aoiPoints.length >= 3) {
              // Prevent the last click from being added
              L.DomEvent.stopPropagation(e);
              
              // Complete the polygon
              var polygon = L.polygon(window.aoiPoints, {
                color: '#e74c3c',
                weight: 2,
                fillColor: '#e74c3c',
                fillOpacity: 0.3
              }).addTo(map);
              
              // Store the polygon for later use
              window.aoiPolygon = polygon;
              window.aoiDrawingMode = 'none';
              console.log('Polygon completed');
              
              // Enable the 'Use Drawn Shape' button
              Shiny.setInputValue('", ns("shape_drawn"), "', Date.now(), {priority: 'event'});
            }
          };
          
          // Attach event handlers
          map.on('click', window.aoiClickHandler);
          map.on('dblclick', window.aoiDblClickHandler);
          console.log('Event handlers attached');
          
          // Update status
          var statusEl = document.getElementById('", ns("aoi_status_text"), "');
          if (statusEl) {
            statusEl.textContent = 'Click on the map to draw polygon points, double-click to finish';
          }
        } else {
          console.error('Map element or leafletMap not found');
        }
      "))
      
      shinyjs::html("aoi_status_text", "Click on the map to draw polygon points, double-click to finish")
    })
    
    # Start drawing rectangle
    observeEvent(input$start_draw_rectangle_btn, {
      cat("*** AOI: Starting rectangle drawing mode ***\n")
      drawing_mode("rectangle")
      
      # Enable rectangle drawing mode using JavaScript
      shinyjs::runjs(paste0("
        console.log('*** AOI: Rectangle button clicked ***');
        var mapElement = document.getElementById('", map_id, "');
        
        // Get the Leaflet map from the HTMLWidgets binding
        var map = null;
        if (mapElement && HTMLWidgets && HTMLWidgets.find) {
          var widget = HTMLWidgets.find('#", map_id, "');
          if (widget && widget.getMap) {
            map = widget.getMap();
          }
        }
        
        if (map) {
          console.log('Leaflet map found for rectangle');
          
          // Clear any existing event handlers
          if (window.aoiClickHandler) {
            map.off('click', window.aoiClickHandler);
          }
          if (window.aoiDblClickHandler) {
            map.off('dblclick', window.aoiDblClickHandler);
          }
          
          // Initialize drawing state
          window.aoiDrawingMode = 'rectangle';
          window.aoiStartPoint = null;
          console.log('Drawing mode set to rectangle');
          
          // Define click handler
          window.aoiClickHandler = function(e) {
            console.log('Map clicked for rectangle at:', e.latlng);
            if (window.aoiDrawingMode === 'rectangle') {
              if (!window.aoiStartPoint) {
                window.aoiStartPoint = [e.latlng.lat, e.latlng.lng];
                console.log('Rectangle start point set');
                
                // Add marker for start point
                L.marker([e.latlng.lat, e.latlng.lng], {
                  icon: L.divIcon({
                    className: 'aoi-point-marker',
                    html: '<div style=\"background: #e74c3c; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;\"></div>',
                    iconSize: [14, 14]
                  })
                }).addTo(map);
                
                var statusEl = document.getElementById('", ns("aoi_status_text"), "');
                if (statusEl) {
                  statusEl.textContent = 'Click again to set rectangle corner';
                }
              } else {
                // Create rectangle from start point to current point
                var bounds = L.latLngBounds([window.aoiStartPoint[0], window.aoiStartPoint[1]], [e.latlng.lat, e.latlng.lng]);
                var rectangle = L.rectangle(bounds, {
                  color: '#e74c3c',
                  weight: 2,
                  fillColor: '#e74c3c',
                  fillOpacity: 0.3
                }).addTo(map);
                
                window.aoiPolygon = rectangle;
                window.aoiDrawingMode = 'none';
                console.log('Rectangle completed');
                
                // Enable the 'Use Drawn Shape' button
                Shiny.setInputValue('", ns("shape_drawn"), "', Date.now(), {priority: 'event'});
              }
            }
          };
          
          // Attach event handler
          map.on('click', window.aoiClickHandler);
          console.log('Rectangle click handler attached');
          
          var statusEl = document.getElementById('", ns("aoi_status_text"), "');
          if (statusEl) {
            statusEl.textContent = 'Click to set rectangle start point';
          }
        } else {
          console.error('Map element or leafletMap not found');
        }
      "))
      
      shinyjs::html("aoi_status_text", "Click to set rectangle start point")
    })
    
    # Start drawing circle
    observeEvent(input$start_draw_circle_btn, {
      cat("*** AOI: Starting circle drawing mode ***\n")
      drawing_mode("circle")
      
      # Enable circle drawing mode using JavaScript
      shinyjs::runjs(paste0("
        console.log('*** AOI: Circle button clicked ***');
        var mapElement = document.getElementById('", map_id, "');
        
        // Get the Leaflet map from the HTMLWidgets binding
        var map = null;
        if (mapElement && HTMLWidgets && HTMLWidgets.find) {
          var widget = HTMLWidgets.find('#", map_id, "');
          if (widget && widget.getMap) {
            map = widget.getMap();
          }
        }
        
        if (map) {
          console.log('Leaflet map found for circle');
          
          // Clear any existing event handlers
          if (window.aoiClickHandler) {
            map.off('click', window.aoiClickHandler);
          }
          if (window.aoiDblClickHandler) {
            map.off('dblclick', window.aoiDblClickHandler);
          }
          
          // Initialize drawing state
          window.aoiDrawingMode = 'circle';
          window.aoiStartPoint = null;
          console.log('Drawing mode set to circle');
          
          // Define click handler
          window.aoiClickHandler = function(e) {
            console.log('Map clicked for circle at:', e.latlng);
            if (window.aoiDrawingMode === 'circle') {
              if (!window.aoiStartPoint) {
                window.aoiStartPoint = [e.latlng.lat, e.latlng.lng];
                console.log('Circle center point set');
                
                // Add marker for center point
                L.marker([e.latlng.lat, e.latlng.lng], {
                  icon: L.divIcon({
                    className: 'aoi-point-marker',
                    html: '<div style=\"background: #e74c3c; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;\"></div>',
                    iconSize: [14, 14]
                  })
                }).addTo(map);
                
                var statusEl = document.getElementById('", ns("aoi_status_text"), "');
                if (statusEl) {
                  statusEl.textContent = 'Click again to set circle radius';
                }
              } else {
                // Calculate radius from start point to current point
                var startLatLng = L.latLng(window.aoiStartPoint[0], window.aoiStartPoint[1]);
                var radius = startLatLng.distanceTo(e.latlng);
                console.log('Circle radius:', radius);
                
                // Create circle
                var circle = L.circle([window.aoiStartPoint[0], window.aoiStartPoint[1]], {
                  radius: radius,
                  color: '#e74c3c',
                  weight: 2,
                  fillColor: '#e74c3c',
                  fillOpacity: 0.3
                }).addTo(map);
                
                window.aoiPolygon = circle;
                window.aoiDrawingMode = 'none';
                console.log('Circle completed');
                
                // Enable the 'Use Drawn Shape' button
                Shiny.setInputValue('", ns("shape_drawn"), "', Date.now(), {priority: 'event'});
              }
            }
          };
          
          // Attach event handler
          map.on('click', window.aoiClickHandler);
          console.log('Circle click handler attached');
          
          var statusEl = document.getElementById('", ns("aoi_status_text"), "');
          if (statusEl) {
            statusEl.textContent = 'Click to set circle center';
          }
        } else {
          console.error('Map element or leafletMap not found');
        }
      "))
      
      shinyjs::html("aoi_status_text", "Click to set circle center")
    })
    
    # Handle shape drawn event
    observeEvent(input$shape_drawn, {
      cat("*** AOI: Shape drawn event received ***\n")
      
      # Enable the "Use Drawn Shape" button
      shinyjs::enable("use_drawn_shape_btn")
      shinyjs::html("aoi_status_text", "Shape drawn! Click 'Use Drawn Shape' to analyze this area.")
    })
    
    # Handle "Use Drawn Shape" button
    observeEvent(input$use_drawn_shape_btn, {
      cat("*** AOI: Using drawn shape ***\n")
      
      # Get the drawn shape from JavaScript
      shinyjs::runjs(paste0("
        (function() {
          if (window.aoiPolygon) {
            console.log('Converting shape to GeoJSON');
            console.log('Shape type:', window.aoiPolygon.constructor.name);
            
            // Get the actual coordinates from the shape
            var geojson;
            
            if (window.aoiPolygon.toGeoJSON) {
              // Use Leaflet's built-in toGeoJSON method
              geojson = window.aoiPolygon.toGeoJSON();
              console.log('GeoJSON created:', geojson);
              
              // For circles, we need to convert to polygon
              if (window.aoiPolygon instanceof L.Circle) {
                console.log('Circle detected, converting to polygon');
                // Get circle bounds and create a polygon approximation
                var center = window.aoiPolygon.getLatLng();
                var radius = window.aoiPolygon.getRadius();
                var numPoints = 32; // Number of points to approximate circle
                var coords = [];
                
                for (var i = 0; i < numPoints; i++) {
                  var angle = (i / numPoints) * 2 * Math.PI;
                  var dx = radius * Math.cos(angle);
                  var dy = radius * Math.sin(angle);
                  
                  // Convert meters to degrees (approximate)
                  var lat = center.lat + (dy / 111320);
                  var lng = center.lng + (dx / (111320 * Math.cos(center.lat * Math.PI / 180)));
                  coords.push([lng, lat]);
                }
                // Close the polygon
                coords.push(coords[0]);
                
                geojson = {
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'Polygon',
                    coordinates: [coords]
                  }
                };
                console.log('Circle converted to polygon GeoJSON');
              }
            } else {
              console.error('Shape does not have toGeoJSON method');
              return;
            }
            
            Shiny.setInputValue('", ns("drawn_shape_geojson"), "', geojson, {priority: 'event'});
          } else {
            console.error('No shape found in window.aoiPolygon');
          }
        })();
      "))
    })
    
    # Handle drawn shape GeoJSON
    observeEvent(input$drawn_shape_geojson, {
      req(input$drawn_shape_geojson)
      
      cat("*** AOI: Processing drawn shape GeoJSON ***\n")
      
      tryCatch({
        # Convert GeoJSON to sf object
        cat("*** AOI: Converting to JSON ***\n")
        geojson <- jsonlite::toJSON(input$drawn_shape_geojson, auto_unbox = TRUE)
        cat("*** AOI: GeoJSON string:", as.character(geojson), "***\n")
        
        cat("*** AOI: Converting to sf object ***\n")
        aoi_sf <- geojsonsf::geojson_sf(geojson)
        cat("*** AOI: sf object created with", nrow(aoi_sf), "features ***\n")
        
        # Validate and fix geometry
        cat("*** AOI: Validating geometry ***\n")
        if (!sf::st_is_valid(aoi_sf)) {
          cat("*** AOI: Geometry is invalid, attempting to fix ***\n")
          aoi_sf <- sf::st_make_valid(aoi_sf)
          cat("*** AOI: Geometry fixed ***\n")
        }
        
        # Set CRS to WGS84 if not set
        if (is.na(sf::st_crs(aoi_sf))) {
          cat("*** AOI: Setting CRS to WGS84 ***\n")
          sf::st_crs(aoi_sf) <- 4326
        }
        
        # Store AOI data
        aoi_data(aoi_sf)
        aoi_geometry(aoi_sf)
        drawn_shape(aoi_sf)
        
        # Update status
        shinyjs::html("aoi_status_text", paste("AOI selected:", nrow(aoi_sf), "feature(s)"))
        
        # Show loading indicator
        shinyjs::html("aoi_status_text", "Analyzing AOI... Please wait.")
        
        # Perform analysis
        cat("*** AOI: Starting analysis ***\n")
        perform_aoi_analysis()
        
      }, error = function(e) {
        cat("*** AOI: Error processing drawn shape:", e$message, "***\n")
        cat("*** AOI: Error class:", class(e), "***\n")
        cat("*** AOI: Full error:", toString(e), "***\n")
        print(e)
        shiny::showNotification(paste("Error processing drawn shape:", e$message), type = "error")
      })
    })
    
    # Handle shapefile upload
    observeEvent(input$upload_aoi_btn, {
      cat("*** AOI: Opening shapefile upload dialog ***\n")
      
      # Create file input for shapefile
      shiny::showModal(
        shiny::modalDialog(
          title = "Upload Shapefile for AOI",
          shiny::fileInput(
            session$ns("aoi_shapefile_upload"),
            "Choose Shapefile (.zip, .shp, .shx, .dbf, .prj)",
            multiple = TRUE,
            accept = c(".zip", ".shp", ".shx", ".dbf", ".prj")
          ),
          footer = tagList(
            shiny::actionButton(session$ns("upload_cancel"), "Cancel"),
            shiny::actionButton(session$ns("upload_confirm"), "Upload", class = "btn-primary")
          )
        )
      )
    })
    
    # Handle shapefile upload confirmation
    observeEvent(input$upload_confirm, {
      req(input$aoi_shapefile_upload)
      shiny::removeModal()
      
      cat("*** AOI: Processing uploaded shapefile ***\n")
      
      tryCatch({
        # Validate uploaded files
        files <- input$aoi_shapefile_upload
        required_extensions <- c("shp", "shx", "dbf", "prj")
        uploaded_extensions <- tools::file_ext(files$name)
        
        if (!all(required_extensions %in% uploaded_extensions)) {
          stop("Missing required shapefile components (.shp, .shx, .dbf, .prj)")
        }
        
        # Create a temporary directory for the shapefile
        temp_dir <- tempdir()
        file.copy(files$datapath, file.path(temp_dir, files$name))
        
        # Find the .shp file path
        shp_file_path <- file.path(temp_dir, files$name[which(uploaded_extensions == "shp")])
        
        # Read shapefile using sf
        aoi_sf <- sf::st_read(shp_file_path)
        
        # Store AOI data
        aoi_data(aoi_sf)
        aoi_geometry(aoi_sf)
        drawn_shape(aoi_sf)
        
        # Add AOI to map
        add_aoi_to_map(aoi_sf)
        
        # Update status
        shinyjs::html("aoi_status_text", paste("AOI uploaded:", nrow(aoi_sf), "feature(s)"))
        
        # Perform analysis
        perform_aoi_analysis()
        
      }, error = function(e) {
        cat("*** AOI: Error processing uploaded shapefile:", e$message, "***\n")
        shiny::showNotification(paste("Error processing uploaded shapefile:", e$message), type = "error")
      })
    })
    
    # Handle upload cancellation
    observeEvent(input$upload_cancel, {
      shiny::removeModal()
    })
    
    # Clear AOI
    observeEvent(input$clear_aoi_btn, {
      cat("*** AOI: Clearing AOI selection ***\n")
      
      # Clear reactive values
      aoi_data(NULL)
      aoi_geometry(NULL)
      aoi_analysis(NULL)
      drawn_shape(NULL)
      drawing_mode("none")
      
      # Clear AOI boundary group
      leaflet::leafletProxy(map_id) %>%
        leaflet::clearGroup("aoi")
      
      # Clear map using JavaScript
      shinyjs::runjs(paste0("
        console.log('*** AOI: Clearing map ***');
        var mapElement = document.getElementById('", map_id, "');
        
        // Get the Leaflet map from the HTMLWidgets binding
        var map = null;
        if (mapElement && HTMLWidgets && HTMLWidgets.find) {
          var widget = HTMLWidgets.find('#", map_id, "');
          if (widget && widget.getMap) {
            map = widget.getMap();
          }
        }
        
        if (map) {
          console.log('Map found, removing layers');
          
          // Remove predefined AOI layer if present
          if (window.predefinedAoiLayer) {
            map.removeLayer(window.predefinedAoiLayer);
            window.predefinedAoiLayer = null;
            console.log('Predefined AOI layer removed');
          }
          
          // Collect layers to remove (can't remove during iteration)
          var layersToRemove = [];
          
          map.eachLayer(function(layer) {
            // Remove AOI polygons, circles, rectangles
            if (layer.options && layer.options.color === '#e74c3c') {
              layersToRemove.push(layer);
            }
            // Remove markers with aoi-point-marker class
            if (layer instanceof L.Marker && layer.options.icon && 
                layer.options.icon.options && 
                layer.options.icon.options.className === 'aoi-point-marker') {
              layersToRemove.push(layer);
            }
            // Remove polylines (drawing guides)
            if (layer instanceof L.Polyline && layer.options.dashArray === '5, 5') {
              layersToRemove.push(layer);
            }
          });
          
          console.log('Removing', layersToRemove.length, 'layers');
          layersToRemove.forEach(function(layer) {
            map.removeLayer(layer);
          });
          
          // Remove event handlers
          if (window.aoiClickHandler) {
            map.off('click', window.aoiClickHandler);
            window.aoiClickHandler = null;
          }
          if (window.aoiDblClickHandler) {
            map.off('dblclick', window.aoiDblClickHandler);
            window.aoiDblClickHandler = null;
          }
          
          // Clear drawing mode and data
          window.aoiDrawingMode = 'none';
          window.aoiPoints = null;
          window.aoiStartPoint = null;
          window.aoiPolygon = null;
          
          console.log('*** AOI: Map cleared successfully ***');
        } else {
          console.error('Map not found for clearing');
        }
      "))
      
      # Disable the "Use Drawn Shape" button and update status
      shinyjs::disable("use_drawn_shape_btn")
      shinyjs::html("aoi_status_text", "Click a drawing button above to start drawing on the map, then click 'Use Drawn Shape'")
      shinyjs::hide("aoi_analysis_panel")
    })
    
    # Function to add AOI to map
    add_aoi_to_map <- function(aoi_sf) {
      # Convert to GeoJSON for Leaflet
      aoi_geojson <- geojsonsf::sf_geojson(aoi_sf)
      
      map <- leaflet::leafletProxy(map_id)
      print(map)
      map %>%
        leaflet::clearGroup("aoi") %>% # Clear existing AOI layers
        leaflet::addGeoJSON(
          aoi_geojson,
          group = "aoi",
          color = "#e74c3c",
          weight = 2,
          fillColor = "#e74c3c",
          fillOpacity = 0.3
        )
    }
    
    # Function to perform AOI analysis
    perform_aoi_analysis <- function() {
      # Debug flag - set to FALSE to reduce logging
      DEBUG_AOI <- FALSE
      
      # Show loading spinner (use id directly since we're in module scope)
      shinyjs::show(id = "aoi_loading", anim = TRUE, animType = "fade")
      
      tryCatch({
        req(aoi_data(), app_data$solutions)
        
        # Get selected solution - use the parent session input
        # The input is in the parent scope, not the module scope
        selected_solution_id <- session$input$solutionResultsPane_results_select
        if (DEBUG_AOI) cat("*** AOI: Selected solution ID (from parent):", selected_solution_id, "***\n")
        
        # If still not available, try getting from app_data
        if (is.null(selected_solution_id) || selected_solution_id == "") {
          cat("*** AOI: No solution selected from input, checking app_data ***\n")
          if (length(app_data$solution_ids) > 0) {
            # Use the last solution as default
            selected_solution_id <- app_data$solution_ids[length(app_data$solution_ids)]
            cat("*** AOI: Using last solution:", selected_solution_id, "***\n")
          } else {
            stop("No solutions available for analysis")
          }
        }
        
        req(selected_solution_id)
      
        solution_index <- which(app_data$solution_ids == selected_solution_id)
        cat("*** AOI: Solution index:", solution_index, "***\n")
        req(length(solution_index) > 0)
        
        solution_obj <- app_data$solutions[[solution_index]]
        cat("*** AOI: Solution object retrieved ***\n")
        
        solution_raster <- solution_obj$variable$get_data() # Assuming this gets a raster
        cat("*** AOI: Solution raster retrieved, class:", class(solution_raster), "***\n")
        
        aoi_sf <- aoi_data()
        cat("*** AOI: AOI sf object, CRS:", sf::st_crs(aoi_sf)$input, "***\n")
        
        # Project AOI to match solution CRS if necessary
        if (sf::st_crs(aoi_sf) != sf::st_crs(solution_raster)) {
          cat("*** AOI: Reprojecting AOI to match solution CRS ***\n")
          aoi_sf <- sf::st_transform(aoi_sf, sf::st_crs(solution_raster))
        }
        
        # Calculate AOI area
        aoi_area_m2 <- as.numeric(sf::st_area(aoi_sf))
        aoi_area_km2 <- aoi_area_m2 / 1000000 # Convert m^2 to km²
        aoi_area_ha <- aoi_area_m2 / 10000 # Convert m^2 to hectares (for backward compatibility)
        cat("*** AOI: AOI area:", aoi_area_km2, "km² (", aoi_area_ha, "ha) ***\n")
        
        # Clip solution raster to AOI
        # Ensure solution_raster is a terra SpatRaster
        if (!inherits(solution_raster, "SpatRaster")) {
          stop("Solution variable is not a SpatRaster object.")
        }
        
        # Mask the solution raster with the AOI polygon
        # First, rasterize the AOI to match the solution raster's extent and resolution
        cat("*** AOI: Rasterizing AOI ***\n")
        aoi_raster_mask <- terra::rasterize(aoi_sf, solution_raster, field = 1)
        
        cat("*** AOI: Masking solution raster ***\n")
        solution_clipped <- terra::mask(solution_raster, aoi_raster_mask)
        
        # Calculate solution area within AOI
        # Assuming solution_clipped values > 0.5 represent "selected" areas
        cat("*** AOI: Calculating solution area ***\n")
        solution_values <- terra::values(solution_clipped)
        
        # Count total cells in AOI (non-NA)
        total_cells_in_aoi <- sum(!is.na(solution_values))
        cat("*** AOI: Total cells in AOI:", total_cells_in_aoi, "***\n")
        
        # Count solution cells (values > 0.5)
        solution_cells_in_aoi <- sum(!is.na(solution_values) & solution_values > 0.5)
        cat("*** AOI: Solution cells in AOI:", solution_cells_in_aoi, "***\n")
        
        # Calculate cell area using terra's cellSize function (accounts for CRS)
        cell_area_m2 <- terra::cellSize(solution_raster, unit = "m")
        cat("*** AOI: Cell area range (m2):", paste(range(terra::values(cell_area_m2), na.rm = TRUE), collapse = " - "), "***\n")
        
        # Get cell areas for solution cells
        cell_areas_clipped <- terra::mask(cell_area_m2, aoi_raster_mask)
        solution_cell_areas <- terra::values(cell_areas_clipped)[!is.na(solution_values) & solution_values > 0.5]
        
        # Sum up the actual areas
        solution_area_in_aoi_ha <- sum(solution_cell_areas, na.rm = TRUE) / 10000 # Convert m^2 to hectares
        cat("*** AOI: Solution area in AOI:", solution_area_in_aoi_ha, "ha ***\n")
        
        # Calculate coverage percentage
        coverage_percentage <- if (total_cells_in_aoi > 0) (solution_cells_in_aoi / total_cells_in_aoi) * 100 else 0
        cat("*** AOI: Coverage percentage:", coverage_percentage, "% ***\n")
        
        # Store analysis results
        aoi_analysis(list(
          aoi_area_ha = aoi_area_ha,
          solution_area_in_aoi_ha = solution_area_in_aoi_ha,
          coverage_percentage = coverage_percentage
        ))
        
        # Update UI
        shinyjs::html("aoi_area_text", paste(round(aoi_area_km2, 2), "km²"))
        shinyjs::html("aoi_solution_coverage_text", paste(round(coverage_percentage, 2), "%"))
        shinyjs::show("aoi_analysis_panel")
        
        # Hide loading spinner
        shinyjs::hide(id = "aoi_loading", anim = TRUE, animType = "fade")
        shinyjs::html(id = "aoi_status_text", html = "Analysis complete!")
        
        # Generate theme overlap charts (one per feature)
        output$aoi_theme_overlap_chart <- shiny::renderUI({
          cat("*** AOI: Generating theme overlap charts ***\n")
          
          # Show loading spinner while rendering
          shinyjs::show(id = "aoi_loading", anim = TRUE, animType = "fade")
          
          # Check if themes exist
          if (is.null(app_data$themes) || length(app_data$themes) == 0) {
            cat("*** AOI: No themes available ***\n")
            return(htmltools::tags$p("No themes available", style = "text-align: center; color: #999;"))
          }
          
          theme_charts <- list()
          
          # Iterate through each theme
          for (theme_idx in seq_along(app_data$themes)) {
            theme <- app_data$themes[[theme_idx]]
            theme_name <- theme$name
            # cat("*** AOI: Processing theme:", theme_name, "***\n")
            
            # Each theme has features (layers)
            for (feature_idx in seq_along(theme$feature)) {
              feature <- theme$feature[[feature_idx]]
              feature_name <- feature$name
              # cat("*** AOI:   Processing feature:", feature_name, "***\n")
              
              tryCatch({
                # Get the feature raster
                feature_raster <- feature$variable$get_data()
                # cat("*** AOI:     Feature raster class:", class(feature_raster), "***\n")
                # cat("*** AOI:     Feature raster dimensions:", paste(dim(feature_raster), collapse = "x"), "***\n")
                
                # Resample feature to match solution raster if needed
                if (!terra::compareGeom(feature_raster, solution_raster, stopOnError = FALSE)) {
                  cat("*** AOI:     Resampling feature to match solution raster ***\n")
                  feature_raster <- terra::resample(feature_raster, solution_raster, method = "near")
                }
                
                # Mask feature raster to AOI
                feature_clipped <- terra::mask(feature_raster, aoi_raster_mask)
                feature_values <- terra::values(feature_clipped)
                
                # Get solution values (already clipped to AOI)
                solution_values_for_feature <- terra::values(solution_clipped)
                
                # Verify they have the same length
                if (length(feature_values) != length(solution_values_for_feature)) {
                  cat("*** AOI:     WARNING: Feature and solution have different lengths:", 
                      length(feature_values), "vs", length(solution_values_for_feature), "***\n")
                  # Skip this feature
                  return(NULL)
                }
                
                # Calculate areas using cell sizes (already clipped to AOI)
                cell_areas_feature <- terra::values(terra::mask(cell_area_m2, aoi_raster_mask))
                
                # Check if this is a continuous raster (richness/abundance data)
                max_value <- max(feature_values, na.rm = TRUE)
                min_value <- min(feature_values[feature_values > 0], na.rm = TRUE)
                unique_values <- length(unique(feature_values[!is.na(feature_values) & feature_values > 0]))
                
                # cat("*** AOI:     Feature value range:", min_value, "to", max_value, 
                #     ", Unique values:", unique_values, "***\n")
                
                # Determine if continuous (many unique values) or binary (few unique values)
                is_continuous <- unique_values > 10
                
                if (is_continuous) {
                  # cat("*** AOI:     Detected continuous raster - using richness binning ***\n")
                  
                  # Create bins: Low, Medium, High (thirds based on max value)
                  low_threshold <- max_value / 3
                  high_threshold <- (max_value * 2) / 3
                  
                  # cat("*** AOI:     Richness bins - Low: 0-", round(low_threshold, 2), 
                  #     ", Medium:", round(low_threshold, 2), "-", round(high_threshold, 2),
                  #     ", High:", round(high_threshold, 2), "-", round(max_value, 2), "***\n")
                  
                  # Calculate area for each richness category
                  low_richness_mask <- !is.na(feature_values) & feature_values > 0 & feature_values <= low_threshold
                  med_richness_mask <- !is.na(feature_values) & feature_values > low_threshold & feature_values <= high_threshold
                  high_richness_mask <- !is.na(feature_values) & feature_values > high_threshold
                  
                  # Count cells in each category
                  low_cells <- sum(low_richness_mask)
                  med_cells <- sum(med_richness_mask)
                  high_cells <- sum(high_richness_mask)
                  # cat("*** AOI:     Cell counts - Low:", low_cells, ", Med:", med_cells, ", High:", high_cells, "***\n")
                  
                  # Total area for each richness category in AOI
                  low_area_km2 <- sum(cell_areas_feature[low_richness_mask], na.rm = TRUE) / 1000000
                  med_area_km2 <- sum(cell_areas_feature[med_richness_mask], na.rm = TRUE) / 1000000
                  high_area_km2 <- sum(cell_areas_feature[high_richness_mask], na.rm = TRUE) / 1000000
                  
                  # cat("*** AOI:     Total areas - Low:", low_area_km2, "km², Med:", med_area_km2, 
                  #     "km², High:", high_area_km2, "km² ***\n")
                  
                  # Calculate solution coverage for each richness category
                  # This is: area where BOTH (richness category) AND (solution) are present
                  low_solution_mask <- low_richness_mask & !is.na(solution_values_for_feature) & solution_values_for_feature > 0.5
                  med_solution_mask <- med_richness_mask & !is.na(solution_values_for_feature) & solution_values_for_feature > 0.5
                  high_solution_mask <- high_richness_mask & !is.na(solution_values_for_feature) & solution_values_for_feature > 0.5
                  
                  low_solution_cells <- sum(low_solution_mask)
                  med_solution_cells <- sum(med_solution_mask)
                  high_solution_cells <- sum(high_solution_mask)
                  # cat("*** AOI:     Solution cells - Low:", low_solution_cells, ", Med:", med_solution_cells, 
                  #     ", High:", high_solution_cells, "***\n")
                  
                  low_solution_km2 <- sum(cell_areas_feature[low_solution_mask], na.rm = TRUE) / 1000000
                  med_solution_km2 <- sum(cell_areas_feature[med_solution_mask], na.rm = TRUE) / 1000000
                  high_solution_km2 <- sum(cell_areas_feature[high_solution_mask], na.rm = TRUE) / 1000000
                  
                  # cat("*** AOI:     Solution areas - Low:", low_solution_km2, "km², Med:", med_solution_km2, 
                  #     "km², High:", high_solution_km2, "km² ***\n")
                  
                  # Calculate coverage percentages
                  low_pct <- if (low_area_km2 > 0) (low_solution_km2 / low_area_km2) * 100 else 0
                  med_pct <- if (med_area_km2 > 0) (med_solution_km2 / med_area_km2) * 100 else 0
                  high_pct <- if (high_area_km2 > 0) (high_solution_km2 / high_area_km2) * 100 else 0
                  
                  # cat("*** AOI:     Coverage % - Low:", low_pct, "%, Med:", med_pct, "%, High:", high_pct, "% ***\n")
                  
                  # Store data for continuous chart (will be handled differently)
                  is_continuous_feature <- TRUE
                  richness_data <- list(
                    low = list(area = low_area_km2, solution = low_solution_km2, pct = low_pct),
                    med = list(area = med_area_km2, solution = med_solution_km2, pct = med_pct),
                    high = list(area = high_area_km2, solution = high_solution_km2, pct = high_pct)
                  )
                  
                } else {
                  # cat("*** AOI:     Detected binary/categorical raster - using presence/absence ***\n")
                  is_continuous_feature <- FALSE
                  
                  # Count cells with theme data
                  theme_cells <- sum(!is.na(feature_values) & feature_values > 0)
                  # cat("*** AOI:     Theme cells:", theme_cells, "***\n")
                  
                  # Total theme area in AOI (km²)
                  theme_area_km2 <- sum(cell_areas_feature[!is.na(feature_values) & feature_values > 0], na.rm = TRUE) / 1000000
                  
                  # Solution coverage of theme area (km²)
                  solution_coverage_km2 <- sum(cell_areas_feature[!is.na(feature_values) & feature_values > 0 & 
                                                                  !is.na(solution_values_for_feature) & solution_values_for_feature > 0.5], na.rm = TRUE) / 1000000
                  
                  # Calculate percentage
                  coverage_pct <- if (theme_area_km2 > 0) (solution_coverage_km2 / theme_area_km2) * 100 else 0
                  
                  # cat("*** AOI:     Theme area:", theme_area_km2, "km², Solution coverage:", solution_coverage_km2, 
                  #     "km², Coverage %:", coverage_pct, "***\n")
                }
                
                # Create individual chart for this feature
                chart_id <- paste0("theme_chart_", theme_idx, "_", feature_idx)
                
                if (is_continuous_feature) {
                  # Check if any richness data exists in AOI
                  total_richness_area <- richness_data$low$area + richness_data$med$area + richness_data$high$area
                  
                  if (total_richness_area == 0) {
                    # No data in AOI - show grayed out message
                    theme_charts[[length(theme_charts) + 1]] <- htmltools::tags$div(
                      class = "theme-feature-chart",
                      style = "margin-bottom: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 5px; border-left: 4px solid #dee2e6; opacity: 0.6;",
                      htmltools::tags$div(
                        style = "display: flex; align-items: center; gap: 8px;",
                        htmltools::tags$span(
                          shiny::icon("info-circle"),
                          style = "color: #95a5a6;"
                        ),
                        htmltools::tags$div(
                          htmltools::tags$strong(feature_name, style = "font-size: 12px; color: #7f8c8d;"),
                          htmltools::tags$div(
                            paste0("(", theme_name, ") - No data in AOI"),
                            style = "font-size: 11px; color: #95a5a6; margin-top: 2px; font-style: italic;"
                          )
                        )
                      )
                    )
                  } else {
                    # Create chart for continuous richness data with three categories
                    theme_charts[[length(theme_charts) + 1]] <- htmltools::tags$div(
                    class = "theme-feature-chart",
                    style = "margin-bottom: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 5px; border-left: 4px solid #9b59b6;",
                    
                    # Feature name
                    htmltools::tags$div(
                      style = "margin-bottom: 10px;",
                      htmltools::tags$strong(
                        feature_name,
                        style = "font-size: 13px; color: #2c3e50;"
                      ),
                      htmltools::tags$span(
                        paste0(" (", theme_name, ")"),
                        style = "font-size: 11px; color: #7f8c8d;"
                      ),
                      htmltools::tags$div(
                        "Richness Categories",
                        style = "font-size: 11px; color: #7f8c8d; font-style: italic; margin-top: 3px;"
                      )
                    ),
                    
                    # Three rows for Low/Medium/High richness
                    htmltools::tags$div(
                      style = "display: flex; flex-direction: column; gap: 8px;",
                      
                      # Low richness
                      if (richness_data$low$area > 0) {
                        htmltools::tags$div(
                          style = "display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px;",
                          htmltools::tags$div(
                            style = "display: flex; justify-content: space-between; align-items: center;",
                            htmltools::tags$strong("Low Richness", style = "font-size: 11px; color: #27ae60;"),
                            htmltools::tags$span(
                              paste0(round(richness_data$low$pct, 1), "% covered"),
                              style = "font-size: 10px; color: #e74c3c; font-weight: bold;"
                            )
                          ),
                          htmltools::tags$div(
                            style = "display: flex; align-items: center; gap: 8px;",
                            htmltools::tags$div(
                              style = "flex: 1; position: relative; height: 24px;",
                              # Gray background bar (total area)
                              htmltools::tags$div(
                                style = "position: absolute; width: 100%; height: 100%; background-color: #bdc3c7; border-radius: 3px;"
                              ),
                              # Blue overlay bar (solution coverage)
                              htmltools::tags$div(
                                style = paste0("position: absolute; height: 100%; background-color: #3498db; border-radius: 3px; width: ",
                                              min(100, richness_data$low$pct), "%;")
                              )
                            ),
                            htmltools::tags$span(
                              paste0(round(richness_data$low$solution, 1), " / ", round(richness_data$low$area, 1), " km²"),
                              style = "font-size: 10px; color: #34495e; white-space: nowrap; min-width: 100px;"
                            )
                          )
                        )
                      } else {
                        htmltools::tags$div(
                          style = "font-size: 10px; color: #95a5a6; font-style: italic; margin-bottom: 10px;",
                          "Low Richness: Not present in AOI"
                        )
                      },
                      
                      # Medium richness
                      if (richness_data$med$area > 0) {
                        htmltools::tags$div(
                          style = "display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px;",
                          htmltools::tags$div(
                            style = "display: flex; justify-content: space-between; align-items: center;",
                            htmltools::tags$strong("Medium Richness", style = "font-size: 11px; color: #f39c12;"),
                            htmltools::tags$span(
                              paste0(round(richness_data$med$pct, 1), "% covered"),
                              style = "font-size: 10px; color: #e74c3c; font-weight: bold;"
                            )
                          ),
                          htmltools::tags$div(
                            style = "display: flex; align-items: center; gap: 8px;",
                            htmltools::tags$div(
                              style = "flex: 1; position: relative; height: 24px;",
                              # Gray background bar (total area)
                              htmltools::tags$div(
                                style = "position: absolute; width: 100%; height: 100%; background-color: #bdc3c7; border-radius: 3px;"
                              ),
                              # Blue overlay bar (solution coverage)
                              htmltools::tags$div(
                                style = paste0("position: absolute; height: 100%; background-color: #3498db; border-radius: 3px; width: ",
                                              min(100, richness_data$med$pct), "%;")
                              )
                            ),
                            htmltools::tags$span(
                              paste0(round(richness_data$med$solution, 1), " / ", round(richness_data$med$area, 1), " km²"),
                              style = "font-size: 10px; color: #34495e; white-space: nowrap; min-width: 100px;"
                            )
                          )
                        )
                      } else {
                        htmltools::tags$div(
                          style = "font-size: 10px; color: #95a5a6; font-style: italic; margin-bottom: 10px;",
                          "Medium Richness: Not present in AOI"
                        )
                      },
                      
                      # High richness
                      if (richness_data$high$area > 0) {
                        htmltools::tags$div(
                          style = "display: flex; flex-direction: column; gap: 3px;",
                          htmltools::tags$div(
                            style = "display: flex; justify-content: space-between; align-items: center;",
                            htmltools::tags$strong("High Richness", style = "font-size: 11px; color: #e74c3c;"),
                            htmltools::tags$span(
                              paste0(round(richness_data$high$pct, 1), "% covered"),
                              style = "font-size: 10px; color: #e74c3c; font-weight: bold;"
                            )
                          ),
                          htmltools::tags$div(
                            style = "display: flex; align-items: center; gap: 8px;",
                            htmltools::tags$div(
                              style = "flex: 1; position: relative; height: 24px;",
                              # Gray background bar (total area)
                              htmltools::tags$div(
                                style = "position: absolute; width: 100%; height: 100%; background-color: #bdc3c7; border-radius: 3px;"
                              ),
                              # Blue overlay bar (solution coverage)
                              htmltools::tags$div(
                                style = paste0("position: absolute; height: 100%; background-color: #3498db; border-radius: 3px; width: ",
                                              min(100, richness_data$high$pct), "%;")
                              )
                            ),
                            htmltools::tags$span(
                              paste0(round(richness_data$high$solution, 1), " / ", round(richness_data$high$area, 1), " km²"),
                              style = "font-size: 10px; color: #34495e; white-space: nowrap; min-width: 100px;"
                            )
                          )
                        )
                      } else {
                        htmltools::tags$div(
                          style = "font-size: 10px; color: #95a5a6; font-style: italic;",
                          "High Richness: Not present in AOI"
                        )
                      }
                    )
                  )
                  }
                  
                } else {
                  # Check if any theme data exists in AOI
                  if (theme_area_km2 == 0) {
                    # No data in AOI - show grayed out message
                    theme_charts[[length(theme_charts) + 1]] <- htmltools::tags$div(
                      class = "theme-feature-chart",
                      style = "margin-bottom: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 5px; border-left: 4px solid #dee2e6; opacity: 0.6;",
                      htmltools::tags$div(
                        style = "display: flex; align-items: center; gap: 8px;",
                        htmltools::tags$span(
                          shiny::icon("info-circle"),
                          style = "color: #95a5a6;"
                        ),
                        htmltools::tags$div(
                          htmltools::tags$strong(feature_name, style = "font-size: 12px; color: #7f8c8d;"),
                          htmltools::tags$div(
                            paste0("(", theme_name, ") - No data in AOI"),
                            style = "font-size: 11px; color: #95a5a6; margin-top: 2px; font-style: italic;"
                          )
                        )
                      )
                    )
                  } else {
                    # Create chart for binary/categorical data (original format)
                    theme_charts[[length(theme_charts) + 1]] <- htmltools::tags$div(
                      class = "theme-feature-chart",
                      style = "margin-bottom: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 5px; border-left: 4px solid #3498db;",
                      
                      # Feature name and coverage percentage
                      htmltools::tags$div(
                        style = "margin-bottom: 8px;",
                        htmltools::tags$strong(
                          feature_name,
                          style = "font-size: 13px; color: #2c3e50;"
                        ),
                        htmltools::tags$span(
                          paste0(" (", theme_name, ")"),
                          style = "font-size: 11px; color: #7f8c8d;"
                        ),
                        htmltools::tags$div(
                          paste0("Coverage: ", round(coverage_pct, 1), "%"),
                          style = "font-size: 12px; color: #e74c3c; font-weight: bold; margin-top: 3px;"
                        )
                      ),
                    
                    # Bar chart showing theme area with solution overlay
                    htmltools::tags$div(
                      style = "display: flex; align-items: center; gap: 8px; margin-top: 5px;",
                      htmltools::tags$div(
                        style = "flex: 1; position: relative; height: 28px;",
                        # Gray background bar (total theme area in AOI)
                        htmltools::tags$div(
                          style = "position: absolute; width: 100%; height: 100%; background-color: #bdc3c7; border-radius: 3px;"
                        ),
                        # Blue overlay bar (solution coverage)
                        htmltools::tags$div(
                          style = paste0("position: absolute; height: 100%; background-color: #3498db; border-radius: 3px; width: ",
                                        if (theme_area_km2 > 0) min(100, (solution_coverage_km2 / theme_area_km2) * 100) else 0, "%;")
                        )
                      ),
                      htmltools::tags$span(
                        paste0(round(solution_coverage_km2, 1), " / ", round(theme_area_km2, 1), " km²"),
                        style = "font-size: 11px; color: #34495e; white-space: nowrap; min-width: 100px;"
                      )
                    )
                  )
                  }
                }
              }, error = function(e) {
                cat("*** AOI:     Error processing feature:", e$message, "***\n")
              })
            }
          }
          
          # Return all charts
          if (length(theme_charts) == 0) {
            shinyjs::hide(id = "aoi_loading", anim = TRUE, animType = "fade")
            return(htmltools::tags$p("No theme data available", style = "text-align: center; color: #999;"))
          }
          
          # Hide loading spinner
          shinyjs::hide(id = "aoi_loading", anim = TRUE, animType = "fade")
          
          htmltools::tagList(theme_charts)
        })
        
        cat("*** AOI: Analysis completed successfully ***\n")
        
      }, error = function(e) {
        cat("*** AOI: Error in perform_aoi_analysis:", e$message, "***\n")
        cat("*** AOI: Error class:", class(e), "***\n")
        print(e)
        shiny::showNotification(paste("Error performing AOI analysis:", e$message), type = "error")
      })
    }
  })
}