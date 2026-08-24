# Runtime Artifact Contract

The backend expects runtime metric artifacts to be mounted or synced into `backend/runtime-artifacts/` during development, or another directory specified by `DMT_ARTIFACT_DIR`. Heavy raster, matrix, cache, or generated metric files must stay out of Git.

The Chat #3 implementation loads a tiny JSON area grid fixture for readiness and custom polygon smoke tests. Production work should keep the same manifest-first warmup shape while replacing this fixture-scale grid with real spatial artifacts.

## Manifest Fields

- `artifact_version`: Version or build identifier for the packaged artifact set.
- `schema_version`: Contract version. Chat #3 uses `metrics-artifact-manifest/v1`.
- `created_at`: ISO timestamp for when the artifact package metadata was created.
- `checksum`: Object with `algorithm` and `value` for the packaged artifact set.
- `source_manifest`: Source metadata, including planned Vercel Blob prefixes or future source manifest references.
- `area_grid_path`: Relative or absolute path to the area grid artifact used by the representative custom polygon path.
- `area_grid_checksum`: Optional SHA-256 checksum for the area grid artifact. When present, warmup verifies it.
- `files`: Optional list of packaged files with path, size, and checksum metadata.

## Tiny Area Grid

The committed fixture at `backend/artifacts/fixtures/tiny-area/area-grid.json` contains four JSON cells with `bbox`, `selected`, and `valid` flags plus a single `pixel_area_km2` value. The custom polygon smoke endpoint includes cells whose centroids fall inside the submitted GeoJSON polygon, then passes the selected/valid masks to the shared area metric adapter.

This fixture is intentionally small and human-readable. It is safe to commit because it is not generated production data and does not contain real rasters, vectors, caches, or secrets.

## Load Behavior

`/ready` reads the manifest configured by `DMT_ARTIFACT_MANIFEST`, defaulting to `runtime-artifacts/manifest.json`.

- If `DMT_ARTIFACT_REQUIRED=false` or unset, missing artifacts are allowed for local API development and `/ready` returns `200` with `available=false`.
- If `DMT_ARTIFACT_REQUIRED=true`, a missing or invalid runtime artifact makes `/ready` return `503`.
- When artifacts are required, `/ready` returns `200` only after the configured runtime artifact has been loaded and validated.
- Metric endpoints require a loaded runtime artifact before running metric calculations.

The production Compose profile additionally enables `DMT_MESA_COVERAGE_REQUIRED=true` and pins both `DMT_EXPECTED_COVERAGE_RELEASE_ID` and `DMT_EXPECTED_COVERAGE_CONTRACT_SHA256`. Production readiness therefore fails unless the runtime package contains the complete V3 Mesa bundle, its approved grid fingerprint, all 417 ecosystem rows per land solution, and the approved 7,980-species runtime/golden-master universe. Other solutions retain the exact species-row counts in their own summary-derived goals documents.
