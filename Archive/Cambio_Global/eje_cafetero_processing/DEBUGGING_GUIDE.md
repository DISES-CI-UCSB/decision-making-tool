# Debugging Guide - Project Upload & Import

This document explains the debugging improvements added to help diagnose project upload/import failures.

## Problem

Project uploads were failing silently:
- Layers were being copied to the correct directory
- But `projectLayers` weren't being saved in the database
- Import would show "Reading 0 layer files"
- Error: "No valid layers could be loaded"

## Debugging Improvements Added

### 1. **Project Upload - Layer Creation** (`mod_project.R`)

Added detailed logging when creating project layers in the database:

**Location**: Lines 553-601

**What's logged**:
- Layer name and type being created
- Full payload being sent to GraphQL mutation
- GraphQL response from server
- Success/failure status with error details

**Example output**:
```
*** CREATING PROJECT LAYER: Páramos ***
*** Type: theme Theme: Ecosistemas estratégicos ***
*** Layer payload prepared ***
***   projectId: 11 ***
***   fileId: 234 ***
***   values: 0, 1 ***
***   colors: #00000000, #aaaa00 ***
***   labels: absence, presence ***
*** ProjectLayer mutation response: {"data":{"addProjectLayer":{"id":"345"}}} ***
*** PROJECT LAYER CREATED SUCCESSFULLY with ID: 345 ***
```

**What to look for**:
- If you see `ERROR CREATING PROJECT LAYER`, the mutation failed
- Check the error message for details (authentication, schema mismatch, etc.)
- If you don't see "SUCCESSFULLY with ID", the layer wasn't saved

### 2. **CSV Reading** (`mod_project.R`)

Added logging when reading `layers.csv` from uploaded ZIP:

**Location**: Lines 285-297

**What's logged**:
- Number of rows in CSV
- Column names found
- First row data
- File existence check results

**Example output**:
```
*** READ layers.csv ***
*** Number of rows: 15 ***
*** Columns: Type, Theme, Name, Legend, Values, Color, Labels, Unit, Provenance, Order, Visible, Hidden, Downloadable, File ***
*** First row Type: theme Theme: Ecosistemas Name: Ecosistemas IAVH ***
*** File existence check: 15 out of 15 files found ***
```

**What to look for**:
- Are all expected columns present?
- Does "file existence check" show 0 files found? (layers folder structure issue)
- Are accents rendering correctly in Theme names?

### 3. **Project Import - Layer Query** (`server_import_projects_database.R`)

Added extensive logging when querying layers from database:

**Location**: Lines 170-202

**What's logged**:
- Raw GraphQL response
- Data structure details
- Number of layers found
- First layer details including file path

**Example output**:
```
*** ProjectLayers query response: {"data":{"projectLayers":[...]}} ***
*** Found layers data structure ***
*** Layers data class: data.frame ***
*** Number of layers (rows): 15 ***
*** Layer columns: id, name, type, theme, legend, values, color, labels, unit, provenance, order, visible, downloadable, file ***
*** First layer name: Ecosistemas IAVH ***
*** First layer type: theme ***
*** First layer has 'file' column: TRUE ***
*** File structure - columns: id, name, path ***
*** First layer file path: uploads/Eje_Cafetero_11/ecosistemas_IAVH.tif ***
```

**What to look for**:
- If query returns empty: `No layers found in database for project X`
  → This means projectLayers weren't saved during upload
- If `Number of layers (rows): 0` appears
  → The projectLayers table is empty for this project
- If file paths are missing or incorrect
  → File upload succeeded but path not stored correctly

## Common Issues & Solutions

### Issue 1: No layers in database (0 layers found)

**Symptoms**:
```
*** WARNING: No layers found in database for project 11 ***
*** This means projectLayers were not saved during upload ***
```

**Causes**:
1. GraphQL mutation failing silently
2. Authentication issues
3. Database connection problems
4. Schema mismatch between frontend and backend

**Solution**:
- Check upload logs for "ERROR CREATING PROJECT LAYER"
- Verify GraphQL mutation response
- Check server logs for database errors

### Issue 2: Layers exist but files not found

**Symptoms**:
```
*** Number of layers (rows): 15 ***
*** Reading 15 layer files ***
*** ERROR: Layer file not found: /path/to/file.tif ***
```

**Causes**:
1. File paths stored incorrectly in database
2. Container restart cleared uploaded files
3. Path resolution issues (Docker vs local)

**Solution**:
- Check that files actually exist in uploads/ directory
- Verify file paths in database match actual locations
- Re-upload project if container was restarted

### Issue 3: CSV encoding issues

**Symptoms**:
- Accents display as weird characters: `EcosistemasstratÃ©gicos`
- Theme names corrupted

**Solution**:
- Ensure `layers.csv` written with `fileEncoding = "UTF-8"`
- Ensure CSV read with `fileEncoding = "UTF-8"`
- Both are now implemented in the scripts

## Validation Script

Run `03_validate_output.R` before uploading to check:
- ✓ Planning unit in root directory
- ✓ layers.csv exists and has all required columns
- ✓ All layer TIF files exist
- ✓ Type values are valid (theme/include/exclude/weight)
- ✓ UTF-8 encoding works (accents readable)
- ✓ solutions.csv exists (if solutions included)

**Usage**:
```r
source("Cambio_Global/eje_cafetero_processing/03_validate_output.R")
```

## Next Steps

When you upload the project, watch the console for:

1. **During Upload**:
   - "CREATING PROJECT LAYER" messages for each layer
   - "PROJECT LAYER CREATED SUCCESSFULLY" confirmations
   - Any ERROR messages

2. **During Import**:
   - "Found X layers" should match number of layers uploaded
   - "Reading X layer files" should match
   - "Successfully loaded X out of X layers" should be 100%

If projectLayers still aren't being saved, the issue is likely in the GraphQL backend. Check:
- Server logs for database errors
- GraphQL schema matches frontend expectations
- Authentication tokens are valid
- Database constraints/validation rules

## Files Modified

1. `shiny-app/R/mod_project.R`
   - Added layer creation logging (lines 553-601)
   - Added CSV reading logging (lines 285-297)
   - Added UTF-8 encoding support for CSV

2. `shiny-app/R/server_import_projects_database.R`
   - Added layer query debugging (lines 170-202)
   - Added detailed structure inspection

3. `Cambio_Global/eje_cafetero_processing/03_validate_output.R`
   - New validation script for output format

