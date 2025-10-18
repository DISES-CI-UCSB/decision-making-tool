# Eje Cafetero SIRAP Processing Workflow

This folder contains scripts to process the Eje Cafetero SIRAP prioritization data and organize it into a format ready for upload to the decision-making tool.

## Overview

The workflow consists of two main steps:
1. Extract features from the rij matrix and create TIF rasters
2. Organize all data (layers and solutions) into the upload format

## Data Sources

### Input Data
- **Scenarios**: `input/Propuesta_Ejecafero_26625.xlsx` (sheet: "escenarios_nuevos")
- **RIJ Matrix**: `input/rij_EJE_CAFETERO_1km.fst`
- **Features Metadata**: `input/features_v4_4_24_(MAPV).xlsx`
- **Planning Units**: `features/PUs_EJE_CAFETERO_1km.tif`
- **Solutions**: `output/EJE_CAFETERO/*.tif`

### Features Extracted

The following features are extracted from either the rij matrix or direct raster files (by `id_elemento_priorizacion`):

| ID | Feature Name | Output File | Source |
|----|--------------|-------------|--------|
| 1  | Ecosistemas IAVH | `ecosistemas_IAVH.tif` | RIJ Matrix |
| 4  | Páramos | `paramos.tif` | RIJ Matrix |
| 24 | Manglares | `manglares.tif` | `features/Manglares INVEMAR.tif` |
| 6  | Humedales | `humedales.tif` | `features/humedales.tif` |
| 7  | Bosque Seco | `bosque_seco.tif` | RIJ Matrix |
| 21 | Especies (~8700 species) | `especies_richness.tif` (aggregated) | RIJ Matrix |
| 11 | Carbono Orgánico en Suelos | `carbono_organico_suelos.tif` | `features/GSOC_v1.5_fixed_1km.tif` |
| 12 | Biomasa Aérea más Subterránea | `biomasa_aerea_mas_subterranea.tif` | `features/agb_plus_bgb_spawn_2020_fixed_1km.tif` |
| 15 | Recarga de Agua Subterránea | `recarga_agua_subterranea.tif` | `features/recarga_agua_subterranea_moderado_alto.tif` |

**Note on Data Sources**:
- **RIJ Matrix**: Categorical/presence features that went through the rij generation workflow
- **Direct Files**: Continuous layers and some binary layers stored as standalone rasters in the `features/` folder
- **Species**: ~8700 individual species distributions are aggregated into a single species richness raster where each pixel value represents the number of species present in that planning unit

The script automatically handles both sources and will reproject direct files if needed to match the Eje Cafetero planning units.

## Workflow Steps

### Step 1: Extract Features

**Script**: `01_extract_features_from_rij.R`

This script:
- Reads the rij matrix for Eje Cafetero (`rij_EJE_CAFETERO_1km.fst`)
- Extracts features from the rij matrix (ecosystems, páramos, bosque seco, species)
- Loads and reprojects (if needed) features from the `features/` folder (manglares, humedales, biomass, carbon, water)
- For species (id_elemento 21), aggregates ~8700 species into a species richness raster
- Saves all features as TIF files in `extracted_features/`

**Output**:
- `extracted_features/*.tif` - 9 feature rasters (all at the same resolution/extent as Eje Cafetero planning units)

### Step 2: Organize for Upload

**Script**: `02_organize_for_upload.R`

This script:
- Copies planning units raster to `upload_ready/` (root directory)
- Copies extracted feature rasters to `upload_ready/layers/`
- Extracts constraint and weight layers from planning unit CSV (includes, excludes, weights)
- Uses hard-coded theme mapping based on Excel `grupo` column structure
- Creates `layers.csv` with metadata for all layers (themes + constraints/weights)
- Copies solution TIF files from `output/EJE_CAFETERO/` to `upload_ready/solutions/`
- Reads scenario information from `Propuesta_Ejecafero_26625.xlsx`
- Creates `solutions.csv` with metadata for all solutions
- All CSV files written with UTF-8 encoding to preserve accents

**Output**:
- `upload_ready/PU_EJE_CAFETERO_1km.tif` - Planning units (in root)
- `upload_ready/layers/` - Feature TIFs, constraint TIFs, weight TIFs, and layers.csv
- `upload_ready/solutions/` - Solution TIFs and solutions.csv

**Constraint and Weight Layers Added**:
- `resguardos_indigenas.tif` - Indigenous reserves (include)
- `comunidades_negras.tif` - Afro-Colombian communities (include)
- `RUNAP.tif` - Protected areas (include)
- `ECC_SIRAPEC.tif` - Strategic ecosystems (include)
- `OMECs.tif` - Marine areas (include)
- `IHEH_2022.tif` - Human footprint index (weight)

## Upload Format

The final `upload_ready/` folder follows this structure:

```
upload_ready/
├── PU_EJE_CAFETERO_1km.tif                # Planning units (in root)
├── layers/
│   ├── layers.csv                          # Metadata for all layers
│   ├── ecosistemas_IAVH.tif               # Theme layers
│   ├── paramos.tif
│   ├── manglares.tif
│   ├── humedales.tif
│   ├── bosque_seco.tif
│   ├── especies_richness.tif
│   ├── carbono_organico_suelos.tif
│   ├── biomasa_aerea_mas_subterranea.tif
│   ├── recarga_agua_subterranea.tif
│   ├── resguardos_indigenas.tif           # Include/constraint layers
│   ├── comunidades_negras.tif
│   ├── RUNAP.tif
│   ├── ECC_SIRAPEC.tif
│   ├── OMECs.tif
│   └── IHEH_2022.tif                       # Weight layers
└── solutions/
    ├── solutions.csv                       # Metadata for all solutions
    ├── scenario1.tif
    ├── scenario2.tif
    └── ...
```

### layers.csv Format

| Column | Description |
|--------|-------------|
| Type | Layer type: theme, include, exclude, weight |
| Theme | Theme grouping for the layer (from `grupo` column in Excel) |
| File | Filename of the TIF |
| Name | Display name |
| Legend | Legend type: manual or continuous |
| Values | For manual legends, the values (e.g., "0, 1") |
| Color | Color scheme or hex colors |
| Labels | Labels for manual legend values |
| Unit | Unit of measurement (typically km2) |
| Provenance | Data source/provenance |
| Order | Display order (optional) |
| Visible | Initial visibility (TRUE/FALSE) |
| Hidden | Hide from selection (TRUE/FALSE) |
| Goal | Default conservation target (0-1) |
| Downloadable | Allow download (TRUE/FALSE) |

### solutions.csv Format

| Column | Description |
|--------|-------------|
| description | Description of the solution |
| author_name | Author name |
| author_email | Author email |
| user_group | Access level (public/private) |
| scenario | Scenario name (must match TIF filename) |
| file_path | TIF filename |
| themes | Comma-separated list of theme names used |
| targets | Comma-separated list of targets (0-1) |
| weights | Weight/cost layer used |
| includes | Comma-separated list of inclusion constraints |
| excludes | Comma-separated list of exclusion constraints |

## Running the Workflow

1. Open R/RStudio
2. Run `01_extract_features_from_rij.R`
   - This will create `extracted_features/` with 9 TIF files
3. Run `02_organize_for_upload.R`
   - This will create `upload_ready/` with organized data
4. Upload the contents of `upload_ready/` using the admin page

## Notes

- The scripts use `rstudioapi::getActiveDocumentContext()` to determine the working directory. If running outside RStudio, you may need to manually set the working directory.
- All rasters are compressed using DEFLATE compression to reduce file size.
- Species richness is calculated by counting the number of distinct species per planning unit from the rij matrix.
- Solution files that don't exist in `output/EJE_CAFETERO/` will be skipped with a warning.

## Dependencies

Required R packages:
- `fst` - For reading .fst files
- `raster` - For raster operations
- `dplyr` - For data manipulation
- `openxlsx` - For reading Excel files
- `rstudioapi` - For getting script location (optional)

