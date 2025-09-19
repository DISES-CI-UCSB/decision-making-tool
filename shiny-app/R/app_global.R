app_global <- quote({
  # set seed for reproducibility
  set.seed(200)

  # initialize GraphQL client
  client <- ghql::GraphqlClient$new(url = "http://localhost:3001/graphql")
  
  # initialize authentication state
  auth_token <- shiny::reactiveVal(NULL)
  user_info <- shiny::reactiveVal(NULL)
  
  # initialize project data for database projects
  projects_data <- shiny::reactiveVal(data.frame())
  
  # reactive trigger for solution loading
  solution_load_trigger <- shiny::reactiveVal(0)

  # print initial memory usage
  if (isTRUE(wheretowork::get_golem_config("monitor"))) {
      cli::cli_rule()
      golem::print_dev("Initial memory used: ")
      golem::print_dev(lobstr::mem_used())
  }

  # initialize file upload limits
  options(shiny.maxRequestSize = 1000*1024^2) # 1GB
  # set global variables limit for future package
  options(future.globals.maxSize= 1000*1024^2) # 1GB

  # initialize asynchronous processing
  ## identify strategy
  strategy <- wheretowork::get_golem_config("strategy")
  if (identical(strategy, "auto")) {
    if (identical(Sys.getenv("R_CONFIG_ACTIVE"), "shinyapps")) {
      strategy <- "multicore"
    } else if (identical(.Platform$OS.type, "unix")) {
      strategy <- "multicore"
    } else {
      strategy <- "multisession"
    }
  }
  ## set future settings
  options(
    future.wait.timeout = wheretowork::get_golem_config("worker_time_out")
  )
  ## implement strategy
  golem::print_dev(paste("plan strategy:", strategy))
  assertthat::assert_that(
    strategy %in% c("sequential", "cluster", "multicore", "multisession"),
    msg = "not a valid strategy"
  )
  suppressWarnings(future::plan(strategy, workers = 2))

  # Built-in projects disabled - using database projects only
  # All project data now comes from GraphQL database queries
  
  # Create empty project_data for backward compatibility
  project_data <- data.frame()

})
