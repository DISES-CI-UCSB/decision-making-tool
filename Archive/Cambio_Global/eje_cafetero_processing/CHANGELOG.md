# Changelog - Eje Cafetero Processing Updates

## Latest Updates

### 1. ✅ Hard-Coded Theme Mapping

**Issue**: The `grupo` column in the Excel had fewer entries than feature IDs (4 grupos for 9 features).

**Solution**: Hard-coded the exact theme mapping based on the Excel structure:

| Feature | Theme |
|---------|-------|
| Ecosistemas IAVH | Ecosistemas |
| Páramos | Ecosistemas estratégicos |
| Manglares | Ecosistemas estratégicos |
| Humedales | Ecosistemas estratégicos |
| Bosque Seco | Ecosistemas estratégicos |
| Riqueza de Especies | Especies |
| Carbono Orgánico Suelos | Servicios ecosistémicos |
| Biomasa Aérea más Subterránea | Servicios ecosistémicos |
| Recarga de Agua Subterránea | Servicios ecosistémicos |

### 2. ✅ UTF-8 Encoding Support

**Issue**: Excel files with Spanish accents (á, é, í, ó, ú, ñ) weren't being read correctly.

**Solution**: 
- Added `options(encoding = "UTF-8")` before reading Excel files
- Added `fileEncoding = "UTF-8"` parameter to all `write.csv()` calls
- This ensures accents in "Páramos", "Ecosistemas estratégicos", "Servicios ecosistémicos", etc. are preserved

### 3. ✅ Added Constraint and Weight Layers

**Issue**: Missing include, exclude, and weight layers from the planning unit CSV.

**Solution**: Added extraction of constraint and weight layers from `PUs_EJE_CAFETERO_1km.csv`:

**Include Layers** (for locked-in constraints):
- `resguardos_indigenas.tif` - Resguardos Indígenas
- `comunidades_negras.tif` - Comunidades Negras
- `RUNAP.tif` - Sistema de Parques Nacionales
- `ECC_SIRAPEC.tif` - Ecosistemas Estratégicos SIRAPEC
- `OMECs.tif` - Other Effective Conservation Measures

**Weight Layers** (for cost functions):
- `IHEH_2022.tif` - Índice de Huella Espacial Humana 2022

These layers are:
1. Extracted from the planning unit CSV
2. Converted to raster format matching the PU grid
3. Added to `layers.csv` with proper metadata (Type, Legend, Colors, etc.)

### 4. ✅ Planning Units in Root Directory

**Issue**: Planning unit TIF was being placed in `layers/` folder.

**Solution**: Moved planning unit TIF to root of `upload_ready/` directory.

**New structure**:
```
upload_ready/
├── PU_EJE_CAFETERO_1km.tif  ← In root now
├── layers/
└── solutions/
```

## Summary of Script Updates

### `02_organize_for_upload.R`

**Added**:
- Section 2b: Extract constraint and weight layers from PU CSV
- Hard-coded theme mapping (lines 73-83)
- UTF-8 encoding for all read/write operations
- Constraint/weight layer metadata in `layers_metadata`

**Changed**:
- Planning unit TIF now copied to root directory
- `layers_metadata` now combines theme and constraint layers
- All CSVs written with UTF-8 encoding

### Total Layers Output

**Before**: 9 theme layers  
**After**: 15 layers total (9 themes + 5 includes + 1 weight)

## Testing Checklist

When you run the scripts, verify:

- [ ] All 9 feature TIFs extracted successfully
- [ ] 6 constraint/weight TIFs created from PU CSV
- [ ] Planning unit TIF in root of `upload_ready/`
- [ ] `layers.csv` has 15 rows (9 themes + 6 constraints/weights)
- [ ] Theme column shows Spanish text with accents correctly
- [ ] Include layers have Type="include"
- [ ] Weight layer has Type="weight"
- [ ] Solutions CSV created successfully

## File Locations

All processing files are in:
```
Cambio_Global/eje_cafetero_processing/
├── 00_run_all.R                          # Master script
├── 01_extract_features_from_rij.R        # Extract features
├── 02_organize_for_upload.R              # Organize for upload (UPDATED)
├── README.md                              # Documentation
├── EXPLANATION.md                         # Why features aren't all in rij
└── CHANGELOG.md                           # This file
```

Output location:
```
Cambio_Global/eje_cafetero_processing/upload_ready/
```

