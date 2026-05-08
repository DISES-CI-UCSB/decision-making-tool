import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.mjs';

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
const REPORTS_ROOT = path.resolve(repoRoot, 'development-artifacts/layer-manifest/reports');
const MANIFEST_ARCHIVE_ROOT = path.resolve(repoRoot, 'development-artifacts/layer-manifest/archive');
const MAX_ARCHIVED_MANIFESTS = 30;
const REPORT_PATH = path.resolve(REPORTS_ROOT, 'reconciliation-report.json');
const CATEGORY_MAPPING_REPORT_PATH = path.resolve(REPORTS_ROOT, 'category-mapping-report.json');
const CATEGORY_REVIEW_CSV_PATH = path.resolve(REPORTS_ROOT, 'category-review.csv');
const LEFT_SIDEBAR_SOURCE_PATH = path.resolve(
  __dirname,
  '../src/app/features/left-sidebar/map-layers-panel/map-layers-panel.ts',
);
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
const RASTER_SAMPLE_GRID_SIZE = 64;
const NON_INTEGER_TOLERANCE = 1e-6;
const DEFAULT_BINARY_SELECTED_COLOR = '#16a34a';
const DEFAULT_CONTINUOUS_START_COLOR = '#bbf7d0';
const DEFAULT_CONTINUOUS_END_COLOR = '#166534';

/**
 * Optional per-layer overrides for rendering inference.
 * Keep these entries rare and explicit when domain knowledge must win.
 */
const renderingOverrideByLayerId = {
  ecosistemas: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: -32768,
    minValue: null,
    maxValue: null,
    startColor: DEFAULT_CONTINUOUS_START_COLOR,
    endColor: DEFAULT_CONTINUOUS_END_COLOR,
  },
  species_richness: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: 255,
    minValue: 815,
    maxValue: 3562,
    startColor: '#fef3c7',
    endColor: '#854d0e',
  },
};

const rasterCharacteristicsByUrl = new Map();

const proposedManifestCategories = {
  species_and_biodiversity: {
    spanishLabel: 'Especies y biodiversidad',
    englishLabel: 'Species & Biodiversity',
    frontendGroup: 'Species & Biodiversity',
  },
  ecosystems: {
    spanishLabel: 'Ecosistemas',
    englishLabel: 'Ecosystems',
    frontendGroup: 'Ecosystems',
  },
  environmental_services: {
    spanishLabel: 'Servicios ecosistémicos',
    englishLabel: 'Environmental Services',
    frontendGroup: 'Environmental Services',
  },
  management_figures: {
    spanishLabel: 'Figuras de manejo',
    englishLabel: 'Management Figures',
    frontendGroup: 'Management Figures',
  },
  administrative_boundaries: {
    spanishLabel: 'Límites administrativos',
    englishLabel: 'Administrative Boundaries',
    frontendGroup: 'Administrative Boundaries',
  },
  cultural_and_ethnic_territories: {
    spanishLabel: 'Territorios culturales y étnicos',
    englishLabel: 'Cultural & Ethnic Territories',
    frontendGroup: 'Cultural & Ethnic Territories',
  },
  socioeconomic: {
    spanishLabel: 'Socioeconómico',
    englishLabel: 'Socio-economic',
    frontendGroup: 'Socio-economic',
  },
  conflict_and_security: {
    spanishLabel: 'Conflicto y seguridad',
    englishLabel: 'Conflict & Security',
    frontendGroup: 'Conflict & Security',
  },
  territorial_planning: {
    spanishLabel: 'Ordenamiento territorial',
    englishLabel: 'Territorial Planning',
    frontendGroup: 'Territorial Planning',
  },
  prospective_models: {
    spanishLabel: 'Modelos prospectivos',
    englishLabel: 'Prospective Models',
    frontendGroup: 'Prospective Models',
  },
  solutions: {
    spanishLabel: 'Soluciones',
    englishLabel: 'Solutions',
    frontendGroup: 'Solutions',
  },
};

const proposedLayerCategoryOverrides = {
  runap: 'management_figures',
  omecs: 'management_figures',
  comunidades: 'cultural_and_ethnic_territories',
  resguardos: 'cultural_and_ethnic_territories',
  siraps: 'administrative_boundaries',
  admin_departments: 'administrative_boundaries',
  admin_municipalities: 'administrative_boundaries',
  human_footprint_2022: 'socioeconomic',
  human_footprint_2030: 'prospective_models',
  net_benefit: 'socioeconomic',
  conflict: 'conflict_and_security',
  climate_refugia: 'prospective_models',
};

const proposedCsvGroupCategoryIds = {
  biodiversidad: 'species_and_biodiversity',
  ecosistemas: 'ecosystems',
  ecosistemas_estrategicos: 'ecosystems',
  servicios_ecosistemicos: 'environmental_services',
  costo: 'socioeconomic',
  coberturas: 'territorial_planning',
};

const categoryMappingRules = {
  species_and_biodiversity: {
    frontendCategoryIds: ['group-species-biodiversity'],
    status: 'maps_cleanly',
    notes: 'Biodiversity layers map to the existing Species & Biodiversity sidebar group.',
  },
  ecosystems: {
    frontendCategoryIds: ['group-ecosystems'],
    status: 'maps_cleanly',
    notes: 'Ecosystem layers map to the existing Ecosystems sidebar group.',
  },
  environmental_services: {
    frontendCategoryIds: ['group-environmental-services'],
    status: 'maps_cleanly',
    notes: 'Environmental service layers map to the existing Environmental Services sidebar group.',
  },
  management_figures: {
    frontendCategoryIds: ['management-figures'],
    status: 'maps_cleanly',
    notes: 'RUNAP and OMEC layers map to the existing Management Figures overlay group.',
  },
  administrative_boundaries: {
    frontendCategoryIds: ['group-admin-boundaries'],
    status: 'maps_cleanly',
    notes: 'Administrative boundary layers map to the existing Administrative Boundaries sidebar group.',
  },
  cultural_and_ethnic_territories: {
    frontendCategoryIds: ['group-cultural-ethnic'],
    status: 'maps_cleanly',
    notes:
      'Cultural and ethnic territory layers map to the existing Cultural & Ethnic Territories sidebar group.',
  },
  socioeconomic: {
    frontendCategoryIds: ['group-socio-economic'],
    status: 'maps_cleanly',
    notes: 'Socioeconomic cost/context layers map to the existing Socio-economic sidebar group.',
  },
  conflict_and_security: {
    frontendCategoryIds: ['group-conflict-security'],
    status: 'maps_cleanly',
    notes: 'Conflict and security layers map to the existing Conflict & Security sidebar group.',
  },
  territorial_planning: {
    frontendCategoryIds: [],
    status: 'needs_frontend_category',
    notes:
      'The current left sidebar does not have a dedicated Territorial Planning group. Confirm whether these layers should use an existing group or a new UI category.',
  },
  prospective_models: {
    frontendCategoryIds: ['group-prospective-models'],
    status: 'maps_cleanly',
    notes: 'Prospective model layers map to the existing Prospective Models sidebar group.',
  },
  solutions: {
    frontendCategoryIds: ['management-figures'],
    status: 'maps_cleanly_with_existing_overlay_group',
    notes: 'Solution layers currently appear in the existing Management Figures overlay group.',
  },
};

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

function splitLayerLabels(value) {
  const labels = splitMultilineLabel(value);

  return {
    spanishLabel: labels[0] ?? value,
    englishLabel: labels[1] ?? '',
  };
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
    const id = inferProposedCategoryId(row);
    const proposedCategory = proposedManifestCategories[id];
    const layerIds = layerEntries
      .filter((entry) => entry.manifestLayer.sidebarCategoryId === id)
      .map((entry) => entry.manifestLayer.id);

    if (!categories.has(id)) {
      categories.set(id, {
        id,
        spanishLabel: proposedCategory.spanishLabel,
        englishLabel: proposedCategory.englishLabel,
        layerIds,
      });
    }
  }

  return [...categories.values()].sort((a, b) => a.spanishLabel.localeCompare(b.spanishLabel));
}

async function createLayerEntry(row, blobByPath) {
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
  const { rendering, renderingInference } = await inferRenderingConfig({
    row,
    id,
    dataRole,
    displayReference,
  });

  return {
    manifestLayer: {
      id,
      spanishLabel: labels[0] || row.layer_name,
      englishLabel: labels[1] ?? null,
      description: row.layer_description,
      tooltip: null,
      dataRole,
      sidebarCategoryId: inferProposedCategoryId(row),
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
      rendering,
    },
    reconciliation: {
      sourceLayerId: row.layer_id,
      displayName: labels[0] || row.layer_name,
      displayReference,
      originalStorageLocation: row.storage_location,
      renderingInference,
    },
  };
}

async function inferRenderingConfig({ row, id, dataRole, displayReference }) {
  const override = renderingOverrideByLayerId[id];
  if (override) {
    return {
      rendering: override,
      renderingInference: {
        strategy: 'manual_override',
        classification: override.valueType,
        confidence: 'forced',
        reason: 'Layer matched renderingOverrideByLayerId',
      },
    };
  }

  const isRasterCandidate = isRasterDisplayReference(displayReference, row.data_format);
  if (isRasterCandidate && displayReference.url) {
    const characteristics = await getRasterCharacteristics(displayReference.url);

    if (characteristics.status === 'ok') {
      if (characteristics.classification === 'binary') {
        return {
          rendering: toBinaryRenderingConfig(characteristics, id, dataRole),
          renderingInference: {
            strategy: 'raster_sampling',
            classification: 'binary',
            confidence: characteristics.confidence,
            reason: characteristics.reason,
            sample: characteristics.sample,
          },
        };
      }

      if (characteristics.classification === 'continuous') {
        return {
          rendering: toContinuousRenderingConfig(characteristics, id, dataRole),
          renderingInference: {
            strategy: 'raster_sampling',
            classification: 'continuous',
            confidence: characteristics.confidence,
            reason: characteristics.reason,
            sample: characteristics.sample,
          },
        };
      }
    }
  }

  const fallbackRendering = inferLegacyRenderingConfig({ row, id, dataRole });
  return {
    rendering: fallbackRendering,
    renderingInference: {
      strategy: isRasterCandidate ? 'fallback_after_uncertain_sampling' : 'legacy_non_raster',
      classification: fallbackRendering.valueType,
      confidence: 'low',
      reason: isRasterCandidate
        ? 'Raster sampling was unavailable or inconclusive; used legacy rule-based fallback.'
        : 'Layer is not a direct GeoTIFF file URL; used legacy rule-based fallback.',
    },
  };
}

function inferLegacyRenderingConfig({ row, id, dataRole }) {
  const layerGroupId = toLayerId(row.layer_group || '');
  const modelGroupId = toLayerId(row.model_group || '');

  if (id === 'ecosistemas') {
    return renderingOverrideByLayerId.ecosistemas;
  }

  if (dataRole === 'cost_layer') {
    const theme = inferLayerColorTheme(id, dataRole);
    return {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: null,
      minValue: null,
      maxValue: null,
      startColor: theme.gradientStartColor,
      endColor: theme.gradientEndColor,
    };
  }

  if (
    layerGroupId === 'ecosistemas_estrategicos' ||
    modelGroupId === 'incluye' ||
    modelGroupId === 'limites' ||
    dataRole === 'include_layer' ||
    dataRole === 'administrative_boundary'
  ) {
    const theme = inferLayerColorTheme(id, dataRole);
    return {
      valueType: 'binary',
      renderMode: 'mask',
      noDataValue: 255,
      selectedValue: 1,
      selectedColor: theme.binarySelectedColor,
    };
  }

  const theme = inferLayerColorTheme(id, dataRole);
  return {
    valueType: 'binary',
    renderMode: 'mask',
    noDataValue: 255,
    selectedValue: 1,
    selectedColor: theme.binarySelectedColor,
  };
}

function isRasterDisplayReference(displayReference, dataFormat) {
  if (!displayReference?.url || displayReference.type !== 'file') {
    return false;
  }

  const normalizedDataFormat = (dataFormat || '').toLowerCase();
  if (normalizedDataFormat.includes('geotiff')) {
    return true;
  }

  try {
    const { pathname } = new URL(displayReference.url);
    return pathname.toLowerCase().endsWith('.tif') || pathname.toLowerCase().endsWith('.tiff');
  } catch {
    return false;
  }
}

async function getRasterCharacteristics(url) {
  const cached = rasterCharacteristicsByUrl.get(url);
  if (cached) {
    return cached;
  }

  const characteristicsPromise = analyzeRasterCharacteristics(url).catch((error) => ({
    status: 'error',
    reason: `Failed to inspect raster: ${error.message}`,
  }));
  rasterCharacteristicsByUrl.set(url, characteristicsPromise);
  return characteristicsPromise;
}

async function analyzeRasterCharacteristics(url) {
  const { fromUrl } = await import('geotiff');
  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const noDataValue = normalizeNumericValue(image.getGDALNoData());
  const sampleWidth = Math.max(1, Math.min(width, RASTER_SAMPLE_GRID_SIZE));
  const sampleHeight = Math.max(1, Math.min(height, RASTER_SAMPLE_GRID_SIZE));
  const sampleValues = await image.readRasters({
    samples: [0],
    interleave: true,
    width: sampleWidth,
    height: sampleHeight,
  });
  const sample = summarizeSampleValues(sampleValues, noDataValue);
  const classification = classifyRasterSample({
    sample,
    sampleFormat: image.fileDirectory?.SampleFormat?.[0] ?? null,
    bitsPerSample: image.fileDirectory?.BitsPerSample?.[0] ?? null,
  });

  return {
    status: 'ok',
    ...classification,
    noDataValue,
  };
}

function summarizeSampleValues(values, noDataValue) {
  let validCount = 0;
  let integerLikeCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const valueCounts = new Map();

  for (const rawValue of values) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (typeof noDataValue === 'number' && value === noDataValue) {
      continue;
    }

    validCount += 1;
    if (Math.abs(value - Math.round(value)) <= NON_INTEGER_TOLERANCE) {
      integerLikeCount += 1;
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }

    const key = Number(value.toFixed(6));
    valueCounts.set(key, (valueCounts.get(key) ?? 0) + 1);
  }

  const uniqueValues = [...valueCounts.keys()].sort((a, b) => a - b);
  const topValues = [...valueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));

  return {
    validCount,
    integerLikeCount,
    nonIntegerRatio: validCount > 0 ? (validCount - integerLikeCount) / validCount : 0,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    uniqueValues,
    uniqueCount: uniqueValues.length,
    topValues,
  };
}

function classifyRasterSample({ sample, sampleFormat, bitsPerSample }) {
  if (sample.validCount === 0) {
    return {
      classification: 'unknown',
      confidence: 'low',
      reason: 'No valid sampled cells after excluding noData/non-finite values.',
      sample,
      sampleFormat,
      bitsPerSample,
    };
  }

  const range =
    typeof sample.min === 'number' && typeof sample.max === 'number' ? sample.max - sample.min : null;
  const allIntegerLike = sample.nonIntegerRatio <= 0.01;
  const hasManyUniqueValues = sample.uniqueCount >= 16;
  const hasWideRange = typeof range === 'number' && range > 10;

  if (sample.nonIntegerRatio >= 0.05) {
    return {
      classification: 'continuous',
      confidence: 'high',
      reason: 'Sample contains substantial non-integer values.',
      sample,
      sampleFormat,
      bitsPerSample,
    };
  }

  if (sampleFormat === 3 && sample.uniqueCount > 2) {
    return {
      classification: 'continuous',
      confidence: 'medium',
      reason: 'Float sample format with more than two unique values.',
      sample,
      sampleFormat,
      bitsPerSample,
    };
  }

  if (allIntegerLike && sample.uniqueCount <= 3) {
    return {
      classification: 'binary',
      confidence: 'high',
      reason: 'Sample has three or fewer integer-like unique values.',
      sample,
      sampleFormat,
      bitsPerSample,
    };
  }

  if (allIntegerLike && hasManyUniqueValues && hasWideRange) {
    return {
      classification: 'continuous',
      confidence: 'high',
      reason: 'Integer-like sample has many unique values across a wide range.',
      sample,
      sampleFormat,
      bitsPerSample,
    };
  }

  return {
    classification: 'unknown',
    confidence: 'low',
    reason: 'Sample does not clearly match binary or continuous thresholds.',
    sample,
    sampleFormat,
    bitsPerSample,
  };
}

function toBinaryRenderingConfig(characteristics, layerId, dataRole) {
  const selectedValue = inferSelectedBinaryValue(characteristics.sample.uniqueValues, characteristics.noDataValue);
  const fallbackNoDataValue = inferNoDataFromBinaryValues(characteristics.sample.uniqueValues);
  const theme = inferLayerColorTheme(layerId, dataRole);

  return {
    valueType: 'binary',
    renderMode: 'mask',
    noDataValue:
      typeof characteristics.noDataValue === 'number' ? characteristics.noDataValue : fallbackNoDataValue,
    selectedValue,
    selectedColor: theme.binarySelectedColor,
  };
}

function inferSelectedBinaryValue(uniqueValues, noDataValue) {
  const viableValues = uniqueValues.filter(
    (value) => typeof noDataValue !== 'number' || value !== noDataValue,
  );
  if (viableValues.includes(1)) {
    return 1;
  }
  const nonZeroValue = viableValues.find((value) => value !== 0);
  if (typeof nonZeroValue === 'number') {
    return nonZeroValue;
  }
  return viableValues[0] ?? 1;
}

function inferNoDataFromBinaryValues(uniqueValues) {
  if (uniqueValues.includes(255)) {
    return 255;
  }
  if (uniqueValues.includes(-32768)) {
    return -32768;
  }
  return null;
}

function toContinuousRenderingConfig(characteristics, layerId, dataRole) {
  const minValue = typeof characteristics.sample.min === 'number' ? characteristics.sample.min : null;
  const maxValue = typeof characteristics.sample.max === 'number' ? characteristics.sample.max : null;
  const hasValidRange = typeof minValue === 'number' && typeof maxValue === 'number' && maxValue > minValue;
  const theme = inferLayerColorTheme(layerId, dataRole);

  return {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: typeof characteristics.noDataValue === 'number' ? characteristics.noDataValue : null,
    minValue: hasValidRange ? minValue : null,
    maxValue: hasValidRange ? maxValue : null,
    startColor: theme.gradientStartColor,
    endColor: theme.gradientEndColor,
  };
}

function normalizeNumericValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferLayerColorTheme(layerId, dataRole) {
  const seed = hashStringToPositiveInt(layerId);
  const [minHue, maxHue] = dataRole === 'cost_layer' ? [6, 35] : [55, 320];
  const hueSpan = maxHue - minHue;
  const hue = minHue + (seed % (hueSpan + 1));

  return {
    binarySelectedColor: hslToHex(hue, 78, 42),
    gradientStartColor: hslToHex(hue, 72, 86),
    gradientEndColor: hslToHex(hue, 74, 33),
  };
}

function hashStringToPositiveInt(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(100, s)) / 100;
  const lightness = Math.max(0, Math.min(100, l)) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (hue < 60) {
    rPrime = chroma;
    gPrime = x;
  } else if (hue < 120) {
    rPrime = x;
    gPrime = chroma;
  } else if (hue < 180) {
    gPrime = chroma;
    bPrime = x;
  } else if (hue < 240) {
    gPrime = x;
    bPrime = chroma;
  } else if (hue < 300) {
    rPrime = x;
    bPrime = chroma;
  } else {
    rPrime = chroma;
    bPrime = x;
  }

  const r = Math.round((rPrime + m) * 255);
  const g = Math.round((gPrime + m) * 255);
  const b = Math.round((bPrime + m) * 255);
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
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

function inferProposedCategoryId(row) {
  const layerId = toLayerId(row.layer_id);
  const csvGroupId = toLayerId(row.layer_group || 'uncategorized');

  return (
    proposedLayerCategoryOverrides[layerId] ??
    proposedCsvGroupCategoryIds[csvGroupId] ??
    'territorial_planning'
  );
}

function shouldTeamReviewCategory(row, proposedCategoryId) {
  const layerId = toLayerId(row.layer_id);
  const csvGroupId = toLayerId(row.layer_group || 'uncategorized');

  return (
    !isTrue(row.in_use_now) ||
    csvGroupId === 'limite_politico_o_administrativo' ||
    csvGroupId === 'costo' ||
    proposedCategoryId === 'territorial_planning'
  );
}

function createCategoryReviewRows(rows) {
  return rows.map((row) => {
    const layerId = toLayerId(row.layer_id);
    const labels = splitLayerLabels(row.layer_name);
    const proposedCategoryId = inferProposedCategoryId(row);
    const proposedCategory = proposedManifestCategories[proposedCategoryId];

    return {
      layer_id: layerId,
      layer_name_spanish: labels.spanishLabel,
      layer_name_english: labels.englishLabel,
      current_csv_layer_group: row.layer_group,
      in_use_now: isTrue(row.in_use_now) ? 'TRUE' : 'FALSE',
      proposed_manifest_category_id: proposedCategoryId,
      proposed_category_spanish_label: proposedCategory.spanishLabel,
      proposed_category_english_label: proposedCategory.englishLabel,
      proposed_frontend_group: proposedCategory.frontendGroup,
      needs_team_review: shouldTeamReviewCategory(row, proposedCategoryId) ? 'TRUE' : 'FALSE',
      team_approved_category_id: '',
      team_notes: '',
    };
  });
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? '');

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function toCsv(rows) {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ];

  return `${lines.join('\n')}\n`;
}

async function extractCurrentFrontendCategories() {
  const source = await fs.readFile(LEFT_SIDEBAR_SOURCE_PATH, 'utf-8');
  const groupStart = source.indexOf('private createDefaultGroups(): LayerGroup[]');
  const groupEnd = source.indexOf('private layerRow(', groupStart);
  const groupSource = groupStart >= 0 && groupEnd > groupStart ? source.slice(groupStart, groupEnd) : '';
  const categories = [
    {
      id: 'management-figures',
      title: 'Management Figures',
      source: 'createDefaultOverlays',
      notes: 'Overlay card above category groups; currently contains solution, RUNAP, and OMEC rows.',
    },
  ];

  for (const match of groupSource.matchAll(/id:\s*'([^']+)'[\s\S]*?title:\s*'([^']+)'/g)) {
    categories.push({
      id: match[1],
      title: match[2],
      source: 'createDefaultGroups',
    });
  }

  return categories;
}

function buildCategoryMappingReport({ categories, layerEntries, currentFrontendCategories }) {
  const frontendById = new Map(currentFrontendCategories.map((category) => [category.id, category]));
  const manifestCategoryMappings = categories.map((category) => {
    const rule = categoryMappingRules[category.id];
    const frontendCategoryIds = rule?.frontendCategoryIds ?? [];
    const layerMappings = category.layerIds.map((layerId) => {
      const layer = layerEntries.find((entry) => entry.manifestLayer.id === layerId)?.manifestLayer;
      const frontendCategoryId = rule?.layerLevelFrontendCategoryIds?.[layerId] ?? frontendCategoryIds[0] ?? null;

      return {
        layerId,
        spanishLabel: layer?.spanishLabel ?? null,
        dataRole: layer?.dataRole ?? null,
        frontendCategoryId,
        frontendCategoryTitle: frontendCategoryId ? frontendById.get(frontendCategoryId)?.title ?? null : null,
      };
    });

    return {
      manifestCategoryId: category.id,
      manifestSpanishLabel: category.spanishLabel,
      layerIds: category.layerIds,
      frontendCategoryIds,
      frontendCategoryTitles: frontendCategoryIds.map((id) => frontendById.get(id)?.title ?? null),
      status: rule?.status ?? 'needs_mapping_rule',
      notes: rule?.notes ?? 'No mapping rule has been defined for this manifest category.',
      layerMappings,
    };
  });

  const mappedFrontendCategoryIds = new Set(
    manifestCategoryMappings.flatMap((mapping) => mapping.frontendCategoryIds),
  );
  const frontendCategoriesWithoutManifestMapping = currentFrontendCategories
    .filter((category) => !mappedFrontendCategoryIds.has(category.id))
    .map((category) => ({
      id: category.id,
      title: category.title,
      source: category.source,
      notes: category.notes ?? 'No included CSV layer currently maps to this sidebar category.',
    }));

  return {
    generatedAt: GENERATED_AT,
    whyThisReportExists: {
      purpose:
        'Helps developers compare generated manifest categories against the current left-sidebar map layer groups.',
      intendedAudience: 'Developers and product reviewers working on sidebar category integration.',
      howToUse:
        'Review mappings with status values that include "needs" before changing sidebar grouping behavior.',
    },
    sourceCsv: path.relative(repoRoot, REQUIRED_LAYERS_CSV),
    frontendSource: path.relative(repoRoot, LEFT_SIDEBAR_SOURCE_PATH),
    counts: {
      manifestCategories: categories.length,
      currentFrontendCategories: currentFrontendCategories.length,
      mappedManifestCategories: manifestCategoryMappings.filter(
        (mapping) => mapping.status !== 'needs_mapping_rule',
      ).length,
      manifestCategoriesNeedingReview: manifestCategoryMappings.filter((mapping) =>
        mapping.status.includes('needs'),
      ).length,
      frontendCategoriesWithoutManifestMapping: frontendCategoriesWithoutManifestMapping.length,
    },
    currentFrontendCategories,
    manifestCategoryMappings,
    frontendCategoriesWithoutManifestMapping,
  };
}

function buildReport({ allRows, includedRows, layerEntries, blobInventory, categoryMappingReport }) {
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

  const renderingInferenceCounts = layerEntries.reduce(
    (counts, entry) => {
      const strategy = entry.reconciliation.renderingInference?.strategy ?? 'unknown';
      counts.byStrategy[strategy] = (counts.byStrategy[strategy] ?? 0) + 1;
      if (entry.reconciliation.renderingInference?.confidence === 'low') {
        counts.lowConfidence += 1;
      }
      return counts;
    },
    { byStrategy: {}, lowConfidence: 0 },
  );

  return {
    generatedAt: GENERATED_AT,
    whyThisReportExists: {
      purpose:
        'Shows whether required CSV layers have matching display assets in Vercel Blob and highlights related manifest-generation gaps.',
      intendedAudience: 'Developers validating Blob Storage contents before wiring layers into the tool.',
      howToUse:
        'Check missingRequired first, then extraAvailable and includedRowMetadataGaps, before treating the generated manifest as ready for frontend integration.',
    },
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
      manifestCategoriesNeedingReview:
        categoryMappingReport.counts.manifestCategoriesNeedingReview,
      frontendCategoriesWithoutManifestMapping:
        categoryMappingReport.counts.frontendCategoriesWithoutManifestMapping,
      renderingInferenceLowConfidence: renderingInferenceCounts.lowConfidence,
    },
    missingRequired,
    extraAvailable,
    includedRowMetadataGaps,
    categoryMappingSummary: {
      reportPath: path.relative(repoRoot, CATEGORY_MAPPING_REPORT_PATH),
      manifestCategoriesNeedingReview:
        categoryMappingReport.counts.manifestCategoriesNeedingReview,
      frontendCategoriesWithoutManifestMapping:
        categoryMappingReport.counts.frontendCategoriesWithoutManifestMapping,
    },
    renderingInferenceSummary: renderingInferenceCounts,
    excludedRows,
  };
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

async function writeText(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data, 'utf-8');
}

async function archiveExistingManifestIfChanged(nextManifestJson) {
  let existingManifestJson;
  try {
    existingManifestJson = await fs.readFile(GENERATED_MANIFEST_PATH, 'utf-8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  if (existingManifestJson === nextManifestJson) {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveFileName = `manifest.${timestamp}.json`;
  const archivePath = path.resolve(MANIFEST_ARCHIVE_ROOT, archiveFileName);
  await fs.mkdir(MANIFEST_ARCHIVE_ROOT, { recursive: true });
  await fs.writeFile(archivePath, existingManifestJson, 'utf-8');
  await pruneManifestArchive();

  return archivePath;
}

async function pruneManifestArchive() {
  const archiveEntries = await fs.readdir(MANIFEST_ARCHIVE_ROOT, { withFileTypes: true });
  const files = archiveEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  const filesToRemove = files.slice(0, Math.max(0, files.length - MAX_ARCHIVED_MANIFESTS));
  for (const fileName of filesToRemove) {
    await fs.unlink(path.resolve(MANIFEST_ARCHIVE_ROOT, fileName));
  }
}

async function main() {
  await loadLocalEnv(path.resolve(__dirname, '..'));

  const csvRaw = await fs.readFile(REQUIRED_LAYERS_CSV, 'utf-8');
  const rows = rowsToObjects(parseCsv(csvRaw));
  const includedRows = rows.filter((row) => isTrue(row.in_use_now) && isDisplayCandidate(row));
  const blobInventory = await readBlobInventory();
  const blobByPath = new Map(blobInventory.map((blob) => [blob.pathname, blob]));
  const layerEntries = await Promise.all(includedRows.map((row) => createLayerEntry(row, blobByPath)));
  const categories = createCategories(includedRows, layerEntries);
  const layers = layerEntries.map((entry) => entry.manifestLayer);
  const currentFrontendCategories = await extractCurrentFrontendCategories();
  const categoryMappingReport = buildCategoryMappingReport({
    categories,
    layerEntries,
    currentFrontendCategories,
  });
  const report = buildReport({
    allRows: rows,
    includedRows,
    layerEntries,
    blobInventory,
    categoryMappingReport,
  });

  const manifest = {
    version: '0.1.0',
    generatedAt: GENERATED_AT,
    publicBlobHost: PUBLIC_BLOB_HOST,
    sourceCsv: path.relative(repoRoot, REQUIRED_LAYERS_CSV),
    categories,
    layers,
  };

  const nextManifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const archivedManifestPath = await archiveExistingManifestIfChanged(nextManifestJson);

  await writeJson(GENERATED_MANIFEST_PATH, manifest);
  await writeJson(CATEGORY_MAPPING_REPORT_PATH, categoryMappingReport);
  await writeJson(REPORT_PATH, report);
  await writeText(CATEGORY_REVIEW_CSV_PATH, toCsv(createCategoryReviewRows(rows)));

  console.log(`[generate:layer-manifest] wrote ${path.relative(repoRoot, GENERATED_MANIFEST_PATH)}`);
  if (archivedManifestPath) {
    console.log(`[generate:layer-manifest] archived ${path.relative(repoRoot, archivedManifestPath)}`);
  }
  console.log(`[generate:layer-manifest] wrote ${path.relative(repoRoot, CATEGORY_MAPPING_REPORT_PATH)}`);
  console.log(`[generate:layer-manifest] wrote ${path.relative(repoRoot, REPORT_PATH)}`);
  console.log(`[generate:layer-manifest] wrote ${path.relative(repoRoot, CATEGORY_REVIEW_CSV_PATH)}`);
  console.log(
    `[generate:layer-manifest] ${layers.length} layer(s), ${report.counts.missingRequired} missing required, ${report.counts.extraAvailable} extra available`,
  );
}

main().catch((error) => {
  console.error(`[generate:layer-manifest] ${error.message}`);
  process.exit(1);
});
