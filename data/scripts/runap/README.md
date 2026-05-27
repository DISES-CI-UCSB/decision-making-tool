# RUNAP identify GeoJSON builder

Builds `inputs/includes/runap_identify.geojson` from the Vercel-hosted RUNAP
shapefile (`boundaries/runaps_vector/runap.*`) so MapView can render the
1,879 individual protected-area polygons as a single vector overlay (smooth
edges) and identify them on click — mirroring what `omecs_identify.geojson`
does for OMECs.

The shapefile lives only in Vercel Blob (per the `vercel-blob-storage.mdc`
workspace rule and to keep the 66 MB `.shp` out of git). This script
downloads it, reprojects from EPSG:4686 (MAGNA-SIRGAS) to EPSG:4326,
keeps only the attributes the UI needs, trims coordinate precision to
6 decimal places (~10 cm), and writes the GeoJSON locally for inspection.

## Layout

```
data/scripts/runap/
  main.py        # CLI entry: download → convert → write GeoJSON
  helpers/
    blob.py      # Vercel Blob download + upload helpers
  README.md
```

## Run

```bash
# 1. Build the GeoJSON locally (defaults: 1879 features, ~10 MB output)
python3 data/scripts/runap/main.py \
  --output data/inputs/includes/runap_identify.geojson

# 2. Upload to Vercel under inputs/includes/ (requires BLOB_READ_WRITE_TOKEN
#    from .env.local; the runap.shp stays at boundaries/runaps_vector/).
python3 data/scripts/runap/main.py \
  --output data/inputs/includes/runap_identify.geojson \
  --upload
```

## Attribute mapping

The published GeoJSON keeps the fields MapView and the metrics pipeline
need; everything else from the original `.dbf` is dropped.

| GeoJSON property | Source DBF field   | Sample value                              |
| ---------------- | ------------------ | ----------------------------------------- |
| `runap_id`       | `ap_id`            | `6`                                       |
| `runap_name`     | `ap_nombre`        | `"Cueva de los Guácharos"`                |
| `runap_category` | `ap_categor`       | `"Parque Nacional Natural"`               |
| `runap_status`   | `condicion`        | `"REGISTRADA"`                            |
| `runap_area_ha`  | `area_ha_to`       | `7142.93`                                 |
| `runap_url`      | `url`              | `"https://runap.parquesnacionales..."`    |
| `runap_sirap`    | `sirap`            | `"Sirap Amazonia,Sirap Andes ..."`        |
| `runap_dt`       | `territor_1`       | `"DTAO"` (territorial code)               |

`runap_id` is the canonical identifier used by `boundary_loader.py` and the
AOI selection model (`AOI.id = "runap:<runap_id>"`). `runap_category` is
the AOI panel kicker (Colombians refer to these places by category — e.g.
"Parque Nacional Natural" — not by "RUNAP").
