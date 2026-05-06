import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const PUBLIC_BLOB_HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';
const REQUIRED_LAYERS_CSV = path.resolve(
  repoRoot,
  'data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv',
);
const GENERATED_MANIFEST_PATH = path.resolve(
  __dirname,
  '../public/data/layer-manifest/manifest.json',
);
const REPORT_PATH = path.resolve(__dirname, './reports/reconciliation-report.json');
const GENERATED_AT = new Date().toISOString();

const BLOB_PREFIXES = [
  'boundaries/',
  'inputs/costs/',
  'inputs/features/biomass/',
  'inputs/features/carbon/',
  'inputs/features/ecosystems/',
  'inputs/features/ground_water_recharge/',
  'inputs/features/species_richness/',
  'inputs/features/strategic/',
  'inputs/includes/',
];
const COLLECTION_PREFIXES = ['inputs/features/species/'];

const columnAliases = {
  layer_id: ['layer_id'],
  layer_name: ['layer_name'],
  layer_group: ['layer_group'],
  layer_description: ['layer_description'],
  model_group: ['model_group'],
  spatial_extent: ['spatial extent'],
  visibility: ['visibility'],
  source_org: ['source_org'],
  in_use_now: ['in_use_now'],
  source_url: ['source_url'],
  source_created_date: ['source_created_date'],
  source_updated_date: ['source_updated_date'],
  source_license: ['source_license'],
  source_contact: ['source_contact'],
  filename: ['filename'],
  storage_type: ['storage_type'],
  storage_location: ['storage_location'],
  data_format: ['data_format'],
  notes: ['notes'],
  metadata_status: ['metadata_status'],
  metadata_verified_at: ['metadata_verified_at'],
  metadata_verified_by: ['metadata_verified_by'],
};

const displayAssetFormats = new Set([
  'arcgis featureserver',
  'arcgis feature service',
  'featureserver',
  'feature service',
  'geotiff',
  'geotiff or feature service',
  'shapefile',
]);

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeHeader(header) {
  return header
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mapHeaders(headers) {
  return headers.map((header) => {
    const normalized = normalizeHeader(header);

    for (const [key, aliases] of Object.entries(columnAliases)) {
      if (aliases.some((alias) => normalized.includes(alias))) {
        return key;
      }
    }

    return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  });
}

function rowsToObjects(parsedRows) {
  const [headers, ...records] = parsedRows;
  const keys = mapHeaders(headers);

  return records.map((record) => {
    const row = {};
    keys.forEach((key, index) => {
      row[key] = normalizeCell(record[index] ?? '');
    });
    return row;
  });
}

function normalizeCell(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function isTrue(value) {
  return value.trim().toLowerCase() === 'true';
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function splitMultilineLabel(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function toLayerId(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function toBlobPath(storageLocation, filename) {
  if (!storageLocation || /^https?:\/\//i.test(storageLocation)) {
    return null;
  }

  const normalizedLocation = storageLocation.replace(/\\/g, '/').replace(/^\/+/, '');
  const paths = normalizedLocation
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = paths.find((entry) => {
    const lowerEntry = entry.toLowerCase();
    return lowerEntry.includes('data/inputs/') || lowerEntry.includes('data/boundaries/');
  });

  if (!candidate) {
    return null;
  }

  if (candidate.endsWith('/')) {
    return candidate.replace(/^data\//, '');
  }

  if (path.posix.extname(candidate)) {
    return candidate.replace(/^data\//, '');
  }

  if (filename && filename.toLowerCase() !== 'na') {
    return `${candidate.replace(/\/+$/, '')}/${filename}`.replace(/^data\//, '');
  }

  return candidate.replace(/^data\//, '');
}

function isDisplayCandidate(row) {
  const normalizedFormat = row.data_format.toLowerCase();
  return [...displayAssetFormats].some((format) => normalizedFormat.includes(format));
}

function parseBlobListOutput(output) {
  const blobs = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Vercel CLI') || trimmed.startsWith('Fetching blobs')) {
      continue;
    }
    if (trimmed.startsWith('Uploaded At') || trimmed.startsWith('> To display')) {
      continue;
    }

    const match = trimmed.match(/^\S+\s+(\d+)\s+(\S+)\s+(https:\/\/\S+)$/);
    if (!match) {
      continue;
    }

    blobs.push({
      bytes: Number(match[1]),
      pathname: match[2],
      url: match[3],
    });
  }

  return blobs;
}

async function listBlobPrefix(prefix, limit = 1000) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required to list Vercel Blob contents');
  }

  const { stdout, stderr } = await execFileAsync('vercel', [
    'blob',
    'list',
    '--rw-token',
    process.env.BLOB_READ_WRITE_TOKEN,
    '--limit',
    String(limit),
    '--prefix',
    prefix,
    '--no-color',
  ]);

  return parseBlobListOutput(`${stdout}\n${stderr}`);
}

async function readBlobInventory() {
  const blobs = [];

  for (const prefix of BLOB_PREFIXES) {
    blobs.push(...(await listBlobPrefix(prefix)));
  }

  for (const prefix of COLLECTION_PREFIXES) {
    blobs.push(...(await listBlobPrefix(prefix, 1)));
  }

  const unique = new Map();
  for (const blob of blobs) {
    unique.set(blob.pathname, blob);
  }

  return [...unique.values()];
}

function createCategories(rows, layerEntries) {
  const categories = new Map();

  for (const row of rows) {
    const spanishLabel = row.layer_group || 'Uncategorized';
    const id = toLayerId(spanishLabel) || 'uncategorized';
    const layerIds = layerEntries
      .filter((entry) => entry.manifestLayer.sidebarCategoryId === id)
      .map((entry) => entry.manifestLayer.id);

    if (!categories.has(id)) {
      categories.set(id, {
        id,
        spanishLabel,
        englishLabel: null,
        layerIds,
      });
    }
  }

  return [...categories.values()].sort((a, b) => a.spanishLabel.localeCompare(b.spanishLabel));
}

function createLayerEntry(row, blobByPath) {
  const labels = splitMultilineLabel(row.layer_name);
  const blobPath = toBlobPath(row.storage_location, row.filename);
  const isCollection = blobPath?.endsWith('/');
  const matchedBlob = blobPath ? blobByPath.get(blobPath) : null;
  const remoteUrl = /^https?:\/\//i.test(row.storage_location) ? row.storage_location : '';
  const displayReference = createDisplayReference({
    row,
    blobPath,
    isCollection,
    matchedBlob,
    remoteUrl,
  });
  const id = toLayerId(row.layer_id);
  const dataRole = inferDataRole(row);
  const roleInMetricCalculation = inferRoleInMetricCalculation(dataRole);

  return {
    manifestLayer: {
      id,
      spanishLabel: labels[0] || row.layer_name,
      englishLabel: labels[1] ?? null,
      description: row.layer_description,
      tooltip: null,
      dataRole,
      sidebarCategoryId: toLayerId(row.layer_group || 'uncategorized'),
      roleInMetricCalculation,
      ...toDisplayUrlFields(displayReference),
      ...(row.layer_id === 'species'
        ? { speciesManifestUrl: `${PUBLIC_BLOB_HOST}/manifests/species.manifest.json` }
        : {}),
      metadataUrl: `${PUBLIC_BLOB_HOST}/metadata/${id}.metadata.json`,
      compressedDataForLiveMetricsUrl: roleInMetricCalculation.includes('live_metric_calculation')
        ? `${PUBLIC_BLOB_HOST}/metrics/live/${id}.bin.gz`
        : null,
      precomputedMetricUrls: createPrecomputedMetricUrls(id, roleInMetricCalculation),
    },
    reconciliation: {
      sourceLayerId: row.layer_id,
      displayName: labels[0] || row.layer_name,
      displayReference,
      originalStorageLocation: row.storage_location,
    },
  };
}

function createDisplayReference({ row, blobPath, isCollection, matchedBlob, remoteUrl }) {
  if (matchedBlob && row.data_format.toLowerCase().includes('shapefile')) {
    const shapefileStem = matchedBlob.pathname.replace(/\.[^/.]+$/, '');
    const collectionPath = `${path.posix.dirname(matchedBlob.pathname)}/`;

    return {
      status: 'matched',
      type: 'collection',
      url: `${PUBLIC_BLOB_HOST}/${collectionPath}`,
      blobPath: collectionPath,
      collectionPattern: `${shapefileStem}.*`,
    };
  }

  if (isCollection && matchedBlob) {
    return {
      status: 'matched',
      type: 'collection',
      url: `${PUBLIC_BLOB_HOST}/${blobPath}`,
      blobPath,
      collectionPattern: `${blobPath}*.tif`,
    };
  }

  if (matchedBlob) {
    return {
      status: 'matched',
      type: 'file',
      url: matchedBlob.url,
      blobPath: matchedBlob.pathname,
    };
  }

  if (remoteUrl) {
    return {
      status: 'matched',
      type: 'file',
      url: remoteUrl,
    };
  }

  return {
    status: 'pending',
    type: isCollection ? 'collection' : 'file',
    blobPath: blobPath || undefined,
  };
}

function toDisplayUrlFields(displayReference) {
  if (displayReference.type === 'collection') {
    return {
      displayCollectionUrl: displayReference.url ?? null,
    };
  }

  return {
    displayUrl: displayReference.url ?? null,
  };
}

function inferDataRole(row) {
  const layerId = row.layer_id.toLowerCase();
  const modelGroup = row.model_group.toLowerCase();
  const layerGroup = row.layer_group.toLowerCase();

  if (layerId === 'species') {
    return 'manifest_for_species_layers';
  }
  if (modelGroup.includes('costo') || layerGroup.includes('costo')) {
    return 'cost_layer';
  }
  if (modelGroup.includes('incluye')) {
    return 'include_layer';
  }
  if (modelGroup.includes('limites') || modelGroup.includes('boundaries') || layerGroup.includes('limite')) {
    return 'administrative_boundary';
  }

  return 'feature_layer';
}

function inferRoleInMetricCalculation(dataRole) {
  if (dataRole === 'administrative_boundary') {
    return 'boundary_used_for_precomputed_metric_lookup';
  }

  return 'data_used_for_live_metric_calculation';
}

function createPrecomputedMetricUrls(layerId, roleInMetricCalculation) {
  if (roleInMetricCalculation === 'none') {
    return {};
  }

  if (roleInMetricCalculation === 'boundary_used_for_precomputed_metric_lookup') {
    return {
      byBoundaryFeature: `${PUBLIC_BLOB_HOST}/metrics/precomputed/${layerId}/by-feature.json`,
    };
  }

  return {
    national: `${PUBLIC_BLOB_HOST}/metrics/precomputed/${layerId}/nacional.json`,
  };
}

function buildReport({ allRows, includedRows, layerEntries, blobInventory }) {
  const matchedBlobPaths = new Set(
    layerEntries
      .map((entry) => entry.reconciliation.displayReference.blobPath)
      .filter(Boolean)
      .map((blobPath) => (blobPath.endsWith('/') ? blobPath : blobPath)),
  );
  const matchedCollectionPrefixes = layerEntries
    .map((entry) => entry.reconciliation.displayReference.collectionPattern)
    .filter(Boolean)
    .map((pattern) => pattern.replace(/\*.*$/, ''));

  const missingRequired = layerEntries
    .filter((entry) => entry.reconciliation.displayReference.status === 'pending')
    .map((entry) => ({
      layerId: entry.reconciliation.sourceLayerId,
      displayName: entry.reconciliation.displayName,
      expectedBlobPath: entry.reconciliation.displayReference.blobPath ?? null,
      storageLocation: entry.reconciliation.originalStorageLocation,
    }));

  const extraAvailable = blobInventory
    .filter((blob) => blob.bytes > 0)
    .filter((blob) => !blob.pathname.startsWith('inputs/features/species/'))
    .filter((blob) => !matchedBlobPaths.has(blob.pathname))
    .filter((blob) => !matchedCollectionPrefixes.some((prefix) => blob.pathname.startsWith(prefix)))
    .map((blob) => ({
      pathname: blob.pathname,
      url: blob.url,
      bytes: blob.bytes,
    }));

  const excludedRows = allRows
    .filter((row) => !isTrue(row.in_use_now))
    .map((row) => ({
      layerId: row.layer_id,
      displayName: splitMultilineLabel(row.layer_name)[0] || row.layer_name,
      reason: 'in_use_now is not TRUE',
    }));

  const includedRowMetadataGaps = includedRows
    .map((row) => {
      const missingFields = [
        'source_url',
        'source_created_date',
        'source_updated_date',
        'source_license',
        'source_contact',
      ].filter((field) => !row[field] || row[field].toLowerCase() === 'unknown');

      return {
        layerId: row.layer_id,
        displayName: splitMultilineLabel(row.layer_name)[0] || row.layer_name,
        missingFields,
      };
    })
    .filter((entry) => entry.missingFields.length > 0);

  return {
    generatedAt: GENERATED_AT,
    sourceCsv: path.relative(repoRoot, REQUIRED_LAYERS_CSV),
    policy: {
      includedRows: 'Only rows with en_uso_actual / in_use_now set to TRUE',
      speciesHandling: 'Species rasters are represented as one collection pointer, not one layer per TIFF',
      liveManifest: 'Generated to frontend/public/data/layer-manifest/manifest.json and ignored by git',
    },
    counts: {
      csvRows: allRows.length,
      includedRows: includedRows.length,
      generatedLayers: layerEntries.length,
      blobInventoryEntries: blobInventory.length,
      missingRequired: missingRequired.length,
      extraAvailable: extraAvailable.length,
      includedRowMetadataGaps: includedRowMetadataGaps.length,
      excludedRows: excludedRows.length,
    },
    missingRequired,
    extraAvailable,
    includedRowMetadataGaps,
    excludedRows,
  };
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

async function main() {
  const csvRaw = await fs.readFile(REQUIRED_LAYERS_CSV, 'utf-8');
  const rows = rowsToObjects(parseCsv(csvRaw));
  const includedRows = rows.filter((row) => isTrue(row.in_use_now) && isDisplayCandidate(row));
  const blobInventory = await readBlobInventory();
  const blobByPath = new Map(blobInventory.map((blob) => [blob.pathname, blob]));
  const layerEntries = includedRows.map((row) => createLayerEntry(row, blobByPath));
  const categories = createCategories(includedRows, layerEntries);
  const layers = layerEntries.map((entry) => entry.manifestLayer);
  const report = buildReport({ allRows: rows, includedRows, layerEntries, blobInventory });

  const manifest = {
    version: '0.1.0',
    generatedAt: GENERATED_AT,
    publicBlobHost: PUBLIC_BLOB_HOST,
    sourceCsv: path.relative(repoRoot, REQUIRED_LAYERS_CSV),
    categories,
    layers,
  };

  await writeJson(GENERATED_MANIFEST_PATH, manifest);
  await writeJson(REPORT_PATH, report);

  console.log(`[generate:layer-manifest] wrote ${path.relative(repoRoot, GENERATED_MANIFEST_PATH)}`);
  console.log(`[generate:layer-manifest] wrote ${path.relative(repoRoot, REPORT_PATH)}`);
  console.log(
    `[generate:layer-manifest] ${layers.length} layer(s), ${report.counts.missingRequired} missing required, ${report.counts.extraAvailable} extra available`,
  );
}

main().catch((error) => {
  console.error(`[generate:layer-manifest] ${error.message}`);
  process.exit(1);
});
