# Decision Making Tool Frontend

Angular web application for the DISES Decision Making Tool.

## Project-specific folders

| Folder                        | Purpose                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `src/`                        | Active application code                                                      |
| `public/`                     | Static assets and local development mirrors served by Angular                |
| `public/data/layer-manifest/` | Development-only cache location for the generated Blob layer manifest        |
| `layer-manifest/`             | Committed schema, template, and validator for the Blob-backed layer manifest |
| `scripts/data-deploy/`        | Frequently used sync/validation scripts for current frontend deploy assets   |

Large geospatial layer assets are transitioning from repo-local files to Vercel Blob storage. The committed manifest contract lives in `layer-manifest/`; the generated development manifest lives at `public/data/layer-manifest/manifest.json` and is intentionally ignored.

## Development server

To start a local development server, run:

```bash
npm start
```

`npm start` syncs current local solution and boundary assets into `public/data/` before running `ng serve`. Once the server is running, open `http://localhost:4200/`.

## Layer manifest validation

```bash
npm run validate:layer-manifest
```

This validates the committed template and, when present, the ignored development manifest cache.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
npm run build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

For Vercel-style validation and asset sync, run:

```bash
npm run build:vercel
```

`METRICS_API_BASE_URL` can be set for production-style builds to point custom polygon metric requests at the backend API. If it is omitted, production defaults to the Vercel same-origin `/metrics-api` rewrite, which forwards requests to the HTTPS backend.

## Docker

Vercel deploy is unchanged. The frontend image is a second way to serve the same `npm run build:vercel` output.

From the repository root:

```bash
docker build -f frontend/Dockerfile -t dmt-frontend .
docker run --rm -p 8080:8080 -e METRICS_API_UPSTREAM=http://host.docker.internal:8000 dmt-frontend
```

Open `http://localhost:8080/`. nginx serves the SPA and proxies `/metrics-api/` to `METRICS_API_UPSTREAM` (this one can change without rebuilding). Firebase and manifest URLs are build-time args; omit them to keep the committed production Firebase config.

To run frontend and backend together:

```bash
docker compose up --build
```

The Docker image disables the Vercel-only manifest editor (`ENABLE_MANIFEST_EDITOR=false`). Manifest-style publishing stays on Vercel.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
