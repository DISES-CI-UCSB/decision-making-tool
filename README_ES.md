# Decision Making Tool (Herramienta de Toma de Decisiones)

Una plataforma de priorización espacial para la conservación en Colombia. Las personas comparan soluciones de conservación en un mapa.

Los números del panel de control para áreas **conocidas** (nacional, departamentos, municipios, etc.) están **precalculados** en Vercel Blob (almacenamiento de objetos público de Vercel) público. Cuando alguien **dibuja un polígono personalizado**, el backend (servidor) calcula esas métricas en vivo a partir de rásteres y matrices de especies en su volumen local.

Este README cubre dos tareas:

1. **Levantar la app** — hidratar esos datos de polígono personalizado, luego iniciar los servidores.
2. **Publicar nuevas métricas** y apuntar la app hacia ellas.

Cada proceso abre **una URL que configuraste**.

## Estructura de directorios

| Directorio | Descripción |
|-----------|-------------|
| `frontend/` | App de Angular — mapa, buscador de soluciones, paneles de análisis |
| `frontend/layer-manifest/` | Esquema y scripts para manifiestos de capas e índices de lanzamiento de catálogo |
| `backend/` | FastAPI — métricas de AOI (Area of Interest / Área de Interés) personalizada desde un volumen de rásteres hidratado |
| `data/` | Capas fuente, rásteres de solución y el pipeline de métricas |
| `docs/` | Documentos de diseño y entregas de TI a Parques |
| `development-artifacts/` | Experimentos y maquetas |
| `legacy-r-shiny-app/` | App de Shiny archivada |

## Arquitectura del frontend

El frontend (`frontend/`) es una SPA (Single Page Application / Aplicación de Página Única) hecha en Angular — toda la interfaz corre como una sola página que intercambia contenido, sin recargas completas. Tiene tres piezas principales:

- **App shell** (`app.html`, `app-shell.ts`) — un layout de tres columnas redimensionable: barra lateral izquierda, mapa central, barra lateral derecha. Un componente raíz (`App`) lo ensambla y controla los modales (pantalla de bienvenida, Buscador de Soluciones).
- **Áreas de funcionalidad**, cada una en su propia carpeta bajo `features/`:
  - `solution-finder/` — el cuestionario guiado que asocia las respuestas del usuario con uno de los ~170 escenarios de conservación pre-construidos.
  - `left-sidebar/` — controles para activar capas de referencia (ecosistemas, especies, costos, límites).
  - `map/` — el mapa de ArcGIS en sí: renderizado de rásteres de solución, dibujo de AOI personalizadas, clics sobre límites administrativos.
  - `analysis/` — las pestañas Overview / AOI / Comparison (Resumen / AOI / Comparación) de la barra lateral derecha y sus métricas.
  - `auth/` — login con Firebase, control de acceso por nivel, solicitudes de acceso SIRAP.
- **Estado compartido** — un único servicio inyectable, `AppStateService` (`core/services/app-state.service.ts`), guarda el estado transversal (solución activa, AOI seleccionada, modo de la barra lateral derecha) usando signals de Angular (un contenedor de valores reactivo, similar a un Observable pero más simple de leer). Cada panel lee y escribe en este mismo servicio en lugar de comunicarse directamente entre sí — eso es lo que mantiene sincronizados tres paneles de interfaz independientes.

**El flujo de datos refleja la misma separación precalculado-vs-en-vivo mencionada arriba:** los números de AOI conocidas y las definiciones de capas vienen de manifiestos JSON versionados en Vercel Blob (ver "Qué es 'el catálogo'"); los rásteres de solución son `ImageryTileLayer`s de ArcGIS construidos a partir de archivos GeoTIFF (GeoTIFF Optimizado para la Nube); las métricas de polígonos personalizados pasan por el backend de FastAPI descrito abajo.

Stack: Angular (componentes standalone, sin NgModules heredados), Tailwind CSS, ArcGIS Maps SDK for JavaScript (kit de desarrollo de software), ngx-translate para i18n en inglés/español, Firebase Auth.

## 1. Levantar la app

Necesitas Docker Desktop, salida HTTPS hacia Blob público, y una copia de `.env.example` → `.env`. El Compose raíz carga `.env` y `backend/.env` (ignora `.env.local`). Completa Firebase en `.env` si necesitas login.

Hydrate (hidratar) descarga los rásteres y matrices de especies que el backend usa para calcular puntajes de polígonos personalizados. Publicar nuevas métricas de AOI conocidas es una tarea separada, en la sección 2.

```bash
# Primero: llenar el volumen del backend (unos 15–25 minutos la primera vez)
docker compose run --rm --build backend hydrate

# Luego: iniciar ambos contenedores
docker compose up --build
```

Abre **http://localhost:8080/**. Firebase Auth (autenticación de Firebase) está vinculado a `localhost`; `127.0.0.1` fallará al iniciar sesión.

| Verificación | Significado |
|-------|---------|
| `curl http://localhost:8000/health` | El proceso está activo |
| `curl http://localhost:8000/ready` | Hydrate terminó. **503** significa que el volumen está vacío — corre hydrate primero |
| `curl http://localhost:8080/metrics-api/ready` | El proxy del frontend puede alcanzar ese mismo backend |

Hydrate sin flags (banderas) en el `docker-compose.yml` raíz usa la grilla de solución de suelo EPSG:9377 (sistema de referencia de coordenadas). Flags opcionales de hydrate: `--production-v3` (build de producción Mesa / inmutable) y `--reference-grid ecosistemas` (EPSG:4326 legado). `backend/docker-compose.yml` es un archivo Compose solo para el backend con controles de runtime (tiempo de ejecución) de Mesa más estrictos; usa el archivo raíz para el primer arranque.

**Solo UI:** `cd frontend && yarn install && yarn start` → http://localhost:4200. Los números de AOI conocidas se cargan desde Blob. Los polígonos personalizados pasan por `frontend/proxy.conf.json` hacia la API de métricas **remota** (`https://api.decision-making-support-tool.xyz`), así que puedes dibujar áreas sin Docker local. Para apuntar a un backend local en su lugar, configura ese proxy (o `metricsApiBaseUrl`) hacia él.

### Dos contenedores

| Contenedor | Puerto | Tarea |
|-----------|------|-----|
| `frontend` | 8080 | Sirve la SPA (Single Page Application / Aplicación de Página Única). Hace proxy de `/metrics-api/` hacia el backend. |
| `backend` | 8000 | Cálculos de AOI personalizada. Necesita el volumen hidratado. |

Si más adelante los corres como repositorios separados, configura `METRICS_API_UPSTREAM` en el contenedor del frontend (destino de nginx; el valor por defecto `http://backend:8000` solo funciona en una red Compose compartida), **o** integra `METRICS_API_BASE_URL` con un origen de backend completo y configura `DMT_CORS_ORIGINS` en el backend.

Hydrate solo necesita salida HTTPS hacia Blob público. Un token de escritura es para publicar más adelante.

## Qué es "el catálogo"

La gente usa "catálogo" para referirse a tres archivos distintos.

```
Índice diminuto de lanzamiento de catálogo   ← el frontend empieza aquí
        │
        ├── manifest.json nacional  ← capas + 172 soluciones + URLs a JSON de métricas
        └── manifest.json de SIRAP  ← 56 soluciones regionales + URLs a JSON de métricas
```

SIRAP es Sistema Regional de Áreas Protegidas.

- Un **lanzamiento de catálogo** (catalog release) es el índice diminuto (hoy `catalog-releases/3.0.6/catalog-release-index.json`). Enumera los `manifestUrl` de cada lote (batch). Valor por defecto actual: **dos** lotes, nacional y SIRAP. El formato permite más o menos.
- Un **manifiesto de lote** (batch manifest) es el JSON grande: capas del mapa, soluciones, y `precomputedMetricUrls` (métricas compactas, metas, fragmentos de geografía MEC, fragmentos de cobertura de especies). Esos fragmentos son **otros** archivos JSON. El manifiesto es un índice de esos archivos.
- El **manifiesto de capas en vivo** (`manifest/manifest.json`) es un tercer archivo. Hydrate lo lee. Puede incluir `hydrationPackage` (grilla, matrices de especies, rutas de capas de métricas). `generate:layer-manifest` expande ese paquete a partir de la plantilla editada a mano `frontend/shared/hydration-package.json`.

Eliges una versión apuntando una URL hacia un índice diminuto. Las copias registradas viven en `frontend/layer-manifest/catalog-releases/` (3.0.1–3.0.6). No existe un `latest.json` que rastree automáticamente la versión más reciente.

Nombra los futuros catálogos con una versión (`3.0.7`, una fecha). `*-land-use-aoi-test` es una ruta remanente que 3.0.6 todavía enumera. "Probado localmente" significa que apuntaste tu entorno hacia una URL candidata, y luego convertiste esa misma URL en la oficial.

### Los dos punteros (fáciles de confundir)

| Quién debería cambiarlo | Variable de entorno | Valor por defecto si está vacío | Qué mueve |
|-------------------|----------------------|------------------|------------|
| **Lo que muestra la SPA** | `CATALOG_RELEASE_INDEX_BLOB_URL` en `.env` (build de Docker/Vercel). Para `yarn start`, también `catalogReleaseIndexBlobUrl` en `frontend/src/environments/environment.ts`. | `https://aagibolq28slyfof.public.blob.vercel-storage.com/catalog-releases/3.0.6/catalog-release-index.json` | Soluciones, números del panel de AOI conocidas |
| **Contra qué calculan los polígonos personalizados** | `MANIFEST_BLOB_URL` o `DMT_MANIFEST_URL` en `.env` / `backend/.env` | `https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/catalog-v3-2-0/manifest.json` | Receta de hydrate (`hydrationPackage`) |

Estos nombres se desalinearon con el tiempo. Como regla mental: la primera variable = **índice de catálogo del frontend**, la segunda = **manifiesto de capas de hydrate**. Actualiza solo el puntero de la superficie que cambió.

- Nuevos números de panel / AOI conocidas, misma grilla de AOI personalizada → cambia el puntero del **frontend**, reconstruye el frontend. Omite hydrate si las entradas de `hydrationPackage` no cambiaron.
- Nuevos rásteres de AOI personalizada o matrices de especies, mismo catálogo de la SPA → cambia el puntero de **hydrate** (o publica el `manifest/manifest.json` en vivo) y vuelve a correr hydrate.
- Cambio oficial de ambos → actualiza ambos, reconstruye el frontend, corre hydrate.

`yarn start` sin más lee `environment.ts`. Mantén ese archivo sincronizado con el puntero oficial del frontend, a menos que estés previsualizando deliberadamente otro catálogo.

## 2. Publicar nuevas métricas

El pipeline **calcula archivos**. Apuntar la app hacia ellos es un paso posterior. `main.py` es la calculadora.

Secuencia típica (comandos y flags: `docs/handoffs/parques-it/english/data-operations/metrics-and-artifacts.md`):

1. **Calcular** — `data/metrics/python/metrics_pipeline/main.py` (venv, entorno virtual, en `data/metrics/python/.venv`).
2. **Inspeccionar, simular (dry-run), publicar, verificar** esa salida detallada con `inspect_metrics.py`, `publish.py`, `verify_artifacts.py`. Publicar necesita un token de escritura de Blob en `.env.local`.
3. **Compactar** — `compact_metrics.py`, luego el mismo paso de inspeccionar / publicar / verificar sobre los archivos compactos (estos son los que cargan los paneles).
4. **MEC, metas, y cobertura de especies** — `mec_compact.py`, `conservation_goals.py`, y `species_goals.py` escriben archivos locales. Sube esos manualmente.
5. **Conectar los enrutadores (routers)** (dos superficies)
   - **SPA / números de AOI conocidas:** publica los manifiestos de **lote** (batch) nacional y de SIRAP, grandes, cuyos `precomputedMetricUrls` coincidan con los archivos nuevos. Para una nueva versión de catálogo, publica también un **nuevo índice diminuto** en `catalog-releases/<version>/catalog-release-index.json` (ese archivo enumera los lotes para **esa** versión). Apunta `CATALOG_RELEASE_INDEX_BLOB_URL` y, para un lanzamiento oficial, `environment.ts` hacia él. Reconstruye el frontend.
   - **Polígonos personalizados:** `yarn --cwd frontend generate:layer-manifest` actualiza `hydrationPackage` a partir de `frontend/shared/hydration-package.json`. `publish:layer-manifest` actualiza el `manifest/manifest.json` en vivo — el archivo que lee hydrate.
6. **Rehidratar** solo si cambiaron las entradas de AOI personalizada (`docker compose run --rm --build backend hydrate`, luego `docker compose up -d --build --force-recreate`).

Prefiere **nuevas rutas de Blob** (un nuevo prefijo de lanzamiento e índice diminuto) cuando los números cambien. El JSON de métricas se cachea por mucho tiempo, así que sobrescribir la misma URL puede dejar a los navegadores con bytes antiguos. Un refresco forzado (hard refresh) es solo tal vez una solución.

Un lanzamiento normal usa los pasos anteriores. `publish_land_use_aoi_test_catalog.py` es un script antiguo, puntual, que escribe prefijos `*-land-use-aoi-test` a propósito.

## Despliegue

Vercel todavía despliega automáticamente el frontend en cada push. Docker, arriba, es la ruta de auto-hospedaje (ambos contenedores).

```bash
docker build -f backend/Dockerfile -t dmt-backend .
docker build --platform linux/amd64 -f backend/Dockerfile -t dmt-backend:amd64 .
docker build -f frontend/Dockerfile -t dmt-frontend .
docker build --platform linux/amd64 -f frontend/Dockerfile -t dmt-frontend:amd64 .
```

CI (Integración Continua) construye ambas imágenes en `ubuntu-latest` (x86) y prueba `/health` más `/ready` contra un fixture (dato de prueba) pequeño.

## Tecnologías clave

- **Frontend**: Angular, TypeScript, Tailwind CSS, ArcGIS Maps SDK (kit de desarrollo de software)
- **Backend**: FastAPI, Python
- **Mapas**: @arcgis/core, @arcgis/map-components
- **Datos**: rásteres GeoTIFF, metadatos CSV, i18n (internacionalización, inglés/español)
- **Despliegue**: Vercel (frontend), Docker Compose (frontend + backend auto-hospedados)
