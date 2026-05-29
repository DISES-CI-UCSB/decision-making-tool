"""Static catalog of non-species layer TIFs we want sparse sidecars for.

Resolves URLs by looking at the live manifest for layers registered there
(paramos, bosque_seco, humedales, mangroves, ecosistemas, resguardos,
comunidades) and falls back to off-manifest URLs declared on the metric
definitions for layers stored outside the manifest (recarga_agua,
coberturas, runap_protected_areas, biomasa, carbono_organico).

Each entry records:

- ``layer_id``      : identifier used in the metric pipeline.
- ``tif_pathname``  : Vercel Blob pathname for the source ``.tif``.
- ``sparse_pathname``: Vercel Blob pathname for the ``.sparse.gz`` sidecar
                      (same directory, same stem, ``.sparse.gz`` suffix).
- ``layer_type``    : ``binary`` / ``categorical`` / ``continuous``.
- ``selected_value``: present-value threshold for binary layers (or None).
- ``selected_values``: alternative for binary layers that match a set.

The ``selected_value(s)`` columns are intentionally optional and primarily
relevant when a single TIF feeds multiple metrics with different
``selectedValue`` choices (e.g. ``coberturas.tif`` is encoded as a categorical
sparse artifact with all class IDs preserved, so the JS loader can compute
forest, agriculture, and other land-use metrics from the same artifact).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from blob_manifest import ResolvedManifest


@dataclass(frozen=True)
class SparseLayerInput:
    layer_id: str
    tif_pathname: str
    sparse_pathname: str
    layer_type: str
    selected_value: int | None = None
    selected_values: tuple[int, ...] | None = None


def _swap_extension(pathname: str, *, new_suffix: str) -> str:
    if pathname.endswith(".tif"):
        return pathname[: -len(".tif")] + new_suffix
    if pathname.endswith(".tiff"):
        return pathname[: -len(".tiff")] + new_suffix
    return pathname + new_suffix


def _strip_host(url: str) -> str:
    """Convert a public blob URL into a Vercel pathname (no host, no leading /)."""
    if "://" not in url:
        return url.lstrip("/")
    return url.split("://", 1)[1].split("/", 1)[1]


# Layers that MUST come from the live manifest (their pathnames change with
# Blob deployment IDs and we want this list to keep working as the manifest
# evolves).  Each entry's layer_type / selected_value is decided here, not
# in the manifest, because the manifest does not distinguish how the
# Tier 1 sparse representation should treat the data.
_MANIFEST_LAYERS: tuple[tuple[str, str], ...] = (
    ("paramos", "binary"),
    ("bosque_seco", "binary"),
    ("wetlands", "binary"),
    ("mangroves", "binary"),
    # ecosistemas is logically categorical (~396 unique values), but every
    # metric in this pipeline only needs a "valid cell" mask off it.  Encode
    # as categorical so values are preserved for any future per-class metric
    # without re-encoding.
    ("ecosistemas", "categorical"),
    ("resguardos", "binary"),
    ("comunidades", "binary"),
)


# Layers stored outside the manifest, pinned by their public Vercel pathname.
# Pulled out here (rather than re-derived from metric_definitions.py at
# runtime) so the sparse pipeline has a single source of truth and doesn't
# pick up coberturas.tif twice when two metrics share it.
_OFF_MANIFEST_LAYERS: tuple[SparseLayerInput, ...] = (
    SparseLayerInput(
        layer_id="recarga_agua",
        tif_pathname="inputs/features/ground_water_recharge/"
                     "recarga_agua_subterranea_moderado_alto.tif",
        sparse_pathname="inputs/features/ground_water_recharge/"
                        "recarga_agua_subterranea_moderado_alto.sparse.gz",
        layer_type="binary",
    ),
    SparseLayerInput(
        # CORINE Level 1 land cover, classes 1=forest, 2=agriculture,
        # 3=wetland, 4=water, 5=urban.  Single artifact reused for #9, #51,
        # #52/53, #54.
        layer_id="coberturas",
        tif_pathname="boundaries/coberturas.tif",
        sparse_pathname="boundaries/coberturas.sparse.gz",
        layer_type="categorical",
    ),
    SparseLayerInput(
        # Categorical raster encoding RUNAP categories.  #63 needs presence
        # (any non-zero), #64 needs class id == 3.  Categorical sparse keeps
        # both metrics derivable from one artifact.
        layer_id="runap_protected_areas",
        tif_pathname="inputs/includes/runap_protected_areas.tif",
        sparse_pathname="inputs/includes/runap_protected_areas.sparse.gz",
        layer_type="categorical",
    ),
    SparseLayerInput(
        layer_id="biomasa",
        tif_pathname="inputs/features/biomass/"
                     "biomasa_areara+subterranea_1km.tif",
        sparse_pathname="inputs/features/biomass/"
                        "biomasa_areara+subterranea_1km.sparse.gz",
        layer_type="continuous",
    ),
    SparseLayerInput(
        layer_id="carbono_organico",
        tif_pathname="inputs/features/carbon/carbono_organico.tif",
        sparse_pathname="inputs/features/carbon/carbono_organico.sparse.gz",
        layer_type="continuous",
    ),
)


def resolve_sparse_layer_inputs(manifest: ResolvedManifest) -> list[SparseLayerInput]:
    """Return the canonical Tier 1 list of layers to sparsify.

    Layers whose ``displayUrl`` is missing from the manifest are skipped
    with no error — the caller decides how to surface that.  The off-manifest
    layers are always included.
    """
    inputs: list[SparseLayerInput] = []
    for layer_id, layer_type in _MANIFEST_LAYERS:
        layer = manifest.layers_by_id.get(layer_id)
        if layer is None:
            continue
        url = layer.get("displayUrl")
        if not url:
            continue
        pathname = _strip_host(url)
        inputs.append(
            SparseLayerInput(
                layer_id=layer_id,
                tif_pathname=pathname,
                sparse_pathname=_swap_extension(pathname, new_suffix=".sparse.gz"),
                layer_type=layer_type,
            )
        )

    inputs.extend(_OFF_MANIFEST_LAYERS)
    return inputs


def filter_inputs(
    inputs: Iterable[SparseLayerInput],
    *,
    only: list[str] | None = None,
    skip: list[str] | None = None,
) -> list[SparseLayerInput]:
    """Optionally restrict the layer list (CLI ``--only`` / ``--skip``)."""
    selected = list(inputs)
    if only:
        wanted = {token.strip().lower() for token in only}
        selected = [item for item in selected if item.layer_id.lower() in wanted]
    if skip:
        skipped = {token.strip().lower() for token in skip}
        selected = [item for item in selected if item.layer_id.lower() not in skipped]
    return selected
