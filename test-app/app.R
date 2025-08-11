library(shiny)
library(ghql)
library(DT)

# Initialize GraphQL client
client <- GraphqlClient$new(url = "http://localhost:3001/graphql")

# Login mutation
login_mutation <- '
mutation($username: String!, $password: String!) {
  userSignOn(username: $username, password: $password) {
    token
    user {
      id
      username
    }
  }
}'

# Projects query
projects_query <- '
query {
  projects {
    id
    title
    description
  }
}'

# Add file mutation

# Add project mutation
add_project_mutation <- '
  mutation($input: ProjectInput!) {
    addProject(input: $input) {
      id
      title
    }
  }
'

ui <- fluidPage(
  tags$h2("Project Management App"),

  fluidRow(
    column(4,
           wellPanel(
             h3("Login"),
             textInput("username", "Username"),
             passwordInput("password", "Password"),
             actionButton("login_btn", "Login"),
             verbatimTextOutput("login_status")
           )
    ),
    column(8,
           wellPanel(
             h3("Projects"),
             DTOutput("projects_table"),
             uiOutput("add_project_ui")
           )
    )
  )
)

server <- function(input, output, session) {
  
  # Reactive values for login state and token
  user_info <- reactiveVal(NULL)
  auth_token <- reactiveVal(NULL)

  
  # Login handler
  observeEvent(input$login_btn, {
    req(input$username, input$password)
    
    qry <- Query$new()
    qry$query("login", login_mutation)
    
    tryCatch({
      res <- client$exec(qry$queries$login, variables = list(
        username = input$username,
        password = input$password
      ))
      res_list <- jsonlite::fromJSON(res)
      
      if (!is.null(res_list$data$userSignOn$token)) {
        auth_token(res_list$data$userSignOn$token)
        user_info(res_list$data$userSignOn$user)
        output$login_status <- renderText(paste("Logged in as:", user_info()$username))
        showNotification("Login successful!", type = "message")
        print(user_info())
      } else {
        output$login_status <- renderText("Login failed: Invalid credentials")
        showNotification("Login failed", type = "error")
      }
    }, error = function(e) {
      output$login_status <- renderText(paste("Login error:", e$message))
      showNotification("Login error", type = "error")
    })
  })
  
  # Fetch projects from DB
  projects_data <- reactiveVal(data.frame())
  
  fetch_projects <- function() {
    qry <- Query$new()
    qry$query("projects", projects_query)
    tryCatch({
      res <- client$exec(qry$queries$projects)
      res_list <- jsonlite::fromJSON(res)
      projects <- res_list$data$projects
      projects_data(as.data.frame(projects))
    }, error = function(e) {
      showNotification("Failed to fetch projects", type = "error")
    })
  }
  
  # Fetch projects initially and after login
  observeEvent(auth_token(), {
    fetch_projects()
  })
  
  # Render projects table
  output$projects_table <- renderDT({
    df <- projects_data()
    if (nrow(df) == 0) {
      return(datatable(data.frame(Message = "No projects found"), options = list(dom = 't')))
    }
    datatable(df[, c("id", "title", "description")], 
              rownames = FALSE,
              colnames = c("ID", "Title", "Description"))
  })
  
  # Show Add Project button only if logged in
  output$add_project_ui <- renderUI({
    req(user_info())
    tagList(
      actionButton("show_add_project", "Add New Project")
    )
  })
  
  # Show modal to add project
  observeEvent(input$show_add_project, {
    showModal(modalDialog(
      title = "Add New Project",
      textInput("project_title", "Project Title"),
      textAreaInput("project_description", "Description", ""),
      textInput("project_user_group", "User Group", value = "public"),
      fileInput("project_files", "Upload Project Files (.tif)", multiple = TRUE, accept = ".tif"),
      footer = tagList(
        modalButton("Cancel"),
        actionButton("submit_project", "Submit")
      ),
      size = "m",
      easyClose = TRUE
    ))
  })
  
  # Handle project submission
  observeEvent(input$submit_project, {
    req(input$project_title)
    req(user_info())

    print(user_info())
    
    # 1. Upload files first and collect their IDs
    file_ids <- list()
    print(input$project_files)
    # Let's say input$project_files is a multi-file input of project files
    if (!is.null(input$project_files)) {
      files_df <- as.data.frame(input$project_files)
      print("upload files")
      for (i in seq_len(nrow(files_df))) {
        file_path <- input$project_files$datapath[i]
        file_name <- input$project_files$name[i]
        
        # Build your addFile mutation
        file_mutation <- '
          mutation($uploaderId: ID!, $path: String!) {
            addFile(uploaderId: $uploaderId, path: $path) {
              id
              path
            }
          }
        '
        
        qry_file <- Query$new()
        qry_file$query("addFile", file_mutation)
        
        tryCatch({
          res_file <- client$exec(
            qry_file$queries$addFile,
            headers = list(Authorization = paste("Bearer", auth_token())),
            variables = list(
              uploaderId = user_info()$id,
              path = file_path
            )
          )
          res_file_list <- jsonlite::fromJSON(res_file)
          file_ids <- c(unlist(file_ids), res_file_list$data$addFile$id)

        }, error = function(e) {
          showNotification(paste("Error adding file:", e$message), type = "error")
        })
      }
    }
 

    
    qry_proj <- Query$new()
    qry_proj$query("addProject", add_project_mutation)
    
    tryCatch({
      print(user_info()$id)
      print(file_ids)

      owner_id_str <- as.character(user_info()$id)
      file_ids <- unlist(file_ids, use.names = FALSE)

      payload <- list(
        input = list(
          ownerId = owner_id_str,
          title = input$project_title,
          description = input$project_description,
          userGroup = input$project_user_group,
          fileIds = file_ids
        )
      )

      cat("DEBUG — GraphQL variables payload:\n")
      cat(jsonlite::toJSON(payload, pretty = TRUE, auto_unbox = TRUE), "\n")

      res_proj <- client$exec(
        qry_proj$queries$addProject,
        headers = list(Authorization = paste("Bearer", auth_token())),
        variables = payload
      )
      res_list <- jsonlite::fromJSON(res_proj)
      new_project <- res_list$data$addProject
      
      showNotification(paste("Project created:", new_project$title), type = "message")
      removeModal()
      fetch_projects()  # refresh project list
    }, error = function(e) {
      showNotification(paste("Error creating project:", e$message), type = "error")
    })
  })
}

shinyApp(ui, server)








# library(shiny)
# library(DT)
# library(yaml)    # For YAML generation
# library(jsonlite) # For JSON parsing
# library(ghql)

# # Simulate existing uploaded rasters (for demo)
# existing_rasters <- c("Biomas/Orobioma.tif", "Especies/aves.tif", "Especies/mammalia.tif")

# # Initialize GraphQL client once
# client <- GraphqlClient$new(url = "http://localhost:3001/graphql")

# ui <- fluidPage(
#   titlePanel("Upload Metadata and Raster Layers"),
  
#   sidebarLayout(
#     sidebarPanel(
#       fileInput("metadata_csv", "Upload Metadata CSV", accept = ".csv"),
#       uiOutput("layer_inputs_ui"),
#       fileInput("solution_raster", "Upload Solution Raster (.tif)", accept = ".tif"),
#       textInput("solution_title", "Solution Title", value = "My Solution"),
#       textInput("solution_description", "Solution Description", value = "Description here..."),
#       textInput("author_name", "Author Name", value = "Author Example"),
#       textInput("author_email", "Author Email", value = "author@example.com"),
#       actionButton("submit_btn", "Submit to Database")
#     ),
    
#     mainPanel(
#       h4("Uploaded Metadata Preview"),
#       DTOutput("metadata_preview"),
#       verbatimTextOutput("submit_status")
#     )
#   )
# )

# server <- function(input, output, session) {
  
#   # Reactive: read the metadata CSV
#   metadata <- reactive({
#     req(input$metadata_csv)
#     df <- read.csv(input$metadata_csv$datapath, stringsAsFactors = FALSE)
#     df
#   })
  
#   # Show metadata preview
#   output$metadata_preview <- renderDT({
#     req(metadata())
#     datatable(metadata())
#   })
  
#   # Dynamically generate upload/select inputs per layer in metadata
#   output$layer_inputs_ui <- renderUI({
#     req(metadata())
#     layers <- metadata()$File
    
#     if (length(layers) == 0) return(NULL)
    
#     lapply(seq_along(layers), function(i) {
#       layer_name <- layers[i]
      
#       fluidRow(
#         column(6,
#                selectInput(
#                  inputId = paste0("existing_layer_", i),
#                  label = paste0("Select existing raster for layer: ", layer_name),
#                  choices = c("", existing_rasters),
#                  selected = ""
#                )
#         ),
#         column(6,
#                fileInput(
#                  inputId = paste0("upload_layer_", i),
#                  label = paste0("Or upload raster for layer: ", layer_name),
#                  accept = ".tif",
#                  multiple = FALSE
#                )
#         )
#       )
#     })
#   })
  
#   # Prepare the GraphQL mutation query once
#   addSolution_mutation <- '
#     mutation($input: SolutionInput!) {
#       addSolution(input: $input) {
#         id
#         title
#         layers {
#           id
#           name
#           file {
#             path
#           }
#         }
#       }
#     }
#   '
  
#   qry <- Query$new()
#   qry$query("addSolutionMutation", addSolution_mutation)
  
#   observeEvent(input$submit_btn, {
#     req(metadata())
#     layers <- metadata()$File
#     n_layers <- length(layers)
    
#     # Collect raster file info for each layer
#     layer_files <- vector("list", n_layers)
#     for (i in seq_len(n_layers)) {
#       upload_input <- input[[paste0("upload_layer_", i)]]
#       existing_choice <- input[[paste0("existing_layer_", i)]]
      
#       if (!is.null(upload_input)) {
#         layer_files[[i]] <- upload_input$datapath
#       } else if (!is.null(existing_choice) && nzchar(existing_choice)) {
#         layer_files[[i]] <- existing_choice
#       } else {
#         showNotification(paste0("Layer '", layers[i], "' needs a raster file (upload or select)."), type = "error")
#         return(NULL)
#       }
#     }
    
#     if (is.null(input$solution_raster)) {
#       showNotification("Please upload the solution raster file.", type = "error")
#       return(NULL)
#     }
#     solution_file <- input$solution_raster$datapath
    
#     # --- YAML generation (optional) ---
#     yaml_list <- list(
#       metadata = metadata(),
#       layers = setNames(layer_files, layers),
#       solution = solution_file
#     )
    
#     yaml_text <- as.yaml(yaml_list)
#     writeLines(yaml_text, con = "uploaded_data.yaml")
    
#     # Build layers input for GraphQL mutation
#     # Here I assign dummy values for fields like type, theme, etc.
#     # You can replace or extend with actual user inputs or metadata fields
    
#     layers_input <- lapply(seq_along(layers), function(i) {
#       list(
#         type = "raster ",                      # static example
#         theme = "default",                    # static example
#         fileId = "1",                        # TODO: Replace with actual file ID after uploading files
#         name = layers[i],
#         legend = paste("Legend for", layers[i]),
#         values = c("val1", "val2"),          # Example static
#         color = c("#FF0000", "#00FF00"),
#         labels = c("label1", "label2"),
#         unit = "units",
#         provenance = "user-uploaded",
#         order = i,
#         visible = TRUE,
#         goal = 0.5,
#         downloadable = TRUE
#       )
#     })
    
#     # Build the solution input object for the mutation
#     solution_input <- list(
#       projectId = "1",       # TODO: Replace with actual project ID
#       authorId = "123",      # TODO: Replace with logged-in user ID
#       title = input$solution_title,
#       description = input$solution_description,
#       authorName = input$author_name,
#       authorEmail = input$author_email,
#       userGroup = "public",  # or based on user session
#       layers = layers_input
#     )
    
#     # Execute the GraphQL mutation
#     res <- tryCatch({
#       client$exec(
#         qry$queries$addSolutionMutation,
#         variables = list(input = solution_input)
#       )
#     }, error = function(e) {
#       e$message
#     })
    
#     output$submit_status <- renderPrint({
#       if (startsWith(res, "{")) {
#         parsed <- fromJSON(res)
#         if (!is.null(parsed$errors)) {
#           paste("GraphQL error:", parsed$errors[[1]]$message)
#         } else {
#           parsed$data$addSolution
#         }
#       } else {
#         paste("GraphQL call error:", res)
#       }
#     })
    
#   })
# }

# shinyApp(ui, server)




# library(shiny)
# library(dotenv)
# library(DBI)
# library(RPostgres)
# source("process_project.R")

# options(shiny.maxRequestSize = 500*1024^2)

# load_dot_env(file = ".env")

# # Connect to PostgreSQL
# con <- dbConnect(
#   RPostgres::Postgres(),
#   dbname = Sys.getenv("DB_NAME"),
#   host = "localhost",
#   port = 5432,
#   user = Sys.getenv("DB_USER"),
#   password = Sys.getenv("DB_PW")
# )

# ui <- fluidPage(
#   titlePanel("Project Loader"),
#   sidebarLayout(
#     sidebarPanel(
#       textInput("project_name", "Project Name", value = "new_project"),
#       fileInput("metadata", "Upload metadata.csv", accept = ".csv"),
#       fileInput("rasters", "Upload raster files (.tif)", multiple = TRUE, accept = ".tif"),
#       actionButton("process", "Process Project")
#     ),
#     mainPanel(
#       verbatimTextOutput("log")
#     )
#   )
# )

# server <- function(input, output, session) {
#   observeEvent(input$process, {
#     req(input$metadata, input$rasters, input$project_name)

#     tmp_dir <- tempfile()
#     dir.create(tmp_dir)

#     # Save uploaded files
#     file.copy(input$metadata$datapath, file.path(tmp_dir, input$metadata$name))
#     file.copy(input$rasters$datapath, file.path(tmp_dir, input$rasters$name))

#     # Run processing
#     output_dir <- "projects"
#     dir.create(output_dir, showWarnings = FALSE)

#     result <- process_project(
#       data_dir = tmp_dir,
#       metadata_file = file.path(tmp_dir, input$metadata$name),
#       project_name = input$project_name,
#       output_dir = output_dir,
#       db_con = con
#     )

#     output$log <- renderText({
#       paste(
#         "✅ Project processed successfully!\n",
#         "Saved to:", result$project_dir, "\n",
#         "YAML path:", result$yaml_path
#       )
#     })
#   })
# }

# shinyApp(ui, server)
