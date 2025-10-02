library(leaflet)

mapUI <- function(id) {
  ns <- NS(id)
  tagList(
    selectInput(ns("project_select"), "Select Project", choices = NULL),
    leafletOutput(ns("map"))
  )
}

mapServer <- function(id, client, auth_token, projects_data) {
  moduleServer(id, function(input, output, session) {
    ns <- session$ns

    # GraphQL query to get files by project ID
    files_query <- '
    query($projectId: ID!) {
      project_files(projectId: $projectId) {
        id
        path
        name
      }
    }'

    # Update dropdown choices when projects_data changes
    observeEvent(projects_data(), {
      proj_df <- projects_data()
      if (nrow(proj_df) > 0) {
        choices <- setNames(proj_df$id, proj_df$title)
        updateSelectInput(session, "project_select", choices = choices)
      }
    }, ignoreNULL = FALSE)

    # Reactive for files related to selected project
    files_reactive <- reactiveVal(list())

    observeEvent(input$project_select, {
      req(input$project_select)

      qry <- Query$new()
      qry$query("project_files", files_query)
        print(input$project_select)

      tryCatch({
        res <- client$exec(
          qry$queries$project_files,
          headers = list(Authorization = paste("Bearer", auth_token())),
          variables = list(projectId = as.character(input$project_select))
        )
        res_list <- jsonlite::fromJSON(res)
        print(res_list)
        # Extract files list
        files <- res_list$data$project_files
        print("files:")
        print(files)
        if (is.null(files)) files <- list()
        files_reactive(files)
      }, error = function(e) {
        showNotification(paste("Failed to fetch files:", e$message), type = "error")
        files_reactive(list())
      })
    })

    output$map <- renderLeaflet({
      # Base map
      leaflet() %>% addTiles()
    })

    # Update leaflet map overlays when files_reactive changes
    observeEvent(files_reactive(), {
      files <- files_reactive()
        # Make sure files is always a data.frame
        if (is.null(files) || length(files) == 0) {
            files <- data.frame(id = character(), path = character(), name = character(), stringsAsFactors = FALSE)
        }

      leafletProxy("map", session) %>% clearImages()
        print(files)
      # For each file, add raster image overlay
      # Assuming files$path are relative/absolute paths to .tif files accessible by the app
      if (nrow(files) > 0) {
        for (i in seq_len(nrow(files))) {
            f <- files[i, ]
            try({
                print(f)
                # Convert to RasterLayer for leaflet
                rast_layer <- raster::raster(f$path)
                print(rast_layer)
                
                # Convert terra raster to something leaflet can use
                # leaflet supports SpatRaster directly with addRasterImage since leaflet 2.0.0+
                leafletProxy("map", session) %>%
                    addRasterImage(rast_layer, colors = colorNumeric("viridis", values(rast_layer), na.color = "transparent"), opacity = 0.5, layerId = f$id)
                }, silent = TRUE)
            }
        }
     })
  })
}

