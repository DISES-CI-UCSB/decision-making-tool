@echo off
echo 🚀 Starting Azure Deployment...

REM Register required providers first
echo 📋 Registering Azure providers...
az provider register --namespace Microsoft.Web
az provider register --namespace Microsoft.DBforPostgreSQL
az provider register --namespace Microsoft.ContainerInstance

set SUBSCRIPTION_ID=b793e3c0-3c53-4815-8b98-68ecc44f5be4
set RESOURCE_GROUP=decision-making-tool
set LOCATION=westus2
set ACR_NAME=decisiontoolregistry
set APP_NAME=priorizando-la-naturaleza-colombia

echo 📋 Configuration:
echo   Subscription: %SUBSCRIPTION_ID%
echo   Resource Group: %RESOURCE_GROUP%
echo   Location: %LOCATION%
echo   App Name: %APP_NAME%
echo.

echo 🎯 Setting subscription...
az account set --subscription %SUBSCRIPTION_ID%

echo 📦 Creating resource group...
az group create --name %RESOURCE_GROUP% --location %LOCATION%

echo 🐳 Creating container registry...
az acr create --resource-group %RESOURCE_GROUP% --name %ACR_NAME% --sku Basic --admin-enabled true
az acr update -n %ACR_NAME% --admin-enabled true

echo 🔐 Logging into container registry...
az acr login --name %ACR_NAME%

for /f %%i in ('az acr show --name %ACR_NAME% --resource-group %RESOURCE_GROUP% --query "loginServer" --output tsv') do set ACR_LOGIN_SERVER=%%i
echo 📍 ACR: %ACR_LOGIN_SERVER%

echo 🔨 Building server image...
docker build -t %ACR_LOGIN_SERVER%/decision-tool-server:latest ./server
docker push %ACR_LOGIN_SERVER%/decision-tool-server:latest

echo 🔨 Building shiny image...
docker build -t %ACR_LOGIN_SERVER%/decision-tool-shiny:latest ./shiny-app
docker push %ACR_LOGIN_SERVER%/decision-tool-shiny:latest

echo 📋 Creating app service plan...
set PLAN_NAME=%APP_NAME%-plan
az appservice plan create --name %PLAN_NAME% --resource-group %RESOURCE_GROUP% --sku F1 --is-linux

set DB_SERVER_NAME=%APP_NAME%-db-%RANDOM%
set DB_NAME=decision_tool
set DB_USER=dbadmin
set DB_PASSWORD=SecurePass123!

echo 🗄️ Creating database...
az postgres flexible-server create --resource-group %RESOURCE_GROUP% --name %DB_SERVER_NAME% --location %LOCATION% --admin-user %DB_USER% --admin-password %DB_PASSWORD% --sku-name Standard_B1ms --tier Burstable --storage-size 32 --version 13 --public-access 0.0.0.0

az postgres flexible-server db create --resource-group %RESOURCE_GROUP% --server-name %DB_SERVER_NAME% --database-name %DB_NAME%

set JWT_SECRET=MyJWTSecret123456789

for /f %%i in ('az acr credential show --name %ACR_NAME% --query "username" --output tsv') do set ACR_USERNAME=%%i
for /f %%i in ('az acr credential show --name %ACR_NAME% --query "passwords[0].value" --output tsv') do set ACR_PASSWORD=%%i

echo 🐳 Creating server container...
az container create --resource-group %RESOURCE_GROUP% --name %APP_NAME%-server --image %ACR_LOGIN_SERVER%/decision-tool-server:latest --os-type Linux --cpu 0.5 --memory 0.5 --registry-login-server %ACR_LOGIN_SERVER% --registry-username %ACR_USERNAME% --registry-password %ACR_PASSWORD% --dns-name-label %APP_NAME%-server --ports 4000 --environment-variables NODE_ENV=production DB_HOST=%DB_SERVER_NAME%.postgres.database.azure.com DB_NAME=%DB_NAME% DB_USER=%DB_USER% DB_PW=%DB_PASSWORD% JWT_SECRET=%JWT_SECRET% PORT=4000

for /f %%i in ('az container show --resource-group %RESOURCE_GROUP% --name %APP_NAME%-server --query "ipAddress.fqdn" --output tsv') do set SERVER_FQDN=%%i

echo 🌐 Creating shiny web app...
az webapp create --resource-group %RESOURCE_GROUP% --plan %PLAN_NAME% --name %APP_NAME%-shiny --deployment-container-image-name %ACR_LOGIN_SERVER%/decision-tool-shiny:latest

echo ⚙️ Configuring shiny app...
az webapp config appsettings set --resource-group %RESOURCE_GROUP% --name %APP_NAME%-shiny --settings R_SHINY_PORT=80 R_SHINY_HOST=0.0.0.0 GRAPHQL_URI=http://%SERVER_FQDN%:4000/graphql DOCKER_CONTAINER=true

echo 🔑 Configuring container credentials...
az webapp config container set --name %APP_NAME%-shiny --resource-group %RESOURCE_GROUP% --docker-custom-image-name %ACR_LOGIN_SERVER%/decision-tool-shiny:latest --docker-registry-server-url https://%ACR_LOGIN_SERVER% --docker-registry-server-user %ACR_USERNAME% --docker-registry-server-password %ACR_PASSWORD%

echo.
echo 🎉 Deployment completed!
echo 🌐 App URL: https://%APP_NAME%-shiny.azurewebsites.net
echo 📄 Server: http://%SERVER_FQDN%:4000
echo 🗄️ Database: %DB_SERVER_NAME%.postgres.database.azure.com
echo 🔑 DB Password: %DB_PASSWORD%
echo.
echo ⏱️ Wait 10-15 minutes for services to start
pause