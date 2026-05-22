# Layer Manifest / Manifiesto de Capas

## Espanol

### Que es

El `manifest.json` es un indice pequeno para la aplicacion. Su trabajo principal es decirle al panel lateral:

- que categorias de capas existen,
- que capas pertenecen a cada categoria,
- que nombre y descripcion debe mostrar,
- que URL debe cargar cuando una persona quiere ver una capa,
- que archivos relacionados existen para metadatos y metricas.

El manifest no debe guardar toda la historia de una capa. Los detalles largos de fuente, licencia, contacto, verificacion y notas deben vivir en archivos de metadatos separados, como `metadata/species_richness.metadata.json`.

### Archivos principales

- `manifest.example.json`: ejemplo legible del contrato, con casos representativos.
- `manifest.schema.json`: contrato tecnico que valida la estructura.
- `generate-manifest.mjs`: genera el manifest runtime desde el CSV verificado y Vercel Blob.
- `generate-species-manifest.mjs`: hidrata el manifest secundario de especies (`species.manifest.json`) desde Blob y calcula configuracion de render por especie.
- `validate-manifest.mjs`: valida el ejemplo y el manifest runtime.
- `public/data/layer-manifest/manifest.json`: manifest runtime actual que la app usa en local.
- `public/data/layer-manifest/species.manifest.json` (omitido por git): salida opcional solo para depuracion local al ejecutar `npm run generate:species-manifest`. En tiempo de ejecucion la app obtiene la version publicada desde `speciesManifestUrl` en Vercel Blob.
- `latest/manifest.latest.json` (gitignored): snapshot legible para desarrolladores con metadatos de origen.
- `../../development-artifacts/layer-manifest/reports/reconciliation-report.json`: reporte para revisar diferencias entre el CSV verificado y Blob Storage.
- `../../development-artifacts/layer-manifest/reports/category-mapping-report.json`: reporte para comparar categorias del CSV con categorias actuales del panel lateral.
- `../../development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json`: reporte para revisar que soluciones en Blob entraron en `solutions[]`.
- `../../development-artifacts/layer-manifest/reports/category-review.csv`: borrador para revisar categorias en Google Sheets con el equipo cientifico.

### CSV, Blob y reporte de reconciliacion

El CSV verificado es la fuente de verdad para las capas requeridas. Vercel Blob es la fuente de verdad para los archivos disponibles.

El reporte de reconciliacion no es para la aplicacion. Es para humanos y desarrolladores. Contesta preguntas como:

- Que capas requeridas estan presentes en Blob?
- Que capas requeridas faltan?
- Que archivos existen en Blob pero no estan incluidos por el CSV?
- Que capas incluidas tienen vacios de metadatos?
- Que filas del CSV fueron excluidas porque `in_use_now` no es `TRUE`?

### Campos importantes del manifest

- `id`: identificador estable de la capa conceptual.
- `spanishLabel` y `englishLabel`: nombres para mostrar.
- `description`: descripcion corta de la capa.
- `tooltip`: texto corto opcional para ayuda en la UI.
- `dataRole`: que tipo de dato es.
- `category`: ruta con punto que ubica la capa en el panel lateral, como `"ecosystems"` para una categoria de primer nivel o `"species_and_biodiversity.felidae"` cuando vive bajo una subcategoria.
- `roleInMetricCalculation`: como participa en el calculo de metricas.
- `displayUrl` o `displayCollectionUrl`: URL que la aplicacion usa para mostrar la capa.
- `metadataUrl`: URL del archivo de metadatos detallados.
- `compressedDataForLiveMetricsUrl`: URL del archivo comprimido usado para calculo vivo de metricas.
- `precomputedMetricUrls`: URLs para metricas precalculadas.
- `speciesManifestUrl`: URL del manifest secundario de especies, cuando aplica.
- `solutions[]`: catalogo app-facing de soluciones disponibles en Blob, con URL del raster, URL de metadatos, entradas normalizadas para Finder, metricas resumen y cobertura.

### Roles de datos

- `feature_layer`: capa de caracteristica usada por el modelo o el mapa.
- `manifest_for_species_layers`: entrada que apunta al manifest secundario de especies.
- `species_layer`: una capa de especie individual dentro del manifest de especies.
- `cost_layer`: capa de costo.
- `include_layer`: capa de inclusion.
- `solution_layer`: capa de solucion generada por el modelo.
- `administrative_boundary`: limite administrativo o area de interes conocida.
- `reference_layer`: capa de referencia visual que no encaja en los roles anteriores.

### Roles en calculo de metricas

- `none`: no participa en metricas.
- `data_used_for_live_metric_calculation`: datos usados para calculo vivo de metricas.
- `boundary_used_for_precomputed_metric_lookup`: limite usado para buscar metricas precalculadas.
- `data_used_for_live_metric_calculation_and_precomputed_metric_lookup`: datos usados para calculo vivo y busqueda precalculada.

### Especies

La entrada `species` del manifest principal no representa una sola especie. Representa el punto de entrada para cargar `species.manifest.json`.

El manifest secundario de especies debe describir las especies individuales, sus taxones, nombres de busqueda y URLs de capas. Asi evitamos poner miles de especies en el manifest principal. La copia canonica esta en Blob (`speciesManifestUrl`); el archivo local bajo `public/data/layer-manifest/` es solo artefacto de generacion si lo necesitas.

### Como Funcionan Las Etiquetas Bilingues

Cada capa y categoria del manifest tiene dos campos de nombre para mostrar:

- `spanishLabel` — siempre requerido; se usa como ultimo recurso si falta el otro.
- `englishLabel` — requerido por el esquema; la UI usa `spanishLabel` como fallback si es null.

La logica de seleccion de etiquetas esta en `src/app/core/models/layer-manifest.model.ts` (`resolveLayerLabel`). El locale activo es gestionado por `AppLocaleService` (`src/app/core/services/app-locale.service.ts`).

### De Donde Vienen Las Etiquetas (Y Como Editarlas)

Las etiquetas se obtienen de tres fuentes, aplicadas en este orden de prioridad durante la generacion:

| Prioridad | Fuente                                                     | Que cubre                                                                                                                                                         |
| --------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Columna `layer_name` del CSV (linea 2)                     | Etiqueta en ingles para capas rastreadas por el CSV. Si la celda tiene dos lineas separadas por salto de linea, linea 1 = espanol, linea 2 = ingles.              |
| 2         | `englishLabelOverrideByLayerId` en `generate-manifest.mjs` | Etiquetas en ingles hardcodeadas para capas cuya fila CSV no tiene linea en ingles. Edita este mapa para corregir o agregar etiquetas en ingles sin tocar el CSV. |
| 3         | `proposedManifestCategories` en `generate-manifest.mjs`    | Etiquetas de categoria (hardcodeadas, siempre bilingues).                                                                                                         |

**Para cambiar el nombre de una capa:** buscarla en `englishLabelOverrideByLayerId` (para las 7 capas actualmente sobreescritas) o agregar una celda `layer_name` de dos lineas en el CSV. Luego ejecutar `npm run generate:layer-manifest`.

**Limitacion conocida:** la edicion de etiquetas esta actualmente dividida entre el CSV y dos ubicaciones en el generador. Una tarea de limpieza futura consolidaria todas las etiquetas en un unico archivo `layer-labels.json` que el generador leeria.

### Regenerar y validar

```bash
npm run generate:layer-manifest
npm run validate:layer-manifest
```

## English

### What It Is

`manifest.json` is a small application index. Its main job is to tell the left sidebar:

- which layer categories exist,
- which layers belong to each category,
- which name and description to show,
- which URL to load when someone wants to display a layer,
- which related files exist for metadata and metrics.

The manifest should not store the full history of a layer. Long source, license, contact, verification, and notes details should live in separate metadata files, such as `metadata/species_richness.metadata.json`.

### Main Files

- `manifest.example.json`: readable example of the contract, with representative cases.
- `manifest.schema.json`: technical contract used for validation.
- `generate-manifest.mjs`: generates the runtime manifest from the verified CSV and Vercel Blob.
- `generate-species-manifest.mjs`: hydrates the secondary species manifest (`species.manifest.json`) from Blob and computes per-species rendering settings.
- `validate-manifest.mjs`: validates the example and runtime manifest.
- `public/data/layer-manifest/manifest.json`: current runtime manifest used by the app in local development.
- `public/data/layer-manifest/species.manifest.json` (gitignored): optional local debugger output when you run `npm run generate:species-manifest`. At runtime the app should load the published copy via `speciesManifestUrl` on Vercel Blob.
- `latest/manifest.latest.json` (gitignored): developer-readable snapshot with source metadata.
- `../../development-artifacts/layer-manifest/reports/reconciliation-report.json`: report for reviewing differences between the verified CSV and Blob Storage.
- `../../development-artifacts/layer-manifest/reports/category-mapping-report.json`: report for comparing CSV categories with current left-sidebar categories.
- `../../development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json`: report for checking which Blob solutions were included in `solutions[]`.
- `../../development-artifacts/layer-manifest/reports/category-review.csv`: draft category review sheet for the science team in Google Sheets.

### CSV, Blob, And Reconciliation

The verified CSV is the source of truth for required layers. Vercel Blob is the source of truth for available files.

The reconciliation report is not for the application. It is for humans and developers. It answers questions like:

- Which required layers are present in Blob?
- Which required layers are missing?
- Which Blob files exist but are not included by the CSV?
- Which included layers have metadata gaps?
- Which CSV rows were excluded because `in_use_now` is not `TRUE`?

### Important Manifest Fields

- `id`: stable identifier for the conceptual layer.
- `spanishLabel` and `englishLabel`: display names.
- `description`: short layer description.
- `tooltip`: optional short UI help text.
- `dataRole`: what kind of data this is.
- `category`: dot-path locating the layer in the left sidebar, for example `"ecosystems"` for a top-level category or `"species_and_biodiversity.felidae"` when the layer lives under a subcategory.
- `roleInMetricCalculation`: how this layer participates in metric calculation.
- `displayUrl` or `displayCollectionUrl`: URL the app uses to display the layer.
- `metadataUrl`: URL for detailed layer metadata.
- `compressedDataForLiveMetricsUrl`: URL for compressed data used in live metric calculation.
- `precomputedMetricUrls`: URLs for precomputed metrics.
- `speciesManifestUrl`: URL for the secondary species manifest, when relevant.
- `solutions[]`: app-facing catalog of available Blob solutions, including raster URL, metadata URL, normalized Finder inputs, summary metrics, and coverage.

### Data Roles

- `feature_layer`: feature layer used by the model or map.
- `manifest_for_species_layers`: entry that points to the secondary species manifest.
- `species_layer`: one individual species layer inside the species manifest.
- `cost_layer`: cost layer.
- `include_layer`: include layer.
- `solution_layer`: solution layer generated by the model.
- `administrative_boundary`: administrative boundary or known area of interest.
- `reference_layer`: visual reference layer that does not fit the other roles.

### Metric Calculation Roles

- `none`: does not participate in metrics.
- `data_used_for_live_metric_calculation`: data used for live metric calculation.
- `boundary_used_for_precomputed_metric_lookup`: boundary used to look up precomputed metrics.
- `data_used_for_live_metric_calculation_and_precomputed_metric_lookup`: data used for live calculation and precomputed lookup.

### Species

The `species` entry in the main manifest does not represent one species. It is the entry point for loading `species.manifest.json`.

The secondary species manifest should describe individual species, taxa, search names, and layer URLs. This avoids putting thousands of species in the main manifest. The canonical copy lives on Blob (`speciesManifestUrl`); the file under `public/data/layer-manifest/` is only a generated local artifact when you run the hydrator for debugging or builds.

### How Bilingual Labels Work

Every layer and category in the manifest has two display name fields:

- `spanishLabel` — always required; used as the last-resort fallback.
- `englishLabel` — required by the schema; the UI falls back to `spanishLabel` if null.

The runtime label selection policy lives in `src/app/core/models/layer-manifest.model.ts` (`resolveLayerLabel`). The active locale is managed by `AppLocaleService` (`src/app/core/services/app-locale.service.ts`).

### Where Labels Come From (And How To Edit Them)

Labels are populated from three sources, applied in this order of precedence during generation:

| Priority | Source                                                     | What it covers                                                                                                                              |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | CSV `layer_name` column (line 2)                           | English label for CSV-tracked layers. If the cell has two newline-separated lines, line 1 = Spanish, line 2 = English.                      |
| 2        | `englishLabelOverrideByLayerId` in `generate-manifest.mjs` | Hardcoded English labels for layers whose CSV row has no English line. Edit this map to fix or add English labels without touching the CSV. |
| 3        | `proposedManifestCategories` in `generate-manifest.mjs`    | Category-level labels (hardcoded, always bilingual).                                                                                        |

**To change a layer's display name:** find it in `englishLabelOverrideByLayerId` (for the 7 currently overridden layers) or add a two-line `layer_name` cell to the CSV. Then re-run `npm run generate:layer-manifest`.

**Known limitation:** label editing is currently split across the CSV and two locations in the generator. A future cleanup task would consolidate all labels into a single `layer-labels.json` file that the generator reads.

### Regenerate And Validate

```bash
npm run generate:layer-manifest
npm run validate:layer-manifest
```
