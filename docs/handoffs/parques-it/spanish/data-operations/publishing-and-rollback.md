[← Volver a Operaciones de Datos](./README.md)

# Publicación y reversión

> **Audiencia:** Publicadores de datos y operadores de pipelines que lanzan productos de datos validados o restauran una versión en buen estado.
>
> Los comandos marcados como **admitidos** están presentes en este repositorio. Los pasos marcados como **manual** no tienen automatización de repositorio dedicada y requieren un procedimiento Blob/host aprobado más un nombre de ruta, suma de verificación, operador y marca de tiempo registrados.

Ejecute comandos desde la raíz del repositorio a menos que un procedimiento indique lo contrario. Nunca coloque valores de variables de entorno en la documentación o en la salida de comandos.

## Antes de cualquier publicación

1. Identifique el entorno de destino, la URL pública o la ruta Blob, los consumidores y el revisor científico.
2. Conserve los archivos fuente, el directorio de generación, los informes, las sumas de verificación y la referencia exacta de reversión en buen estado.
3. Confirme que `BLOB_READ_WRITE_TOKEN` esté presente sin imprimirlo.
4. Prefiera una ruta de versión inmutable para las métricas y otros artefactos con caché de larga duración.
5. Genere, pruebe, valide e inspeccione los artefactos antes de escribirlos en el destino.
6. Publique los activos de datos antes de publicar cualquier manifiesto que los referencie.

## Los cuatro manifiestos

| Manifiesto                  | Ubicación canónica                                                                                        | Propósito del operador                                                                        | Comportamiento de publicación                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Manifiesto de capa de tiempo de ejecución    | Local `frontend/public/data/layer-manifest/manifest.json`; en producción `manifest/manifest.json`                  | Capas de aplicaciones, categorías, soluciones, renderizado, URL de métricas y puntero de manifiesto de especies | Comandos dedicados de publicación y reversión; la versión activa anterior se archiva en `manifest/archive/`                   |
| Manifiesto de especies          | Local `frontend/public/data/layer-manifest/species.manifest.json`; en producción `manifests/species.manifest.json` | Catálogo secundario para especies individuales.                                                | La generación publica de forma predeterminada cuando un token está disponible y archiva la versión anterior en `manifests/archive/` |
| Manifiesto de artefactos de backend | VM local `backend/runtime-artifacts/manifest.json`                                                        | Disponibilidad de FastAPI y entradas ráster y de especies para AOI personalizadas                                  | Construido sobre el host de métricas; no es un manifiesto del navegador y no está publicado por los scripts del frontend                            |
| Manifiesto de activos de despliegue     | `frontend/scripts/data-deploy/manifest.json`                                                              | Validación en tiempo de compilación de activos copiados en `frontend/public/`                          | Utilizado por herramientas de construcción frontend; no el catálogo de capas de tiempo de ejecución                                                          |

No reemplace un manifiesto por otro ni infiera la visibilidad de la aplicación a partir de la existencia de un manifiesto de despliegue o del backend.

## Registros y conciliaciones

El generador de tiempo de ejecución lee el CSV verificado:

```text
data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv
```

Estas son instantáneas legibles por humanos, no entradas del generador:

```text
data/input_layers_in_use.csv
data/input_layers_required.csv
```

Mantenga los tres alineados, pero trate el CSV verificado como el registro del generador y el Blob como el registro de disponibilidad. La deriva de registros múltiples es un riesgo de incidente conocido.

La generación escribe:

```text
development-artifacts/layer-manifest/reports/reconciliation-report.json
development-artifacts/layer-manifest/reports/category-mapping-report.json
development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json
```

Revise los activos faltantes/inesperados, las discrepancias de categorías, las soluciones omitidas y los pares de ráster/metadatos no coincidentes. No publique hasta que se explique cada diferencia.

## Convenciones de rutas en Blob

| Activo                       | Nombre de ruta o prefijo establecido                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Manifiesto de capa de tiempo de ejecución      | `manifest/manifest.json`                                                                                    |
| Archivos de manifiesto en tiempo de ejecución   | `manifest/archive/manifest.<timestamp>.json`                                                                |
| Manifiesto de especies            | `manifests/species.manifest.json`                                                                           |
| Archivos de manifiesto de especies   | `manifests/archive/species.manifest.<timestamp>.json`                                                       |
| Insumos de capas de características              | `inputs/features/`                                                                                          |
| Entradas de especies              | `inputs/features/species/`                                                                                  |
| Entradas de costos                 | `inputs/costs/`                                                                                             |
| Insumos de inclusión              | `inputs/includes/`                                                                                          |
| Soluciones nacionales          | `solutions/nacional/`                                                                                       |
| COG de solución               | Utilice el `expectedBlobPath` de cada informe de carga; no invente un prefijo paralelo                                |
| Métricas precalculadas predeterminadas | `metrics/cache/<solution-id>.metrics.json`                                                                  |
| Métricas versionadas           | Utilice la configuración de versión seleccionada por `--release-id`                                                    |
| Límites                  | Nombre de ruta de límite registrado existente; preserve el contrato de URL a menos que un cambio revisado actualice a los consumidores |

No existe un flujo de trabajo que examine `inputs/excludes/`. El contrato de metadatos admite `excludes[]`, pero los rásteres de exclusión y los controles de Finder todavía no están listos para su operación.

## Procedimiento 1: generar, probar, validar y publicar el manifiesto de tiempo de ejecución

1. Genere el manifiesto local y los informes de conciliación (**admitido**):

   ```bash
   npm --prefix frontend run generate:layer-manifest
   ```

2. Revise los tres informes de conciliación enumerados anteriormente (**revisión manual**).
3. Ejecute validación de esquema y pruebas de manifiesto (**admitido**):

   ```bash
   npm --prefix frontend run validate:layer-manifest
   npm --prefix frontend run test:layer-manifest
   ```

   Establezca `CHECK_REMOTE_DISPLAY_URLS=true` para que el validador analice las URL visibles remotas; la validación predeterminada no realiza esas solicitudes remotas.

4. Confirme que cada URL apunte a un recurso ya publicado (**revisión manual**). En particular:
   - `compressedDataForLiveMetricsUrl` puede generarse como `metrics/live/{id}.bin.gz`, mientras que los generadores de artefactos dispersos publican `*.sparse.gz` junto a las entradas de origen. Verifique el formato de producción y la URL.
   - Las métricas de producción deben tener `precomputedMetricUrls` explícito y versionado; la interfaz tiene un fallback de preproducción codificado para `solutions/nick-runs/...`.
5. Publique el manifiesto local validado (**admitido**):

   ```bash
   npm --prefix frontend run publish:layer-manifest
   ```

   El comando archiva el manifiesto en vivo actual antes de reemplazar `manifest/manifest.json`.

6. Registre el nombre de la ruta del archivo impreso por el comando, la nueva URL del manifiesto, la confirmación/referencia local, el operador y la marca de tiempo (**manual**).

## Procedimiento 2: Generar y publicar el manifiesto de especies

1. Asegúrese de que las cargas de archivos TIFF de especies estén completas. El proceso de carga y generación del manifiesto está **admitido**:

   ```bash
   npm --prefix frontend run upload:species-tifs:manifest
   ```

   Para generar a partir de TIFF ya publicados:

   ```bash
   npm --prefix frontend run generate:species-manifest
   ```

2. Comprenda el límite de escritura: `generate:species-manifest` escribe el archivo local y, cuando `BLOB_READ_WRITE_TOKEN` está disponible, publica `manifests/species.manifest.json` de forma predeterminada. Archiva el manifiesto activo de especies anterior en `manifests/archive/`.
3. Para una generación solo local, configure `SPECIES_MANIFEST_SKIP_BLOB_UPLOAD`; las ejecuciones parciales que utilizan `SPECIES_MANIFEST_MAX_LAYERS` no se publican a menos que `SPECIES_MANIFEST_ALLOW_PARTIAL_UPLOAD` esté habilitado explícitamente.
4. Trate cualquier fallo en el recuento de capas o cualquier código de salida distinto de cero como una versión fallida. No publique un catálogo parcial en producción (**decisión manual**).
5. Actualice la pestaña del navegador y verifique la búsqueda de especies, un ráster binario, un ráster continuo y las métricas afectadas (**manual**).

## Procedimiento 3: Publicar referencias de la solución COG

1. Genere los COG (**admitido**):

   ```bash
   python data/scripts/solutions-cog/main.py
   ```

2. Obtenga una vista previa de una carga e inspeccione el informe generado (**comando admitido, revisión manual**):

   ```bash
   npm --prefix frontend run upload:solutions-cogs -- --dry-run --limit 1
   ```

3. Cargue el conjunto COG (**admitido**):

   ```bash
   npm --prefix frontend run upload:solutions-cogs
   ```

4. Produzca y valide un manifiesto candidato sin publicarlo (**admitido**):

   ```bash
   npm --prefix frontend run publish:solution-cog-manifest
   ```

5. Publique el candidato después de la revisión (**admitido**):

   ```bash
   npm --prefix frontend run publish:solution-cog-manifest -- --publish
   ```

   Esto utiliza el publicador habitual del manifiesto de tiempo de ejecución, por lo que se archiva el manifiesto activo anterior.

## Procedimiento 4: inspeccionar, publicar y verificar métricas

1. Conserve el directorio de generación completo y `publish-report.json`. No existe un archivo de métricas automático.
2. No trate el `--validate-only` del pipeline regular como una validación de extremo a extremo. Esta opción comprueba el manifiesto, el catálogo y la presencia de las capas requeridas, y luego sale antes de la selección de la solución, la carga de límites, las lecturas de origen y el cálculo. Exija una generación real y una inspección.
3. Inspeccione la salida generada (**admitido**):

   ```bash
   python data/metrics/python/metrics_pipeline/inspect_metrics.py \
     --output-dir data/metrics/generated/tier1
   ```

4. Obtenga una vista previa de las cargas (**admitido**):

   ```bash
   python data/metrics/python/metrics_pipeline/publish.py \
     --output-dir data/metrics/generated/tier1 \
     --dry-run
   ```

5. Publique después de que la inspección se complete correctamente (**admitido**):

   ```bash
   python data/metrics/python/metrics_pipeline/publish.py \
     --output-dir data/metrics/generated/tier1
   ```

6. Compare los bytes remotos y SHA-256 con el informe local y verifique los encabezados de caché esperados (**admitido**):

   ```bash
   python data/metrics/python/metrics_pipeline/verify_artifacts.py \
     data/metrics/generated/tier1/publish-report.json
   ```

7. Regenere, valide y publique el manifiesto de tiempo de ejecución si las URL de métricas cambiaron (**admitido**):

   ```bash
   npm --prefix frontend run generate:layer-manifest
   npm --prefix frontend run validate:layer-manifest
   npm --prefix frontend run test:layer-manifest
   npm --prefix frontend run publish:layer-manifest
   ```

8. Verifique un resultado nacional y una AOI conocida de cada geografía afectada frente a las expectativas científicas (**manual**).

El publicador sobrescribe con `--force`; por lo tanto, los encabezados de caché Blob de larga duración pueden servir bytes antiguos en una URL sin cambios. Prefiera `--release-id` durante la generación y rutas de versión inmutables. Si los bytes ráster de origen cambiaron, regenere con `--no-cache`; si es necesario volver a calcular los resultados del cálculo, utilice `--force`. Esas opciones abordan diferentes cachés.

## Procedimiento 5: Publicar activos y límites genéricos

Ningún comando del repositorio carga de forma masiva capas genéricas de características, costos, inclusión, exclusión o referencia; pares `.tif`/`.json` de soluciones sin procesar; ni la mayoría de los archivos de límites.

1. Complete la guía operativa específica de la fuente y obtenga la aprobación científica.
2. Registre la ruta local, el nombre de ruta Blob de destino, SHA-256, el operador, la marca de tiempo y la referencia de activo anterior (**manual**).
3. Cargue a través del procedimiento aprobado Vercel Blob sin cambiar accidentalmente la ruta registrada (**manual**).
4. Verifique el tamaño remoto/suma de comprobación y la legibilidad pública (**manual**).
5. Actualice los pines de suma de verificación y los consumidores de URL en el mismo cambio revisado cuando cambie un contrato de límites (**cambio de desarrollador**).
6. Ejecute el procedimiento de manifiesto en tiempo de ejecución y todos los procedimientos de métricas/backend afectados.

Las excepciones dedicadas incluyen cargas de especies, cargas de soluciones COG, modo `--upload` de RUNAP y publicación de resumen de clasificación de ecosistemas. No generalice esos scripts a activos no relacionados.

## Cómo se vuelven visibles los activos publicados

1. El activo debe existir en la URL registrada en el manifiesto correspondiente.
2. El manifiesto de la capa en tiempo de ejecución debe admitir la capa y asignar su categoría a un grupo de barra lateral.
3. Una capa normal necesita un `displayUrl` o `displayCollectionUrl` utilizable.
4. Una solución necesita una entrada `solutions[]` válida y `finderInputs` utilizable; un ráster por sí solo no es suficiente.
5. Las especies requieren que el manifiesto principal apunte a un manifiesto de especies secundario válido.
6. Las métricas de AOI conocidas requieren una entrada `precomputedMetricUrls` válida o el contrato predeterminado heredado.
7. Los cambios de AOI personalizadas requieren artefactos de tiempo de ejecución reconstruidos y un contenedor de backend recreado.
8. Actualice el navegador durante la verificación porque los datos de manifiesto, especies y métricas pueden permanecer en la memoria.

## Comprobaciones posteriores a la publicación

1. Obtenga los manifiestos activos de tiempo de ejecución y de especies mediante una consulta que omita la caché, y confirme que la marca de tiempo y el contenido generados sean los previstos (**manual**).
2. Confirme que los informes de conciliación no contengan filas faltantes, excluidas, de categoría o de solución sin explicación.
3. Renderice una capa modificada y verifique la extensión, la alineación de CRS, las unidades, los colores y el comportamiento de NoData.
4. Busque y represente una solución afectada en Solution Finder.
5. Compruebe una AOI conocida de cada geografía afectada.
6. Compruebe un polígono personalizado cuando cambien las entradas activas.
7. Compare un polígono personalizado que coincida con un límite conocido con su resultado precalculado según las reglas científicas documentadas.
8. Para cambios de backend, ejecute (**admitido en el host de métricas**):

   ```bash
   curl http://127.0.0.1:8000/health
   curl http://127.0.0.1:8000/ready
   ```

   `/health` sólo prueba que el proceso está vivo. No devuelva el servicio al tráfico a menos que `/ready` tenga éxito cuando se requieran artefactos.

9. Registre comprobaciones, resultados, rutas de versión, sumas de comprobación y referencias de reversión (**manual**).

## Procedimientos de reversión

La reversión del manifiesto restaura únicamente los metadatos de enrutamiento. **No** recrea bytes de activos que se sobrescribieron o eliminaron en la ruta a la que se hace referencia. Antes de restaurar un manifiesto, verifique que todos los rásteres, métricas, artefactos complementarios y manifiestos secundarios a los que se hace referencia sigan existiendo con la suma de comprobación registrada; restaure los bytes faltantes o modificados por separado de las copias locales/inmutables retenidas.

### Manifiesto de capa de tiempo de ejecución

1. Liste los archivos disponibles sin cambiar el estado activo (**admitido**):

   ```bash
   npm --prefix frontend run rollback:layer-manifest
   ```

2. Revise la lista de archivos numerados y elija la entrada en buen estado (**decisión manual**).
3. Vuelva a publicar ese archivo (**admitido**):

   ```bash
   npm --prefix frontend run rollback:layer-manifest -- --use <index|pathname|url>
   ```

4. Actualice el navegador y repita las comprobaciones posteriores a la publicación afectadas.

### Manifiesto de especies

1. Identifique el `manifests/archive/species.manifest.<timestamp>.json` en buen estado del registro de versión (**manual**).
2. Copie ese Blob archivado a `manifests/species.manifest.json` usando la operación Blob aprobada (**manual; sin comando de reversión dedicado**).
3. Actualice el navegador y verifique la búsqueda/representación de especies. Si el puntero del manifiesto de tiempo de ejecución principal también cambió, reviértalo por separado.

### COG de solución

1. Si solo la nueva ruta de visualización COG es incorrecta, restaure el manifiesto de tiempo de ejecución archivado por `publish:solution-cog-manifest -- --publish` mediante el comando de reversión del manifiesto de tiempo de ejecución.
2. Confirme que el `displayUrl` heredado conservado se renderice. Normalmente no es necesario volver a cargar el ráster antiguo.
3. Si se sobrescribieron bytes ráster en el mismo nombre de ruta COG, restaure un COG retenido en buen estado mediante la operación Blob aprobada (**manual**) y tenga en cuenta el contenido obsoleto en caché.

### Métricas

1. Detenga la promoción e identifique el directorio de generación en buen estado retenido y su `publish-report.json` (**manual**).
2. Realice una ejecución en seco, vuelva a publicar y verifique ese directorio mediante el Procedimiento 4 (**admitido**).
3. Restaure el manifiesto de tiempo de ejecución anterior si las URL de métricas cambiaron.
4. Verifique la paridad de AOI conocidas y de AOI personalizadas según corresponda.

No existe un archivo de métricas automático. Si no existe un directorio/informe de generación local anterior o una versión inmutable, la reversión no se puede reproducir de forma segura.

### Límites

1. Vuelva a publicar el GeoJSON anterior retenido en su nombre de ruta aprobado (**manual**).
2. Restaure los pines de suma de verificación revisados ​​coincidentes y cualquier configuración de URL de interfaz de usuario modificada (**cambio de desarrollador**).
3. Vuelva a publicar las métricas afectadas, reconstruya los artefactos de backend si es necesario y vuelva a ejecutar las comprobaciones de identificación/métricas.

### Artefactos de tiempo de ejecución de backend

1. Seleccione el conjunto de fuentes/URL del manifiesto anterior y reconstrúyalo en el directorio de artefactos de la VM (**constructor admitido**):

   ```bash
   backend/.venv/bin/python backend/scripts/build_runtime_artifact.py
   ```

   Utilice las opciones admitidas `--manifest-url`, `--solution-id`, `--artifact-dir` o `--force` cuando lo requiera la versión registrada.

2. Vuelva a crear el servicio con los artefactos necesarios (**admitidos**):

   ```bash
   DMT_ARTIFACT_REQUIRED=true \
     docker compose -f backend/docker-compose.yml up -d --build --force-recreate
   ```

3. Inspeccione los registros y la disponibilidad (**admitido**):

   ```bash
   docker compose -f backend/docker-compose.yml logs --tail=100 backend
   curl http://127.0.0.1:8000/ready
   ```

4. Devuelva el tráfico solo después de comprobar la disponibilidad y superar la prueba de humo de polígono personalizado.

### Pérdida de almacenamiento o corrupción generalizada

Detenga la publicación y escale. No existe un procedimiento de recuperación ante desastres de Blob/Firestore automatizado y probado; los archivos históricos de manifiesto y las salidas locales conservadas no constituyen una recuperación ante desastres probada.

## Nombres de variables de entorno

Los valores nunca deben aparecer en esta guía ni en los registros de versiones.

| Objetivo                            | Nombres                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escrituras en Blob                        | `BLOB_READ_WRITE_TOKEN`                                                                                                                                                                                                                                                                       |
| Catálogo de tiempo de ejecución y enrutamiento        | `MANIFEST_BLOB_URL`, `BLOB_ASSET_PROXY_PATH`, `METRICS_API_BASE_URL`                                                                                                                                                                                                                          |
| Validación del manifiesto                | `CHECK_REMOTE_DISPLAY_URLS`                                                                                                                                                                                                                                                                   |
| Artefactos de backend                  | `DMT_ARTIFACT_DIR`, `DMT_ARTIFACT_MANIFEST`, `DMT_ARTIFACT_REQUIRED`, `DMT_ARTIFACT_SCHEMA_VERSION`, `DMT_METRICS_PIPELINE_PATH`                                                                                                                                                              |
| Carga de especies-TIF                 | `SPECIES_TIF_UPLOAD_SOURCE`, `SPECIES_TIF_BLOB_PREFIX`, `SPECIES_TIF_UPLOAD_CONCURRENCY`, `SPECIES_TIF_UPLOAD_MAX`, `SPECIES_TIF_UPLOAD_DRY_RUN`, `SPECIES_TIF_UPLOAD_RUN_SPECIES_MANIFEST`                                                                                                   |
| Publicación del manifiesto de especies       | `SPECIES_MANIFEST_SKIP_BLOB_UPLOAD`, `SPECIES_MANIFEST_MAX_LAYERS`, `SPECIES_MANIFEST_ALLOW_PARTIAL_UPLOAD`, `SPECIES_MANIFEST_BLOB_PATHNAME`, `SPECIES_MANIFEST_ARCHIVE_PREFIX`, `SPECIES_MANIFEST_SKIP_ARCHIVE`                                                                             |
| Fuente y ajuste del manifiesto de especies | `SPECIES_MANIFEST_CONCURRENCY`, `SPECIES_RASTER_SAMPLE_GRID_SIZE`, `SPECIES_MANIFEST_RASTER_READ_RETRY_ATTEMPTS`, `SPECIES_MANIFEST_BASE_REQUEST_DELAY_MS`, `SPECIES_MANIFEST_REQUEST_JITTER_MS`, `SPECIES_MANIFEST_RETRY_JITTER_MS`, `SPECIES_TAXONOMY_CSV_PATH`, `SPECIES_TAXONOMY_CSV_URL` |
| Editor del manifiesto                    | `ENABLE_MANIFEST_EDITOR`, `ENABLE_MANIFEST_EDITOR_WRITES`                                                                                                                                                                                                                                     |
| Cliente de Firebase                    | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `FIREBASE_MEASUREMENT_ID`                                                                                                                    |

## Brechas de automatización actuales

- Los activos genéricos y la mayoría de los límites carecen de automatización de carga dedicada.
- El generador verificado CSV y dos instantáneas legibles por humanos pueden desviarse.
- El almacenamiento, el registro y el comportamiento del Finder de la capa de exclusión no se implementan como un flujo de trabajo del operador.
- Las URL del manifiesto de métricas en vivo comprimidas y las convenciones de salida del generador disperso no coinciden claramente.
- La interfaz tiene un fallback de métricas compactas de preproducción codificado de forma rígida.
- Las sobrescrituras de métricas no se archivan automáticamente.
- La reversión de especies, la reversión de límites y la reversión de artefactos de backend requieren registros manuales de versiones.
- La recuperación ante desastres Blob/Firestore no está automatizada ni probada.
