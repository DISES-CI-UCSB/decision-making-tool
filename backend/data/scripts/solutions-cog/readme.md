# Solutions COG Batch

Small Python script that reads the public Vercel Blob layer manifest, batches
every nacional prioritizr solution, and emits Cloud-Optimized GeoTIFFs staged in
the same path layout they will eventually use in Vercel Blob.

The script does **not** upload to Blob and does **not** mutate the remote
`manifest.json`. It produces local COG files plus a `publish-report.json` that
maps each staged file to the Blob path/URL it should be uploaded to.

## Layout

```
data/scripts/solutions-cog/
  main.py            # CLI entry
  cog_writer.py      # rasterio COG translate + validation helpers
  blob_manifest.py   # manifest.json fetch + validate + solution lookup
  local_io.py        # download cache, staged output paths, publish report
  requirements.txt
  readme.md
```

## Outputs

Generated artifacts are ignored by the repository data policy:

```
data/cog/cache/                                      # downloaded source TIFFs
data/cog/generated/publish-report.json              # latest run
data/cog/generated/runs/publish-report.<stamp>.json # previous report snapshots
data/cog/generated/blob-staged/
  solutions/nacional/<basename>.cog.tif             # one COG per solution
```

The staged COG path mirrors the eventual Blob layout:

```
solutions/nacional/Ecos17+RUNAP_HF.tif      # current source raster in Blob
solutions/nacional/Ecos17+RUNAP_HF.cog.tif  # uploaded by separate publish step
```

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r data/scripts/solutions-cog/requirements.txt
```

`rasterio` ships GDAL wheels on macOS/Linux/Windows; no system GDAL is usually
required for the default install on Apple Silicon.

## Run

Validate the live manifest without downloads or writes:

```bash
python data/scripts/solutions-cog/main.py --validate-only
```

Smoke test one solution:

```bash
python data/scripts/solutions-cog/main.py \
  --solution-id ecos17_estr30_runap_hf \
  --limit 1
```

Default run for all nacional solutions:

```bash
python data/scripts/solutions-cog/main.py
```

Generate EPSG:9377 projected COGs from the currently published solution TIFFs:

```bash
python data/scripts/solutions-cog/main.py \
  --target-epsg 9377 \
  --target-resolution 1000 \
  --target-aligned-pixels
```

Projected outputs use a distinct basename suffix, for example:

```text
solutions/nacional/Ecos17+RUNAP_HF.epsg9377.cog.tif
```

This keeps the original TIFFs and existing COGs untouched. After upload, the
manifest publish step can point `displayCogUrl` at the projected COG URL while
leaving each solution's source `displayUrl` unchanged.

The projection path is source-aware. If a future source raster already reports
the requested EPSG code, resolution, and aligned grid, the script copies it to a
COG without warping. If an older source reports a different CRS, such as
EPSG:4326, the script marks `warpRequired: true` in the publish report and
reprojects it before COG creation.

## CLI Flags

| Flag              | Default                         | Notes                                      |
| ----------------- | ------------------------------- | ------------------------------------------ |
| `--manifest-url`  | live Blob URL in `blob_manifest.py` | Override for local/staging manifests    |
| `--output-dir`    | `data/cog/generated`            | COGs + publish report land here            |
| `--cache-dir`     | `data/cog/cache`                | Downloaded source rasters land here        |
| `--solution-id`   | (none, processes all)           | Repeatable; restricts to listed solutions  |
| `--limit`         | (none)                          | Cap solutions processed for a smoke test   |
| `--no-cache`      | off                             | Force re-download of source rasters        |
| `--force-rebuild` | off                             | Rebuild even when source SHA is unchanged  |
| `--validate-only` | off                             | Fetch manifest + select solutions only     |
| `--target-epsg`   | (none)                          | Reproject staged COGs to an EPSG code      |
| `--target-resolution` | (none)                      | One square-pixel value or x/y values       |
| `--target-aligned-pixels` | off                    | Align projected bounds to the output grid  |

## COG Settings

The converter uses rasterio's GDAL COG driver with:

- `COMPRESS=LZW`
- `BLOCKSIZE=512`
- `OVERVIEW_RESAMPLING=NEAREST`
- `RESAMPLING=NEAREST`
- `OVERVIEWS=IGNORE_EXISTING`
- `BIGTIFF=IF_SAFER`

Nearest-neighbor overviews preserve binary 0/1 solution categories so the
frontend can render crisp pixels through ArcGIS `ImageryTileLayer`.

When `--target-epsg` is set, the converter reprojects with nearest-neighbor
resampling before COG creation. Use nearest-neighbor for these solution rasters
because they encode categorical selected/not-selected planning-unit values.
The script first checks the source CRS/grid and only performs that reprojection
when the source does not already match the requested target.

## Idempotency

Each run downloads or reuses the source TIFF, computes its SHA-256, and compares
that value to the latest `publish-report.json`. If the staged COG still exists
and the previous report says the same source SHA produced a valid COG, the row is
marked `skipped` and the file is not rebuilt.

Use `--force-rebuild` when you change conversion settings and need to regenerate
COGs even though the source rasters have not changed.

## Verify A COG

After a smoke run, inspect one output with GDAL:

```bash
gdalinfo data/cog/generated/blob-staged/solutions/nacional/Ecos17+ESTR30+RUNAP_HF.cog.tif \
  | grep -i 'cog\|tiled\|overview'
```

The report also records validation flags per file: `layoutIsCog`, `isTiled`,
`blockSize512`, `hasInternalOverviews`, and the combined `isValidCog`.

## Publish Report

Each run writes `data/cog/generated/publish-report.json` containing:

- manifest metadata and the public Blob host
- per-solution `stagedPath`, `expectedBlobPath`, and `expectedPublicUrl`
- source SHA-256, COG SHA-256, byte sizes, conversion seconds, and validation flags
- status counts and failures with tracebacks

A separate publish step can read this report and upload each `stagedPath` to its
`expectedBlobPath` using `BLOB_READ_WRITE_TOKEN`.
