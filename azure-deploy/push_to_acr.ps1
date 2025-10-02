# -------------------------------
# push-to-acr.ps1
# Automates build, tag, and push to Azure Container Registry
# -------------------------------

# Azure Container Registry name
$ACR_NAME = "decisiontoolregistry"

# Local image names
$SHINY_LOCAL = "shiny-app:latest"
$SERVER_LOCAL = "graphql-server:latest"

# ACR image names
$SHINY_ACR = "$ACR_NAME.azurecr.io/shiny-app:latest"
$SERVER_ACR = "$ACR_NAME.azurecr.io/graphql-server:latest"

Write-Host "Logging in to Azure..."
az login

Write-Host "Logging in to Azure Container Registry..."
az acr login --name $ACR_NAME

Write-Host "Building local Docker images..."
docker build -t $SHINY_LOCAL ./shiny-app
docker build -t $SERVER_LOCAL ./server

Write-Host "Tagging images for ACR..."
docker tag $SHINY_LOCAL $SHINY_ACR
docker tag $SERVER_LOCAL $SERVER_ACR

Write-Host "Pushing images to ACR..."
docker push $SHINY_ACR
docker push $SERVER_ACR

Write-Host "Verifying pushed images in ACR..."
az acr repository list --name $ACR_NAME --output table

Write-Host "Done! Your images are now available in $ACR_NAME."
