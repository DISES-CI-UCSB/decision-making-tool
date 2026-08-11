[← Volver a Operaciones de datos](./README.md)

# Agregar y reemplazar soluciones

## Propósito y estado de publicación

Use esta guía para:

1. agregar un paquete de solución nuevo; o
2. preparar una solución con revisiones materiales como un paquete de solución nuevo.

La unidad orientada al operador es **Agregar una solución nueva**. Cada adición incluye un ID de solución inmutable recién asignado, rutas inmutables para la fuente y los artefactos derivados, metadatos, una entrada en el manifiesto, métricas y procedencia. Una revisión material también es una adición: nunca sobrescriba ni reutilice el paquete, las rutas o el `solution_id` anterior. Archive el paquete anterior completo y su ID anterior como parte de la versión inmutable anterior del catálogo, genere un nuevo `solution_id` y nuevas rutas de artefactos para la revisión, y publique la revisión en una nueva versión del catálogo.

Retirar la revisión anterior significa excluir su ID anterior de la nueva versión activa del catálogo. No significa eliminar el ID anterior, el paquete, los artefactos, los metadatos ni las versiones históricas. Ese paso de reemplazo del catálogo activo **no está listo actualmente para operadores**. El flujo independiente del catálogo versionado debe integrarse, documentarse, probarse y ensayarse antes de usarse en la entrega técnica. El generador actual del manifiesto parte del catálogo publicado y combina las soluciones descubiertas por ID, por lo que se conservan los ID ausentes del descubrimiento de Blob.

El repositorio no tiene un campo estructurado y verificado de linaje o sucesión de soluciones. Hasta que se implemente y valide uno, registre la relación legible por personas entre los ID anterior y nuevo en el campo de metadatos `notes` existente, cuando esté aprobado, y en la documentación de la versión del catálogo y los informes conservados del operador. No invente campos como `supersedes`, `replaces` o `previous_solution_id` ni asuma que las herramientas de ejecución los conservarán o interpretarán.

La ruta compatible para una sola solución también depende de un manifiesto candidato HTTP que no esté en producción. Los generadores de COG, métricas regulares y MEC obtienen un manifiesto mediante HTTP; publicar primero un candidato base en el manifiesto de producción expondría URL deterministas de métricas y COG antes de que existan esos objetos. Nunca use el manifiesto de producción activo como staging.

Para obtener detalles más amplios sobre los artefactos, consulte [Métricas y artefactos de ejecución](./metrics-and-artifacts.md). Para los comandos de publicación y recuperación, consulte [Publicación y reversión](./publishing-and-rollback.md).

## Resumen del alcance

| Operación                                      | Estado actual                                      | Restricción importante                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agregar una solución nueva                     | Compatible con staging controlado                  | El paquete incluye un ID inmutable recién asignado, rutas de artefactos, metadatos, entrada en el manifiesto, métricas y procedencia; use un manifiesto candidato HTTP nuevo y no activo |
| Preparar una revisión material como solución nueva | Compatible únicamente como adición de paquete nuevo | Nunca sobrescriba ni reutilice el paquete o ID anterior; genere un ID y rutas inmutables nuevos y registre la relación anterior-nueva en metadatos compatibles o documentación de publicación |
| Reemplazar la revisión anterior en el catálogo activo | Aún no es compatible para operadores           | Requiere una nueva versión del catálogo que incluya el ID nuevo y excluya el anterior, conservando completa la versión anterior; el generador actual conserva los ID publicados ausentes |
| Retirar una solución del catálogo activo       | Aún no es compatible para operadores               | Retirar significa excluirla de una nueva versión activa del catálogo, no eliminar ni reutilizar su ID, paquete, metadatos, artefactos o versiones históricas                         |
| Reemplazar el catálogo completo                | En desarrollo — aún no está listo para operadores  | Un flujo independiente de reemplazo del catálogo versionado debe integrarse, documentarse, probarse y ensayarse antes de usarse en la entrega técnica                               |
| Generar un COG de visualización                | Compatible solo cuando `scope` es exactamente `nacional` | El selector de COG actual no procesa soluciones marinas                                                                                                                      |

## Roles y requisitos previos

- **Operador de publicación:** controla las escrituras en Blob, la publicación del candidato y el cambio final del manifiesto.
- **Responsable de los datos o analista:** aprueba los valores del ráster, los metadatos, la procedencia, los insumos del Finder y el significado científico.
- **Revisor:** comprueba de forma independiente los informes, las URL, el comportamiento del Finder, el renderizado y las métricas.
- **Desarrollador/ingeniero de publicación:** requerido para reemplazar el catálogo completo, retirar soluciones, reemplazar una revisión material en el catálogo activo, publicar MEC/metas o suplir la falta de un entorno de staging.

Antes de comenzar:

1. Trabaje desde la raíz del repositorio con el entorno de métricas de Python y las dependencias del frontend instalados.
2. Confirme que `BLOB_READ_WRITE_TOKEN` esté presente en `.env.local`. Nunca imprima, pegue ni registre su valor.
3. Registre el entorno de destino, la URL del manifiesto activo, el archivo exacto del manifiesto conocido como válido y los informes/directorios conservados de artefactos anteriores.
4. Elija una ruta única para el candidato, como `manifest/candidates/<release-id>.json`. No debe ser `manifest/manifest.json`.
5. Registre la fuente, licencia, responsable, hora de generación, CRS, resolución, extensión, tipo de datos, significado de los valores, NoData y SHA-256 del par fuente.

## Decidir si es una solución nueva o una revisión material

### Solución nueva

Una solución nueva recibe un ID inmutable recién asignado. Su paquete completo incluye el par de rásteres fuente, artefactos derivados, metadatos, entrada en el manifiesto, métricas y procedencia, según corresponda. El catálogo activo no referencia estas rutas antes del cambio final, siempre que el operador use rutas inmutables nuevas y un manifiesto candidato no activo.

### Revisión material de una solución existente

Una revisión material es un paquete de solución nuevo, incluso cuando representa la misma solución conceptual:

- Conserve el `solution_id`, el par de rásteres sin procesar, el COG, las métricas, los metadatos y los registros de publicación anteriores como el paquete inmutable anterior.
- Genere un `solution_id` nuevo y rutas inmutables nuevas para cada artefacto fuente y derivado revisado. Nunca sobrescriba ni reutilice el paquete o ID anterior.
- Registre la procedencia y la relación anterior-nueva en el campo `notes` existente de los metadatos, cuando esté aprobado, además de la documentación de la versión del catálogo y los informes conservados del operador. No existe un campo de linaje estructurado verificado.
- Publique el paquete revisado en una nueva versión del catálogo y retire el ID anterior excluyéndolo de esa nueva versión activa. Conserve las versiones históricas.

El procedimiento compatible que aparece a continuación puede preparar y agregar el paquete nuevo. Actualmente no puede completar el reemplazo del catálogo activo porque el generador conserva los ID publicados ausentes del descubrimiento de Blob. Deténgase antes de afirmar que el ID anterior está retirado; use el flujo de catálogo versionado desarrollado por separado solo después de que se haya integrado, documentado, probado y ensayado.

## Procedimiento compatible: agregar una solución nueva

Los comandos siguientes se comprobaron con las CLI actuales del repositorio. Reemplace todos los marcadores de posición y conserve cada informe generado.

### 1. Preparar y revisar el par fuente

Cree dos archivos con el mismo nombre base:

```text
<solution-name>.tif
<solution-name>.json
```

Use `data/solutions/metadata/example_solution_metadata.json` solo como punto de partida y luego compárelo con un sidecar admitido en producción. Verifique:

- `id` está recién asignado, es único e inmutable y nunca se reutiliza.
- Para una revisión material, `id` es distinto del `solution_id` anterior archivado.
- `run_name`, `scope`, el `domain` opcional y `raster_file` describen este ráster.
- `input_layer_ids.features`, el valor singular `input_layer_ids.cost`, `includes` y `excludes` usan ID conceptuales registrados.
- `evaluation` y `coverage` están presentes cuando existen esos resultados.
- `raster_file` nombra exactamente el ráster emparejado.
- `notes`, cuando se apruebe para la procedencia operativa, identifica en lenguaje sencillo el ID y la versión del catálogo anteriores; no invente un campo de linaje estructurado no compatible.

Mantenga `excludes` vacío salvo que los desarrolladores hayan implementado y probado el flujo de exclusión. No dependa de la inferencia a partir del nombre del archivo como contrato formal de metadatos.

### 2. Preparar el par sin procesar en staging

No existe un comando en el repositorio para cargar un TIFF de solución sin procesar y su sidecar JSON. Use el procedimiento manual aprobado de Vercel Blob y coloque ambos archivos en el mismo prefijo aprobado, normalmente `solutions/nacional/` o `solutions/marine/`. Use una ruta inmutable nueva para cada paquete nuevo. Nunca sobrescriba ni reutilice una ruta de solución existente.

Conserve:

- las rutas locales y de Blob;
- el SHA-256 y el recuento de bytes de ambos archivos;
- el operador, la marca de tiempo UTC y el entorno de destino;
- las URL públicas o evidencia del inventario de Blob; y
- la confirmación de que no se sobrescribió ningún objeto no relacionado.

### 3. Generar y validar localmente el candidato base

El generador npm registra las soluciones marinas, pero no las nacionales. Ejecute directamente el generador con ambos prefijos conocidos:

```bash
node frontend/layer-manifest/generate-manifest.mjs \
  --register-solution-prefix solutions/nacional/ \
  --register-solution-prefix solutions/marine/

npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
```

Revise `development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json`. El ID previsto debe aparecer una vez en `solutions[]`, no en `skipped` ni `unmatchedRasters`. Compruebe `finderInputs`, `displayUrl`, `metadataUrl`, `rendering` y cada valor determinista de `precomputedMetricUrls`.

Por diseño, este candidato todavía contiene todos los ID publicados anteriormente. No demuestra que un ID anterior se haya retirado ni que una revisión material lo haya reemplazado en el catálogo activo.

### 4. Publicar únicamente un candidato HTTP no activo

Las herramientas posteriores de COG, métricas regulares y MEC requieren una entrada HTTP. Publique el archivo local validado en una ruta de candidato única:

```bash
npm --prefix frontend run publish:layer-manifest -- \
  --source frontend/public/data/layer-manifest/manifest.json \
  --target manifest/candidates/<release-id>.json \
  --skip-archive
```

Registre la URL que imprime el comando como `<candidate-manifest-url>`. Obténgala con un parámetro de consulta que evite la caché y confirme que contenga el ID previsto.

**No use `manifest/manifest.json` como destino en este paso.** Si la política no permite una URL candidata pública no activa, deténgase. La alternativa segura son herramientas de producción que permitan a cada generador consumir un candidato local; publicar en producción un manifiesto base incompleto no es una solución alternativa aceptable.

### 5. Generar y cargar opcionalmente un COG de visualización nacional

El generador de COG actual incluye únicamente entradas cuyo `scope` sea exactamente `nacional`. No procesa soluciones marinas.

```bash
python data/scripts/solutions-cog/main.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id>

npm --prefix frontend run upload:solutions-cogs -- \
  --dry-run \
  --solution-id <solution-id>

npm --prefix frontend run upload:solutions-cogs -- \
  --solution-id <solution-id>
```

Exija que `data/cog/generated/publish-report.json` informe un COG válido y que `data/cog/generated/upload-report.json` contenga únicamente la solución prevista, sin fallas.

Cree un artefacto local del manifiesto final con la URL del COG cargado, pero no lo publique:

```bash
npm --prefix frontend run publish:solution-cog-manifest -- \
  --manifest-url <candidate-manifest-url>
```

El comando imprime la ruta del artefacto generado bajo `frontend/development-artifacts/layer-manifest/publish/`. Registre esa ruta como `<final-candidate-path>`.

Para una solución marina, omita este paso y use `frontend/public/data/layer-manifest/manifest.json` como el `<final-candidate-path>` inicial.

### 6. Generar todas las métricas regulares de AOI conocidas para la solución

Valide con respecto al candidato:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id> \
  --validate-only
```

Genere cada geografía de AOI aplicable que se haya cargado. No use `--national-only`:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id> \
  --output-dir data/metrics/generated/<release-directory> \
  --cache-dir data/metrics/cache/tier1 \
  --force \
  --no-cache
```

`--force` vuelve a calcular el resultado; `--no-cache` actualiza los insumos descargados. No lo sustituya por `--limit 1`, que selecciona según el orden del catálogo.

Inspeccione, simule, publique y verifique:

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/<release-directory> \
  --solution-id <solution-id>

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory> \
  --solution-id <solution-id> \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory> \
  --solution-id <solution-id>

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/<release-directory>/publish-report.json
```

El resultado regular debe contener datos nacionales, departamentos, municipios, SIRAP, RUNAP y OMEC cuando se carguen sus límites fijados y el catálogo de métricas indique que corresponden. Los errores al cargar límites son fallas de publicación.

### 7. Generar y publicar la caché regular compacta

El resultado compacto se deriva del resultado regular inspeccionado:

```bash
python data/metrics/python/metrics_pipeline/compact_metrics.py \
  --input-dir data/metrics/generated/<release-directory> \
  --output-dir data/metrics/generated/<release-directory>-compact

python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/<release-directory>-compact

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory>-compact \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/<release-directory>-compact

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/<release-directory>-compact/publish-report.json
```

No agregue `--release-id` a esta conversión de una sola solución, salvo que se haya preparado un contrato revisado de selección de publicación parcial.

### 8. Generar MEC y metas cuando corresponda

MEC aplica a soluciones terrestres y genera seis fragmentos geográficos:

```bash
python data/metrics/python/metrics_pipeline/mec_compact.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id> \
  --force \
  --no-cache
```

Las metas pueden consumir el manifiesto HTTP preparado en staging:

```bash
python data/metrics/python/metrics_pipeline/conservation_goals.py \
  --manifest-url <candidate-manifest-url> \
  --solution-id <solution-id> \
  --output-dir data/metrics/generated/goals \
  --force-download
```

**Bloqueo de publicación:** los generadores de MEC y metas no cargan archivos. No existe un flujo dedicado y completamente verificado de publicación y conexión con el manifiesto. Si se requiere cualquiera de estos artefactos, un proceso manual revisado por un desarrollador debe cargar exactamente las rutas de los informes, verificar los bytes remotos y garantizar que el candidato final apunte a ellos. No afirme que la publicación está completa basándose únicamente en la generación.

### 9. Validar y realizar el cambio autoritativo final

Antes del cambio, confirme que cada URL de `<final-candidate-path>` ya resuelva a bytes verificados. Si se modificaron URL de MEC/metas, actualice y vuelva a validar el candidato mediante un proceso revisado por un desarrollador.

```bash
node frontend/layer-manifest/validate-manifest.mjs \
  <final-candidate-path>

npm --prefix frontend run test:layer-manifest

npm --prefix frontend run publish:layer-manifest -- \
  --source <final-candidate-path>
```

Solo este comando final puede usar como destino el valor predeterminado de producción `manifest/manifest.json`. Archiva el manifiesto activo anterior y luego lo reemplaza. Registre la ruta del archivo y la URL publicada.

### 10. Verificar y conservar la publicación

- Obtenga el manifiesto activo con un parámetro de consulta que evite la caché y verifique un ID previsto.
- Confirme los insumos y las etiquetas del Finder.
- Renderice el ráster sin procesar y el COG, si corresponde.
- Pruebe una AOI conocida de cada geografía aplicable.
- Cargue datos regulares, compactos, MEC y de metas, según corresponda.
- Verifique que una solución sin cambios todavía cargue.
- Conserve las sumas de comprobación sin procesar y derivadas, todos los informes, los directorios locales de generación, los manifiestos candidato/final, los nombres del operador/revisor y las marcas de tiempo UTC.
- Conserve los objetos anteriores durante el periodo de retención aprobado. No los elimine solo porque exista un archivo del manifiesto.
- Para una revisión material, no afirme que se reemplazó o retiró hasta que la nueva versión activa excluya el ID anterior y se conserve completa la versión anterior.

## Procedimiento aún no listo para operadores: reemplazo o retiro del catálogo

> **Todavía no ejecute esto como guía de producción.** Los pasos siguientes definen el flujo seguro objetivo, no una funcionalidad que el repositorio ofrezca actualmente. El flujo desarrollado por separado debe integrarse, documentarse, probarse y ensayarse primero.

Un reemplazo seguro y autoritativo del catálogo debe:

1. Congelar los cambios e inventariar el grafo completo de dependencias en producción.
2. Archivar o copiar cada par TIFF/JSON anterior sin procesar, COG, métrica regular, métrica compacta, fragmento MEC, objeto de metas, archivo de metadatos, ID de solución anterior, informe de publicación y estado del manifiesto en ubicaciones inmutables conservadas como una versión anterior del catálogo.
3. Verificar de forma independiente los recuentos de bytes y las sumas de comprobación del archivo.
4. Para cada revisión material, generar un ID de solución nuevo y preparar su paquete completo bajo rutas inmutables nuevas. Nunca sobrescribir ni reutilizar un ID o paquete anterior.
5. Generar un candidato autoritativo únicamente a partir del nuevo catálogo declarado, sin combinar ID publicados no declarados.
6. Generar y verificar todos los COG, métricas regulares, métricas compactas, fragmentos MEC y metas con respecto a un candidato HTTP no activo o una cadena de herramientas que admita candidatos locales.
7. Demostrar que cada URL candidata resuelva y que cada retiro previsto esté ausente del nuevo catálogo activo, mientras su ID, paquete, artefactos, metadatos y versión anterior permanezcan intactos.
8. Realizar un único cambio autoritativo final del manifiesto después de que existan todos los bytes referenciados.
9. Conservar la versión anterior completa durante el periodo de retención aprobado.
10. Verificar el Finder, el renderizado del mapa, todas las geografías de AOI conocidas, las capas compartidas sin cambios y el comportamiento de la caché del navegador.
11. Revertir restaurando tanto el manifiesto anterior como cada conjunto de bytes anterior referenciado y luego repetir la verificación.

Los archivos del manifiesto contienen únicamente referencias JSON. **No archivan los rásteres, COG, métricas regulares/compactas, fragmentos MEC, metas, límites ni otros bytes referenciados por esas URL**. Por tanto, un archivo del manifiesto no es una copia de seguridad completa y no puede garantizar por sí solo una reversión.

Eliminar los pares anteriores sin procesar antes de la generación no retira sus ID: la combinación que conserva las soluciones mantiene las entradas publicadas. Eliminar objetos anteriores mientras un manifiesto archivado o activo todavía los referencia convierte la reversión en URL rotas. No elimine ni ponga en cuarentena los recursos del catálogo anterior hasta que existan un modo autoritativo de reemplazo, un inventario de referencias, una decisión de retención y una reversión probada.

## Lista de verificación para reemplazar una revisión material

Use los pasos compatibles de adición para preparar el paquete nuevo, pero no complete ni afirme el reemplazo del catálogo activo hasta que existan todos los controles:

- [ ] La revisión tiene un `solution_id` nuevo que nunca se ha reutilizado.
- [ ] Cada ruta nueva de recursos sin procesar, COG, métricas, metadatos y artefactos derivados es inmutable y no sobrescribe bytes anteriores.
- [ ] Se conservan el paquete anterior completo, el ID anterior, los metadatos, las sumas de comprobación y la versión del catálogo.
- [ ] La relación anterior-nueva está registrada en metadatos compatibles o documentación de publicación, sin inventar un campo de linaje estructurado.
- [ ] El candidato autoritativo incluye el ID nuevo, excluye el ID anterior retirado y conserva los demás ID previstos.
- [ ] El flujo del catálogo versionado y la reversión se han probado con los conjuntos completos de bytes de las versiones anterior y nueva.

Si falta algún control, deténgase después de preparar el paquete nuevo y escale el caso en lugar de afirmar que se reemplazó o retiró.

## Impacto en AOI personalizadas

Las AOI conocidas usan cachés publicadas por solución. Las AOI personalizadas son distintas: actualmente, el backend calcula un polígono dibujado con respecto a capas compartidas de referencia y métricas de ejecución; no carga el ráster de la solución seleccionada como insumo de cálculo específico de esa solución. Por tanto, agregar por sí solo un paquete de solución nuevo no requiere volver a generar los artefactos del backend.

Si cambian los insumos compartidos en producción o el manifiesto fuente que usan los artefactos del backend, siga [Métricas y artefactos de ejecución](./metrics-and-artifacts.md), vuelva a generar los artefactos de ejecución, vuelva a crear el contenedor del backend y verifique `/ready`. El comportamiento de las máscaras de categorías para polígonos arbitrarios sigue siendo una inquietud de ingeniería; no afirme que existe paridad total entre AOI conocidas y personalizadas sin las comprobaciones de regresión documentadas.

## Reversión

### Solución nueva

1. Detenga cualquier publicación adicional y conserve la evidencia de la ejecución fallida.
2. Enumere los archivos del manifiesto:

   ```bash
   npm --prefix frontend run rollback:layer-manifest
   ```

3. Seleccione y restaure el archivo registrado conocido como válido:

   ```bash
   npm --prefix frontend run rollback:layer-manifest -- \
     --use <index|pathname|url>
   ```

4. Actualice el navegador y repita las comprobaciones del manifiesto, Finder, mapa y AOI conocidas.
5. Conserve los objetos nuevos sin procesar y derivados hasta que concluyan el incidente y la decisión de retención. Su presencia es inocua cuando ningún manifiesto activo los referencia.

### Reemplazo del catálogo por revisión material

Restaure la versión inmutable anterior completa del catálogo, incluidos su ID de solución anterior, manifiesto, metadatos, rásteres sin procesar, COG, métricas regulares/compactas, MEC y metas, según corresponda; verifique las sumas de comprobación remotas y actualice los clientes. El paquete revisado permanece conservado, pero sin referencias. Si se sobrescribió o eliminó algún byte anterior, se infringió la política y la reversión no puede considerarse verificada.

### Catálogo completo

La reversión está bloqueada hasta que existan un conjunto completo de bytes anteriores y un flujo autoritativo del catálogo probado. No infiera la capacidad de recuperación a partir de los archivos del manifiesto.

## Bloqueos restantes para producción

- No existe un modo autoritativo para reemplazar el catálogo de soluciones ni retirar soluciones.
- No existe un cambio atómico probado para todo el catálogo.
- El generador conserva los ID publicados ausentes del descubrimiento, por lo que una revisión material puede agregarse con un ID nuevo, pero el procedimiento del operador todavía no puede retirar ni reemplazar el ID anterior.
- Los generadores de COG y métricas regulares/MEC necesitan manifiestos HTTP; la operación segura depende de una URL candidata no activa hasta que se agregue compatibilidad con candidatos locales.
- El modo de publicación completamente inmutable requiere el catálogo completo de tamaño fijo.
- La publicación y conexión de MEC y metas siguen siendo manuales e incompletas.
- La carga del par de solución sin procesar es manual y no es transaccional.
- No existe un archivo automático del paquete completo para versiones anteriores del catálogo.
- La generación de COG solo admite `scope: "nacional"`, no soluciones marinas.
- Los archivos del manifiesto no conservan los bytes referenciados.
- La paridad de máscaras de categorías para AOI personalizadas todavía requiere verificación de ingeniería.
