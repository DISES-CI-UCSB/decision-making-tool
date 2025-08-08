#' createProjectModal UI function
#'  @description
#'  Once logged in, a manager can choose to open the createProjectModal to generate a new project in the database.
#'  The UI contains a form with creating a new project. Once that form has been filled out, they can add layers associated with the solution
#'  and the solution layer.
#'  
#' @return A shiny modal dialog UI
#' @export
createProjectModal <- function(id) {
  assertthat::assert_that(
    assertthat::is.string(id),
    assertthat::noNA(id)
  )
  
  modalDialog(
    size = "l",
    easyClose = FALSE,
    title="Create a Project",
    footer = tagList(
      actionButton(paste0(id, "_prev_btn"), "Previous"),
      actionButton(paste0(id, "_next_btn"), "Next"),
      modalButton("Cancel")
    ),
    # CSS override
    textInput(paste0(id, "fake_element"), "required for rendering correctlt"),
    tabsetPanel(
      id = paste0(id, "_modal_steps"),
      
      ## STEP 1: Project Info
      tabPanel(
        title = "Project",
        value = "project_step",
        h3("Project Information"),
        textInput(paste0(id, "_project_title"), "Title"),
        textAreaInput(paste0(id, "_project_description"), "Description"),
        selectInput(paste0(id, "_project_user_group"), "User Group", choices = c("public", "planner", "manager"))
      ),
      
      ## STEP 2: Solutions
      tabPanel(
        title = "Solutions",
        value = "solutions_step",
        h3("Solutions"),
        actionButton(paste0(id, "_add_solution"), "Add Solution"),
        uiOutput(paste0(id, "_solutions_ui"))
      ),
      
      ## STEP 3: Layers (for a selected solution)
      tabPanel(
        title = "Layers",
        value = "layers_step",
        h3("Layers for Current Solution"),
        actionButton(paste0(id, "_add_layer"), "Add Layer"),
        uiOutput(paste0(id, "_layers_ui"))
      )
    )
  )

}
