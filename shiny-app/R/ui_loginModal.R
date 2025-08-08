#' loginModal UI function
#'
#' @return A shiny modal dialog UI
#' @export
loginModal <- function(id) {
  assertthat::assert_that(
    assertthat::is.string(id),
    assertthat::noNA(id)
  )
  
  modalDialog(
    title = tags$p(
      "Priorizando la Naturaleza - Colombia",
      style = "text-align:center; font-weight: bold; font-size: 20px;"
    ),
    easyClose = FALSE,
    fade = TRUE,
    
    # Main modal body (each as its own top-level argument)
    tags$p(
      "Seleccione el método de acceso",
      style = "text-align: center; font-weight: bold; margin-top: 10px;"
    ),
    
    div(
      style = "display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 10px;",
      actionButton(paste0(id, "_public_btn"), "Acceso público", class = "btn btn-primary"),
      actionButton(paste0(id, "_admin_btn"), "Acceso administrador", class = "btn btn-warning")
    ),
    
      
    conditionalPanel(
      condition = paste0("input.", id, "_admin_btn > 0"),
      textInput(paste0(id, "_admin_username"), "Usuario"),
      passwordInput(paste0(id, "_admin_password"), "Contraseña"),
      actionButton(paste0(id, "_login_submit"), "Iniciar sesión")
    ),
    
    textOutput(paste0(id, "_login_error_text"), container = span, inline = TRUE),

    
    uiOutput(paste0(id, "_admin_options_ui")),
    
    
    footer = div(
      style = "text-align: center; width: 100%;",
      tags$p(class = "dev-title", "Herramienta basada en WhereToWork, desarrollada por:"),
      div(class = "sponser-logos",
          div(class = "sponser-logo-row",
              tags$img(
                class = "wtw-logo",
                src = "www/wtw_logos.webp"
              )
          )
      )
    )
  )
}
