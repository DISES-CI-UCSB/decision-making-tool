[← Volver a Operaciones de datos](./README.md)

# Agregar y reemplazar soluciones

## Empiece aquí

- [Propósito y estado de publicación](#propósito-y-estado-de-publicación) — solo nacional/marino; SIRAP es otra canalización
- [Resumen del alcance](#resumen-del-alcance) — qué está admitido hoy
- [Procedimiento compatible: agregar una solución nueva](#procedimiento-compatible-agregar-una-solución-nueva)
- [Reemplazo o retiro del catálogo](#reemplazo-o-retiro-del-catálogo) — `solution-catalog-v1` con publicación condicionada
- [Relleno incremental de métricas](#relleno-incremental-de-métricas) — no es la ruta de publicación GTIC.
- [Reversión](#reversión)

## Propósito y estado de publicación

Esta guía operativa es **solo para soluciones nacionales y marinas**. Las soluciones regionales SIRAP usan una canalización aparte (`sirap_release/` y rutas inmutables `releases/sirap-…/`). No siga este procedimiento para catálogos SIRAP.

Use esta guía para:

1. agregar un paquete de solución nuevo; o
2. preparar una solución con revisiones materiales como un paquete de solución nuevo.

La unidad orientada al operador es **Agregar una solución nueva**. Cada adición incluye un ID de solución inmutable recién asignado, rutas inmutables para la fuente y los artefactos derivados, metadatos, una entrada en el manifiesto, métricas y procedencia. Una revisión material también es una adición: nunca sobrescriba ni reutilice el paquete, las rutas o el `solution_id` anterior. Archive el paquete anterior completo y su ID anterior como parte de la versión inmutable anterior del catálogo, genere un nuevo `solution_id` y nuevas rutas de artefactos para la revisión, y publique la revisión en una nueva versión del catálogo.

Retirar la revisión anterior significa excluir su ID anterior de la nueva versión activa del catálogo. No significa eliminar el ID anterior, el paquete, los artefactos, los metadatos ni las versiones históricas. El reemplazo y el retiro **están admitidos en modo de publicación**. Declare el conjunto de ID previsto en un archivo JSON `solution-catalog-v1`, genere y valide con `--catalog`, y promueva con `--confirm-release` y `--expected-live-sha256`. Cuando `releaseId` está definido, el generador **no** conserva los ID publicados que estén ausentes del catálogo.

El repositorio no tiene un campo estructurado y verificado de linaje o sucesión de soluciones. Hasta que se implemente y valide uno, registre la relación legible por personas entre los ID anterior y nuevo en el campo de metadatos `notes` existente, cuando esté aprobado, y en la documentación de la versión del catálogo y los informes conservados del operador. No invente campos como `supersedes`, `replaces` o `previous_solution_id` ni asuma que las herramientas de ejecución los conservarán o interpretarán.

La promoción en vivo siempre exige un manifiesto de publicación con `releaseId` más `--catalog`. No publique un candidato incompleto en `manifest/manifest.json`. La generación de una versión puede consumir un manifiesto local de preflight `file://`, así que no use `--skip-archive`: esa bandera ya no existe. El detalle autoritativo de la CLI está en [frontend/layer-manifest/README.md](../../../../../frontend/layer-manifest/README.md) y [data/metrics/README.md](../../../../../data/metrics/README.md).

Para obtener detalles más amplios sobre los artefactos, consulte [Métricas y artefactos de ejecución](./metrics-and-artifacts.md). Para los comandos de publicación y recuperación, consulte [Publicación y reversión](./publishing-and-rollback.md).

## Resumen del alcance

| Operación                                      | Estado actual                                      | Restricción importante                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agregar una solución nueva                     | Admitido como versión de catálogo                  | Incluya el ID inmutable nuevo en un archivo `solution-catalog-v1`; prepare las fuentes bajo `releases/{releaseId}/solutions/{land\|marine}/`; promueva con publicación condicionada |
| Preparar una revisión material como solución nueva | Admitido únicamente como adición de paquete nuevo | Nunca sobrescriba ni reutilice el paquete o ID anterior; genere un ID y rutas inmutables nuevos y registre la relación anterior-nueva en metadatos compatibles o documentación de publicación |
| Reemplazar la revisión anterior en el catálogo activo | Admitido en modo de publicación               | El catálogo nuevo incluye el ID nuevo y excluye el anterior; conserve completa la versión anterior; el generador no combina ID publicados no declarados cuando `releaseId` está definido |
| Retirar una solución del catálogo activo       | Admitido en modo de publicación                    | Retirar significa excluirla de una nueva versión activa del catálogo, no eliminar ni reutilizar su ID, paquete, metadatos, artefactos o versiones históricas                         |
| Reemplazar el catálogo completo                | Admitido — promoción `solution-catalog-v1`         | Genere con `--catalog`; promueva con inventarios de artefactos, `--dry-run` y luego `--confirm-release` y `--expected-live-sha256`                                                 |
| Generar un COG de visualización                | Admitido solo cuando `scope` es exactamente `nacional` | El selector de COG actual no procesa soluciones marinas                                                                                                                      |

## Roles y requisitos previos

- **Operador de publicación:** controla las escrituras en Blob, los archivos de catálogo, los inventarios de artefactos y la promoción condicionada del manifiesto.
- **Responsable de los datos o analista:** aprueba los valores del ráster, los metadatos, la procedencia, los insumos del Finder y el significado científico.
- **Revisor:** comprueba de forma independiente los informes, las URL, el comportamiento del Finder, el renderizado y las métricas.
- **Desarrollador/ingeniero de publicación:** requerido para preguntas de conexión de publicación de MEC/metas, falta de un entorno de preproducción, o catálogos regionales SIRAP (no esta guía).

Antes de comenzar:

1. Trabaje desde la raíz del repositorio con el entorno de métricas de Python y las dependencias del frontend instalados.
2. Confirme que `BLOB_READ_WRITE_TOKEN` esté presente en `.env.local`. Nunca imprima, pegue ni registre su valor.
3. Registre el entorno de destino, la URL del manifiesto nacional activo, el JSON histórico del catálogo para reversión y los informes/directorios conservados de artefactos anteriores.
4. Prepare un archivo `solution-catalog-v1` con `releaseId`, `catalogVersion`, recuentos esperados y el conjunto exacto de ID de solución ordenados. Las rutas pasadas a `npm --prefix frontend` son relativas a `frontend/`.
5. Registre la fuente, licencia, responsable, hora de generación, CRS, resolución, extensión, tipo de datos, significado de los valores, NoData y SHA-256 de cada par fuente.

## Decidir si es una solución nueva o una revisión material

### Solución nueva

Una solución nueva recibe un ID inmutable recién asignado. Su paquete completo incluye el par de rásteres fuente, artefactos derivados, metadatos, entrada en el manifiesto, métricas y procedencia, según corresponda. El catálogo activo no referencia estas rutas antes de la promoción condicionada, siempre que el operador use rutas inmutables nuevas bajo `releases/{releaseId}/`.

### Revisión material de una solución existente

Una revisión material es un paquete de solución nuevo, incluso cuando representa la misma solución conceptual:

- Conserve el `solution_id`, el par de rásteres sin procesar, el COG, las métricas, los metadatos y los registros de publicación anteriores como el paquete inmutable anterior.
- Genere un `solution_id` nuevo y rutas inmutables nuevas para cada artefacto fuente y derivado revisado. Nunca sobrescriba ni reutilice el paquete o ID anterior.
- Registre la procedencia y la relación anterior-nueva en el campo `notes` existente de los metadatos, cuando esté aprobado, además de la documentación de la versión del catálogo y los informes conservados del operador. No existe un campo de linaje estructurado verificado.
- Publique el paquete revisado en una nueva versión del catálogo y retire el ID anterior excluyéndolo de esa versión. Conserve las versiones históricas.

Los pasos de adición que siguen preparan el paquete nuevo. El reemplazo del catálogo activo es el procedimiento de promoción del catálogo: el catálogo nuevo debe incluir el ID nuevo y omitir el ID retirado.

## Procedimiento compatible: agregar una solución nueva

Los comandos siguientes se comprobaron con las CLI actuales del repositorio. Reemplace todos los marcadores de posición y conserve cada informe generado. Agregar un ID sigue siendo una versión de catálogo: inclúyalo en `solution-catalog-v1` y promueva ese catálogo.

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

### 2. Preparar el par sin procesar bajo el prefijo de la versión

No cargue a los prefijos mutables antiguos `solutions/nacional/` o `solutions/marine/` para una versión de catálogo. Construya un plan de carga de fuentes con SHA fijado y escriba solo en `releases/<releaseId>/solutions/{land|marine}/...`. El cargador usa de forma predeterminada una simulación de solo lectura y se niega a sobrescribir bytes inmutables distintos:

```bash
python data/metrics/python/metrics_pipeline/upload_solution_sources.py \
  data/metrics/generated/releases/<releaseId>/source-upload/upload-plan.json

python data/metrics/python/metrics_pipeline/upload_solution_sources.py \
  data/metrics/generated/releases/<releaseId>/source-upload/upload-plan.json \
  --execute
```

Conserve:

- las rutas locales y de Blob;
- el SHA-256 y el recuento de bytes de ambos archivos;
- el operador, la marca de tiempo UTC y el entorno de destino;
- las URL públicas o evidencia del inventario de Blob; y
- la confirmación de que no se sobrescribió ningún objeto no relacionado.

### 3. Declarar el ID en solution-catalog-v1 y preflight del plan

Agregue el nuevo `solutionId`, `solutionBasename` (`.tif` en minúsculas exacto), `domain` y `rasterSha256` a un archivo `solution-catalog-v1`. Incremente `catalogVersion` (MAJOR o MINOR para cambios de soluciones/métricas). Fije `expectedSolutionCount`, `expectedLandSolutionCount` y `expectedMarineSolutionCount` al conjunto declarado.

```bash
python data/metrics/python/metrics_pipeline/plan_solution_release.py \
  --catalog path/to/new-solution-catalog.json \
  --baseline-catalog path/to/previous-solution-catalog.json \
  --output data/metrics/generated/releases/<releaseId>/release-plan.json
```

Genere el manifiesto local de la versión contra ese catálogo (las rutas son relativas a `frontend/`):

```bash
npm --prefix frontend run generate:layer-manifest -- \
  --catalog ../path/to/solution-catalog.json

npm --prefix frontend run validate:layer-manifest -- \
  public/data/layer-manifest/manifest.json \
  --catalog ../path/to/solution-catalog.json

npm --prefix frontend run test:layer-manifest
```

Revise `development-artifacts/layer-manifest/reports/solutions-reconciliation-report.json`. El ID previsto debe aparecer una vez en `solutions[]`, no en `skipped` ni `unmatchedRasters`. Compruebe `finderInputs`, `displayUrl`, `metadataUrl`, `rendering` y cada valor determinista de `precomputedMetricUrls` bajo `releases/{releaseId}/`.

Este candidato es evidencia únicamente del catálogo declarado. Los ID omitidos del catálogo no se conservan.

### 4. Mantener el candidato fuera del puntero activo

No apunte a `manifest/manifest.json` hasta que existan todos los bytes de métricas y COG referenciados. Las métricas de la versión pueden consumir un manifiesto local de preflight:

```text
--manifest-url file://$PWD/data/metrics/generated/releases/<releaseId>/preflight/manifest.json
```

No existe la bandera `--skip-archive`. La promoción condicionada siempre archiva el puntero activo actual como parte de `--confirm-release`. Publicar en vivo un catálogo a medio construir no es una solución alternativa aceptable.

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

### 6. Generar las métricas regulares de AOI conocidas para la versión

La salida predeterminada queda bajo `data/metrics/generated/releases/<releaseId>/`, no `metrics/cache/`. La caché queda bajo `data/metrics/cache/releases/<releaseId>/`. Pase el catálogo y el plan de publicación; consulte [data/metrics/README.md](../../../../../data/metrics/README.md) para fragmentos de workers y `merge_release_workers.py`.

Una prueba de humo científica de una sola solución puede omitir `--release-plan` y nunca debe ensamblarse ni publicarse como la versión completa:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url "file://$PWD/$RELEASE_ROOT/preflight/manifest.json" \
  --release-id "$RELEASE_ID" \
  --solution-catalog "$RELEASE_ROOT/solution-catalog.json" \
  --solution-id <solution-id> \
  --cache-dir "data/metrics/cache/releases/$RELEASE_ID" \
  --output-dir "$RELEASE_ROOT/smoke/scientific/regular/verbose"
```

Para la versión del catálogo en sí, genere, inspeccione, publique y verifique. Las métricas de publicación se niegan a sobrescribir en silencio: una ruta remota existente solo se acepta cuando su SHA-256 coincide.

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/releases/<releaseId>/regular/verbose \
  --solution-id <solution-id>

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/releases/<releaseId>/regular/verbose \
  --solution-id <solution-id> \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/releases/<releaseId>/regular/verbose \
  --solution-id <solution-id>

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/releases/<releaseId>/regular/verbose/publish-report.json
```

El resultado regular debe contener datos nacionales, departamentos, municipios, SIRAP, RUNAP y OMEC cuando se carguen sus límites fijados y el catálogo de métricas indique que corresponden. Los errores al cargar límites son fallas de publicación.

### 7. Compactas, metas e inventarios MEC

Genere la caché regular compacta, las metas y (para terrestre) MEC v2 contra el mismo catálogo. Cada salida de `verify_artifacts.py` es un inventario `metric-artifact-verification-v1` requerido en la promoción.

Las soluciones terrestres requieren regular detallada/compacta, metas y los seis artefactos MEC v2. Las soluciones marinas requieren regular detallada/compacta y metas, sin MEC.

Después de que existan los artefactos recalculados, ensamble la reutilización declarada por el catálogo a partir de un inventario de línea base con SHA fijado mediante `assemble_solution_release.py`. Ese ensamblaje **no** es un procedimiento de agregar-una-métrica; consulte el apartado de relleno incremental más abajo.

### 8. Promover el catálogo (publicación condicionada)

Confirme que cada URL del manifiesto generado ya resuelva a bytes verificados. Luego simule y promueva. `--catalog` es obligatorio. Cada `--artifact-inventory` debe provenir de `verify_artifacts.py`. Copie `--expected-live-sha256` de la salida de la simulación:

```bash
npm --prefix frontend run publish:layer-manifest -- \
  --source public/data/layer-manifest/manifest.json \
  --catalog ../path/to/solution-catalog.json \
  --artifact-inventory ../path/to/regular-verification.json \
  --artifact-inventory ../path/to/compact-verification.json \
  --artifact-inventory ../path/to/goals-verification.json \
  --artifact-inventory ../path/to/mec-verification.json \
  --dry-run

npm --prefix frontend run publish:layer-manifest -- \
  --source public/data/layer-manifest/manifest.json \
  --catalog ../path/to/solution-catalog.json \
  --artifact-inventory ../path/to/regular-verification.json \
  --artifact-inventory ../path/to/compact-verification.json \
  --artifact-inventory ../path/to/goals-verification.json \
  --artifact-inventory ../path/to/mec-verification.json \
  --confirm-release <releaseId> \
  --expected-live-sha256 <digest-from-dry-run>
```

El publicador escribe una revisión inmutable en `manifest/releases/{releaseId}/revisions/{sha256}.json`, archiva el puntero activo actual y luego promueve con un put condicionado al destino usando el ETag activo. `--dry-run` realiza las mismas lecturas remotas y omite todas las escrituras.

### 9. Verificar y conservar la publicación

- Obtenga el manifiesto nacional activo con un parámetro de consulta que evite la caché y verifique el conjunto de ID previsto.
- Confirme los insumos y las etiquetas del Finder.
- Renderice el ráster sin procesar y el COG, si corresponde.
- Pruebe una AOI conocida de cada geografía aplicable.
- Cargue datos regulares, compactos, MEC y de metas, según corresponda.
- Verifique que una solución reutilizada sin cambios todavía cargue.
- Conserve las sumas de comprobación sin procesar y derivadas, todos los informes, los directorios locales de generación, catálogos, inventarios, nombres del operador/revisor y marcas de tiempo UTC.
- Conserve los objetos anteriores durante el periodo de retención aprobado. No los elimine solo porque exista un archivo del manifiesto.
- Para una revisión material, afirme el reemplazo solo cuando el nuevo catálogo activo excluya el ID anterior y se conserve completa la versión anterior.

## Reemplazo o retiro del catálogo

Este es el flujo nacional/marino en vivo. No está a la espera de una fusión.

1. Congelar los cambios e inventariar el grafo completo de dependencias en producción.
2. Redactar un archivo `solution-catalog-v1` para el nuevo `releaseId`. Incluya cada ID que deba permanecer activo; omita cada ID que deba salir del catálogo activo.
3. Cargar pares fuente nuevos solo bajo `releases/{releaseId}/solutions/{land|marine}/`. Nunca sobrescriba un ID o paquete anterior.
4. Planificar la versión (`plan_solution_release.py`), generar métricas para los ID marcados `recompute` y ensamblar la reutilización idéntica por SHA.
5. Generar el manifiesto con `--catalog`. No combine ID publicados no declarados.
6. Verificar cada URL candidata. Cada `--artifact-inventory` debe coincidir en identidad de catálogo, URL, recuentos de bytes y valores SHA-256 locales/remotos.
7. Simular la publicación condicionada y luego promover con `--confirm-release <releaseId>` y `--expected-live-sha256` de esa simulación.
8. Conservar la versión anterior completa durante el periodo de retención aprobado.
9. Verificar el Finder, el renderizado del mapa, todas las geografías de AOI conocidas, las capas compartidas sin cambios y el comportamiento de la caché del navegador.
10. Revertir con el catálogo histórico: `--use`, `--catalog`, `--dry-run` y luego `--confirm-rollback`. Se rechazan archivos sin identidad de versión.

Los archivos del manifiesto contienen únicamente referencias JSON. **No archivan los rásteres, COG, métricas regulares/compactas, fragmentos MEC, metas, límites ni otros bytes referenciados por esas URL**. Por tanto, un archivo del manifiesto no es una copia de seguridad completa y no puede garantizar por sí solo una reversión.

Eliminar objetos anteriores mientras un manifiesto archivado o activo todavía los referencia convierte la reversión en URL rotas. No elimine ni ponga en cuarentena los recursos del catálogo anterior hasta que existan inventarios, retención y una reversión ensayada.

## Relleno incremental de métricas

`backfill_land_use_of_aoi.py` está en este repositorio. Esta sección no es una guía operativa congelada. No invente aquí una receta de CLI. No es la ruta de publicación GTIC.

La producción GTIC (`catalog-releases/3.0.5` → `manifest/manifest.json`) declara 172 nacionales (168 terrestres + 4 marinas) + 56 SIRAP = 228. El compacto de producción no incluye `land_use_*_pct_of_aoi`, así que las AOI administrativas conocidas (departamento, municipio, SIRAP, RUNAP, OMEC) muestran barras de uso del suelo vacías («aún no disponible»). Los polígonos personalizados dibujados ya muestran barras CLC de uso del suelo en vivo.

Esta rama / 3.0.6 usa el índice de prueba `land-use-aoi-test` (mismas cifras). Las barras locales de AOI conocidas pueden llenarse. Eso no es producción GTIC.

El código puede reutilizar artefactos a nivel de solución mediante `plan_solution_release.py` y `assemble_solution_release.py` cuando coinciden el nombre base, el dominio, el SHA del ráster y las firmas de insumos. Esa reutilización no es lo mismo que un procedimiento de agregar-una-métrica. Dirija a los desarrolladores al README de métricas.

## Lista de verificación para reemplazar una revisión material

- [ ] La revisión tiene un `solution_id` nuevo que nunca se ha reutilizado.
- [ ] Cada ruta nueva de recursos sin procesar, COG, métricas, metadatos y artefactos derivados es inmutable bajo `releases/{releaseId}/` y no sobrescribe bytes anteriores.
- [ ] Se conservan el paquete anterior completo, el ID anterior, los metadatos, las sumas de comprobación y la versión del catálogo.
- [ ] La relación anterior-nueva está registrada en metadatos compatibles o documentación de publicación, sin inventar un campo de linaje estructurado.
- [ ] El archivo `solution-catalog-v1` incluye el ID nuevo, excluye el ID anterior retirado y conserva los demás ID previstos.
- [ ] La publicación condicionada usó `--catalog`, inventarios de artefactos, `--dry-run` y luego `--confirm-release` y `--expected-live-sha256`.
- [ ] La reversión se ensayó con el catálogo histórico y `--confirm-rollback`.

Si falta algún control, deténgase después de preparar el paquete nuevo y escale el caso en lugar de afirmar que se reemplazó o retiró.

## Impacto en AOI personalizadas

Las AOI conocidas usan cachés publicadas por solución. Las AOI personalizadas son distintas: actualmente, el backend calcula un polígono dibujado con respecto a capas compartidas de referencia y métricas de ejecución; no carga el ráster de la solución seleccionada como insumo de cálculo específico de esa solución. Por tanto, agregar por sí solo un paquete de solución nuevo no requiere volver a generar los artefactos del backend.

Si cambian los insumos compartidos en producción o el manifiesto fuente que usan los artefactos del backend, siga [Métricas y artefactos de ejecución](./metrics-and-artifacts.md), vuelva a generar los artefactos de ejecución, vuelva a crear el contenedor del backend y verifique `/ready`. El comportamiento de las máscaras de categorías para polígonos arbitrarios sigue siendo una inquietud de ingeniería; no afirme que existe paridad total entre AOI conocidas y personalizadas sin las comprobaciones de regresión documentadas.

## Reversión

### Solución nueva o promoción del catálogo

1. Detenga cualquier publicación adicional y conserve la evidencia de la ejecución fallida.
2. Enumere los archivos del manifiesto:

   ```bash
   npm --prefix frontend run rollback:layer-manifest
   ```

3. Simule el archivo registrado conocido como válido contra su catálogo histórico:

   ```bash
   npm --prefix frontend run rollback:layer-manifest -- \
     --use <index|pathname|url> \
     --catalog ../path/to/historical-solution-catalog.json \
     --dry-run
   ```

4. Confirme la restauración:

   ```bash
   npm --prefix frontend run rollback:layer-manifest -- \
     --use <index|pathname|url> \
     --catalog ../path/to/historical-solution-catalog.json \
     --confirm-rollback
   ```

5. Actualice el navegador y repita las comprobaciones del manifiesto, Finder, mapa y AOI conocidas.
6. Conserve los objetos nuevos sin procesar y derivados hasta que concluyan el incidente y la decisión de retención. Su presencia es inocua cuando ningún manifiesto activo los referencia.

### Reemplazo del catálogo por revisión material

Restaure la versión inmutable anterior completa del catálogo, incluidos su ID de solución anterior, manifiesto, metadatos, rásteres sin procesar, COG, métricas regulares/compactas, MEC y metas, según corresponda; verifique las sumas de comprobación remotas y actualice los clientes. El paquete revisado permanece conservado, pero sin referencias. Si se sobrescribió o eliminó algún byte anterior, se infringió la política y la reversión no puede considerarse verificada.

## Bloqueos restantes para producción

- El relleno incremental de uso del suelo / agregar-una-métrica (`backfill_land_use_of_aoi.py`) no es la ruta de publicación GTIC.
- Los generadores de COG y algunos otros todavía prefieren manifiestos HTTP o `file://`; nunca publique un catálogo incompleto en el puntero activo como staging.
- La carga del par de solución sin procesar fuera de `upload_solution_sources.py` sigue siendo manual y no es transaccional.
- La generación de COG solo admite `scope: "nacional"`, no soluciones marinas.
- Los archivos del manifiesto no conservan los bytes referenciados.
- La paridad de máscaras de categorías para AOI personalizadas todavía requiere verificación de ingeniería.
- Los catálogos regionales SIRAP están fuera del alcance de esta guía.
