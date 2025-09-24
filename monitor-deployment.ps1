# Monitor Azure Deployment Progress
Write-Host "🔍 Monitoring Azure Deployment Progress..." -ForegroundColor Green
Write-Host ""

# Check provider registration status
Write-Host "📋 Provider Registration Status:" -ForegroundColor Cyan
$webStatus = az provider show -n Microsoft.Web --query "registrationState" --output tsv
$dbStatus = az provider show -n Microsoft.DBforPostgreSQL --query "registrationState" --output tsv
$containerStatus = az provider show -n Microsoft.ContainerInstance --query "registrationState" --output tsv

Write-Host "  Microsoft.Web: $webStatus"
Write-Host "  Microsoft.DBforPostgreSQL: $dbStatus"
Write-Host "  Microsoft.ContainerInstance: $containerStatus"
Write-Host ""

# Check resources in resource group
Write-Host "📦 Resources in decision-making-tool:" -ForegroundColor Cyan
az resource list --resource-group decision-making-tool --output table
Write-Host ""

# Check container registry images
Write-Host "🐳 Container Registry Images:" -ForegroundColor Cyan
az acr repository list --name decisiontoolregistry --output table
Write-Host ""

# Check deployments
Write-Host "🚀 Deployment Status:" -ForegroundColor Cyan
az deployment group list --resource-group decision-making-tool --output table
Write-Host ""

Write-Host "✅ Monitoring complete!" -ForegroundColor Green
