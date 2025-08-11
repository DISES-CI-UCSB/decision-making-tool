#' The application server-side
#'
#' @param input,output,session Internal parameters for {shiny}.
#'     DO NOT REMOVE.
#' @noRd
#' 


app_server <- function(input, output, session) {

  # initialization
  ## initialize app
  eval(server_initialize_app)
  
  # # user authentification
  # ## create reactive variable to store json web token if a user logs in
  # auth_token <- reactiveVal(NULL)
  # ## create reactive variable to track user type
  # user_type <- reactiveVal(NULL)
  # is_authenticated <- reactive({
  #   token <- auth_token()
  #   print("is_authenticated")
  #   print(token)
  #   if (is.null(token) || !nzchar(token)) return(FALSE)
    
  #   # decode
  #   payload <- tryCatch({
  #     jose::jwt_decode_hmac(token, secret)
  #   }, error = function(e) {
  #     print(paste("error decoding jwt: ", e))
  #     return(NULL)
  #   })
  #   if (is.null(payload) || is.null(payload$exp)) return(FALSE)
    
  #   # check expiration
  #   now <- as.numeric(Sys.time())
  #   return(payload$exp > now)
  # })
  # ## handles logging in and setting auth_token
  # eval(server_login)
  
  # ## handles adding new projects
  # eval(server_import_projects_database)

  # ## print debugging information
  # if (isTRUE(wheretowork::get_golem_config("monitor"))) {
  #   shiny::observe({
  #     shiny::invalidateLater(3000)
  #     cli::cli_rule()
  #     golem::print_dev("Total memory used: ")
  #     golem::print_dev(lobstr::mem_used())
  #     golem::print_dev("  app_data")
  #     golem::print_dev(lobstr::obj_size(app_data))
  #   })
  # }

  # # import data
  # ## import data using builtin import option
  # eval(server_import_builtin_data)

  # ## import data using manual import option
  # eval(server_verify_manual_uploads)
  # eval(server_import_manual_data)

  # ## import data using spatial import option
  # eval(server_verify_spatial_uploads)
  # eval(server_import_spatial_data)

  # # update map
  # eval(server_update_map)

  # # update server_solution settings
  # eval(server_update_solution_settings)

  # # generate new solution using settings
  # eval(server_generate_new_solution)

  # # update solution results
  # eval(server_update_solution_results)

  # # export data
  # eval(server_export_data)
  # eval(server_export_spreadsheets)

  # # load solution and settings previously generated
  # eval(server_load_solution)
}
