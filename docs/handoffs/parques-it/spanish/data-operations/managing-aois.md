[← Volver a Operaciones de datos](./README.md)

# Gestión de AOI conocidas y límites

## Cuándo usar este procedimiento

Use este procedimiento al agregar o corregir un registro de departamento, municipio, SIRAP, RUNAP u OMEC, o al reemplazar una de esas colecciones de límites publicadas. También explica por qué agregar un tipo de geografía completamente nuevo es un proyecto de desarrollo y no una tarea de carga.

No use este flujo de trabajo para un polígono dibujado por el usuario. Una AOI personalizada se envía al servicio FastAPI y se calcula a partir de artefactos ráster en tiempo de ejecución; no se registra en los catálogos de límites de AOI conocidas ni en la caché precalculada.

## Roles y requisitos previos

- **Responsable de datos:** aprueba la fuente, la licencia, los ID estables, los nombres, la geometría y si un cambio es una adición o una corrección.
- **Operador:** construye o recibe el GeoJSON de reemplazo completo, ejecuta la validación, coordina la carga controlada a Blob, genera las métricas y verifica la publicación.
- **Desarrollador/revisor:** actualiza las referencias de validación de cierre seguro y los contratos de código. Este rol es obligatorio para un nuevo tipo de geografía y se recomienda enfáticamente para cada reemplazo de límites.
- Trabaje desde la raíz del repositorio con el entorno virtual de métricas instalado.
- Confirme que `BLOB_READ_WRITE_TOKEN` esté presente en `.env.local` antes de publicar. Nunca imprima, pegue ni registre su valor.
- Registre la URL pública actual, el SHA-256 de la fuente, la referencia del archivo del manifiesto, los informes de publicación de métricas y la versión del artefacto del backend antes de realizar un cambio.
- Prefiera una nueva ruta inmutable de Blob para cada publicación de límites. Una carga exitosa no constituye aprobación para referenciar o exponer el nuevo límite.

## Tabla de decisión de impacto

| Cambio                                                  | Soporte para el operador                         | Contrato del límite                                                     | Alcance de las métricas                                                | Consecuencia para frontend/manifiesto                                                       |
| ------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Agregar o actualizar un departamento                    | **Manual/con asistencia de desarrollo**          | Reemplazar el GeoJSON completo de departamentos; actualizar todas las referencias afectadas | **Todas las soluciones y todas las AOI conocidas en cada salida**      | El tipo y la URL existentes pueden mantenerse; los cambios de catálogo/nombre/ID afectan la identificación y la consulta de caché |
| Agregar o actualizar un municipio                       | **Manual/con asistencia de desarrollo**          | Reemplazar el GeoJSON completo de municipios; actualizar todas las referencias afectadas | **Todas las soluciones y todas las AOI conocidas en cada salida**      | Igual que para departamentos                                                               |
| Agregar o actualizar un SIRAP                           | **Manual/con asistencia de desarrollo**          | Reemplazar la fuente combinada completa; actualizar las referencias de catálogo y geometría | **Todas las soluciones y todas las AOI conocidas**                     | La capa combinada de identificación y la entrada de límite del manifiesto deben seguir resolviendo los mismos ID |
| Agregar o actualizar un área RUNAP                      | Script de construcción/carga disponible          | Reconstruir la colección completa de identificación; actualizar las referencias completas | **Todas las soluciones y todas las AOI conocidas**                     | La selección por identificación/puntero de RUNAP y la clave `runaps` en caché deben coincidir |
| Agregar o actualizar un área OMEC                       | **Manual/incompleto**                             | Reemplazar la colección completa de identificación; actualizar las referencias completas | **Todas las soluciones y todas las AOI conocidas**                     | La selección por identificación/puntero de OMEC y la clave `omecs` en caché deben coincidir |
| Cambiar solo el nombre, conservando el ID estable y la geometría | Parcialmente manual                       | La suma de verificación del catálogo y la de la fuente también cambian | **Todas las soluciones**, porque los nombres están incorporados en cada caché de solución | La etiqueta de identificación y la etiqueta en caché deben publicarse juntas                |
| Agregar un tipo de geografía completamente nuevo        | **No admite operación directa — cambio de desarrollo** | Agregar una nueva especificación de fuente y pruebas                 | **Todas las soluciones y todas las AOI** después de la implementación | Agregar modelo de AOI, identificación, rol en el manifiesto, consulta de caché, UI/UAT y decisiones del backend |
| El usuario dibuja un polígono personalizado             | Flujo de trabajo existente de la aplicación      | Sin referencia de límite conocido ni entrada de catálogo                | Sin reconstrucción precalculada                                       | FastAPI lo calcula a partir de artefactos en tiempo de ejecución; consulte el procedimiento de métricas/artefactos |

La canalización regular de métricas escribe un documento por solución que contiene todas las geografías y AOI. Tiene `--solution-id`, pero no un selector para un solo límite. Por lo tanto, cualquier cambio en un registro de límite, nombre, geometría, ID estable, URL de fuente o referencia exige regenerar cada solución con el catálogo completo y vigente de AOI, incluso cuando los valores calculados parezcan no haber cambiado.

## Pasos y comandos admitidos

### 1. Clasificar y preparar el cambio

1. Confirme si se trata de:
   - una adición o corrección de registro dentro de una geografía existente; o
   - un nuevo tipo de geografía con un nuevo significado para la aplicación.
2. Conserve los ID estables. Nunca reutilice un ID existente para un lugar diferente.
3. Registre la fuente, la licencia, la fecha de extracción, el CRS, los campos de ID/nombre, el número de elementos, los pasos de reparación de geometría y la suma de verificación publicada anteriormente.
4. Genere un nuevo archivo local. No sobrescriba la fuente local o pública que se sabe que funciona hasta completar la validación.

Los contratos actuales son:

| Tipo en la aplicación | Clave de métricas | Fuente pública                                              | Identidad requerida                                                           |
| --------------------- | ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Departamento          | `departments`     | `boundaries/igac_departments_detailed.geojson`              | `boundary_id`, `boundary_name`; los campos de fuente incluyen `DeCodigo`, `DeNombre` |
| Municipio             | `municipalities`  | `boundaries/igac_municipalities_detailed.geojson`           | `boundary_id`, `boundary_name`; los campos de fuente incluyen `MpCodigo`, `MpNombre` |
| SIRAP                 | `siraps`          | `inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson`  | `sirap_id`, `sirap_name`, `sirap_kind`, `source_file`                          |
| RUNAP                 | `runaps`          | `inputs/includes/runap_identify.geojson`                    | `runap_id`, `runap_name`, `runap_category`, `runap_status`                     |
| OMEC                  | `omecs`           | `inputs/includes/omecs_identify.geojson`                    | `SITE_ID`, `NAME`, `DESIG`, `STATUS`, `GOV_TYPE`                               |

### 2. Construir la colección completa de límites

Use el flujo de trabajo correspondiente a la geografía afectada:

**Departamentos y municipios — manual/con asistencia de desarrollo**

No existe un constructor dedicado en el repositorio ni un cargador genérico de límites. Produzca el GeoJSON detallado completo en la ruta establecida. Conserve los campos de identidad establecidos y el CRS aprobado.

**SIRAP — solo reparación/migración fija, publicación manual**

```bash
python3 data/scripts/sirap/main.py
```

Este comando no es un constructor general para contenido SIRAP nuevo o modificado arbitrariamente. Descarga una URL de fuente fija, exige el SHA-256 codificado de esa fuente y repara de manera reproducible esa colección existente de diez elementos para convertirla en la versión v2, limitada a polígonos y fijada. Úselo únicamente para reproducir esa migración. Una nueva fuente o catálogo SIRAP requiere una transformación revisada con asistencia de desarrollo y nuevos contratos. Revise el GeoJSON generado y el JSON correspondiente de procedencia/metadatos en `data/boundaries/sirap/`; el script no los carga.

**RUNAP — construcción y carga opcional admitidas**

```bash
python3 data/scripts/runap/main.py \
  --output data/inputs/includes/runap_identify.geojson
```

Ejecute la carga solo después de la revisión local:

```bash
python3 data/scripts/runap/main.py \
  --output data/inputs/includes/runap_identify.geojson \
  --upload
```

**OMEC — manual/incompleto**

No existe un comando dedicado para reconstruir OMEC. La reconstrucción y publicación de `omecs_identify.geojson` requiere un proceso revisado y con asistencia de desarrollo. Deténgase y escale si la transformación de la fuente al contrato aún no está documentada para el conjunto de datos que se entregará.

### 3. Validar la geometría y actualizar las referencias de cierre seguro

El cargador de métricas rechaza bytes de fuente, CRS, campos de ID/nombre, campos obligatorios, número de elementos, catálogo, colección de geometrías, geometrías representativas, ID duplicados y geometrías no válidas que no coincidan con lo esperado. SIRAP también exige geometría poligonal y su comportamiento de elementos combinados.

Calcule y registre la suma de verificación de todo el archivo sin exponer credenciales:

```bash
shasum -a 256 <candidate-boundary.geojson>
```

**Paso revisado por desarrollo:** actualice la entrada afectada de `BOUNDARY_SOURCE_SPECS` en `data/metrics/python/metrics_pipeline/boundaries/boundary_loader.py`, incluidos:

- `expected_sha256` y el nombre de archivo de caché;
- `expected_feature_count`;
- `expected_catalog_sha256`;
- `expected_geometry_collection_sha256`;
- los hashes de geometrías representativas cuando cambie una geometría representativa;
- los contratos de CRS, campos o comportamiento solo cuando se aprueben intencionalmente.

No existe una CLI para operadores que reescriba estas referencias de manera segura. No debilite ni omita una comprobación fallida para permitir que se cargue un archivo nuevo.

Ejecute las pruebas unitarias y de contrato del cargador de límites:

```bash
python -m pytest data/metrics/python/tests/test_boundary_loader.py
```

El modo `--validate-only` de la canalización regular **no** carga, descarga ni valida las fuentes de límites. Obtiene el manifiesto, valida el catálogo de soluciones/capas requeridas, comprueba si las URL de las capas requeridas responden y sale antes de cargar los límites:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --validate-only
```

Valide los bytes públicos reales frente a cada referencia revisada con la prueba opcional de fuentes públicas:

```bash
VALIDATE_BOUNDARY_SOURCES=1 \
  python -m pytest \
  data/metrics/python/tests/test_boundary_loader.py \
  -k public_boundary_snapshots
```

Luego ejecute una generación real de una solución en una salida/caché limpia de prueba de humo. Esto ejercita la descarga de límites, la validación de referencias, la carga de geometrías y el cálculo de métricas; `--validate-only` no puede sustituirla:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --manifest-url <approved-manifest-url> \
  --solution-id <known-solution-id> \
  --output-dir data/metrics/generated/boundary-smoke \
  --cache-dir data/metrics/cache/boundary-smoke \
  --force \
  --no-cache
```

Una generación que no corresponde a una publicación informa las fallas de límites como advertencias y puede continuar sin algunos niveles geográficos. La prueba de humo solo pasa cuando `publish-report.json` contiene un objeto `boundaryErrors` vacío y la solución generada incluye el nivel nacional y todos los niveles de límites esperados: `departments`, `municipalities`, `siraps`, `runaps` y `omecs`.

### 4. Preparar y promover el límite de forma segura

Para departamentos, municipios, SIRAP y OMEC, la publicación es una **operación manual controlada de Blob**; no existe un comando genérico de carga en el repositorio. El comando `--upload` de RUNAP escribe en su ruta configurada, por lo que debe tratarse como una publicación en una ruta mutable, salvo que esa implementación se revise y cambie.

La URL del límite y sus referencias de cierre seguro constituyen un solo contrato. Las referencias modificadas no pueden validar los bytes anteriores en una URL mutable, y los bytes nuevos de esa URL no pueden cargarse con las referencias anteriores. No despliegue ninguna de las dos partes por separado.

**Secuencia preferida con ruta inmutable**

1. Cargue el GeoJSON candidato completo en una nueva ruta inmutable de preparación; no sobrescriba ni elimine el objeto anterior.
2. Revise un cambio de código que actualice la URL, el nombre de archivo de caché y todas las referencias aprobadas del `BoundarySourceSpec` afectado para apuntar exactamente a ese objeto preparado.
3. Ejecute la prueba de límites de fuente pública y la prueba de humo de generación real anteriores en un entorno que use el código revisado. Exija cero `boundaryErrors` y todos los niveles geográficos esperados.
4. Genere, inspeccione y publique la entrega completa de artefactos de todas las soluciones/todas las AOI mediante [Métricas y artefactos en tiempo de ejecución](./metrics-and-artifacts.md).
5. Coordine el despliegue del código, las referencias de métricas/manifiesto, la configuración de identificación del frontend y el cambio de tráfico para que los usuarios no puedan combinar contratos de límites nuevos y anteriores.
6. Conserve para reversión el límite inmutable anterior, el código/las referencias, el archivo del manifiesto, los artefactos de métricas y los informes.

**Si la URL del límite debe seguir siendo mutable**

No existe un mecanismo atómico en el repositorio o en Blob que intercambie conjuntamente los bytes mutables y las referencias desplegadas. Programe un tiempo de inactividad coordinado o aísle el tráfico de la publicación; conserve tanto los bytes anteriores como el código/las referencias anteriores; reemplace los bytes; despliegue las referencias correspondientes; ejecute la prueba de fuente pública y la prueba de humo de generación real; publique la entrega completa de artefactos; y restablezca el tráfico solo después de la verificación integral. Si algún paso falla, restablezca los bytes anteriores y el código/las referencias anteriores mientras el tráfico permanece aislado.

### 5. Actualizar el manifiesto en tiempo de ejecución cuando cambie su contrato de límites

Si cambió la URL, la entrada de límite del manifiesto, la etiqueta, la categoría o el rol de cálculo, regenere y valide:

```bash
npm --prefix frontend run generate:layer-manifest
npm --prefix frontend run validate:layer-manifest
npm --prefix frontend run test:layer-manifest
```

Revise los informes de conciliación en `development-artifacts/layer-manifest/reports/` y luego publique:

```bash
npm --prefix frontend run publish:layer-manifest
```

Incluso cuando la URL no cambie, verifique que la configuración de identificación del frontend siga leyendo los campos de ID/nombre publicados. Los departamentos, municipios y SIRAP se configuran en `admin-boundary.service.ts`; RUNAP y OMEC se integran mediante el flujo de identificación del mapa y capas complementarias al pasar el puntero.

### 6. Recalcular cada solución con respecto al catálogo completo de AOI

No use `--solution-id` para cambiar un registro de límite. Genere todas las soluciones y fuerce el reemplazo de la salida de soluciones existente:

```bash
python data/metrics/python/metrics_pipeline/main.py \
  --output-dir data/metrics/generated/tier1 \
  --cache-dir data/metrics/cache/tier1 \
  --force
```

Si los bytes de límite publicados reemplazaron una URL existente y puede haber una descarga obsoleta, agregue también `--no-cache`. `--force` vuelve a calcular la salida; `--no-cache` vuelve a descargar los rásteres y límites de origen.

Siga [Métricas y artefactos en tiempo de ejecución](./metrics-and-artifacts.md) para conocer el procedimiento de generación en producción, inspección, ejecución de prueba, publicación, verificación remota, artefacto compacto/MEC derivado y reversión. Los comandos principales para artefactos regulares son:

```bash
python data/metrics/python/metrics_pipeline/inspect_metrics.py \
  --output-dir data/metrics/generated/tier1

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1 \
  --dry-run

python data/metrics/python/metrics_pipeline/publish.py \
  --output-dir data/metrics/generated/tier1

python data/metrics/python/metrics_pipeline/verify_artifacts.py \
  data/metrics/generated/tier1/publish-report.json
```

Si los artefactos compactos o MEC están habilitados en el manifiesto de destino, regenere y vuelva a publicar sus conjuntos afectados de todas las soluciones/todas las geografías como se describe allí.

### 7. Reconstruir artefactos activos de AOI personalizadas cuando cambien las entradas compartidas

Un cambio que afecte únicamente al catálogo de límites no modifica por sí mismo los polígonos personalizados. Si la misma publicación también modificó un ráster de cálculo o una fuente del manifiesto usada por FastAPI, reconstruya y reinicie el backend mediante [Métricas y artefactos en tiempo de ejecución](./metrics-and-artifacts.md). No suponga que la publicación precalculada de AOI conocidas actualiza un backend en ejecución.

### 8. Agregar un tipo de geografía completamente nuevo — proyecto de desarrollo

**Flujo de trabajo manual/incompleto:** no comience con una carga. Cree un plan de implementación revisado que abarque:

1. `AoiType` del frontend, estado de selección, controles de visibilidad, etiquetas y normalización de claves de caché de AOI conocidas;
2. fuente de identificación del mapa, propiedad de la capa, campos de ID/nombre, resaltado y comportamiento de elemento completo/componente;
3. una nueva clave geográfica de la canalización y un `BoundarySourceSpec`;
4. pruebas de suma de verificación de cierre seguro, CRS, número de elementos, campos obligatorios, catálogo, colección de geometrías y geometrías representativas;
5. esquema/rol de datos del manifiesto y cualquier entrada de límite;
6. caché compacta regular, fragmento MEC y aplicabilidad de objetivos de conservación;
7. comportamiento de FastAPI: consulta precalculada conocida, cálculo de polígono personalizado o ambos;
8. generación de métricas de todas las soluciones, pruebas del frontend, pruebas de paridad de métricas y UAT.

Solo después de que esos contratos se integren y prueben, los operadores deben publicar el límite y ejecutar una entrega completa.

## Efectos posteriores

- El ID de un registro se convierte en la clave de unión entre los resultados de identificación, `geographies.<level>`, las etiquetas de la UI, los artefactos compactos y los catálogos de alcance MEC. Cambiarlo puede hacer que las URL o los marcadores existentes no resuelvan métricas.
- El reemplazo de una fuente de límites invalida las referencias de todo el archivo, el catálogo, la colección de geometrías y, posiblemente, las geometrías representativas.
- Los nombres se incorporan en el documento precalculado de cada solución; cambiar un nombre es una publicación de métricas, no solo un cambio de etiqueta del mapa.
- SIRAP usa elementos combinados completos para la selección analítica. Los departamentos y municipios pueden seleccionar en la UI un componente de geometría sobre el que se hizo clic, mientras que las métricas precalculadas se vinculan al elemento de límite registrado; pruebe la paridad deliberadamente.
- Las capas de identificación de RUNAP y OMEC también admiten el comportamiento de selección y al pasar el puntero sobre el mapa. Un catálogo de métricas válido no demuestra que la detección de impactos del frontend funcione.
- La publicación del manifiesto controla la visibilidad y las URL de métricas. Cargar únicamente los bytes de límites no actualiza los metadatos ni las cachés del frontend.
- Las AOI personalizadas permanecen separadas: son polígonos arbitrarios calculados por FastAPI y no se agregan a estos catálogos.

## Lista de verificación

- [ ] Se registraron la fuente, la licencia, la fecha, el CRS, la transformación y el aprobador.
- [ ] Cada ID tiene contenido, es único, estable y usa el campo esperado.
- [ ] Cada nombre y propiedad obligatoria está presente.
- [ ] La geometría es válida; SIRAP contiene únicamente tipos de polígonos aprobados y elementos combinados.
- [ ] Se revisaron las referencias de todo el archivo, número de elementos, catálogo, colección de geometrías y geometrías representativas.
- [ ] `test_boundary_loader.py` pasa, incluida la prueba opcional de fuente pública con la URL y las referencias revisadas.
- [ ] `main.py --validate-only` pasa únicamente la validación del manifiesto y del catálogo de capas requeridas; no se registra como evidencia de límites.
- [ ] La generación real de una solución usa descargas nuevas, no informa `boundaryErrors` y contiene todos los niveles geográficos esperados.
- [ ] Se registraron la URL inmutable candidata, el código/las referencias revisados correspondientes, la evidencia de la prueba de humo y el cambio coordinado; o se aprobaron explícitamente el tiempo de inactividad/aislamiento de tráfico de la ruta mutable.
- [ ] Las pruebas/validación del manifiesto pasan y los informes de conciliación no tienen exclusiones inesperadas.
- [ ] La capa afectada representa e identifica el registro nuevo/actualizado en el navegador.
- [ ] El ID de AOI seleccionado en el frontend coincide exactamente con la clave geográfica y el ID de registro de las métricas.
- [ ] Se regeneraron todas las soluciones; el informe de publicación no contiene fallas ni omisiones de reanudación inesperadas.
- [ ] Los recuentos de bytes y valores SHA-256 de artefactos remotos coinciden con el informe de publicación local.
- [ ] Una AOI modificada y una AOI sin cambios de cada geografía afectada devuelven métricas plausibles.
- [ ] Un polígono personalizado sigue funcionando cuando cambian las entradas compartidas de cálculo activo y `/ready` del backend permanece en buen estado.
- [ ] Los bytes/URL del límite anterior, el código y las referencias, el archivo del manifiesto, los artefactos de métricas y los informes siguen disponibles para reversión.

## Reversión

Use [Métricas y artefactos en tiempo de ejecución](./metrics-and-artifacts.md) para conocer los detalles de reversión de cada familia de artefactos. La reversión de límites debe restablecer conjuntamente los bytes, la URL, el código y las referencias como un solo contrato coordinado:

1. Detenga toda publicación posterior y retire la aplicación del tráfico de la entrega si la identificación, la carga de límites o las métricas no coinciden.
2. Para la entrega inmutable preferida, vuelva a desplegar el código/las referencias anteriores revisados que apuntan al límite inmutable anterior conservado. No sobrescriba el candidato fallido solo para imitar una reversión.
3. Para una ruta mutable obligatoria, mantenga el tráfico aislado mientras restablece los bytes anteriores y el código/las referencias anteriores. Ninguna de las partes puede exponerse de forma segura por sí sola y no existe un mecanismo de intercambio atómico.
4. Restablezca el manifiesto anterior en tiempo de ejecución:

```bash
npm --prefix frontend run rollback:layer-manifest
```

5. Vuelva a publicar el directorio y el informe conservados de la generación de métricas anterior, o restablezca sus referencias inmutables, siguiendo el procedimiento de métricas/artefactos. Las métricas no tienen un archivo automático; la reversión solo es posible si las salidas locales anteriores o la entrega inmutable siguen disponibles.
6. Si cambiaron las entradas compartidas de FastAPI, reconstruya el conjunto anterior de artefactos en tiempo de ejecución que se sabe que funciona y fuerce la recreación del contenedor.
7. Repita la prueba de límites de fuente pública, una prueba de humo de generación real sin errores de límites y con todos los niveles esperados, las comprobaciones de identificación, las comprobaciones de métricas de AOI conocidas, las sumas de verificación remotas y las comprobaciones de disponibilidad antes de restablecer el tráfico.

## Limitaciones y escalamiento

- Las cargas genéricas de departamentos, municipios, SIRAP, OMEC y límites no están automatizadas.
- El script de SIRAP reproduce una reparación de polígonos fijada mediante suma de verificación; no es un generador general de ingesta o catálogo de SIRAP.
- OMEC no tiene un flujo de trabajo de reconstrucción dedicado. Escale al desarrollador de datos.
- El cálculo/la actualización de referencias no es un comando para operadores. Escale en lugar de omitir las comprobaciones de cierre seguro.
- No es posible regenerar una sola AOI de forma independiente; la unidad de salida es un documento de solución completo.
- Agregar un tipo de geografía requiere cambios coordinados en la aplicación, la canalización, el manifiesto, los artefactos y las pruebas.
- El reemplazo de límites mutables y el despliegue de código/referencias no tienen un mecanismo de cambio atómico; exija URL inmutables o aislamiento coordinado del tráfico.
- No existe un archivo automático de métricas ni un proceso probado de recuperación ante desastres de Blob. Exija entregas inmutables conservadas o informes locales antes de publicar.
- Escale cualquier discrepancia entre los ID de identificación, los ID de catálogo, el comportamiento de selección de geometría, los roles del manifiesto y las claves precalculadas; estas son fallas de contrato, no problemas de caché del navegador.
