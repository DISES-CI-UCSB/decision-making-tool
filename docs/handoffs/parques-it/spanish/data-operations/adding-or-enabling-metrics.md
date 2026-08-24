[← Volver a Operaciones de Datos](./README.md)

# Agregar una nueva métrica o habilitar una métrica para otro dominio

## Resumen

Utilice esta guía de desarrollo para cualquiera de estos dos cambios:

- **Métrica realmente nueva:** introduzca un nuevo identificador estable de métrica y un nuevo contrato de cálculo.
- **Habilitación para otro dominio:** haga que una métrica existente sea válida para otro dominio de solución, actualmente `land` o `marine`, sin crear un segundo identificador para el mismo significado.

Ambos son cambios de código, no operaciones de carga de capas. Una métrica debe ser coherente en el catálogo y el despacho en Python, los artefactos detallados y compactos generados, la presentación en el frontend y, cuando deba estar disponible para polígonos personalizados, el artefacto FastAPI y los contratos de solicitud. Un cambio de catálogo o de aplicabilidad cambia la firma del catálogo, por lo que el alcance seguro para producción es **todas las soluciones × todas las AOI conocidas**.

No utilice esta guía para reemplazar el catálogo completo de soluciones. Las adiciones de soluciones individuales se gestionan mediante [Agregar soluciones](./adding-solutions.md); el reemplazo completo del catálogo permanece bloqueado hasta que se revise por separado un contrato de migración y publicación.

## Primera decisión: ¿nuevo identificador o habilitación para otro dominio?

| Pregunta           | Nueva métrica                                                                             | Habilitar métrica existente para otro dominio                                                              |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `metric_id` estable | Agregue un identificador nuevo y permanente                                                              | Mantenga el identificador existente                                                                                   |
| `MetricKind`       | Reutilice un tipo existente cuando la semántica coincida; agregue un tipo solo para un comportamiento de despacho nuevo | Generalmente, no requiere cambios                                                                                      |
| Entrada de catálogo      | Agregue un `MetricDefinition`                                                             | Amplíe `applicable_domains` en la definición existente                                                 |
| Calculadora         | Agréguela o regístrela cuando ninguna calculadora existente implemente la fórmula                        | Reutilícela solo después de demostrar que la fórmula y la fuente son válidas en el nuevo dominio                            |
| Frontend           | Agregue las superficies donde deba aparecer la métrica                                        | Verifique el comportamiento de selección de dominio o de alias; no duplique un plano de configuración a menos que la interfaz necesite una fila separada |
| Alcance de la versión      | Todas las soluciones × todas las AOI                                                               | Todas las soluciones × todas las AOI                                                                               |

Si dos dominios utilizan diferentes significados científicos, unidades, denominadores o fuentes autorizadas, no son automáticamente la misma métrica. Obtenga una revisión científica y del producto antes de decidir si compartir un identificador o definir métricas separadas.

## Lista de verificación del contrato

### 1. Aprobar identidad y significado científico

Edite `data/metrics/python/metrics_pipeline/metric_definitions.py`.

- [ ] Elija un identificador inmutable en formato snake_case para `MetricDefinition.metric_id`; nunca reutilice un identificador después de su publicación.
- [ ] Asigne el `metric_number` revisado y mantenga el orden del catálogo intencional porque las firmas de salida y catálogo dependen del orden.
- [ ] Establezca `label_key`, las etiquetas en inglés y español, `unit`, `format_hint` y un `source_note` preciso.
- [ ] Establezca `layer_id` cuando un ráster proporcione el valor. Utilice `off_manifest_url` y `off_manifest_rendering` solo cuando la fuente revisada viva intencionalmente fuera del manifiesto de tiempo de ejecución.
- [ ] Establezca `applicable_domains` explícitamente. El valor predeterminado es `frozenset({"land"})`.
- [ ] Reutilice un `MetricKind` existente cuando su semántica de envío y salida encaje. Amplíe el literal `MetricKind` solo cuando la métrica necesite un comportamiento realmente nuevo.
- [ ] Registre NoData, reglas de celda seleccionada, denominador, tratamiento del área de píxeles, rango esperado y comportamiento de estado para entradas faltantes o no válidas.

Para habilitar el dominio, modifique la definición existente en lugar de clonarla. Confirme que las soluciones del nuevo dominio, la cuadrícula ráster, la capa de origen y el denominador cumplan el mismo contrato científico.

### 2. Implementar y registrar la calculadora.

Los módulos de calculadora se encuentran en:

```text
data/metrics/python/metrics_pipeline/calculators/
```

Coloque la fórmula con el área funcional existente más cercana o agregue un módulo enfocado cuando se trate de un área funcional nueva. Mantenga la calculadora determinista e independiente de las etiquetas de la interfaz de usuario.

Registre calculadoras respaldadas por ráster en `data/metrics/python/metrics_pipeline/calculator_registry.py`:

- `_OVERLAP_AREA_BY_LAYER`
- `_OVERLAP_PERCENT_BY_LAYER`
- `_CATEGORICAL_AREA_BY_METRIC_ID`
- `_WEIGHTED_SUM_BY_LAYER` o `_WEIGHTED_SUM_BY_METRIC_ID`
- `_WEIGHTED_PERCENT_BY_LAYER`

Elija el registro de ID de métrica cuando las métricas que comparten una capa de origen utilicen fórmulas diferentes. Elija el registro de capa solo cuando la capa determine de manera única la fórmula.

Para un nuevo tipo, agregue una búsqueda tipada si es necesario y actualice la prueba de cobertura del registro. Para habilitar el dominio, verifique que el registro existente sea neutral en cuanto al dominio; el registro por sí solo no prueba que la fuente sea válida para el nuevo dominio.

### 3. Integrar el despacho principal, la salida, los estados, el esquema y la procedencia.

El despacho del pipeline regular es `_build_metrics()` en:

```text
data/metrics/python/metrics_pipeline/main.py
```

Los tipos existentes se dirigen a través de ayudantes dedicados o búsquedas en el registro de la calculadora. Si se agrega un nuevo `MetricKind`:

- [ ] Agregue una rama explícita de despacho; no deje la salida de producción en el estado alternativo `pending`.
- [ ] Actualice `_preload_layer_masks()` o `_preload_layer_values()` si el nuevo tipo requiere insumos subnacionales reutilizables.
- [ ] Asegúrese de que `_metrics_for_domain()` cargue solo las entradas aplicables al dominio de la solución.
- [ ] Emita valores a través de los asistentes de salida de métricas compartidos para que cada fila conserve `metricId`, `value`, `unit`, `status`, `source`, `notes`, `labelKey`, `formatHint` y `details` opcional.
- [ ] Utilice `ready` solo con un valor numérico. Utilice un valor nulo para `blocked`, `pending`, `derivation_needed` y `not_applicable`; utilice `empty` de acuerdo con el contrato de límites vacíos existente.
- [ ] Emita `not_applicable` para dominios no compatibles, no `blocked`.

El contrato compartido es `data/metrics/python/metrics_pipeline/metrics_contract.py`. Los campos del catálogo y `applicable_domains` ya están incluidos en `catalog_signature()`, por lo que un cambio solo en el catálogo invalida automáticamente las cachés obsoletas. Incremente `METRICS_SCHEMA_VERSION` solo cuando la estructura transmitida o la semántica de cálculo cambien de una manera no representada por `MetricDefinition`; luego actualice los inspectores, los modelos de interfaz, la conversión compacta y las pruebas juntas.

Los documentos generados llevan `metricsProvenance` con `schemaVersion`, `solutionDomain`, `generationConfig`, `catalogSignature`, ID de versión y procedencia de límites fijados. No edite manualmente la procedencia ni reutilice una salida antigua después de que cambie la firma.

`--validate-only` recupera el manifiesto y verifica la presencia de capas requeridas por el catálogo, luego sale antes de la selección de la solución, la carga de límites, las lecturas de origen y el cálculo. Es una verificación previa útil, pero sólo una generación real más una inspección validan esos contratos posteriores.

### 4. Agregue pruebas de pipeline enfocadas

Como mínimo, actualice o agregue pruebas enfocadas en `data/metrics/python/tests/`:

- Casos extremos de la calculadora: valor esperado, NoData, denominador cero y selección vacía;
- `test_calculator_registry.py`: cada definición respaldada por ráster se resuelve en una calculadora;
- envío: estado/valor/fuente esperado y sin carga de capas de dominio incorrecto;
- puerta de dominio: el comportamiento del dominio antiguo permanece sin cambios y el nuevo dominio admitido es `ready`;
- la salida del dominio incorrecto sigue siendo `not_applicable`;
- `test_metric_output.py` o pruebas de contrato cuando la salida/estado/esquema cambia;
- `test_metrics_cache_resume.py` cuando cambia el comportamiento de firma de catálogo o procedencia;
- cobertura compacta de ida y vuelta en `test_compact_metrics.py`;
- cobertura de inspección en `test_inspect_cache.py`.

Utilice los patrones existentes centrados en el dominio en `test_marine_pipeline_dispatch.py`, `test_marine_ecosystem_metrics.py` y `test_ecosystem_coverage_pipeline.py`.

Ejecute:

```bash
cd data/metrics/python
python -m pytest tests/test_calculator_registry.py \
  tests/test_metric_output.py \
  tests/test_metrics_cache_resume.py \
  tests/test_compact_metrics.py \
  tests/test_inspect_cache.py
```

Agregue los archivos de prueba específicos de métricas a ese comando. Regrese a la raíz del repositorio luego.

### 5. Integre en el frontend la presentación de la vista general, las AOI y la comparación

La configuración principal es:

```text
frontend/src/app/features/analysis/panel-switcher/panel-switcher.config.ts
```

Actualice solo las superficies aprobadas para la métrica:

- `OVERVIEW_SECTION_LOOKUP` asigna la sección de descripción general.
- `OVERVIEW_METRIC_BLUEPRINTS` controla las filas de descripción general.
- `AOI_ALIGNED_METRIC_BLUEPRINTS` asigna filas de AOI conocidas o personalizadas a uno o más identificadores de métrica.
- `COMPARISON_METRIC_BLUEPRINTS` controla las filas de comparación de soluciones.
- `CUSTOM_AOI_METRIC_DEFINITIONS` proporciona etiquetas, unidades y formato de respuesta personalizados.
- `CUSTOM_AOI_FAST_METRIC_IDS` o `CUSTOM_AOI_SPECIES_METRIC_IDS` controlan las solicitudes de polígonos personalizados; no agregue un identificador hasta que el backend lo exponga.

La resolución de identificadores específica del dominio se encuentra actualmente en `frontend/src/app/features/analysis/panel-switcher/overview-metrics.utils.ts`; `mangrove_coverage` es el ejemplo existente de un alias terrestre/marino. Prefiera un solo identificador cuando la semántica sea realmente idéntica. Agregue lógica de alias solo cuando métricas de dominio con identificadores distintos compartan intencionalmente una fila de la interfaz.

Agregue una copia de la interfaz de usuario en inglés y español en:

```text
frontend/public/i18n/en.json
frontend/public/i18n/es.json
```

El `labelKey` del artefacto es un dato, pero las claves de traducción del plano de configuración del panel son independientes y también deben existir. Agregue las claves de metodología y fuente cuando la vista general las muestre.

El formato está centralizado en `frontend/src/app/features/analysis/utils/metric-presentation.utils.ts`. Agregue a `AREA_METRIC_IDS` los identificadores cuyos valores representan áreas para que el selector de km²/hectáreas los convierta. Agregue una sobrescritura de unidad solo cuando la unidad del artefacto no pueda normalizarse mediante `getMetricDisplayUnit()`. Actualice `metric-presentation.utils.spec.ts`, `panel-switcher.config.spec.ts`, `overview-metrics.utils.spec.ts` y los casos pertinentes de `panel-switcher.spec.ts`.

El contrato DTO es `frontend/src/app/core/models/metric-value.model.ts`. Un identificador nuevo por sí solo no requiere un cambio de modelo porque `CustomPolygonMetricId` es una cadena; los cambios de estado, formato, geografía o estructura transmitida sí lo requieren.

### 6. Agregue soporte para AOI personalizadas solo cuando sea necesario

La generación para AOI conocidas y el cálculo de polígonos personalizados son implementaciones independientes. El hecho de que una métrica aparezca en la salida precalculada no la hace disponible desde `/metrics/custom-polygon`.

El cableado del adaptador backend está en:

```text
backend/app/metric_adapters.py
```

- [ ] Importe o implemente la calculadora compartida correspondiente.
- [ ] Registre el comportamiento de superposición/porcentaje/ponderado en la búsqueda de backend adecuada.
- [ ] Asegúrese de que `IMPLEMENTED_RASTER_METRIC_IDS` incluya el tipo o el identificador explícito solo después de que se implementen las entradas y el despacho en tiempo de ejecución.
- [ ] Actualice el comportamiento de `metric_ids_for_request()` solo si los alias o la validación de la solicitud cambian.
- [ ] Asegúrese de que los metadatos de respuesta informen el identificador en `implemented_metric_ids` y registren con precisión las capas utilizadas y los motivos de indisponibilidad.

Si la métrica necesita una fuente que aún no está empaquetada, actualice:

```text
backend/scripts/build_runtime_artifact.py
```

Agregue un `LayerSpec` o `SpeciesMatrixSpec` revisado, una URL de origen, una interpretación de representación o valor y una asociación con el identificador de la métrica. Actualice `metric_coverage()` para que `implemented_now`, los grupos bloqueados o diferidos y las notas sigan siendo veraces. Reconstruya los artefactos con `--force` cuando cambien los bytes de una URL existente.

Agregue pruebas de solicitud y adaptador en:

```text
backend/tests/test_raster_polygon_metrics.py
backend/tests/test_metrics_contract.py
backend/tests/test_shared_metric_adapters.py
```

Pruebe las solicitudes explícitas, la exposición de solicitudes predeterminadas, los identificadores no admitidos, el comportamiento de fuentes no disponibles, los metadatos y la paridad con la calculadora compartida del pipeline.

Ejecute:

```bash
backend/.venv/bin/python -m pytest \
  backend/tests/test_raster_polygon_metrics.py \
  backend/tests/test_metrics_contract.py \
  backend/tests/test_shared_metric_adapters.py
```

Después de crear los artefactos en el host de destino, vuelva a crear el contenedor de backend y exija que tanto la comprobación de `/ready` como una solicitud representativa de polígono personalizado se completen correctamente antes de restaurar el tráfico.

### 7. Comprenda las implicaciones del manifiesto y de la fuente de entrada

Una definición de métrica no es en sí misma una fila de manifiesto en tiempo de ejecución. El manifiesto pasa a formar parte del cambio cuando:

- se debe registrar una nueva capa de cálculo y resolverla mediante `layer_id`;
- cambia una URL de origen, un contrato de representación o algún metadato;
- cambian las URL de artefactos regulares, compactos, MEC o de metas; o
- cambian los metadatos del dominio de la solución.

Para una nueva entrada de origen, primero use [Administrar capas](./managing-layers.md) para aprobar, publicar, registrar y validar la capa. Confirme que `_validate_required_layers()` puede resolver su `displayUrl` o documentar deliberadamente la URL revisada fuera del manifiesto. Publique bytes de origen antes de las métricas generadas y publique bytes de métricas antes del manifiesto que las dirige.

Cambiar un `MetricDefinition` cambia la firma del catálogo incluso cuando no cambia ningún campo de manifiesto. Por lo tanto, la publicación de métricas aún requiere artefactos regenerados; una publicación de manifiesto solo es necesaria cuando cambian sus URL enrutadas o contratos de origen.

### 8. Genere versiones regulares y compactas

Debido a que el orden/aplicabilidad del catálogo está integrado en cada documento de solución y no existe un selector único AOI, genere **todas las soluciones × todas las AOI**:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --output-dir data/metrics/generated/<release-id>-verbose \
  --cache-dir data/metrics/cache/tier1 \
  --release-id <release-id> \
  --force

python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/<release-id>-verbose

python data/metrics/python/metrics_pipeline/compact_metrics.py \
  --input-dir data/metrics/generated/<release-id>-verbose \
  --output-dir data/metrics/generated/<release-id>-compact \
  --release-id <release-id>
```

Agregue `--no-cache` cuando los bytes de origen remoto puedan estar obsoletos. Inspeccione, ejecute en seco, publique y verifique directorios detallados y compactos utilizando [Métricas y artefactos de tiempo de ejecución](./metrics-and-artifacts.md) y [Publicación y reversión](./publishing-and-rollback.md). Confirme que cada dominio tenga la división `ready`/`not_applicable` esperada y una firma de catálogo coincidente.

Se necesita volver a calcular todas las AOI siempre que cambie el catálogo, la calculadora, la aplicabilidad, la fuente compartida, el esquema o el contrato de límites. Un único cambio de ráster de solución puede utilizar una solución, pero su salida aún contiene todas las AOI conocidas.

### 9. Mantenga separadas las métricas regulares, MEC y las metas

No trate estos productos como artefactos intercambiables:

- **Las métricas regulares detalladas** las genera `main.py`.
- **Las métricas regulares compactas** son una conversión de la salida detallada inspeccionada por `compact_metrics.py`.
- Los fragmentos **MEC** son generados por separado por `mec_compact.py`, tienen un contrato de taxonomía/geografía independiente y no tienen un publicador dedicado.
- **Las metas de conservación** son complementos a nivel de solución generados por `conservation_goals.py` a partir de resúmenes de soluciones; no son filas de métricas de AOI y tampoco tienen un publicador o verificador dedicado.

Una nueva métrica regular no pertenece automáticamente a MEC ni a las metas. Cambie esos pipelines solo cuando el requisito aprobado cambie explícitamente sus esquemas o productos fuente; luego pruébelos y publíquelos mediante sus procedimientos revisados por separado.

## Verificación de la versión

- [ ] Se registran la identidad estable, las unidades, las etiquetas, la fuente, la fórmula, la aplicabilidad del dominio y el revisor.
- [ ] Pasa la validación del catálogo, seguida de una generación real que carga los límites y fuentes requeridos.
- [ ] Las pruebas enfocadas de calculadora, despacho, dominio, salida, procedencia, compacto, inspección, frontend y backend pasan según corresponda.
- [ ] Los artefactos detallados y compactos cubren el catálogo completo de soluciones y cada geografía conocida.
- [ ] Los valores del dominio anterior se mantienen estables; los dominios recién habilitados tienen valores revisados científicamente.
- [ ] Las filas del dominio incorrecto son `not_applicable`, no ceros engañosos ni valores bloqueados.
- [ ] La descripción general de la interfaz, AOI, la comparación, las traducciones, la conversión de unidades y las exportaciones muestran la métrica deseada.
- [ ] Las listas de solicitudes de AOI personalizadas contienen solo ID implementados por el backend; la cobertura de artefactos y los metadatos de respuesta coinciden.
- [ ] Los nuevos bytes de origen, los artefactos métricos y los manifiestos de enrutamiento se publicaron en orden de dependencia.
- [ ] MEC y las metas se mantuvieron deliberadamente sin cambios o se publicaron a través de sus contratos separados.
- [ ] Las rutas inmutables anteriores, las salidas locales, los informes de publicación y las referencias de archivos históricos de manifiesto permanecen disponibles.

## Brechas de producción actuales

- El reemplazo completo del catálogo de soluciones no tiene un flujo de trabajo de migración/conciliación aprobado; sólo las adiciones individuales están documentadas por el operador.
- Las sobrescrituras de métricas no tienen un archivo automático; utilice versiones inmutables o conserve resultados e informes completos anteriores.
- MEC y la publicación/verificación de metas de conservación siguen siendo manuales e incompletas.
- Las entradas del tiempo de ejecución del backend y las listas de solicitudes personalizadas del frontend AOI son registros codificados.
- `--validate-only` no carga límites ni ejecuta cálculos.
- La corrección de la máscara de categoría de AOI personalizadas aún requiere revisión de ingeniería y cobertura de regresión de polígonos arbitrarios.
- Es posible que las convenciones de URL de métricas en vivo del manifiesto y los nombres de salida del generador disperso no coincidan; verifique el formato implementado.
- La recuperación de Blob ante desastres no está automatizada ni probada.
