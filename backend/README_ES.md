# Decision Making Tool (Herramienta de Toma de Decisiones) — Backend

Versión en inglés: [README.md](README.md). La referencia detallada de la API (variables de entorno, endpoints, operación en la VM) está en la versión en inglés y en la entrega a TI de Parques: [`docs/handoffs/parques-it/spanish/`](docs/handoffs/parques-it/spanish/).

La Herramienta de Toma de Decisiones es una plataforma de priorización espacial para la conservación en Colombia. Las personas comparan soluciones de conservación en un mapa. Este repositorio contiene todo lo que hay detrás de la app web:

- el contenedor de la **API de métricas** (Metrics API), que calcula métricas en vivo para un polígono que alguien dibuja y firma URLs de descarga;
- el **pipeline de métricas**, que precalcula los números de las áreas conocidas y los publica en Vercel Blob (almacenamiento de objetos público);
- las **herramientas de layer-manifest**, que publican los índices JSON que apuntan la app web hacia esos archivos.

La app web vive en el repositorio frontend. Lee los números precalculados directamente desde Blob y llama a esta API solo para polígonos personalizados.

No se deben registrar en Git secretos, archivos `.env` locales, rásteres pesados, cachés generadas ni artefactos de métricas de producción empaquetados. Los artefactos de ejecución van en `runtime-artifacts/` localmente, o en un directorio montado configurado por variables de entorno.

## Estructura de directorios

| Directorio | Descripción |
|-----------|-------------|
| `app/` | Aplicación FastAPI — métricas de polígono personalizado, trabajos de especies, servicio de firma de URLs de Blob |
| `scripts/` | Hydrate, constructores de artefactos de ejecución, constructor del catálogo de descargas, ayudantes de publicación |
| `tests/` | Pruebas de la API (`pytest`) |
| `docker/`, `Dockerfile`, `docker-compose.yml` | El contenedor de la API de métricas |
| `artifacts/` | Contrato de artefactos de ejecución y el pequeño fixture (dato de prueba) registrado |
| `data/metrics/python/` | El pipeline de métricas (`metrics_pipeline/`), sus pruebas y su propio `requirements.txt` |
| `data/metrics/fixtures/`, `data/metrics/release-specs/` | Fixtures del pipeline y contratos de lanzamiento |
| `data/scripts/` | Scripts puntuales de preparación de datos |
| `layer-manifest/` | Herramientas en Node.js que construyen, publican y revierten manifiestos de capas e índices de lanzamiento de catálogo |
| `docs/` | Arquitectura, glosario, hallazgos y la entrega a TI de Parques (`docs/handoffs/parques-it/`, inglés y español) |
| `runtime-artifacts/`, `runtime-cache/`, `secrets/` | Solo locales; ignorados por Git y Docker |

## Arquitectura

La API de métricas es un servicio de FastAPI (framework web de Python) con una tarea principal: calcular métricas de conservación para un **polígono personalizado** que alguien dibujó en el mapa. La mayor parte de lo que muestra la app — números de AOI (Area of Interest / Área de Interés) conocidas, definiciones de capas, soluciones — viene directamente de manifiestos servidos desde Blob (ver "Qué es 'el catálogo'" más abajo). Para esa tarea, la API necesita saber qué rásteres y matrices de especies cargar — eso es lo que le indica `manifest.json`:

- **`manifest.json` — el registro de una versión del catálogo.** Es el archivo que lee hydrate. Enumera cada ráster (cobertura de suelo, áreas protegidas, carbono, agua, etc.), las matrices de especies, la grilla de referencia y checksums para **una versión específica del catálogo** — hoy **3.7.0** (`releases/catalog-v3-7-0/manifest.json` en Vercel Blob). `DMT_MANIFEST_URL` (con `MANIFEST_BLOB_URL` como respaldo) le dice a la API de qué versión hidratar.
- **Endpoints de AOI en vivo — lo que corre al hacer clic.** Una vez que hydrate llenó el volumen, la API responde:
  - `POST /metrics/custom-polygon` — recibe un polígono GeoJSON, lo rasteriza sobre la grilla de referencia y devuelve métricas (área, cobertura de suelo, áreas protegidas, carbono, agua, ecosistemas, y más) calculadas **en vivo**.
  - `POST /area-profile/custom-polygon` más un par de rutas `species-coverage/jobs` — desgloses de especies/ecosistemas, ejecutados como trabajos en segundo plano (una cola SQLite en disco).
  - `GET /health` — el proceso está activo. `GET /ready` — el artefacto cargado (y el worker de especies) son utilizables; devuelve `503` si hydrate todavía no se ha ejecutado.
- **Punto de entrada:** `app/main.py`. Al arrancar, un lifespan hook (función que corre al iniciar/apagar el proceso) llama a `warmup_artifacts()`, que carga los rásteres y matrices hidratados en una caché en memoria (`app/artifacts.py`).
- **Calculadoras compartidas, sin lógica duplicada:** la API importa sus fórmulas desde `data/metrics/python/metrics_pipeline`, el mismo paquete que usa el pipeline offline (sección 2) para precalcular los números de AOI conocidas.

Stack: FastAPI, Pydantic, rasterio (entrada/salida de rásteres), NumPy, Shapely/PyProj (geometría). Herramientas de lanzamiento: Node.js 22.

## 1. Levantar la API

Necesitas Docker, salida HTTPS hacia Blob público, y una copia de `.env.example` → `.env`. Compose carga `.env` (ignora `.env.local`). Los archivos de llaves de cuentas de servicio van en `secrets/`.

Hydrate (hidratar) descarga los rásteres y matrices de especies que la API usa para los polígonos personalizados. Publicar nuevas métricas de AOI conocidas es una tarea separada (sección 2).

```bash
# Primero: llenar el volumen de artefactos (unos 15–25 minutos la primera vez)
docker compose run --rm --build backend hydrate

# Luego: iniciar la API
docker compose up -d --build
```

| Verificación | Significado |
|-------|---------|
| `curl http://localhost:8000/health` | El proceso está activo |
| `curl http://localhost:8000/ready` | Hydrate terminó. **503** significa que el volumen está vacío — corre hydrate primero |

Hydrate sin flags usa la grilla de solución terrestre EPSG:9377. Flags opcionales: `--production-v3` (build de producción Mesa / inmutable) y `--reference-grid ecosistemas` (EPSG:4326 legado).

**Conectar el frontend:** el contenedor del frontend hace proxy de `/metrics-api/` hacia su `METRICS_API_UPSTREAM`. Apúntalo a la URL de esta API, **o** integra en el build del frontend `METRICS_API_BASE_URL` con el origen completo de esta API y agrega el origen del frontend en `DMT_CORS_ORIGINS` aquí.

## Qué es "el catálogo"

La gente usa "catálogo" para tres archivos distintos.

```
Índice diminuto de lanzamiento de catálogo   ← el frontend empieza aquí
        │
        ├── manifest.json nacional  ← capas + 172 soluciones + URLs a JSON de métricas
        └── manifest.json de SIRAP  ← 56 soluciones regionales + URLs a JSON de métricas
```

SIRAP es Sistema Regional de Áreas Protegidas.

- Un **lanzamiento de catálogo** (catalog release) es el índice diminuto (por ejemplo `catalog-releases/3.7.1/catalog-release-index.json`). Enumera los `manifestUrl` de cada lote (batch): hoy, nacional y SIRAP.
- Un **manifiesto de lote** (batch manifest) es el JSON grande: capas del mapa, soluciones y `precomputedMetricUrls` (métricas compactas, metas, fragmentos MEC, fragmentos de cobertura de especies).
- El **manifiesto de capas en vivo** (`manifest/manifest.json`) es un tercer archivo. Hydrate lo lee. Puede incluir `hydrationPackage`, que `npm run generate:layer-manifest` expande a partir de la plantilla `layer-manifest/shared/hydration-package.json`.

Las copias registradas de los índices viven en `layer-manifest/catalog-releases/`. No existe un `latest.json` que siga automáticamente la versión más reciente.

### Los dos punteros (fáciles de confundir)

| Qué cambia | Variable de entorno | Qué mueve |
|-------------------|----------------------|------------|
| **Lo que muestra la app web** | Repositorio frontend: `CATALOG_RELEASE_INDEX_BLOB_URL` (build Docker/Vercel) y `catalogReleaseIndexBlobUrl` en `src/environments/environment.ts` (`yarn start`) | Soluciones, números de AOI conocidas |
| **Contra qué calculan los polígonos personalizados** | Este repositorio: `MANIFEST_BLOB_URL` o `DMT_MANIFEST_URL` en `.env` | Receta de hydrate (`hydrationPackage`) |

Actualiza solo el puntero de la superficie que cambió. Nuevos números de AOI conocidas → puntero del frontend y reconstruir el frontend. Nuevos rásteres o matrices de AOI personalizada → puntero de hydrate (o publicar `manifest/manifest.json`) y volver a correr hydrate.

## 2. Publicar nuevas métricas

El lanzamiento de métricas es una secuencia de constructores de artefactos, no un solo script. Python calcula los datos. Los scripts de manifiesto en Node.js solo apuntan la app hacia datos ya calculados.

Configuración inicial en la máquina que publica:

```bash
# Pipeline de métricas (Python)
cd data/metrics/python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../../..

# Herramientas de layer-manifest (Node.js 22)
npm ci
```

Publicar requiere `BLOB_READ_WRITE_TOKEN` en `.env.local` dentro de esta carpeta (ver `.env.example`). Los scripts solo informan si el token está presente, nunca su valor.

| Paso | Script | Qué produce |
|------|--------|-------------|
| 1. Métricas regulares detalladas | `main.py` | Un documento de métricas por solución: área y prioridad, uso del suelo, carbono, agua, áreas protegidas, áreas sociales/de gobernanza, resúmenes marinos y de ecosistemas, `conservation_goals_met` y los diez resúmenes de especies terrestres. `--skip-species` deja esos diez sin terminar. |
| 2. Desgloses de cobertura de especies | `run_species_goals_full_build.py` con `species_goals.py` | Registros por especie para cada solución y geografía (ventanas emergentes de especies). No escribe los diez resúmenes regulares. |
| 3. Reconciliar resúmenes de especies diferidos | Todavía no existe un comando completo | Necesario después de `main.py --skip-species`. Un lanzamiento de producción no debe tratar especies omitidas como completas. |
| 4. Desgloses de cobertura de ecosistemas | `mec_compact.py` | Fragmentos MEC (Mapa de Ecosistemas de Colombia) por solución y geografía, solo terrestres. |
| 5. Desgloses de metas de conservación | `conservation_goals.py` | Convierte los CSV resumen de Prioritizr en registros de meta, cubierto, déficit y cumplido. |
| 6. Métricas regulares compactas | `compact_metrics.py` | El formato pequeño que cargan los paneles. Solo cambia el formato. |
| 7. Inspeccionar, ensamblar, publicar y verificar | `inspect_metrics.py`, `assemble_solution_release.py`, `publish.py`, `verify_artifacts.py` | Valida, ensambla, sube a Blob y verifica los bytes subidos. Usa `publish.py --dry-run` primero. |
| 8. Actualizar los manifiestos de la app | `layer-manifest/*.mjs` (scripts `npm run …` en `package.json`) | Apunta la app hacia los artefactos publicados. No calcula métricas. |

Rehidrata solo cuando cambiaron las entradas de AOI personalizada (`docker compose run --rm --build backend hydrate`, luego `docker compose up -d --build --force-recreate`).

Algunos scripts de manifiesto también leen o escriben en el checkout del frontend (el manifiesto de vista previa local y la lista de capas de la barra lateral). Lo esperan junto a esta carpeta en `../frontend`; define `DMT_FRONTEND_DIR` si vive en otro lugar.

Prefiere **nuevas rutas de Blob** (un nuevo prefijo de lanzamiento e índice) cuando cambien los números. El JSON de métricas se cachea por mucho tiempo.

Sintaxis completa de comandos y flags: [`docs/handoffs/parques-it/spanish/`](docs/handoffs/parques-it/spanish/) y [`docs/handoffs/parques-it/english/data-operations/metrics-and-artifacts.md`](docs/handoffs/parques-it/english/data-operations/metrics-and-artifacts.md).

## Pruebas

```bash
python -m pytest                                  # API
(cd data/metrics/python && python -m pytest)      # pipeline de métricas
npm run check:layer-manifest                      # herramientas de layer-manifest
```

## Despliegue

```bash
docker build -t dmt-backend .
docker build --platform linux/amd64 -t dmt-backend:amd64 .
```

El contexto de build es esta carpeta. La imagen contiene la API, el paquete del pipeline de métricas y los contratos de lanzamiento; los rásteres de producción se hidratan en un volumen montado al ejecutar.
