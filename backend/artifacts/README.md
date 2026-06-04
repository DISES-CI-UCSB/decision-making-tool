# Runtime Artifact Contract

The backend expects runtime metric artifacts to be mounted or synced into `backend/runtime-artifacts/` during development, or another directory specified by `DMT_ARTIFACT_DIR`. Heavy raster, matrix, cache, or generated metric files must stay out of Git.

The lightweight manifest is the only artifact metadata this Chat #1 foundation is designed to create or validate. It documents what artifact bundle should be present without implementing the metric engine.

## Manifest Fields

- `artifact_version`: Version or build identifier for the packaged artifact set.
- `schema_version`: Contract version. Chat #1 uses `metrics-artifact-manifest/v1`.
- `created_at`: ISO timestamp for when the artifact package metadata was created.
- `checksum`: Object with `algorithm` and `value` for the packaged artifact set. Dry-run skeleton manifests use `none:not-computed-dry-run`.
- `source_manifest`: Source metadata, including planned Vercel Blob prefixes or future source manifest references.
- `files`: Optional list of packaged files with path, size, and checksum metadata.

## Load Behavior

`/ready` reads the manifest configured by `DMT_ARTIFACT_MANIFEST`, defaulting to `runtime-artifacts/manifest.json`.

- If `DMT_ARTIFACT_REQUIRED=false` or unset, missing artifacts are allowed for local API development and `/ready` returns `200`.
- If `DMT_ARTIFACT_REQUIRED=true`, a missing or invalid manifest makes `/ready` return `503`.
- Real metric endpoints should require valid artifacts before running metric calculations. Chat #1 only exposes the contract stub.
