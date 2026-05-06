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

- `manifest.template.json`: ejemplo pequeno y legible del contrato, con casos representativos.
- `manifest.schema.json`: contrato tecnico que valida la estructura.
- `generate-manifest.mjs`: genera el manifest runtime desde el CSV verificado y Vercel Blob.
- `validate-manifest.mjs`: valida el template y el manifest generado.
- `reports/reconciliation-report.json`: reporte para revisar diferencias entre el CSV verificado y Blob Storage.
- `reports/category-mapping-report.json`: reporte para comparar categorias del CSV con categorias actuales del panel lateral.
- `reports/category-review.csv`: borrador para revisar categorias en Google Sheets con el equipo cientifico.
- `public/data/layer-manifest/manifest.json`: manifest mas reciente para desarrollo local. Este archivo esta ignorado por git y funciona como cache/snapshot para desarrolladores.

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
- `sidebarCategoryId`: en que categoria del panel lateral aparece.
- `roleInMetricCalculation`: como participa en el calculo de metricas.
- `displayUrl` o `displayCollectionUrl`: URL que la aplicacion usa para mostrar la capa.
- `metadataUrl`: URL del archivo de metadatos detallados.
- `compressedDataForLiveMetricsUrl`: URL del archivo comprimido usado para calculo vivo de metricas.
- `precomputedMetricUrls`: URLs para metricas precalculadas.
- `speciesManifestUrl`: URL del manifest secundario de especies, cuando aplica.

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

El manifest secundario de especies debe describir las especies individuales, sus taxones, nombres de busqueda y URLs de capas. Asi evitamos poner miles de especies en el manifest principal.

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

- `manifest.template.json`: small readable example of the contract, with representative cases.
- `manifest.schema.json`: technical contract used for validation.
- `generate-manifest.mjs`: generates the runtime manifest from the verified CSV and Vercel Blob.
- `validate-manifest.mjs`: validates the template and generated manifest.
- `reports/reconciliation-report.json`: report for reviewing differences between the verified CSV and Blob Storage.
- `reports/category-mapping-report.json`: report for comparing CSV categories with current left-sidebar categories.
- `reports/category-review.csv`: draft category review sheet for the science team in Google Sheets.
- `public/data/layer-manifest/manifest.json`: latest local development manifest. This file is ignored by git and works as a developer cache/snapshot.

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
- `sidebarCategoryId`: which left-sidebar category contains this layer.
- `roleInMetricCalculation`: how this layer participates in metric calculation.
- `displayUrl` or `displayCollectionUrl`: URL the app uses to display the layer.
- `metadataUrl`: URL for detailed layer metadata.
- `compressedDataForLiveMetricsUrl`: URL for compressed data used in live metric calculation.
- `precomputedMetricUrls`: URLs for precomputed metrics.
- `speciesManifestUrl`: URL for the secondary species manifest, when relevant.

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

The secondary species manifest should describe individual species, taxa, search names, and layer URLs. This avoids putting thousands of species in the main manifest.

### Regenerate And Validate

```bash
npm run generate:layer-manifest
npm run validate:layer-manifest
```
