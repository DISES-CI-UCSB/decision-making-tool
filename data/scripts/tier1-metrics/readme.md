# Tier 1 Metrics Batch

Small Python script that reads the public Vercel Blob layer manifest, batches
every nacional prioritizr solution, and emits per-solution Tier 1 metric
sidecars staged in the same path layout they will eventually use in Vercel
Blob.

The script does **not** upload to Blob and does **not** mutate the remote
`manifest.json`. It produces local JSON sidecars plus a `publish-report.json`
that explicitly maps each staged file to the Blob path/URL it should be
uploaded to.

## Layout

```
data/scripts/tier1-metrics/
  main.py                # CLI entry
  metric_definitions.py  # 14 Tier 1 metric IDs, labels, units, source notes
  blob_manifest.py       # manifest.json fetch + validate + lookups
  raster_metrics.py      # rasterio + numpy mask/area/overlap helpers
  local_io.py            # download cache, sidecar JSON, publish report
  requirements.txt
  readme.md
```

`local_io.py` is named that way (instead of the planned `io.py`) so it does
not shadow Python's standard library `io` module when this directory is on
`sys.path[0]`.

## Outputs (ignored by `.gitignore`)

```
data/metrics/cache/tier1/                              # downloaded rasters
data/metrics/generated/tier1/publish-report.json       # one report per run
data/metrics/generated/tier1/blob-staged/
  solutions/nacional/<basename>.tier1-metrics.json     # one sidecar per solution
```

The staged sidecar path mirrors the eventual Blob layout:

```
solutions/nacional/Ecos17+RUNAP_HF.tif                 # already in Blob
solutions/nacional/Ecos17+RUNAP_HF.json                # already in Blob (Mesa metadata)
solutions/nacional/Ecos17+RUNAP_HF.tier1-metrics.json  # uploaded by separate publish step
```

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r data/scripts/tier1-metrics/requirements.txt
```

`rasterio` ships GDAL wheels on macOS/Linux/Windows; no system GDAL required
for the default install on Apple Silicon.

## Run

Default (live Blob manifest, all nacional solutions):

```bash
python data/scripts/tier1-metrics/main.py
```

Smoke test against a single solution:

```bash
python data/scripts/tier1-metrics/main.py \
  --solution-id ecos17_runap_hf \
  --limit 1
```

Validate manifest + required layers without computing or writing anything:

```bash
python data/scripts/tier1-metrics/main.py --validate-only
```

CLI flags:

| Flag                  | Default                                       | Notes                                            |
| --------------------- | --------------------------------------------- | ------------------------------------------------ |
| `--manifest-url`      | live Blob URL in `blob_manifest.py`           | Override for local/staging manifests             |
| `--output-dir`        | `data/metrics/generated/tier1`                | Sidecars + publish report land here              |
| `--cache-dir`         | `data/metrics/cache/tier1`                    | Downloaded rasters land here                     |
| `--solution-id`       | (none, processes all)                         | Repeatable; restricts to listed solutions        |
| `--limit`             | (none)                                        | Cap solutions processed (smoke test)             |
| `--no-cache`          | off                                           | Force re-download of rasters                     |
| `--validate-only`     | off                                           | Fetch manifest + check layer URLs; no compute    |

## Tier 1 metric catalog (14 entries)

Edit `metric_definitions.METRIC_CATALOG` to add/remove metrics. Numbers
reference rows in `docs/design/DISES Metrics - Finalized Metrics.csv`.

| Metric ID | # | Label                              | Source                                |
| --------- | - | ---------------------------------- | ------------------------------------- |
| metric-1  | 1 | Conservation Goals Met             | manifest summaryMetrics.pctTargetsMet |
| metric-2  | 2 | Species Groups Protected           | manifest coverage[].met               |
| metric-4  | 4 | Ecosystem Coverage                 | raster ∩ `ecosistemas`                |
| metric-17 | 17 | National Contribution             | selectedCells / validCells × 100      |
| metric-18 | 18 | Priority Area (Selected)          | solution raster                       |
| metric-30 | 30 | Ecosystem Coverage - Páramo       | raster ∩ `paramos`                    |
| metric-31 | 31 | Ecosystem Coverage - Dry Forest   | raster ∩ `bosque_seco`                |
| metric-32 | 32 | Ecosystem Coverage - Wetlands     | raster ∩ `wetlands`                   |
| metric-36 | 36 | Mangrove Coverage                 | raster ∩ `mangroves`                  |
| metric-59 | 59 | Indigenous Reservations Area      | raster ∩ `resguardos`                 |
| metric-60 | 60 | Community Councils Area           | raster ∩ `comunidades`                |
| metric-70 | 70 | Agreement Area (deferred)         | live pairwise comparison              |
| metric-71 | 71 | Unique to Solution A (deferred)   | live pairwise comparison              |
| metric-72 | 72 | Unique to Solution B (deferred)   | live pairwise comparison              |

Metrics 70–72 are kept in the catalog so Angular sees stable IDs, but their
values are intentionally not generated here — they will be computed live in
the app when the comparison UI selects a baseline + candidate pair.

## Solution raster convention

Matches `frontend/src/app/features/map/services/geotiff-loader.service.ts`:

- skip GDAL nodata cells when present
- count cells with value `1` as selected
- treat all other valid cells as not-selected

## Calculation conventions

- Pixel area in km² is derived from the raster transform per row:
  - **Projected CRS** (meters or kilometers): constant pixel area from the
    transform.
  - **Geographic CRS** (e.g. EPSG:4326): per-row spherical Earth
    approximation (longitudinal degree shrinks with cos(latitude)). Adequate
    for national 1 km Colombian rasters; not appropriate for global or polar
    work.
- Solution and feature/include layer rasters must align (same width, height,
  transform, CRS). Mismatches fail with a clear message; resampling is out of
  MVP scope.

## Publish report

Each run writes `data/metrics/generated/tier1/publish-report.json` containing:

- `manifestUrl`, `manifestGeneratedAt`, `publicBlobHost`
- per-solution `stagedPath`, `expectedBlobPath`, `expectedPublicUrl`,
  `rasterCacheSha256`, `selectedCells`, `validCells`, `pixelAreaKm2`,
  `metricStatusCounts`, `elapsedSeconds`
- list of failures with full tracebacks

A separate publish step (e.g. `vercel blob put` using
`BLOB_READ_WRITE_TOKEN`) can read this report to upload sidecars in bulk.

## Out of scope (intentionally deferred)

- Uploading to Vercel Blob.
- Mutating remote `manifest.json` to add solution metric URLs.
- Browser-side sparse-matrix or compressed-raster live metric calculation.
- Layer-level metric sidecars under `metrics/precomputed/{layer_id}/...`.
- AOI-specific metrics.
