# Why Some Features Weren't in the RIJ Matrix

## The Issue

When you ran the first version of the extraction script, several features weren't found in the rij matrix:
- Manglares (id: 24) - 0 records
- Humedales (id: 6) - 0 records
- Carbono Orgánico Suelos (id: 11) - 0 records
- Biomasa Aérea más Subterránea (id: 12) - 0 records
- Recarga de Agua Subterránea (id: 15) - 0 records

## The Reason

The **rij matrix** stores feature-planning unit relationships in a sparse matrix format. This format is ideal for:
- **Categorical features** (e.g., ecosystem types, protected areas)
- **Species distributions** (presence/absence per planning unit)
- Features where most planning units have **no data** (sparse)

However, **continuous layers** like biomass, carbon, and water recharge are typically:
- Dense (most planning units have values)
- Better stored as raster files
- Not processed through the rij generation workflow

Looking at the R scripts (`2_rij_large_features.R` and `3_merge_rijs.R`), the rij generation process only processed certain categorical features and species distributions. The continuous environmental layers were kept as standalone raster files in the `features/` folder.

## The Solution

The updated script (`01_extract_features_from_rij.R`) now handles **both sources**:

### From RIJ Matrix:
- Ecosistemas IAVH (396 ecosystem types)
- Páramos  
- Bosque Seco
- Especies (~8700 species → aggregated to richness)

### From Direct Raster Files:
- Manglares → `features/Manglares INVEMAR.tif`
- Humedales → `features/humedales.tif`
- Carbono Orgánico Suelos → `features/GSOC_v1.5_fixed_1km.tif`
- Biomasa Aérea más Subterránea → `features/agb_plus_bgb_spawn_2020_fixed_1km.tif`
- Recarga de Agua Subterránea → `features/recarga_agua_subterranea_moderado_alto.tif`

The script will:
1. Try to extract from rij if available
2. Otherwise load from the direct file
3. Reproject if needed to match the Eje Cafetero planning units
4. Save all features in a consistent format

## File Name Mapping

Here's how the original feature files map to your simplified names:

| Original File | Simplified Name | Description |
|--------------|-----------------|-------------|
| `Manglares INVEMAR.tif` | `manglares.tif` | Mangrove ecosystems (INVEMAR data) |
| `humedales.tif` | `humedales.tif` | Wetlands |
| `GSOC_v1.5_fixed_1km.tif` | `carbono_organico_suelos.tif` | Global Soil Organic Carbon (GSOC) |
| `agb_plus_bgb_spawn_2020_fixed_1km.tif` | `biomasa_aerea_mas_subterranea.tif` | Above + Below Ground Biomass (SPAWN 2020) |
| `recarga_agua_subterranea_moderado_alto.tif` | `recarga_agua_subterranea.tif` | Groundwater recharge (moderate-high) |

Now you can re-run the script and all 9 features should be successfully extracted!

