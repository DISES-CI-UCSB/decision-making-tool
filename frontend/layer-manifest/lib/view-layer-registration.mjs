import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseCsv } from './csv.mjs';

const LAYER_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;

export async function prepareViewLayerRegistration({
  filePath,
  layerId,
  spanishLabel,
  englishLabel,
  description,
  category,
  sourceOrg,
  sourceUrl,
  assetVersion = 'v0.1.0',
  publicBlobHost,
}) {
  assert(filePath, '--file is required');
  assert(LAYER_ID_PATTERN.test(layerId ?? ''), 'layer ID must use lowercase snake_case');
  assert(VERSION_PATTERN.test(assetVersion), 'asset version must look like v0.1.0');
  for (const [label, value] of Object.entries({
    spanishLabel,
    englishLabel,
    description,
    category,
    sourceOrg,
    sourceUrl,
  })) {
    assert(typeof value === 'string' && value.trim(), `${label} is required`);
  }
  assert(
    path.extname(filePath).toLowerCase() === '.geojson',
    'add-view-layer currently accepts finalized .geojson files',
  );

  const contents = await fs.readFile(filePath);
  const document = JSON.parse(contents.toString('utf8'));
  assert.equal(document.type, 'FeatureCollection', 'GeoJSON must be a FeatureCollection');
  assert(
    Array.isArray(document.features) && document.features.length > 0,
    'GeoJSON has no features',
  );
  assertWgs84(document);

  const prefix = `inputs/reference/${layerId}/${assetVersion}`;
  const geojsonPathname = `${prefix}/${layerId}.geojson`;
  const metadataPathname = `${prefix}/${layerId}.metadata.json`;
  const now = new Date().toISOString();
  const metadata = {
    format: 'dises-reference-layer-metadata-v1',
    layerId,
    assetVersion,
    generatedAt: now,
    source: {
      organization: sourceOrg,
      url: sourceUrl,
      localFilename: path.basename(filePath),
    },
    display: {
      role: 'view-only',
      roleInMetricCalculation: 'none',
      featureCount: document.features.length,
      crs: 'EPSG:4326',
    },
  };
  return {
    contents,
    metadataContents: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
    geojsonPathname,
    metadataPathname,
    layer: {
      id: layerId,
      spanishLabel,
      englishLabel,
      description,
      tooltip: null,
      dataRole: 'reference_layer',
      category,
      roleInMetricCalculation: 'none',
      displayUrl: `${publicBlobHost}/${geojsonPathname}`,
      metadataUrl: `${publicBlobHost}/${metadataPathname}`,
      compressedDataForLiveMetricsUrl: null,
      precomputedMetricUrls: {},
      rendering: {
        valueType: 'binary',
        renderMode: 'mask',
        noDataValue: 255,
        selectedValue: 1,
        selectedColor: '#166534',
      },
      requiredForSolution: false,
      selectableInFinder: false,
      visibleInMapLayers: true,
    },
    csvRecord: [
      layerId,
      `${spanishLabel}\n${englishLabel}`,
      csvLayerGroup(category),
      description,
      'referencia\nreference',
      'nacional',
      'a todos',
      sourceOrg,
      'TRUE',
      sourceUrl,
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      `${layerId}.geojson`,
      'Vercel Blob',
      geojsonPathname,
      'GeoJSON',
      'Display-only immutable reference layer; excluded from solution finding and metrics.',
      'complete',
      now.slice(0, 10),
      'DISES Team',
    ],
  };
}

export async function appendCanonicalCsvRecord(csvPath, record, layerId) {
  const raw = await fs.readFile(csvPath, 'utf8');
  const [, ...rows] = parseCsv(raw);
  const existing = rows.find((row) => row[0] === layerId);
  if (existing) {
    assert.deepEqual(existing, record, `CSV layer "${layerId}" exists with different metadata`);
    return false;
  }
  const line = record.map(escapeCsvValue).join(',');
  await fs.writeFile(csvPath, `${raw.replace(/\s*$/, '\n')}${line}\n`, 'utf8');
  return true;
}

function csvLayerGroup(category) {
  const groups = {
    ecosystems: 'Ecosistemas estratégicos',
    cultural_and_ethnic_territories: 'Territorios culturales y étnicos',
    species_and_biodiversity: 'Biodiversidad',
    socioeconomic: 'Socioeconómico',
    administrative_boundaries: 'Límite político o administrativo',
  };
  assert(groups[category], `unsupported sidebar category "${category}"`);
  return groups[category];
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? '');
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

function assertWgs84(document) {
  const crsName = document.crs?.properties?.name;
  if (crsName) {
    assert(
      /(?:EPSG(?::|::)4326|CRS84)$/i.test(crsName),
      `GeoJSON CRS must be EPSG:4326/CRS84; got "${crsName}"`,
    );
  }
  for (const [featureIndex, feature] of document.features.entries()) {
    assert(feature?.type === 'Feature', `features[${featureIndex}] must be a Feature`);
    assert(feature.geometry, `features[${featureIndex}] must have a geometry`);
    visitGeometry(feature.geometry, (position) => {
      const [longitude, latitude] = position;
      assert(
        Number.isFinite(longitude) &&
          Number.isFinite(latitude) &&
          longitude >= -180 &&
          longitude <= 180 &&
          latitude >= -90 &&
          latitude <= 90,
        `features[${featureIndex}] contains coordinates outside EPSG:4326 bounds`,
      );
    });
  }
}

function visitGeometry(geometry, visitor) {
  const coordinateTypes = new Set([
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
  ]);
  if (geometry.type === 'GeometryCollection') {
    assert(
      Array.isArray(geometry.geometries) && geometry.geometries.length > 0,
      'GeometryCollection must contain geometries',
    );
    for (const child of geometry.geometries) {
      visitGeometry(child, visitor);
    }
    return;
  }
  assert(coordinateTypes.has(geometry.type), `unsupported geometry type "${geometry.type}"`);
  assert(
    Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0,
    'geometry has no coordinates',
  );
  visitCoordinates(geometry.coordinates, visitor);
}

function visitCoordinates(value, visitor) {
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    visitor(value);
    return;
  }
  assert(value.length > 0, 'geometry contains an empty coordinate array');
  for (const child of value) {
    assert(Array.isArray(child), 'geometry coordinates are malformed');
    visitCoordinates(child, visitor);
  }
}
