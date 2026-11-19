import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_BLOB_HOST } from './runtime-manifest.constants.mjs';

const PACKAGE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'hydration-package.json');
const PACKAGE_TEMPLATE = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));

export const HYDRATION_PACKAGE_FORMAT = 'dmt-hydration-package/v1';

function publicUrl(host, pathname) {
  return `${host.replace(/\/+$/, '')}/${String(pathname).replace(/^\/+/, '')}`;
}

function withAssetUrl(host, asset) {
  if (!asset || typeof asset !== 'object') {
    return asset;
  }
  if (typeof asset.pathname !== 'string') {
    return { ...asset };
  }
  return {
    ...asset,
    url: publicUrl(host, asset.pathname),
  };
}

export function buildHydrationPackage(publicBlobHost = PUBLIC_BLOB_HOST) {
  const host = publicBlobHost || PUBLIC_BLOB_HOST;
  const referenceGrids = Object.fromEntries(
    Object.entries(PACKAGE_TEMPLATE.referenceGrids).map(([gridName, grid]) => {
      const speciesMatrices = Object.fromEntries(
        Object.entries(grid.speciesMatrices ?? {}).map(([group, pathname]) => [
          group,
          { pathname, url: publicUrl(host, pathname) },
        ]),
      );
      const inventory = grid.ecosystemInventory
        ? Object.fromEntries(
            Object.entries(grid.ecosystemInventory).map(([name, pathname]) => [
              name,
              { pathname, url: publicUrl(host, pathname) },
            ]),
          )
        : undefined;
      return [
        gridName,
        {
          ...grid,
          referenceRaster: withAssetUrl(host, grid.referenceRaster),
          ecosystemInventory: inventory,
          speciesMatrices,
        },
      ];
    }),
  );
  const metricLayers = Object.fromEntries(
    Object.entries(PACKAGE_TEMPLATE.metricLayers).map(([layerId, layer]) => [
      layerId,
      {
        ...layer,
        url: publicUrl(host, layer.pathname),
      },
    ]),
  );
  const packetManifests = Object.fromEntries(
    Object.entries(PACKAGE_TEMPLATE.sirap.packetManifestPathnames).map(([sirapId, pathname]) => [
      sirapId,
      { pathname, url: publicUrl(host, pathname) },
    ]),
  );
  return {
    format: PACKAGE_TEMPLATE.format,
    defaultReferenceGrid: PACKAGE_TEMPLATE.defaultReferenceGrid,
    speciesBitsetIndex: {
      pathname: PACKAGE_TEMPLATE.speciesBitsetIndexPathname,
      url: publicUrl(host, PACKAGE_TEMPLATE.speciesBitsetIndexPathname),
    },
    referenceGrids,
    metricLayers,
    sirap: {
      releaseId: PACKAGE_TEMPLATE.sirap.releaseId,
      packetManifests,
    },
  };
}

export function assertHydrationPackage(packageDocument, label = 'hydrationPackage') {
  if (!packageDocument || typeof packageDocument !== 'object' || Array.isArray(packageDocument)) {
    throw new Error(`${label} must be an object`);
  }
  if (packageDocument.format !== HYDRATION_PACKAGE_FORMAT) {
    throw new Error(`${label}.format must be ${HYDRATION_PACKAGE_FORMAT}`);
  }
  if (packageDocument.defaultReferenceGrid !== 'land-solution') {
    throw new Error(`${label}.defaultReferenceGrid must be land-solution`);
  }
  const land = packageDocument.referenceGrids?.['land-solution'];
  if (!land || land.crs !== 'EPSG:9377') {
    throw new Error(`${label}.referenceGrids.land-solution must use EPSG:9377`);
  }
  if (!land.referenceRaster?.pathname || !land.referenceRaster?.sha256) {
    throw new Error(`${label}.referenceGrids.land-solution.referenceRaster is incomplete`);
  }
  if (!packageDocument.sirap?.releaseId) {
    throw new Error(`${label}.sirap.releaseId is required`);
  }
  if (!packageDocument.metricLayers?.ecosistemas_IAVH_2024) {
    throw new Error(`${label}.metricLayers.ecosistemas_IAVH_2024 is required`);
  }
}
