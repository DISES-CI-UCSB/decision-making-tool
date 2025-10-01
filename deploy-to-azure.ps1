# -------------------------------
# deploy-to-azure.ps1
# Deploy multi-container app to Azure Web App
# -------------------------------

# -------------------------------
# Load .env file
# -------------------------------
$envFile = ".env"  # path to your .env file
$envVars = @{}

Get-Content $envFile | ForEach-Object {
    # Skip empty lines or comments
    if ($_ -and $_ -notmatch '^#') {
        $parts = $_ -split '=', 2
        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        $envVars[$key] = $value
    }
}

Write-Host "Loaded environment variables from $envFile"


# -------------------------------
# Configuration
# -------------------------------
$ResourceGroup = "decision-making-tool"
$AppServicePlan = "decision-tool-plan"
$WebAppName = "decision-tool-app"   # must be globally unique
$ACR_NAME = "decisiontoolregistry"
$ComposeFile = "docker-compose.azure.yml"


# -------------------------------
# Login and prerequisites
# -------------------------------
Write-Host "Logging in to Azure..."
az login

Write-Host "Logging in to Azure Container Registry..."
az acr login --name $ACR_NAME

# -------------------------------
# Create App Service Plan (Linux)
# -------------------------------
Write-Host "Creating App Service Plan..."
az appservice plan create `
    --name $AppServicePlan `
    --resource-group $ResourceGroup `
    --sku B3 `
    --is-linux

# -------------------------------
# Create Web App with multi-container
# -------------------------------
Write-Host "Creating Web App with multi-container configuration..."
az webapp create `
    --resource-group $ResourceGroup `
    --plan $AppServicePlan `
    --name $WebAppName `
    --multicontainer-config-type compose `
    --multicontainer-config-file $ComposeFile

# -------------------------------
# Configure registry credentials
# -------------------------------
Write-Host "Getting ACR credentials..."
$acrUser = az acr credential show --name $ACR_NAME --query "username" -o tsv
$acrPassword = az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv

Write-Host "Connecting Web App to ACR..."
az webapp config container set `
    --name $WebAppName `
    --resource-group $ResourceGroup `
    --docker-registry-server-url "https://$ACR_NAME.azurecr.io" `
    --docker-registry-server-user $acrUser `
    --docker-registry-server-password $acrPassword

# -------------------------------
# Set environment variables
# -------------------------------
Write-Host "Setting environment variables..."
foreach ($key in $envVars.Keys) {
    az webapp config appsettings set `
        --name $WebAppName `
        --resource-group $ResourceGroup `
        --settings "$key=$($envVars[$key])"
}

# -------------------------------
# Done
# -------------------------------
Write-Host "`nDeployment complete!"
Write-Host "Your app URL: https://$WebAppName.azurewebsites.net"
Write-Host "You can check logs with: az webapp log tail --name $WebAppName --resource-group $ResourceGroup"
