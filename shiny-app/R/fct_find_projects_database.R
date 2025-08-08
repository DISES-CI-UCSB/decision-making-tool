#' Find projects
#'
#' Find project files in a directory.
#'
#' @param x `character` directory path.
#'
#' @param user_groups `character` vector of project group names available that
#'   can be imported.
#'  Defaults to `"public"`.
#'
#' @details
#' query projects available based on user type
#'
#' @return 
#'
#' @examples
#' # find directory with built-in projects
#' d <- system.file("extdata", "projects", package = "wheretowork")
#'
#' # list projects in directory
#' find_projects(d)
#' @export


find_projects_database <- function(x, user_groups = "public") { 
  
  
  
  }