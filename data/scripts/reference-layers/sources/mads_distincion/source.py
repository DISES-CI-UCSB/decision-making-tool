"""Authoritative MADS international-designation sources."""

SERVICE = (
    "https://services6.arcgis.com/hxAwRYAu9QHliJ8T/arcgis/rest/services/"
    "Distincion_Internacional/FeatureServer"
)
ITEM = "https://www.arcgis.com/sharing/rest/content/items/3b63a187479543eb858028ecaa9d068b"

ASSETS = (
    {
        "id": "ramsar",
        "title": "Humedales RAMSAR",
        "organization": "Ministerio de Ambiente y Desarrollo Sostenible (MADS)",
        "kind": "arcgis",
        "item_url": ITEM,
        "source_url": f"{SERVICE}/1",
        "source_crs": "EPSG:3857",
    },
    {
        "id": "biosphere_reserves",
        "title": "Reservas de biosfera",
        "organization": "Ministerio de Ambiente y Desarrollo Sostenible (MADS)",
        "kind": "arcgis",
        "item_url": ITEM,
        "source_url": f"{SERVICE}/2",
        "source_crs": "EPSG:3857",
    },
)
