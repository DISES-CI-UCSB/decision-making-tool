[← Volver a Operaciones de datos](./README.md)

# Gestión de capas

## Propósito y cuándo usarlo

Use este procedimiento para agregar, reemplazar o actualizar capas de elementos, costos, inclusiones, referencias solo de mapa o especies. Separa los roles de una capa en el optimizador, el mapa, las métricas precalculadas y las AOI personalizadas para que los operadores realicen únicamente el trabajo posterior que el cambio realmente requiere.

No use este procedimiento para agregar exclusiones. Aunque los metadatos de soluciones tienen `excludes[]`, el repositorio no tiene una carpeta canónica de exclusiones, un prefijo de Blob examinado, un flujo de carga ni un control del Finder probado. Las exclusiones no están listas para operación.

## Roles y requisitos previos

- **Operador de entrega:** controla las escrituras en Blob, los cambios del registro, los informes generados y la publicación del manifiesto.
- **Responsable de datos o analista:** aprueba el significado científico, los valores, las unidades, el CRS, la resolución, NoData, la procedencia y la clasificación de roles.
- **Revisor:** comprueba la conciliación, representación, etiquetas, métricas y evidencia de reversión.
- **Desarrollador:** se requiere para una nueva definición de métrica, comportamiento del optimizador/Finder, categoría del mapa, entrada de artefacto de AOI personalizada, modificación de representación o comportamiento de exclusión. Use [Agregar o habilitar métricas](./adding-or-enabling-metrics.md) para los contratos de métricas.
- **Responsable del backend:** reconstruye y reinicia los artefactos de AOI personalizadas cuando cambia una entrada existente del backend.

Antes de comenzar:

1. Trabaje desde la raíz del repositorio y confirme el entorno de destino.
2. Confirme que `BLOB_READ_WRITE_TOKEN` esté presente en `.env.local`. Nunca imprima, pegue ni registre su valor.
3. Registre la referencia actual del archivo del manifiesto y la URL, el número de bytes, la suma de verificación, los metadatos y los artefactos posteriores del recurso actual.
4. Identifique el ID conceptual estable de la capa; no use un nombre de archivo temporal como identidad.
5. Registre fuente, licencia, fechas, contacto, CRS, resolución, extensión, unidades, significado de valores, NoData, transformaciones y SHA-256.
6. Haga que el responsable de datos y el desarrollador clasifiquen cada rol aplicable antes de cargar.

## Tabla de decisión de impacto

| Rol o cambio                  | Ejemplos típicos                                    | Trabajo de manifiesto/mapa                                                                          | Métricas de AOI conocidas                                            | Artefactos de AOI personalizadas                                                | Consecuencias para el optimizador                              |
| ---------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Solo optimizador             | Superficie de costos, elemento de optimización, inclusión forzada | Registrar solo si también debe aparecer en la aplicación; el generador actual no puede expresar limpiamente un rol exclusivo del optimizador | Ninguna, salvo que se use por separado en una métrica                | Ninguna, salvo que se incluya por separado en la lista aprobada del constructor del backend | Las futuras optimizaciones deben volver a ejecutarse fuera del navegador |
| Solo mapa                    | Superposición contextual o servicio de referencia externo | Recurso/referencia, registro, categoría, representación, manifiesto                                 | Ninguna                                                              | Ninguna                                                                         | Ninguna                                                        |
| Entrada de métrica precalculada | Ráster nombrado por el catálogo de métricas      | Recurso, registro/manifiesto si se resuelve mediante catálogo                                       | Recalcular cada solución afectada en todas las AOI conocidas         | Solo si también es una entrada de AOI personalizada                             | Ninguna, salvo que también sea entrada del optimizador         |
| Entrada de AOI personalizada | Capa en `build_runtime_artifact.py`                 | Generalmente obligatorio                                                                            | Solo si también es entrada precalculada                              | Reconstruir el artefacto y recrear el backend                                    | Ninguna, salvo que también sea entrada del optimizador         |
| Colección de visualización de especies | TIF individuales de especies             | Manifiesto de especies y luego puntero del manifiesto principal                                     | Recalcular cachés de soluciones afectadas cuando deban cambiar métricas de especies | Se requieren matrices de especies separadas; cargar TIF de visualización no basta | Condicional                                                    |
| Solo etiqueta o metadatos    | Nombre bilingüe, descripción, procedencia           | Regenerar y publicar manifiesto/metadatos                                                            | Ninguna si el contrato científico y los bytes no cambian             | Ninguna                                                                         | Ninguna                                                        |
| Bytes de reemplazo en la misma ruta | Ráster corregido                            | Actualizar manifiesto/representación y verificar comportamiento de caché                             | Recalcular todas las soluciones afectadas con descargas nuevas       | Reconstruir si está en la lista de entradas aprobadas del constructor del backend | Volver a ejecutar futuros productos del optimizador si la fuente afecta la optimización |

Los roles son acumulativos. Por ejemplo, una inclusión puede ser al mismo tiempo una entrada del optimizador, una visualización en el mapa y una entrada de superposición precalculada; aplique cada columna correspondiente.

## Procedimiento

### 1. Clasificar la capa y detenerse ante casos no admitidos

Documente si la capa es:

- **elemento:** objetivo de optimización y/o ráster temático;
- **costo:** superficie de costos de optimización;
- **inclusión:** área forzada en la optimización;
- **referencia solo de mapa:** se muestra como contexto, pero no se calcula;
- **entrada de métrica precalculada:** leída por el catálogo de métricas de Python para AOI conocidas;
- **entrada de AOI personalizada:** empaquetada por el constructor de artefactos en tiempo de ejecución del backend;
- **especie:** distribución de una especie individual en el catálogo secundario de especies.

Deténgase para una revisión de desarrollo si la capa introduce una nueva métrica, control del Finder, categoría, significado de representación, entrada de AOI personalizada o exclusión. Cargar un archivo no implementa ninguno de esos comportamientos. Para una métrica realmente nueva o una métrica existente que se habilitará para otro dominio, continúe con [Agregar o habilitar métricas](./adding-or-enabling-metrics.md); este procedimiento sigue siendo la operación de la capa de origen.

### Procedimiento solo de visualización (solo representación en el mapa)

Use este procedimiento cuando los usuarios necesiten una capa en el panel izquierdo de capas del mapa para comparación visual o contexto, pero la capa no deba intervenir en la selección de soluciones, costos, inclusiones/exclusiones, métricas de AOI conocidas, métricas activas del navegador ni métricas de AOI personalizadas. “Elemento” o “costo” puede describir el tema o la carpeta de origen; por sí solo no exige un rol analítico. El manifiesto en tiempo de ejecución permite esta separación y la barra lateral muestra una capa a partir de su URL de visualización y categoría independientemente de su rol en métricas.

El generador CSV actual **no** admite esto como un flujo exclusivo para operadores: infiere un `dataRole` de elemento, costo o inclusión y asigna a cada fila que no sea un límite `roleInMetricCalculation: data_used_for_live_metric_calculation`. Por lo tanto, el operador de entrega debe obtener una corrección del manifiesto revisada por desarrollo o una modificación del generador antes de publicar. No publique como solo de visualización la salida sin corregir del generador.

1. **Aprobar el alcance exclusivo de visualización.** Registre el ID estable de la capa, fuente, licencia, CRS, extensión, resolución, valores/clases, NoData, etiquetas, categoría, representación y responsable. Registre explícitamente que la capa se excluye de las entradas del optimizador, Finder, métricas, artefactos dispersos y artefactos del backend.
2. **Publicar el artefacto de visualización.** Para un GeoTIFF común, use la operación manual controlada de Blob del paso 3. Para un servicio HTTP admitido, conserve la URL HTTPS aprobada del servicio. `storage_location` más `filename` del registro deben resolver exactamente ese recurso de visualización, y `data_format` debe ser un formato reconocido por el generador.
3. **Registrarlo para visualización.** Agregue la fila CSV verificada descrita en el paso 2 con `layer_id` estable, etiquetas bilingües, descripción, grupos que determinen la categoría, campos de fuente/licencia, campos de almacenamiento e `in_use_now: TRUE`. Esta bandera significa “incluir en el catálogo de capas en tiempo de ejecución”; no demuestra ni configura el uso analítico.
4. **Corregir el candidato de versión generado.** Después de generarlo, exija estos valores del manifiesto:
   - `dataRole`: `reference_layer` para una capa pura de contexto/referencia; un rol semántico como `feature_layer` o `cost_layer` solo es válido según el esquema cuando los revisores necesitan esa clasificación y aun así establecen el rol de métrica en `none`;
   - `roleInMetricCalculation`: `none`;
   - `displayUrl`: la URL exacta y accesible del ráster o servicio admitido;
   - `compressedDataForLiveMetricsUrl`: `null`;
   - `precomputedMetricUrls`: `{}`;
   - `category`: una categoría existente mapeada en la barra lateral;
   - `id`, `spanishLabel`, `englishLabel`, `description`, `tooltip`, `metadataUrl` estables y `rendering` científicamente correcto.

   El esquema del manifiesto y el modelo del frontend admiten `reference_layer` junto con `none`; `land_cover` en `frontend/layer-manifest/manifest.example.json` es el ejemplo concreto del contrato. El generador actual sobrescribirá esta corrección al regenerar, así que conserve el candidato revisado y repita la corrección o implemente una modificación aprobada del generador antes de cada publicación posterior.
5. **Mantenerla fuera de la configuración analítica.** No agregue el ID de la capa a `input_layer_ids.features`, `.cost`, `.includes` o `.excludes` de los metadatos de soluciones; definiciones o calculadores de métricas de Python; listas permitidas del constructor disperso del navegador; entradas de `build_runtime_artifact.py` del backend; ni controles del Finder. No cree ni afirme que existen artefactos de métricas activas/precalculadas para ella.
6. **Validar antes de publicar.** Ejecute la validación y las pruebas del manifiesto sobre el candidato corregido, inspeccione los tres informes de conciliación y confirme que el candidato aún tenga `roleInMetricCalculation: none`, una URL nula de métricas activas y un mapa vacío de URL precalculadas. En la aplicación, verifique que la capa aparezca bajo la categoría prevista del panel izquierdo, se active y represente correctamente y no aparezca como opción del Finder ni cambie los resultados de soluciones, AOI conocidas o AOI personalizadas.
7. **Publicar y verificar el resultado visible.** Siga el paso 7 con el candidato corregido y validado. Después de una actualización completa del navegador, el único cambio visible previsto para el usuario es una nueva capa opcional del mapa con la etiqueta, categoría, descripción emergente, leyenda/representación y comportamiento de opacidad aprobados.
8. **Revertir si falla alguna comprobación de contrato.** Ejecute `npm --prefix frontend run rollback:layer-manifest` para restablecer el manifiesto archivado, restablezca o conserve la fila anterior del registro y elimine o ponga en cuarentena el recurso recién cargado mediante el proceso de Blob aprobado. Actualice la aplicación y confirme que la capa no esté presente y que los resultados analíticos permanezcan sin cambios.

Las capas individuales de especies son diferentes: el cargador estándar de especies y el generador del manifiesto secundario exponen TIF desde el prefijo compartido de especies, y la canalización de AOI conocidas también puede leer TIF de especies cuando se recalculan las métricas. Una carga de visualización no reconstruye métricas ni matrices de AOI personalizadas, pero el flujo estándar documentado para especies no puede garantizar que el archivo permanezca solo para visualización en reconstrucciones analíticas futuras. Obtenga la revisión del desarrollador y del responsable de datos para un contrato separado antes de prometer una capa de especies solo para visualización.

### 2. Preparar la fuente canónica y la fila del registro

Para las entradas ordinarias del optimizador, use el área canónica correspondiente del repositorio:

```text
data/inputs/features/
data/inputs/costs/
data/inputs/includes/
```

Actualice el registro verificado que el generador realmente lee:

```text
data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv
```

Establezca un `layer_id` estable; líneas bilingües de `layer_name`; `layer_description` en lenguaje sencillo; `layer_group`; `model_group`; campos de fuente y licencia; `filename`; `storage_type`; `storage_location` exacta; `data_format`; e `in_use_now` deliberado. Use `notes` para detalles internos.

Los archivos `data/input_layers_in_use.csv` y `data/input_layers_required.csv` son instantáneas de documentación, no entradas del generador. Manténgalos alineados únicamente mediante el proceso de documentación revisado del repositorio; no los confunda con el registro en tiempo de ejecución.

Para un servicio HTTP solo de mapa, `storage_location` puede ser la URL admitida completa y el formato debe ser uno reconocido por el generador. Confirme antes de la entrega que la barra lateral existente tenga un mapeo de categoría.

### 3. Publicar recursos ordinarios mediante una operación manual controlada

No existe un comando de carga en el repositorio para recursos genéricos de elementos, costos, inclusiones o solo de mapa. Use el proceso manual aprobado de Vercel Blob. La ruta final debe coincidir exactamente con `storage_location` más `filename` del registro verificado.

Conserve esta evidencia:

- archivo local y ruta final de Blob o URL externa aprobada;
- SHA-256 y número de bytes antes/después para reemplazos;
- operador, revisor, marca de tiempo UTC y entorno;
- evidencia de respuesta/inventario de Blob y si se sobrescribió una ruta existente;
- recurso anterior conservado o ruta inmutable de reversión.

No invente un comando de carga de shell ni exponga un token. Para reemplazos, prefiera una ruta inmutable preparada hasta la validación si el diseño de la entrega lo permite; las URL mutables pueden permanecer en caché.

### 4. Gestionar especies mediante el flujo admitido

El cargador de especies tiene una ruta de origen predeterminada específica de una máquina. Establezca siempre el origen explícitamente, ejecute primero una prueba y conserve el prefijo estándar de Blob salvo que una migración aprobada indique lo contrario:

```bash
SPECIES_TIF_UPLOAD_SOURCE=<approved-local-species-directory> \
SPECIES_TIF_UPLOAD_DRY_RUN=1 \
npm --prefix frontend run upload:species-tifs

SPECIES_TIF_UPLOAD_SOURCE=<approved-local-species-directory> \
npm --prefix frontend run upload:species-tifs

npm --prefix frontend run generate:species-manifest
```

`generate:species-manifest` examina el prefijo publicado de especies, construye el manifiesto secundario, archiva el manifiesto remoto de especies anterior y publica salvo que se configure para omitir la carga. El comando combinado se admite cuando sus valores predeterminados y su entorno ya se revisaron:

```bash
SPECIES_TIF_UPLOAD_SOURCE=<approved-local-species-directory> \
npm --prefix frontend run upload:species-tifs:manifest
```

Si deben cambiar las métricas precalculadas de especies, recalcule los ID de soluciones afectados. Si deben cambiar las métricas de especies de AOI personalizadas, escale: el backend espera matrices preconstruidas `inputs/features/species-sparse/species_<group>.smtx.gz`, que esta carga de visualización no construye.

### 5. Generar e inspeccionar el manifiesto de capas en tiempo de ejecución

Ejecute:

```bash
npm --prefix frontend run generate:layer-manifest
npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
```

Revise:

```text
development-artifacts/layer-manifest/reports/reconciliation-report.json
development-artifacts/layer-manifest/reports/category-mapping-report.json
development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json
```

Confirme que la fila esté incluida, que su recurso coincida, que no haya desaparecido ningún recurso no relacionado, que la categoría se asigne a la barra lateral, que la inferencia de representación sea científicamente correcta y que las etiquetas y URL sean correctas.

Comprobación contractual importante: actualmente el generador infiere cada fila del registro que no sea un límite como `data_used_for_live_metric_calculation`; no tiene una columna de rol editable por el operador para una capa verdaderamente solo de mapa o solo del optimizador. También emite `metrics/live/<id>.bin.gz`, mientras que el constructor disperso admitido escribe archivos `*.sparse.gz` seleccionados junto a las entradas. No publique un rol o una URL comprimida engañosos. Escale para solicitar una modificación del generador o un cambio de esquema cuando el contrato generado no coincida con el uso real.

### 6. Realizar únicamente el trabajo posterior que depende del rol

#### Elemento, costo o inclusión solo del optimizador

Ningún comando del repositorio convierte una entrada cargada en una nueva solución. Registre que la optimización debe volver a ejecutarse mediante el flujo externo aprobado del optimizador. No reconstruya métricas ni artefactos del backend salvo que la capa también tenga esos roles.

#### Referencia solo de mapa

No se requiere reconstruir métricas ni el backend. Verifique únicamente registro, categoría, etiquetas, representación, comportamiento del mapa y accesibilidad. Como el generador actual no puede emitir explícitamente `roleInMetricCalculation: none`, obtenga una corrección de desarrollo antes de publicar si etiqueta la referencia como entrada de cálculo.

#### Entrada de métrica precalculada

Una capa nueva no se calcula por el solo hecho de estar en el manifiesto. Ya debe estar nombrada en `data/metrics/python/metrics_pipeline/metric_definitions.py` y contar con un calculador compatible. Siga [Agregar o habilitar métricas](./adding-or-enabling-metrics.md) para nuevas definiciones, calculadores, aplicabilidad por dominio, presentación en el frontend y compatibilidad con AOI personalizadas.

Para reemplazar una entrada de métrica existente, identifique todos los ID de soluciones afectados y luego ejecute cada selección explícita en un solo lote:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <live-or-staging-manifest-url> \
  --solution-id <affected-solution-id-1> \
  --solution-id <affected-solution-id-2> \
  --output-dir data/metrics/generated/<release-directory> \
  --cache-dir data/metrics/cache/tier1 \
  --force \
  --no-cache

python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/<release-directory>

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory> \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory>

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/<release-directory>/publish-report.json
```

No ejecute todas las soluciones sin criterio. Derive el conjunto afectado del catálogo de métricas y de la dependencia científica; luego verifique que el informe de publicación contenga exactamente ese conjunto y todas las geografías aplicables de AOI conocidas.

#### Entrada dispersa activa del navegador

El constructor disperso solo admite un catálogo fijo de capas actuales. Compruebe que el ID se resuelva antes de usarlo:

```bash
cd data/metrics/python
python -m metrics_pipeline.sparse.build_layer_sparse \
  --only <supported-layer-id> \
  --dry-run

python -m metrics_pipeline.sparse.build_layer_sparse \
  --only <supported-layer-id> \
  --no-upload

python -m metrics_pipeline.sparse.build_layer_sparse \
  --only <supported-layer-id> \
  --force
```

Regrese a la raíz del repositorio después de ejecutarlo. Si la prueba indica que no se seleccionó ninguna capa, agregar compatibilidad es trabajo de desarrollo; no afirme que la capa tiene un artefacto activo.

#### Entrada de AOI personalizada

El constructor del backend usa una lista aprobada de entradas codificada de forma fija más URL de matrices de especies; registrarla en el manifiesto no agrega una capa por sí solo. Para una entrada modificada que ya esté en esa lista, ejecute en el host de métricas:

```bash
backend/.venv/bin/python backend/scripts/build_runtime_artifact.py --force

DMT_ARTIFACT_REQUIRED=true \
  docker compose -f backend/docker-compose.yml up -d --build --force-recreate

docker compose -f backend/docker-compose.yml logs --tail=100 backend
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

`/health` solo demuestra que el proceso está en ejecución. No restablezca el tráfico hasta que `/ready` confirme que se cargó el artefacto requerido. Una nueva capa de AOI personalizada exige los cambios del constructor, catálogo/adaptadores de métricas, pruebas y contrato de solicitud documentados en [Agregar o habilitar métricas](./adding-or-enabling-metrics.md).

### 7. Publicar el manifiesto final

Cuando todos los artefactos aplicables estén listos:

```bash
npm --prefix frontend run generate:layer-manifest
npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
npm --prefix frontend run publish:layer-manifest
```

La publicación archiva el manifiesto anterior en tiempo de ejecución en `manifest/archive/`. Registre esa referencia de archivo. Actualice el navegador antes de verificar, porque la aplicación en ejecución puede conservar datos del manifiesto y de especies.

### 8. Registrar la entrega

Conserve la clasificación de roles, aprobaciones, sumas de verificación de origen y remotas, diferencias del registro, informes de conciliación, informes de métricas cuando corresponda, identidad/disponibilidad del artefacto del backend cuando corresponda, archivo del manifiesto de especies cuando corresponda, archivo del manifiesto en tiempo de ejecución, nombres de operador/revisor, marcas de tiempo y referencias de reversión.

## Efectos posteriores

- **Elemento, costo e inclusión:** pueden afectar las salidas futuras del optimizador; la carga no inicia la optimización.
- **Solo mapa:** afecta únicamente el catálogo, la representación y la UI cuando su rol se representa con exactitud.
- **Métricas precalculadas:** una entrada modificada puede afectar muchas soluciones y todas las AOI conocidas de esas soluciones.
- **AOI personalizada:** usa únicamente las entradas fijas del artefacto del backend en tiempo de ejecución; una capa del manifiesto no está disponible automáticamente.
- **Especies:** las capas individuales del mapa se encuentran en un manifiesto secundario; los cálculos de AOI conocidas leen TIF de especies, mientras que las AOI personalizadas requieren matrices dispersas agrupadas por separado.
- **Etiquetas y metadatos:** los campos del registro regeneran contenido compacto de la UI, mientras que `metadataUrl` apunta a `metadata/<id>.metadata.json`; la publicación genérica de metadatos no tiene un comando dedicado en el repositorio.
- **Recursos de reemplazo:** reemplazar una ruta mutable supone el riesgo de cachés obsoletas en el navegador, descargas de la canalización, métricas e inicio del backend.

## Lista de verificación

- [ ] Se aprobaron el ID estable, los roles científicos, el responsable, la procedencia, el CRS, la resolución, los valores, las unidades y NoData.
- [ ] La fila del registro apunta al recurso publicado exacto o al servicio externo admitido y tiene un `in_use_now` deliberado.
- [ ] Los informes de conciliación no muestran entradas inesperadas faltantes, adicionales, excluidas o reclasificadas.
- [ ] `dataRole`, `roleInMetricCalculation`, URL de visualización, URL comprimida, URL de metadatos, categoría, etiquetas y representación generados coinciden con la realidad.
- [ ] El mapa muestra correctamente extensión, valores/clases, comportamiento de opacidad, NoData, etiquetas y categoría.
- [ ] Los cambios exclusivos del optimizador se transfieren para una nueva ejecución de optimización; no se registra una afirmación falsa de soluciones generadas.
- [ ] Los informes precalculados contienen exactamente los ID de soluciones afectados y todos los niveles aplicables de AOI conocidas, con hashes remotos verificados.
- [ ] Los cambios de AOI personalizadas pasan `/ready` y una prueba con un polígono representativo solo cuando se requirió reconstruir un artefacto del backend.
- [ ] La búsqueda y representación de especies funcionan después de actualizar por completo el navegador; se revisaron la taxonomía y el número de capas fallidas.
- [ ] Las comprobaciones de reemplazo demuestran que la aplicación y las canalizaciones leen la nueva suma de verificación, no los bytes anteriores en caché.
- [ ] Ningún valor secreto aparece en registros, evidencia, documentación o tickets.

## Reversión

1. Detenga la publicación o retire la entrega del tráfico; conserve la evidencia de la falla.
2. Restablezca el manifiesto anterior en tiempo de ejecución:

   ```bash
   npm --prefix frontend run rollback:layer-manifest
   ```

3. Restablezca el recurso anterior mediante el proceso controlado aprobado de Blob, o restablezca la URL del registro para que apunte al recurso inmutable conservado.
4. Para métricas incorrectas, vuelva a publicar el directorio conservado de la generación anterior; los artefactos de métricas no tienen un archivo automático.
5. Para fallas de AOI personalizadas, reconstruya el conjunto anterior de artefactos que se sabe que funciona, fuerce la recreación del contenedor y exija `/ready`.
6. Para fallas de especies, restablezca el manifiesto de especies archivado y el conjunto anterior de TIF mediante el proceso controlado; luego actualice el navegador.
7. Repita las comprobaciones de conciliación, mapa, métricas y disponibilidad correspondientes a los roles de la capa.

## Limitaciones y escalamiento

- Las cargas genéricas de elementos, costos, inclusiones, referencias y metadatos no tienen automatización en el repositorio.
- Las exclusiones no están listas para operación: no existe una carpeta canónica, un prefijo examinado, un script de carga, configuración del Finder ni una ruta de cálculo probada.
- El CSV verificado del generador y los dos CSV de instantáneas legibles pueden divergir.
- El generador no puede distinguir de manera confiable entre roles exclusivos del optimizador, solo de mapa, de métricas precalculadas y de AOI personalizadas a partir de los campos del registro.
- Las URL generadas `metrics/live/<id>.bin.gz` no coinciden con la convención `*.sparse.gz` del constructor disperso admitido.
- Las entradas dispersas del navegador y las entradas de AOI personalizadas del backend son listas permitidas codificadas de forma fija; las capas nuevas requieren desarrollo.
- Las etiquetas y descripciones emergentes bilingües están divididas entre el registro y modificaciones en el código.
- La creación de categorías, las nuevas semánticas de métricas, los controles del Finder y las nuevas reglas de representación requieren código y pruebas.
- El origen predeterminado incorporado en el cargador de especies es específico de una máquina; proporcione siempre un origen explícito aprobado.
- Las cargas de visualización de especies no crean las matrices agrupadas de especies para AOI personalizadas.
- Las rutas mutables de métricas, las cachés de la canalización, la memoria del navegador y los artefactos del backend cargados al iniciar pueden servir datos obsoletos.
- No existe un proceso integral probado de recuperación ante desastres de Blob. Escale de inmediato cualquier pérdida de almacenamiento, suma de verificación poco clara o recurso de reversión faltante.
