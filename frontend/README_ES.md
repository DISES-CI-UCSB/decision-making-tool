# Decision Making Tool (Herramienta de Toma de Decisiones) — Frontend

Versión en inglés: [README.md](README.md).

La Herramienta de Toma de Decisiones es una plataforma de priorización espacial para la conservación en Colombia. Las personas comparan soluciones de conservación en un mapa. Este repositorio es la app web en Angular.

Los números del panel para áreas **conocidas** (nacional, departamentos, municipios, etc.) están **precalculados** y se leen directamente desde Vercel Blob (almacenamiento de objetos público). Cuando alguien **dibuja un polígono personalizado**, la app le pide a la API de métricas (repositorio backend) que calcule esas métricas en vivo.

## Estructura de directorios

| Carpeta | Propósito |
| --- | --- |
| `src/` | Código de la aplicación |
| `public/` | Recursos estáticos servidos por Angular |
| `public/data/layer-manifest/` | Copia local, solo de desarrollo, del manifiesto de capas publicado (ignorada por Git) |
| `scripts/manifest/` | Descarga y revisa esa copia local |
| `scripts/config/` | Escribe el archivo de entorno de producción a partir de variables de build |
| `feature-tests/` | Pruebas de comportamiento (Feature Behavior Tests), su ejecutor y su catálogo (con su propio `package.json`) |
| `docs/` | Documentos de diseño de producto, notas de maquetas y retroalimentación |
| `firestore.rules`, `firebase.json` | Reglas de seguridad de Firestore y su configuración de emulador |
| `.husky/` | Hook de Git pre-commit (lint-staged) |

## Arquitectura

La app es una SPA (Single Page Application / Aplicación de Página Única) en Angular: toda la interfaz corre como una sola página que intercambia contenido, sin recargas completas. Tiene tres piezas principales:

- **App shell** (`app.html`, `app-shell.ts`) — un layout de tres columnas redimensionable: barra lateral izquierda, mapa central, barra lateral derecha. Un componente raíz (`App`) lo ensambla y controla los modales (pantalla de bienvenida, Buscador de Soluciones).
- **Áreas de funcionalidad**, cada una en su carpeta bajo `src/app/features/`:
  - `solution-finder/` — el cuestionario guiado que asocia las respuestas con uno de los ~170 escenarios de conservación pre-construidos.
  - `left-sidebar/` — controles para activar capas de referencia (ecosistemas, especies, costos, límites).
  - `map/` — el mapa de ArcGIS: rásteres de solución, dibujo de AOI (Áreas de Interés) personalizadas, clics sobre límites administrativos.
  - `analysis/` — las pestañas Overview / AOI / Comparison (Resumen / AOI / Comparación) de la barra lateral derecha y sus métricas.
  - `auth/` — login con Firebase, control de acceso por nivel, solicitudes de acceso SIRAP (Sistema Regional de Áreas Protegidas).
- **Estado compartido** — un único servicio inyectable, `AppStateService` (`core/services/app-state.service.ts`), guarda el estado transversal (solución activa, AOI seleccionada, modo de la barra lateral derecha) con signals de Angular (un contenedor de valores reactivo, similar a un Observable pero más simple). Cada panel lee y escribe en este servicio en lugar de comunicarse directamente entre sí.

**El flujo de datos sigue la separación precalculado-vs-en-vivo:** los números de AOI conocidas y las definiciones de capas vienen de manifiestos JSON versionados en Vercel Blob; los rásteres de solución son `ImageryTileLayer`s de ArcGIS construidos a partir de archivos COG (Cloud Optimized GeoTIFF / GeoTIFF Optimizado para la Nube); las métricas de polígonos personalizados pasan por la API de métricas.

Stack: Angular (componentes standalone), Tailwind CSS, ArcGIS Maps SDK for JavaScript, ngx-translate para i18n en inglés/español, Firebase Auth.

## Ejecutar localmente

El proyecto usa Yarn 4 mediante Corepack. Si solo tienes npm, corre `corepack enable` primero.

```bash
yarn install
yarn start
```

Abre `http://localhost:4200/`. Firebase Auth está vinculado a `localhost`; `127.0.0.1` fallará al iniciar sesión.

Los polígonos personalizados pasan por `proxy.conf.json` hacia la API de métricas **remota** (`https://api.decision-making-support-tool.xyz`), así que puedes dibujar áreas sin correr el backend. Para usar un backend local, apunta ese proxy (o `metricsApiBaseUrl`) hacia él.

## Configuración

Copia `.env.example` → `.env.production.local` para builds locales; en CI, define los mismos nombres como variables de compilación. Todos los valores son opcionales; los vacíos mantienen la configuración de Firebase de producción registrada y los catálogos por defecto.

**Qué catálogo muestra la app** es un solo puntero: `CATALOG_RELEASE_INDEX_BLOB_URL` para builds de producción, y `catalogReleaseIndexBlobUrl` en `src/environments/environment.ts` para `yarn start`. Mantenlos sincronizados. El repositorio backend publica los catálogos y explica cómo encajan ("Qué es 'el catálogo'" en su README).

**Excepción conocida:** si un lanzamiento introduce un ID de capa que la barra lateral izquierda no conoce, actualiza también `LAYER_ID_SYNONYM_GROUPS` en `src/app/features/left-sidebar/map-layers-panel/map-layers-panel.utils.ts`. Esa tabla de alias está codificada a mano.

## Pruebas

```bash
yarn lint
yarn test                    # pruebas unitarias (Vitest)
yarn test:manifest-preview   # scripts del manifiesto de vista previa local
yarn test:firestore-rules    # requiere Java para el emulador de Firestore
```

Las pruebas de comportamiento viven en `feature-tests/`, con sus propias dependencias:

```bash
cd feature-tests
npm ci
npm run test:view-test-catalog   # ver cada prueba y su último resultado
npm run test:gate                # compuerta de lanzamiento completa
```

Algunas pruebas de descargas inician una API de métricas local. Esperan el checkout del backend junto a esta carpeta en `../backend` (o define `DMT_TEST_BACKEND_DIR`) y leen las llaves de cuentas de servicio de la carpeta `secrets/` de ese checkout.

## Build

```bash
yarn build:vercel
```

Escribe el archivo de entorno de producción y corre `ng build` hacia `dist/eco-plan/browser/`. `METRICS_API_BASE_URL` apunta las solicitudes de polígonos a la API de métricas; si se omite, producción usa la ruta `/metrics-api` del mismo origen, que solo Vercel reescribe (`vercel.json`). Usa el origen completo de la API (por ejemplo `https://test-priorizandolanaturaleza-api.parquesnacionales.gov.co`); el backend debe listar el origen de esta app en su `DMT_CORS_ORIGINS`.

## Despliegue

El frontend es un sitio estático, no un contenedor. Un pipeline de CI/CD solo necesita:

1. `yarn install --immutable` (Node.js 22, Yarn 4 mediante Corepack; `yarn.lock` está registrado en Git)
2. `yarn build:vercel` con las variables de compilación de `.env.example` definidas en el entorno
3. Servir `dist/eco-plan/browser/` como archivos estáticos, respondiendo `index.html` a cualquier ruta desconocida (la app usa enrutamiento del lado del cliente)

Vercel lo hace automáticamente en cada push (`vercel.json`, `.vercelignore`).

## Hooks de Git

Corre `yarn prepare` una vez después de clonar para instalar el hook pre-commit, que corre lint-staged sobre los archivos cambiados.
