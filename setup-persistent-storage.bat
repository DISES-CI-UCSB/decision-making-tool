@echo off
echo Setting up persistent storage for Decision Making Tool...

REM Create storage account
echo Creating storage account...
az storage account create ^
  --name decisiontoolstorage ^
  --resource-group decision-making-tool ^
  --location westus2 ^
  --sku Standard_LRS

REM Get storage account key
echo Getting storage account key...
for /f "tokens=*" %%i in ('az storage account keys list --resource-group decision-making-tool --account-name decisiontoolstorage --query "[0].value" --output tsv') do set STORAGE_KEY=%%i

REM Create file share
echo Creating file share...
az storage share create ^
  --name uploads ^
  --account-name decisiontoolstorage ^
  --account-key %STORAGE_KEY%

REM Mount storage to web app
echo Mounting storage to web app...
az webapp config storage-account add ^
  --resource-group decision-making-tool ^
  --name priorizando-la-naturaleza-colombia-shiny ^
  --custom-id uploads ^
  --storage-type AzureFiles ^
  --share-name uploads ^
  --account-name decisiontoolstorage ^
  --access-key %STORAGE_KEY% ^
  --mount-path /app/uploads

echo Restarting web app...
az webapp restart --name priorizando-la-naturaleza-colombia-shiny --resource-group decision-making-tool

echo Done! Persistent storage is now configured.
echo Files uploaded to /app/uploads will persist across container restarts.
