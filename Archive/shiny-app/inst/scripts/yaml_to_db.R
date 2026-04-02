library(yaml)
library(ghql)
library(jsonlite)

# GraphQL client
cli <- GraphqlClient$new(
  url = "https://your.graphql.endpoint/graphql"
)

qry <- Query$new()

# Mutation string for inserting projects
qry$add("insertProject", '
  mutation insertProject($input: ProjectInput!) {
    insertProject(input: $input) {
      id
      name
    }
  }
')

# Folder with project YAMLs
yaml_paths <- dir("path/to/projects", pattern = "\\.yaml$", recursive = TRUE, full.names = TRUE)

for (yaml_file in yaml_paths) {
  project <- yaml::read_yaml(yaml_file)

  # Upload files somewhere (S3, DB storage, etc.)
  spatial_url <- upload_file(project$spatial_path)
  attribute_url <- upload_file(project$attribute_path)
  boundary_url <- upload_file(project$boundary_path)

  # Create project input
  input <- list(
    name = project$name,
    userGroup = project$user_group %||% "private",
    mode = project$mode,
    spatialUrl = spatial_url,
    attributeUrl = attribute_url,
    boundaryUrl = boundary_url,
    authorName = project$author_name,
    authorEmail = project$author_email,
    themes = project$themes,
    weights = project$weights,
    includes = project$includes,
    excludes = project$excludes
  )

  # Send mutation
  res <- cli$exec(qry$queries$insertProject, variables = list(input = input))
  print(res)