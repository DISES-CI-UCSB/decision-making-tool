# Azure Deployment Script
param(
    [string]$SubscriptionId = "",
    [string]$ResourceGroup = "decision-tool-demo-rg",
    [string]$Location = "westus2", 
    [string]$AppName = "priorizando-la-naturaleza-colombia"
)

Write-Host "🚀 Starting Azure deployment..." -ForegroundColor Green

# Use subscription from parameter or environment
if ($SubscriptionId -eq "") {
    $SubscriptionId = "b793e3c0-3c53-4815-8b98-68ecc44f5be4"
}

$AcrName = "decisiontooldemo"
$PlanName = "$AppName-plan"

Write-Host "📋 Configuration:" -ForegroundColor Cyan
Write-Host "  Subscription: $SubscriptionId"
Write-Host "  Resource Group: $ResourceGroup"
Write-Host "  Location: $Location"
Write-Host "  App Name: $AppName"
Write-Host ""

# Set subscription
Write-Host "🎯 Setting subscription..." -ForegroundColor Yellow
az account set --subscription $SubscriptionId

# Create resource group
Write-Host "📦 Creating resource group..." -ForegroundColor Yellow
az group create --name $ResourceGroup --location $Location

# Create container registry
Write-Host "🐳 Creating container registry..." -ForegroundColor Yellow
az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic --admin-enabled true

# Get ACR login server
$AcrLoginServer = az acr show --name $AcrName --resource-group $ResourceGroup --query "loginServer" --output tsv
Write-Host "📍 ACR: $AcrLoginServer" -ForegroundColor Cyan

# Login to ACR
Write-Host "🔐 Logging into ACR..." -ForegroundColor Yellow
az acr login --name $AcrName

# Build and push images
Write-Host "🔨 Building server image..." -ForegroundColor Yellow
docker build -t "$AcrLoginServer/decision-tool-server:latest" ./server
docker push "$AcrLoginServer/decision-tool-server:latest"

Write-Host "🔨 Building shiny image..." -ForegroundColor Yellow
docker build -t "$AcrLoginServer/decision-tool-shiny:latest" ./shiny-app
docker push "$AcrLoginServer/decision-tool-shiny:latest"

# Create app service plan (FREE tier)
Write-Host "📋 Creating FREE app service plan..." -ForegroundColor Yellow
az appservice plan create --name $PlanName --resource-group $ResourceGroup --sku F1 --is-linux

# Create database
$DbServerName = "$AppName-db-$(Get-Date -Format 'yyyyMMddHHmm')"
$DbName = "decision_tool"
$DbUser = "dbadmin"
$DbPassword = "SecurePass123!"

Write-Host "🗄️ Creating database..." -ForegroundColor Yellow
az postgres flexible-server create `
  --resource-group $ResourceGroup `
  --name $DbServerName `
  --location $Location `
  --admin-user $DbUser `
  --admin-password $DbPassword `
  --sku-name Standard_B1ms `
  --tier Burstable `
  --storage-size 32 `
  --version 13 `
  --public-access 0.0.0.0

az postgres flexible-server db create `
  --resource-group $ResourceGroup `
  --server-name $DbServerName `
  --database-name $DbName

# Create JWT secret
$JwtSecret = "MyJWTSecret123456789"

# Get ACR credentials
$AcrUsername = az acr credential show --name $AcrName --query "username" --output tsv
$AcrPassword = az acr credential show --name $AcrName --query "passwords[0].value" --output tsv

# Create container instance for server
Write-Host "🐳 Creating server container..." -ForegroundColor Yellow
az container create `
  --resource-group $ResourceGroup `
  --name "$AppName-server" `
  --image "$AcrLoginServer/decision-tool-server:latest" `
  --cpu 0.5 `
  --memory 0.5 `
  --registry-login-server $AcrLoginServer `
  --registry-username $AcrUsername `
  --registry-password $AcrPassword `
  --dns-name-label "$AppName-server" `
  --ports 4000 `
  --environment-variables `
    NODE_ENV=production `
    DB_HOST="$DbServerName.postgres.database.azure.com" `
    DB_NAME=$DbName `
    DB_USER=$DbUser `
    DB_PW=$DbPassword `
    JWT_SECRET=$JwtSecret `
    PORT=4000

# Get server FQDN
$ServerFqdn = az container show --resource-group $ResourceGroup --name "$AppName-server" --query "ipAddress.fqdn" --output tsv

# Create shiny web app
Write-Host "🌐 Creating shiny web app..." -ForegroundColor Yellow
az webapp create `
  --resource-group $ResourceGroup `
  --plan $PlanName `
  --name "$AppName-shiny" `
  --deployment-container-image-name "$AcrLoginServer/decision-tool-shiny:latest"

# Configure shiny app
az webapp config appsettings set `
  --resource-group $ResourceGroup `
  --name "$AppName-shiny" `
  --settings `
    R_SHINY_PORT=80 `
    R_SHINY_HOST=0.0.0.0 `
    GRAPHQL_URI="http://$ServerFqdn:4000/graphql" `
    DOCKER_CONTAINER=true

# Configure container credentials
az webapp config container set `
  --name "$AppName-shiny" `
  --resource-group $ResourceGroup `
  --docker-custom-image-name "$AcrLoginServer/decision-tool-shiny:latest" `
  --docker-registry-server-url "https://$AcrLoginServer" `
  --docker-registry-server-user $AcrUsername `
  --docker-registry-server-password $AcrPassword

# Save deployment info
$InfoFile = "azure-deployment-info.txt"
$Info = @"
AZURE DEPLOYMENT INFORMATION
Generated: $(Get-Date)
============================

App URL: https://$AppName-shiny.azurewebsites.net
Server URL: http://$ServerFqdn:4000
Database: $DbServerName.postgres.database.azure.com
DB User: $DbUser
DB Password: $DbPassword
JWT Secret: $JwtSecret

Resource Group: $ResourceGroup
Container Registry: $AcrLoginServer
"@

$Info | Out-File -FilePath $InfoFile -Encoding UTF8

Write-Host ""
Write-Host "🎉 Deployment completed!" -ForegroundColor Green
Write-Host "🌐 App URL: https://$AppName-shiny.azurewebsites.net" -ForegroundColor Green
Write-Host "📄 Info saved to: $InfoFile" -ForegroundColor Cyan
Write-Host ""
Write-Host "⏱️ Wait 10-15 minutes for services to start" -ForegroundColor Yellow