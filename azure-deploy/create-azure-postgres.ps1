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

# Create the cheapest possible Azure PostgreSQL server
Write-Host "Creating Azure PostgreSQL Flexible Server (cheapest option)..." -ForegroundColor Green

# Create the PostgreSQL Flexible Server with the smallest possible configuration
az postgres flexible-server create --resource-group decision-making-tool --name decision-tool-postgres --location westus2 --admin-user postgres --admin-password $envVars["DB_PASSWORD"] --sku-name Standard_B1ms --tier Burstable --public-access 0.0.0.0-255.255.255.255 --storage-size 32 --version 15 --high-availability Disabled --backup-retention 7 --geo-redundant-backup Disabled

# Create the database
Write-Host "Creating database..." -ForegroundColor Green
az postgres flexible-server db create --resource-group decision-making-tool --server-name decision-tool-postgres --database-name decision_tool

# Get the connection details
Write-Host "PostgreSQL server created successfully!" -ForegroundColor Green
Write-Host "Server name: decision-tool-postgres.postgres.database.azure.com" -ForegroundColor Yellow
Write-Host "Database: decision_tool" -ForegroundColor Yellow
Write-Host "Username: postgres" -ForegroundColor Yellow
Write-Host "Password: $($envVars["DB_PASSWORD"])" -ForegroundColor Yellow
