# Data Deploy Scripts

These scripts move generated geospatial artifacts from local build outputs into
Vercel Blob and then update the published runtime manifest that the Angular app
loads.

## Solution COG Publish Flow

Run the flow whenever the prioritizr solution batch changes or the COG
conversion settings change:

```bash
python data/scripts/solutions-cog/main.py
npm --prefix frontend run upload:solutions-cogs
npm --prefix frontend run publish:solution-cog-manifest -- --publish
```

The Python step writes COGs and `data/cog/generated/publish-report.json`. The
upload step reads that report, uploads each staged COG to its expected
`solutions/nacional/*.cog.tif` Blob path, and writes
`data/cog/generated/upload-report.json`. The manifest step reads the upload
report, fetches the live manifest, adds `displayCogUrl` beside each solution's
existing `displayUrl`, validates the manifest, archives the previous live
manifest, and publishes the new one.

To verify without uploads, use:

```bash
npm --prefix frontend run upload:solutions-cogs -- --dry-run --limit 1
npm --prefix frontend run publish:solution-cog-manifest
```

## Idempotency

`upload:solutions-cogs` checks the remote Blob with `head()` before upload. When
the existing remote ETag still matches the prior `upload-report.json` entry for
the same local COG SHA-256 and byte size, the script marks the file `skipped`.
When it must overwrite an existing blob, it passes the current ETag as `ifMatch`
so the write fails instead of clobbering a blob that changed mid-run.

## Rollback

The legacy `displayUrl` stays in the manifest. If COG rendering regresses, remove
the `displayCogUrl` fields from the live manifest or roll back to the archived
manifest produced by `publish:layer-manifest`; the app can then use the legacy
TIFF URLs without re-uploading rasters.

## Required Environment

Set `BLOB_READ_WRITE_TOKEN` in the repo or frontend `.env.local`. The scripts
load it automatically and never print the token value.
