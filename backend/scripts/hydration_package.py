"""Read the catalog hydration package Docker hydrate uses as its recipe."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

HYDRATION_PACKAGE_FORMAT = "dmt-hydration-package/v1"


class HydrationPackageError(ValueError):
    """Raised when a catalog hydration package is missing or unusable."""


def _host_from(manifest: Mapping[str, Any] | None) -> str:
    if not manifest:
        return ""
    return str(manifest.get("publicBlobHost") or "").rstrip("/")


def _url_for(entry: Any, *, host: str, label: str) -> str:
    if isinstance(entry, str) and entry:
        if entry.startswith("http://") or entry.startswith("https://"):
            return entry
        if not host:
            raise HydrationPackageError(f"{label} needs publicBlobHost to resolve {entry!r}.")
        return f"{host}/{entry.lstrip('/')}"
    if not isinstance(entry, Mapping):
        raise HydrationPackageError(f"{label} must be a pathname, URL, or asset object.")
    url = entry.get("url")
    if isinstance(url, str) and url:
        return url
    pathname = entry.get("pathname")
    if isinstance(pathname, str) and pathname:
        if not host:
            raise HydrationPackageError(f"{label} needs publicBlobHost to resolve {pathname!r}.")
        return f"{host}/{pathname.lstrip('/')}"
    raise HydrationPackageError(f"{label} is missing url or pathname.")


@dataclass(frozen=True)
class HydrationPackage:
    document: dict[str, Any]
    public_blob_host: str

    @property
    def default_reference_grid(self) -> str:
        return str(self.document["defaultReferenceGrid"])

    def reference_grid(self, name: str) -> dict[str, Any]:
        grids = self.document.get("referenceGrids")
        if not isinstance(grids, Mapping) or name not in grids:
            raise HydrationPackageError(f"hydrationPackage has no reference grid {name!r}.")
        grid = grids[name]
        if not isinstance(grid, Mapping):
            raise HydrationPackageError(f"hydrationPackage.referenceGrids.{name} must be an object.")
        return dict(grid)

    def reference_raster_url(self, grid_name: str) -> str | None:
        grid = self.reference_grid(grid_name)
        raster = grid.get("referenceRaster")
        if raster is None:
            return None
        return _url_for(
            raster,
            host=self.public_blob_host,
            label=f"hydrationPackage.referenceGrids.{grid_name}.referenceRaster",
        )

    def species_bitset_kit_id(self, grid_name: str) -> str:
        grid = self.reference_grid(grid_name)
        kit_id = grid.get("speciesBitsetKitId")
        if not isinstance(kit_id, str) or not kit_id:
            raise HydrationPackageError(
                f"hydrationPackage.referenceGrids.{grid_name}.speciesBitsetKitId is required."
            )
        return kit_id

    def ecosystem_inventory_urls(self, grid_name: str) -> dict[str, str]:
        grid = self.reference_grid(grid_name)
        inventory = grid.get("ecosystemInventory")
        if not isinstance(inventory, Mapping):
            raise HydrationPackageError(
                f"hydrationPackage.referenceGrids.{grid_name}.ecosystemInventory is required."
            )
        return {
            name: _url_for(
                entry,
                host=self.public_blob_host,
                label=f"hydrationPackage.referenceGrids.{grid_name}.ecosystemInventory.{name}",
            )
            for name, entry in inventory.items()
        }

    def species_matrix_url(self, grid_name: str, group: str) -> str:
        grid = self.reference_grid(grid_name)
        matrices = grid.get("speciesMatrices")
        if not isinstance(matrices, Mapping) or group not in matrices:
            raise HydrationPackageError(
                f"hydrationPackage.referenceGrids.{grid_name}.speciesMatrices.{group} is required."
            )
        return _url_for(
            matrices[group],
            host=self.public_blob_host,
            label=f"hydrationPackage.referenceGrids.{grid_name}.speciesMatrices.{group}",
        )

    def metric_layer_url(self, layer_id: str) -> str | None:
        layers = self.document.get("metricLayers")
        if not isinstance(layers, Mapping) or layer_id not in layers:
            return None
        return _url_for(
            layers[layer_id],
            host=self.public_blob_host,
            label=f"hydrationPackage.metricLayers.{layer_id}",
        )

    def sirap_release_id(self) -> str:
        sirap = self.document.get("sirap")
        if not isinstance(sirap, Mapping) or not sirap.get("releaseId"):
            raise HydrationPackageError("hydrationPackage.sirap.releaseId is required.")
        return str(sirap["releaseId"])

    def species_bitset_index_url(self) -> str | None:
        index = self.document.get("speciesBitsetIndex")
        if index is None:
            pathname = self.document.get("speciesBitsetIndexPathname")
            if isinstance(pathname, str) and pathname:
                return _url_for(
                    pathname,
                    host=self.public_blob_host,
                    label="hydrationPackage.speciesBitsetIndex",
                )
            return None
        return _url_for(
            index,
            host=self.public_blob_host,
            label="hydrationPackage.speciesBitsetIndex",
        )


def load_hydration_package(
    manifest: Mapping[str, Any] | None,
    *,
    required: bool = False,
) -> HydrationPackage | None:
    """Read ``hydrationPackage`` from a fetched layer-catalog document."""
    if not manifest:
        if required:
            raise HydrationPackageError("Catalog document is missing.")
        return None
    raw = manifest.get("hydrationPackage")
    if raw is None:
        if required:
            raise HydrationPackageError(
                "Catalog is missing hydrationPackage; republish manifest.json with the 9377 recipe."
            )
        return None
    if not isinstance(raw, Mapping):
        raise HydrationPackageError("hydrationPackage must be an object.")
    if raw.get("format") != HYDRATION_PACKAGE_FORMAT:
        raise HydrationPackageError(
            f"hydrationPackage.format must be {HYDRATION_PACKAGE_FORMAT}."
        )
    if raw.get("defaultReferenceGrid") != "land-solution":
        raise HydrationPackageError("hydrationPackage.defaultReferenceGrid must be land-solution.")
    grids = raw.get("referenceGrids")
    if not isinstance(grids, Mapping) or "land-solution" not in grids:
        raise HydrationPackageError("hydrationPackage.referenceGrids.land-solution is required.")
    land = grids["land-solution"]
    if not isinstance(land, Mapping) or land.get("crs") != "EPSG:9377":
        raise HydrationPackageError(
            "hydrationPackage.referenceGrids.land-solution must use EPSG:9377."
        )
    return HydrationPackage(document=dict(raw), public_blob_host=_host_from(manifest))
