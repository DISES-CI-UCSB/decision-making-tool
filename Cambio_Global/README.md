# Cambio Global - Data Processing Pipeline

R scripts for processing conservation prioritization data into upload-ready formats for the Decision Making Tool.

## Directory Structure

```
Cambio_Global/
├── input/                    # Source data files
│   ├── rij_*.fst             # Feature-by-planning-unit matrices
│   ├── features_*.xlsx       # Feature definitions
│   ├── costs_and_constraints_*.xlsx
│   └── scenarios_*.xlsx      # Scenario configurations
│
├── features/                 # Raw feature rasters (.tif)
│
├── scripts/                  # Core processing scripts
│   ├── 1_costs_and_constraints.R  # Generate cost/constraint layers
│   ├── 2_rij_large_features.R     # Build rij matrices
│   ├── 3_merge_rijs.R             # Merge partial rij files
│   └── 4_run_scenarios.R          # Run prioritizr optimization
│
├── output/                   # Prioritization solution outputs
│   ├── Nacional/
│   ├── ORINOQUIA/
│   └── EJE_CAFETERO/
│
├── nacional_processing/      # Nacional region extraction
├── orinoquia_processing/     # Orinoquia region extraction
├── eje_cafetero_processing/  # Eje Cafetero region extraction
│
└── upload_ready/             # Final ZIPs for app upload
```

## Processing Pipeline

Each region folder (`nacional_processing/`, `orinoquia_processing/`, `eje_cafetero_processing/`) contains:

| Script | Purpose |
|--------|---------|
| `00_run_all.R` | Master script - runs entire pipeline |
| `01_extract_features_from_rij.R` | Extracts feature rasters from rij matrix |
| `02_organize_for_upload.R` | Creates `layers.csv`, `solutions.csv`, and ZIPs |
| `03_validate_output.R` | Validates output structure (optional) |

### Running the Pipeline

```r
# Option 1: Run everything
source("nacional_processing/00_run_all.R")

# Option 2: Run steps individually
source("nacional_processing/01_extract_features_from_rij.R")
source("nacional_processing/02_organize_for_upload.R")
```

## Output Format

The pipeline generates upload-ready ZIPs containing:

### layers.zip
```
layers/
├── layers.csv              # Layer metadata (Type, Theme, File, Name, Legend, etc.)
├── feature1.tif            # Feature rasters
├── feature2.tif
├── constraint1.tif         # Constraint/weight rasters
└── ...
```

### solutions.zip
```
solutions/
├── solutions.csv           # Solution metadata (File, Name, Legend, etc.)
├── scenario_1.tif          # Solution rasters (binary 0/1)
├── scenario_2.tif
└── ...
```

## Key Data Structures

### layers.csv columns
| Column | Description |
|--------|-------------|
| Type | `theme`, `weight`, `include`, or `exclude` |
| Theme | Grouping category for themes |
| File | Filename (e.g., `ecosistemas_IAVH.tif`) |
| Name | Display name with units |
| Legend | `manual`, `continuous`, or `null` |
| Values | Comma-separated values for legend |
| Color | Color codes or palette name |
| Goal | Default target (0-1) for themes |

### solutions.csv columns
| Column | Description |
|--------|-------------|
| File | Solution raster filename |
| Name | Display name |
| Legend | Always `manual` for binary solutions |
| Values | `0, 1` |
| Color | Two colors for not-selected/selected |

## Dependencies

```r
install.packages(c("raster", "terra", "fst", "dplyr", "openxlsx", "prioritizr"))
```

## Notes

- Planning unit rasters must align exactly (extent, resolution, CRS)
- Feature rasters are extracted from rij matrices or loaded from `features/`
- Solution rasters are binary (0 = not selected, 1 = selected)

