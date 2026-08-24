[← Volver a Operaciones de Datos](./README.md)

# Métricas y artefactos de tiempo de ejecución

## Cuándo utilizar esta guía operativa

Utilice esta guía operativa cuando cambie una solución, una capa de cálculo compartida, una definición de métrica, un límite conocido, un resumen de solución o un manifiesto de tiempo de ejecución. Abarca el ciclo de vida completo: generación local, inspección, ensayo, publicación, verificación remota, actualización del manifiesto y reinicio de los artefactos de FastAPI.

Las AOI conocidas leen cachés precalculadas por solución. Las AOI personalizadas que dibuja el usuario no: FastAPI las calcula a partir de rásteres de tiempo de ejecución de solo lectura y matrices de especies cargadas al inicio. Trate ambos mecanismos como superficies de publicación independientes que deben mantener la coherencia científica.

## Roles y requisitos previos

- **Propietario de datos/métricas:** aprueba las entradas de cálculo, la semántica de las métricas, el alcance esperado de las soluciones y las AOI, y las verificaciones científicas por muestreo.
- **Operador:** selecciona el alcance, genera artefactos, revisa informes, publica solo resultados validados, actualiza el manifiesto y verifica la preparación del tiempo de ejecución.
- **Operador de backend:** crea artefactos de tiempo de ejecución en el host de métricas y recrea el contenedor FastAPI.
- **Desarrollador/revisor:** se requiere para cambios en las definiciones de métricas, la publicación manual de MEC o de metas, las decisiones sobre máscaras de categorías para AOI arbitrarias y cualquier incumplimiento de contrato.
- Ejecute comandos desde la raíz del repositorio a menos que un paso indique lo contrario.
- Cree y active el entorno Python:

```bash
python3 -m venv data/metrics/python/.venv
source data/metrics/python/.venv/bin/activate
pip install -r data/metrics/python/requirements.txt
```

- Confirme que `BLOB_READ_WRITE_TOKEN` esté presente en `.env.local` antes de publicar. Nunca imprima ni documente su valor.
- Registre la URL exacta del manifiesto, los informes de publicación anteriores y el archivo histórico del manifiesto anterior, el ID/prefijo de la versión y la versión actual del artefacto de backend.
- Prefiera rutas de versión inmutables. Sobrescribir una ruta Blob de caché larga puede dejar a los clientes con bytes obsoletos.

## Tabla de decisiones de impacto

Trate las métricas regulares detalladas, las métricas compactas, los artefactos MEC, las metas y los artefactos de tiempo de ejecución para AOI personalizadas como superficies de publicación independientes:

| Cambio                                                                                                          | Métricas regulares detalladas                                                                                                                                                                                           | Métricas compactas                                                                                                     | MEC                                                                                                                                      | Metas                                                                  | Tiempo de ejecución para AOI personalizadas                                                                        |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Cambio en el ráster de una solución                                                                                     | **Esa solución × todas las AOI conocidas**                                                                                                                                                                                | Reconstruya a partir del informe detallado modificado de esa solución                                                                 | Para una solución terrestre, reconstruya esa solución × las seis geografías MEC                                                                     | Ninguna, a menos que también haya cambiado el resumen de la solución                                   | Ninguno; el constructor actual no empaqueta rásteres por solución                           |
| Cambio en los metadatos, Finder o resumen de una solución                                                                    | **Esa solución × todas las AOI conocidas** solo cuando cambien las métricas emitidas o la procedencia                                                                                                                                 | Reconstruya si cambió el artefacto detallado                                                                                          | Reconstruya esa solución terrestre cuando los metadatos de destino de Finder cambien su valor de referencia MEC                                                         | Reconstruya esa solución cuando cambien su resumen o las entradas de las metas          | Reconstruya solo si cambió el contrato del manifiesto de fuentes de tiempo de ejecución                              |
| Cambio en la fuente de especies                                                                                          | **Todas las soluciones del dominio terrestre × todas las AOI conocidas**; las salidas marinas no se ven afectadas por los cálculos de especies terrestres                                                                                                        | Reconstruya las salidas compactas de las soluciones terrestres afectadas                                                                  | Ninguno                                                                                                                                     | Reconstruya las metas de las soluciones terrestres afectadas cuando cambie su búsqueda de especies | Reconstruya o vuelva a desplegar por separado solo si cambiaron las matrices agrupadas o el índice de especies de tiempo de ejecución |
| Cambio en un ráster métrico compartido o en una calculadora                                                                      | **Todas las soluciones de cada dominio aplicable × todas las AOI conocidas**                                                                                                                                                     | Reconstruya esas soluciones a partir de informes detallados regenerados                                                            | Ninguno, a menos que también haya cambiado la fuente o la calculadora MEC                                                                                       | Ninguna, a menos que también haya cambiado la calculadora o la entrada de las metas                    | Reconstruya o vuelva a desplegar cuando FastAPI comparta el ráster o la calculadora modificados                     |
| Cambio en una definición de métrica, la aplicabilidad, el esquema de salida, el catálogo o la configuración de generación de firmas del catálogo | **Lo más seguro es generar una versión regular completamente coherente para todas las soluciones × todas las AOI conocidas.** Estos campos alimentan las firmas y la procedencia del catálogo; de lo contrario, los archivos que no cambien pueden quedar obsoletos frente al nuevo contrato. | Reconstruya la versión compacta completa a partir de la versión detallada coherente                                                  | Reconstruya solo si cambió el contrato MEC                                                                                                 | Reconstruya solo si cambió el contrato de las metas                             | Reconstruya o vuelva a desplegar si FastAPI comparte el contrato modificado                                   |
| Adición o actualización de un registro de límite conocido                                                                            | **Todas las soluciones × todas las AOI conocidas**; la generación regular no tiene un selector para una sola AOI                                                                                                                                 | Reconstruya todos los resultados compactos a partir de informes detallados regenerados                                                        | Reconstruya todas las soluciones terrestres para la geografía MEC modificada; los cambios más amplios en el contrato de límites pueden requerir las seis geografías              | Ninguna                                                                   | Ninguno para un cambio exclusivamente de límites                                                           |
| Cambio en una fuente MEC, la taxonomía o una calculadora exclusiva de MEC                                                            | Ninguno                                                                                                                                                                                                              | Ninguno                                                                                                                | Reconstruya las soluciones terrestres y las geografías MEC aplicables; use los filtros de solución y geografía de MEC solo para una versión con un alcance intencional | Ninguna                                                                   | Ninguno                                                                                      |
| Cambio en un resumen de metas o en una calculadora exclusiva de metas                                                                   | Ninguno, a menos que los mismos metadatos cambien la salida o la procedencia regular emitida                                                                                                                                           | Ninguno, a menos que cambie el artefacto regular detallado                                                                                 | Ninguno, a menos que los metadatos de destino de Finder también cambien MEC                                                                                      | Reconstruya las soluciones afectadas                                       | Ninguno                                                                                      |
| Cambio exclusivo del convertidor compacto o del formato                                                                           | Ninguno                                                                                                                                                                                                              | Reconstruya a partir del informe detallado seleccionado y ya inspeccionado; utilice el informe detallado completo para obtener una versión compacta completa | Ninguno                                                                                                                                     | Ninguna                                                                   | Ninguno                                                                                      |
| Cambio exclusivo de FastAPI en una fuente, matriz, índice o adaptador                                                          | Ninguno, a menos que las métricas conocidas compartan la fuente o la calculadora modificada                                                                                                                                                     | Ninguno, a menos que cambie el artefacto regular detallado                                                                                 | Ninguno                                                                                                                                     | Ninguna                                                                   | **Reconstruya los artefactos correspondientes, vuelva a crear el servicio y exija que `/ready` responda correctamente**           |
| Cambio exclusivo de etiqueta o mapa con `roleInMetricCalculation: none`                                              | Ninguno                                                                                                                                                                                                              | Ninguno                                                                                                                | Ninguno                                                                                                                                     | Ninguna                                                                   | Ninguno                                                                                      |
| Adición de un nuevo tipo de geografía conocida                                                                                  | **Versión completamente coherente después de que el desarrollador implemente el cambio**                                                                                                                                                          | Los contratos de los artefactos compactos, MEC, del manifiesto y del frontend deben admitirlo explícitamente                                           | Definido por el desarrollador                                                                                                                        | Definidas por el desarrollador                                                      | Se requiere una decisión de diseño explícita                                                         |

Los términos de alcance de esta guía operativa son precisos:

- **Selección de solución** es el único selector de contenido de producción del pipeline regular. Pase uno o más valores `--solution-id` repetibles; cada archivo resultante todavía contiene el nacional más cada departamento, municipio, SIRAP, RUNAP y OMEC cargados.
- **Todas las AOI** significa regenerar el catálogo geográfico completo dentro de cada solución afectada. El pipeline regular no tiene un selector para una sola AOI.
- **Todas las soluciones** significa omitir `--solution-id`; esto es obligatorio para entradas compartidas, contratos de cálculo y cambios de límites.
- El pipeline regular no tiene selector de métrica, de nivel geográfico ni de una AOI individual. `--limit`, la fragmentación, `--national-only` y las banderas para omitir especies son controles de prueba de humo, partición o diagnóstico; no crean un artefacto de producción completo restringido por métrica o AOI.
- MEC es independiente y admite los filtros repetibles `--solution-id` y `--geography-level`. Las metas admiten `--solution-id` repetible. La conversión compacta no tiene un selector independiente de solución, geografía o calculadora: convierte las entradas del `publish-report.json` detallado seleccionado.

## Pasos y comandos admitidos

### 1. Elija una estrategia de caché y salida limpia

Utilice un nuevo directorio de salida para una versión o mantenga intacto el directorio anterior para revertirlo. El generador se reanuda a partir de archivos de solución válidos existentes a menos que se utilice `--force`.

Los indicadores de caché no son intercambiables:

| Opción                                               | Úsela cuando                                                                         | Qué no hace                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `--force`                                          | La salida debe recalcularse después de cambiar las entradas o la lógica de cálculo.                 | No fuerza las descargas de fuentes                                   |
| `--no-cache`                                       | Se reemplazó un ráster remoto, especie CSV o límite y los bytes locales pueden estar obsoletos | Por sí solo, no obliga a volver a calcular un archivo de salida existente. |
| Ambos                                               | Los bytes de origen publicados y las salidas derivadas cambiaron                                  | —                                                                 |
| Ninguno                                            | Reanudar una ejecución interrumpida con entradas y contratos sin cambios                     | La salida válida existente se puede reutilizar                               |
| `--national-only`                                  | Diagnóstico deliberado únicamente a nivel nacional                                                 | No aceptable para una versión de producción AOI                      |
| `--skip-species` / `--skip-species-boundary-level` | Diagnóstico deliberado o producto parcial documentado.                                 | Los valores de especies omitidos no son una versión completa de la producción.      |

Proporcione siempre el `--manifest-url` previsto para preproducción o producción. No permita que un valor predeterminado implícito seleccione accidentalmente el insumo de la versión.

### 2. Validar contratos antes del cómputo

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --validate-only
```

Esto recupera y valida el manifiesto, verifica el catálogo y las capas requeridas, y luego sale **antes de la selección de la solución, la configuración de salida y la carga de límites**. Las URL faltantes de las capas requeridas se informan como advertencias, así que revise el resultado. `--validate-only` no demuestra que haya alguna fuente de límites disponible.

La prueba de límites requiere una generación real que no sea `--national-only`. Ejecute al menos el comando de prueba de humo de una solución a continuación, confirme que stdout enumera todos los niveles de límite esperados sin advertencias de límites y revise su `publish-report.json`: `boundaryErrors` debe estar vacío y `geographyLevels` debe contener `national`, `departments`, `municipalities`, `siraps`, `runaps` y `omecs`. Una generación normal puede continuar solo con los niveles que se cargaron, por lo tanto, trate cualquier nivel faltante como una prueba de humo de producción fallida incluso si el proceso finaliza con éxito. Una generación que usa `--release-id` además falla de forma cerrada cuando cualquier fuente de límite fijada no está disponible.

### 3. Genere métricas detalladas regulares

**Una solución modificada, todas sus AOI**

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --solution-id <solution-id> \
  --output-dir data/metrics/generated/tier1-one-solution \
  --cache-dir data/metrics/cache/tier1 \
  --force
```

Agregue `--no-cache` si se reemplazaron los bytes ráster remotos de esa solución.

**Todas las soluciones y todas las AOI**

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --output-dir data/metrics/generated/tier1 \
  --cache-dir data/metrics/cache/tier1 \
  --force
```

Para una versión completa inmutable, agregue `--release-id <release-id>`. El contrato de versión requiere actualmente exactamente 108 soluciones seleccionadas y cada fuente límite fijada.

### 4. Ejecute un lote fragmentado

Utilice fragmentación solo para particionar soluciones. Cada trabajador recibe todas las AOI de sus soluciones asignadas.

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --chunk-count 3 \
  --chunk-index 0 \
  --output-dir data/metrics/generated/tier1-worker-0 \
  --cache-dir data/metrics/cache/tier1 \
  --force
```

Repita con los índices de base cero `1` y `2`, utilizando un directorio de salida diferente para cada trabajador. Los trabajadores pueden compartir la caché de descarga pero no deben compartir un directorio de salida.

Antes de la publicación, publique todos los informes completos de los trabajadores o combine sus entradas de caché e informe en una salida revisada. **Manual/incompleto:** no existe ningún comando de combinación dedicado. No reclame una versión completa hasta que se verifique que la unión no tenga ID de solución duplicados o faltantes y se inspeccione como un conjunto de versiones.

### 5. Inspeccione, haga una ejecución de prueba, publique y verifique las métricas regulares

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/tier1
```

Para obtener una salida de una solución, opcionalmente repita `--solution-id` para restringir la inspección.

```bash
python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1 \
  --dry-run
```

La publicación ejecuta la inspección automáticamente, a menos que se pase la opción de línea de comandos `--skip-inspect`. No utilice `--skip-inspect` en operaciones normales.

```bash
python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1
```

Verifique los bytes locales con la URL pública, SHA-256, el tipo de contenido y el encabezado de caché de un año:

```bash
python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/tier1/publish-report.json
```

El publicador sobrescribe las rutas de destino con `--force`; no archiva automáticamente métricas anteriores. Conserve la generación/informe local anterior o utilice un prefijo de versión inmutable antes de publicar.

### 6. Cree cachés regulares compactos

Los artefactos compactos se derivan de resultados detallados inspeccionados; no son un cálculo separado.

```bash
python data/metrics/python/metrics_pipeline/compact_metrics.py \
  --input-dir data/metrics/generated/tier1 \
  --output-dir data/metrics/generated/tier1-compact \
  --release-id <release-id>
```

Para un ID de versión, la conversión final requiere 108 entradas detalladas. Las versiones parciales explícitas requieren tanto `--release-selection <selection.json>` como `--partial-release`; el contrato de selección deberá declarar el catálogo completo y el subconjunto exacto.

Inspeccione, realice un ensayo, publique y verifique el resultado compacto utilizando las mismas herramientas:

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/tier1-compact

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1-compact \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1-compact

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/tier1-compact/publish-report.json
```

### 7. Generar MEC fragmentos geográficos

La salida MEC es independiente, se puede reanudar por solución/geografía y admite exactamente:
`national`, `departments`, `municipalities`, `siraps`, `runaps` y `omecs`.

Valide la fuente compuesta de cinco vistas predeterminada:

```bash
python data/metrics/python/metrics_pipeline/mec_compact.py \
  --manifest-url <approved-manifest-url> \
  --validate-only
```

Genere una solución/geografía para una prueba de humo:

```bash
python data/metrics/python/metrics_pipeline/mec_compact.py \
  --manifest-url <approved-manifest-url> \
  --solution-id <solution-id> \
  --geography-level departments
```

Omita ambos filtros para todas las soluciones terrestres y los seis niveles. Utilice `--force` para regenerar fragmentos existentes válidos y `--no-cache` para actualizar los bytes de origen descargados.

Para una versión MEC v2 inmutable, utilice `--release-id <release-id>`. Una versión completa requiere 104 soluciones terrestres y los seis niveles geográficos. La generación de una versión parcial debe utilizar un descriptor `--release-partition` que falle de forma cerrada; los informes finales de partición se pueden conciliar mediante usos repetidos de `--reconcile-partition-report`.

**Publicación manual/incompleta:** `mec_compact.py` nunca carga archivos. El repositorio no tiene un comando dedicado para publicar e integrar MEC en el manifiesto. Un proceso revisado por un desarrollador debe cargar exactamente los valores `expectedBlobPath` del informe, verificar los bytes remotos y confirmar que las URL `mecV2ByGeography` del manifiesto cubren los seis niveles. No envíe informes MEC al publicador habitual a menos que la compatibilidad se pruebe y apruebe por separado.

### 8. Generar complementos para las metas de conservación

Las metas son artefactos a nivel de solución derivados de archivos CSV de resumen de Prioritizr.

```bash
python data/metrics/python/metrics_pipeline/conservation_goals.py \
  --manifest-url <approved-manifest-url> \
  --output-dir data/metrics/generated/goals
```

Para una solución modificada, agregue `--solution-id <solution-id>`. Utilice `--force-download` si se cambiaron los bytes del resumen/especie CSV.

Revise `goals-publish-report.json` para detectar errores, recuentos de filas, URL de origen y rutas esperadas.

**Publicación manual/incompleta:** no hay ningún publicador o verificador de metas dedicado. La carga y el cableado del manifiesto requieren la revisión del desarrollador. No describa la generación por sí sola como una publicación de metas.

### 9. Actualice y publique el manifiesto de capas de tiempo de ejecución

Una vez que estén disponibles las URL de las métricas compactas regulares, MEC o las metas:

```bash
npm --prefix frontend run generate:layer-manifest
npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
npm --prefix frontend run publish:layer-manifest
```

Revise la conciliación de soluciones antes de publicar. Confirme que cada solución afectada apunte, mediante `precomputedMetricUrls`, a las rutas inmutables o aprobadas previstas, incluidas `compactCache`, las metas y las seis URL de geografías MEC cuando corresponda.

### 10. Construya los artefactos de tiempo de ejecución de FastAPI

Ejecute el siguiente comando en el host de métricas después de cualquier cambio en el manifiesto o en un ráster de origen que afecte los cálculos en vivo para AOI personalizadas:

```bash
backend/.venv/bin/python backend/scripts/build_runtime_artifact.py \
  --manifest-url <approved-manifest-url>
```

Utilice `--force` cuando cambien los bytes de origen de una URL existente. La opción `--artifact-dir`, que es opcional, cambia la ubicación de salida. `--solution-id` selecciona únicamente la solución de muestra registrada para la procedencia; los rásteres de cálculo del constructor actual son fuentes compartidas o registradas en el manifiesto, no un conjunto de tiempo de ejecución por solución.

El constructor escribe un `backend/runtime-artifacts/manifest.json` gitignored, un ráster de referencia, rásteres métricos y matrices de especies. Revise las sumas de verificación de los archivos, los tamaños, la cobertura de métricas, la URL del manifiesto de origen y las advertencias de capa faltante antes de reiniciar.

### 11. Reconstruir, reiniciar y demostrar preparación

```bash
DMT_ARTIFACT_REQUIRED=true \
  docker compose -f backend/docker-compose.yml up -d --build --force-recreate

docker compose -f backend/docker-compose.yml logs --tail=100 backend

curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
```

`/health` solo demuestra que el proceso está activo. `/ready` demuestra que los artefactos de solo lectura requeridos se cargaron y validaron. No devuelva el servicio al tráfico si falla la comprobación de disponibilidad.

### 12. Pruebe la paridad conocida/personalizada y los polígonos arbitrarios

1. Actualice el navegador para descartar las cachés de manifiesto, especies y MEC de la sesión.
2. Pruebe una AOI conocida de cada geografía afectada y compárela con sus métricas precalculadas.
3. Dibuje un polígono personalizado que coincida con un límite conocido y compare los resultados dentro de reglas de selección/rasterización documentadas.
4. Pruebe polígonos arbitrarios pequeños, multiparte, de borde de cuadrícula y sin superposición.
5. Supervise los registros de backend para detectar errores de máscara de categoría, matriz de especies, cuadrícula y artefactos.

**Defecto de producción — se requiere una corrección de ingeniería:** `build_custom_aoi_raster()` reemplaza el `selected_mask` del ráster de referencia por la máscara del polígono, pero conserva las máscaras de categorías preexistentes y las del nuevo Prioritizr del ráster de referencia. Para un polígono arbitrario cuyas celdas seleccionadas no coincidan exactamente con la unión de esas máscaras conservadas, es probable que la validación de `SolutionRaster` genere `Solution selected_mask must equal the union of values 1 and 2.` durante la construcción del ráster. Por lo tanto, la solicitud falla antes de calcular las métricas; no se trata simplemente de un desglose de categorías sin verificar. No afirme que existe soporte de producción para AOI personalizadas arbitrarias hasta que la implementación recorte o reconstruya de manera coherente todas las máscaras de categorías y una prueba de regresión de la ruta de producción cubra polígonos que no coincidan.

## Efectos posteriores

- La salida detallada regular es la fuente de la conversión compacta; publicar solo un formato puede dejar la aplicación en generaciones no coincidentes.
- Un cambio de límites modifica todos los documentos de la solución porque los nombres, los ID y las métricas están integrados por geografía.
- Los artefactos MEC se dividen por separado y se cargan de forma diferida; el éxito de la caché regular no demuestra que MEC esté completo.
- Los complementos de metas dependen de los CSV de resumen de la solución y no son métricas AOI.
- El manifiesto es la capa de enrutamiento para las URL de artefactos de interfaz. La publicación de bytes sin actualizar o integrar el manifiesto puede dejar los artefactos inalcanzables.
- Los artefactos FastAPI se cargan al inicio del proceso y se montan en modo de solo lectura. La reconstrucción de archivos sin recrear el contenedor deja el conjunto anterior en la memoria.
- Los cargadores del navegador pueden retener datos de manifiesto/especies/MEC para la sesión; actualizar durante la verificación.

## Lista de verificación

- [ ] La decisión de alcance registra el conjunto de soluciones seleccionado; cada solución seleccionada incluye todas las AOI conocidas.
- [ ] Se registran la URL del manifiesto aprobado y la versión/prefijo inmutable.
- [ ] `--validate-only` se completó; se revisaron las advertencias sobre las capas requeridas y no se utilizó como prueba de límites.
- [ ] Una prueba de humo de generación real no nacional enumera todos los niveles de límites; su informe tiene `boundaryErrors` vacío y los seis esperados `geographyLevels`.
- [ ] `--force` y `--no-cache` se utilizaron según la salida y el estado de descarga.
- [ ] El informe de generación tiene el recuento de soluciones esperado, los niveles geográficos, la firma del catálogo y cero fallas.
- [ ] En las uniones de fragmentos no faltan ID de solución ni están duplicados.
- [ ] `inspect_metrics.py` tiene éxito antes de cada publicación regular/compacta.
- [ ] Las rutas de ensayo y los recuentos coinciden con el entorno previsto.
- [ ] Los artefactos remotos regulares/compactos coinciden con los recuentos de bytes locales y los valores SHA-256 y tienen encabezados de contenido/caché esperados.
- [ ] El informe MEC tiene la solución esperada × recuento de artefactos de geografía seleccionada y cero fallas; una versión completa incluye las seis geografías.
- [ ] Las cargas manuales MEC y metas se verificaron de forma independiente y sus URL de manifiesto se resuelven.
- [ ] La validación y las pruebas del manifiesto pasan, y se aprueba la conciliación de soluciones.
- [ ] Una solución modificada y otra sin cambios cargan datos regulares, compactos, MEC y de metas, según corresponda.
- [ ] Se revisaron las sumas de verificación del manifiesto de artefactos en tiempo de ejecución y la cobertura de métricas.
- [ ] Los registros FastAPI muestran una carga exitosa de artefactos; `/health` y `/ready` pasan ambos.
- [ ] Las AOI conocidas y los valores de polígonos personalizados equivalentes son científicamente consistentes.
- [ ] Las máscaras de categoría AOI personalizadas se corrigen para que coincidan con la selección de polígonos y se pasa una prueba de regresión de polígonos que no coinciden con la ruta de producción.
- [ ] Los informes de publicación anterior, el archivo de manifiesto, los resultados de métricas y los artefactos de tiempo de ejecución permanecen disponibles.

## Reversión

1. Detenga la publicación o elimine la versión del tráfico cuando alguna familia de artefactos no coincida.
2. Restaure el manifiesto de tiempo de ejecución anterior:

```bash
npm --prefix frontend run rollback:layer-manifest
```

3. Vuelva a publicar los directorios e informes de generación regular/compacta anteriores conservados, o restaure las referencias de versiones inmutables anteriores. No existe un archivo de métricas automático.
4. Restaure los objetos y las URL anteriores de MEC y de metas mediante el mismo proceso manual revisado que se utilizó para publicarlos.
5. Reconstruya el conjunto de artefactos FastAPI anterior en buen estado y vuelva a crear el contenedor:

```bash
DMT_ARTIFACT_REQUIRED=true \
  docker compose -f backend/docker-compose.yml up -d --build --force-recreate
```

6. Verifique las sumas de verificación remotas, la carga del navegador, la paridad conocida/personalizada, los registros y `/ready` antes de restaurar el tráfico.

## Limitaciones y escalada

- No existe un selector del pipeline regular para una sola AOI; utilice una solución completa o todas las soluciones.
- La combinación de salida de fragmentos es manual.
- La carga de MEC, su integración en el manifiesto y la publicación de metas de conservación son manuales/incompletos.
- Las sobrescrituras de métricas no tienen un archivo automático; se requieren versiones inmutables o informes locales conservados para una reversión confiable.
- Las dependencias de Python utilizan rangos de versión mínimos en lugar de un bloqueo reproducible.
- El manejo de las máscaras de categorías de AOI personalizadas requiere una corrección del código de producción y cobertura de regresión para polígonos arbitrarios; es probable que la ruta actual rechace los polígonos que no coincidan antes del cálculo.
- Se debe verificar el soporte de especies AOI personalizadas en la máquina virtual de destino; no infiera la compatibilidad a partir de las cachés de especies de AOI conocidas.
- Es posible que las URL de manifiesto en vivo y las convenciones de nomenclatura de resultados del generador disperso no coincidan. Verifique el formato del artefacto de producción real antes de confiar en `compressedDataForLiveMetricsUrl`.
- No se documenta ningún flujo de trabajo de recuperación ante desastres Blob probado. Escale la pérdida de almacenamiento en lugar de improvisar una restauración destructiva.
