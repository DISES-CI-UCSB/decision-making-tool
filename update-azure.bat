@echo off
echo 🔄 Updating Azure deployment...

set ACR_NAME=decisiontoolregistry
set APP_NAME=priorizando-la-naturaleza-colombia
set RESOURCE_GROUP=decision-making-tool

echo 🔐 Logging into container registry...
az acr login --name %ACR_NAME%

for /f %%i in ('az acr show --name %ACR_NAME% --resource-group %RESOURCE_GROUP% --query "loginServer" --output tsv') do set ACR_LOGIN_SERVER=%%i
echo 📍 Using registry: %ACR_LOGIN_SERVER%

echo 🔨 Building and pushing updated server image...
docker build -t %ACR_LOGIN_SERVER%/decision-tool-server:latest ./server
docker push %ACR_LOGIN_SERVER%/decision-tool-server:latest

echo 🔨 Building and pushing updated shiny image...
docker build -t %ACR_LOGIN_SERVER%/decision-tool-shiny:latest ./shiny-app
docker push %ACR_LOGIN_SERVER%/decision-tool-shiny:latest

echo 🔄 Restarting container instance...
az container restart --name %APP_NAME%-server --resource-group %RESOURCE_GROUP%

echo 🔄 Restarting web app...
az webapp restart --name %APP_NAME%-shiny --resource-group %RESOURCE_GROUP%

echo.
echo ✅ Update completed!
echo 🌐 Your app: https://%APP_NAME%-shiny.azurewebsites.net
echo ⏱️ Allow 2-3 minutes for services to restart
pause
