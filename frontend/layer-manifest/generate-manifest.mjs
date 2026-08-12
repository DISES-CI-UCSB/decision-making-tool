import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.mjs';
import { parseBlobListOutput } from './lib/blob-cli-output.mjs';
import { parseCsv, rowsToObjects, toCsv } from './lib/csv.mjs';
import { toBlobPath, toLayerId } from './lib/layer-normalization.mjs';
import {
  createReleaseBoundaryUrls,
  createSolutionPrecomputedMetricUrls,
} from './lib/metric-urls.mjs';
import { selectManifestSolutions } from './lib/solution-preservation.mjs';
import {
  bindManifestSolutionsToCatalog,
  readSolutionCatalog,
  validateManifestAgainstCatalog,
} from './lib/solution-catalog.mjs';
import {
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
  PUBLIC_BLOB_HOST,
  RUNTIME_MANIFEST_BLOB_URL,
} from '../shared/runtime-manifest.constants.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const REQUIRED_LAYERS_CSV = path.resolve(
  repoRoot,
  'data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv',
);
const MARINE_ECOSYSTEM_CATEGORIES_CSV = path.resolve(
  repoRoot,
  'data/inputs/features/marine/marine_ecosystem_categories.csv',
);
const GENERATED_MANIFEST_PATH = path.resolve(
  repoRoot,
  'frontend',
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
);
const REPORTS_ROOT = path.resolve(repoRoot, 'development-artifacts/layer-manifest/reports');
const MANIFEST_ARCHIVE_ROOT = path.resolve(
  repoRoot,
  'development-artifacts/layer-manifest/archive',
);
const MAX_ARCHIVED_MANIFESTS = 30;
const REPORT_PATH = path.resolve(REPORTS_ROOT, 'reconciliation-report.json');
const CATEGORY_MAPPING_REPORT_PATH = path.resolve(REPORTS_ROOT, 'category-mapping-report.json');
const CATEGORY_REVIEW_CSV_PATH = path.resolve(REPORTS_ROOT, 'category-review.csv');
const SOLUTION_RECONCILIATION_REPORT_PATH = path.resolve(
  REPORTS_ROOT,
  'solutions-reconciliation-report.json',
);
const LEFT_SIDEBAR_SOURCE_PATH = path.resolve(
  __dirname,
  '../src/app/features/left-sidebar/map-layers-panel/map-layers-panel.ts',
);
const GENERATED_AT = new Date().toISOString();

const BLOB_PREFIXES = [
  'boundaries/',
  'inputs/boundaries/',
  'inputs/costs/',
  'inputs/features/biomass/',
  'inputs/features/carbon/',
  'inputs/features/ecosystems/',
  'inputs/features/ground_water_recharge/',
  'inputs/features/marine/',
  'inputs/features/species_richness/',
  'inputs/features/strategic/',
  'inputs/includes/',
  'inputs/reference/',
  'metadata/',
];
const COLLECTION_PREFIXES = ['inputs/features/species/'];
const SOLUTION_BLOB_PREFIXES = ['solutions/'];
const RASTER_SAMPLE_GRID_SIZE = 64;
const NON_INTEGER_TOLERANCE = 1e-6;
const DEFAULT_BINARY_SELECTED_COLOR = '#16a34a';
const DEFAULT_CONTINUOUS_START_COLOR = '#bbf7d0';
const DEFAULT_CONTINUOUS_END_COLOR = '#166534';
const MANIFEST_SCHEMA_VERSION = '0.2.0';
const SPECIES_AND_BIODIVERSITY_CATEGORY_ID = 'species_and_biodiversity';
const SPECIES_MANIFEST_URL = `${PUBLIC_BLOB_HOST}/manifests/species.manifest.json`;

function getRegisteredSolutionBlobPrefixes(args) {
  const prefixes = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--register-solution-prefix' && args[index + 1]) {
      prefixes.push(args[index + 1]);
      index += 1;
    }
  }
  return prefixes;
}

function getReleaseId(args) {
  const index = args.indexOf('--release-id');
  if (index < 0) return null;
  const releaseId = args[index + 1];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(releaseId ?? '')) {
    throw new Error('--release-id requires a lowercase, hyphenated immutable release id');
  }
  return releaseId;
}

function getCatalogPath(args) {
  const index = args.indexOf('--catalog');
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--catalog requires a path to a solution-catalog-v1 JSON file');
  }
  return path.resolve(process.cwd(), value);
}

/**
 * Curated per-category palette used to seed brand-new layers and categories.
 * `selectedColor` is the binary-mask default; `startColor`/`endColor` form the
 * continuous gradient. New layers within a known category derive their color by
 * hashing the `layerId` to a small hue offset around this base.
 */
const CATEGORY_PALETTE = {
  administrative_boundaries: {
    selectedColor: '#111827',
    startColor: '#e5e7eb',
    endColor: '#111827',
  },
  species_and_biodiversity: {
    selectedColor: '#854d0e',
    startColor: '#fef3c7',
    endColor: '#854d0e',
  },
  ecosystems: {
    selectedColor: '#166534',
    startColor: '#bbf7d0',
    endColor: '#166534',
  },
  environmental_services: {
    selectedColor: '#0f766e',
    startColor: '#ccfbf1',
    endColor: '#0f766e',
  },
  management_figures: {
    selectedColor: '#3730a3',
    startColor: '#e0e7ff',
    endColor: '#3730a3',
  },
  cultural_and_ethnic_territories: {
    selectedColor: '#1d4ed8',
    startColor: '#dbeafe',
    endColor: '#1d4ed8',
  },
  socioeconomic: {
    selectedColor: '#991b1b',
    startColor: '#fee2e2',
    endColor: '#991b1b',
  },
  conflict_and_security: {
    selectedColor: '#9f1239',
    startColor: '#ffe4e6',
    endColor: '#9f1239',
  },
  territorial_planning: {
    selectedColor: '#4d7c0f',
    startColor: '#ecfccb',
    endColor: '#4d7c0f',
  },
  prospective_models: {
    selectedColor: '#155e75',
    startColor: '#cffafe',
    endColor: '#155e75',
  },
  solutions: {
    selectedColor: '#9d174d',
    startColor: '#fce7f3',
    endColor: '#9d174d',
  },
};
const CATEGORY_PALETTE_FALLBACK = {
  selectedColor: '#475569',
  startColor: '#e2e8f0',
  endColor: '#475569',
};
const LAYER_HUE_OFFSET_RANGE_DEGREES = 15;

export function getCategoryPalette(categoryId) {
  return CATEGORY_PALETTE[categoryId] ?? CATEGORY_PALETTE_FALLBACK;
}
const DEFAULT_SOLUTION_RENDERING = {
  valueType: 'categorical',
  renderMode: 'categorical',
  noDataValue: 255,
  classColors: [
    { value: 1, color: '#16a34a', label: 'New coverage' },
    { value: 2, color: '#2563eb', label: 'Existing protected areas' },
  ],
};

/**
 * Hardcoded English labels for layers whose CSV row has no English line.
 * Add an entry here when the blob-discovered layer has no CSV row or the
 * layer_name cell is single-line (Spanish only).
 */
const englishLabelOverrideByLayerId = {
  paramos: 'Páramos',
  siraps: 'SIRAP',
  siraps_territorial: 'Territorial SIRAPs',
  siraps_territorial_updated: 'Territorial SIRAPs (updated, needs metric calculation)',
  siraps_thematic: 'Thematic SIRAP Additions',
  omecs: 'OMECs (raster)',
  marine_ecosystems: 'Marine Ecosystems',
  admin_departments: 'Departments',
  admin_municipalities: 'Municipalities',
};

/**
 * Optional per-layer overrides for rendering inference.
 * Keep these entries rare and explicit when domain knowledge must win.
 */
const renderingOverrideByLayerId = {
  ecosistemas: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: 4294967295,
    minValue: null,
    maxValue: null,
    startColor: DEFAULT_CONTINUOUS_START_COLOR,
    endColor: DEFAULT_CONTINUOUS_END_COLOR,
  },
  marine_ecosystems: null,
  species_richness: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: 255,
    minValue: 815,
    maxValue: 3562,
    startColor: '#fef3c7',
    endColor: '#854d0e',
  },
  species_richness_mammals: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: 65535,
    minValue: 1,
    maxValue: 142,
    startColor: '#f3e8ff',
    endColor: '#7e22ce',
  },
  species_richness_birds: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: 65535,
    minValue: 1,
    maxValue: 823,
    startColor: '#dbeafe',
    endColor: '#1d4ed8',
  },
  species_richness_amphibians: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: 65535,
    minValue: 1,
    maxValue: 56,
    startColor: '#dcfce7',
    endColor: '#15803d',
  },
  species_richness_reptiles: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: 65535,
    minValue: 1,
    maxValue: 68,
    startColor: '#ffedd5',
    endColor: '#c2410c',
  },
  species_richness_plants: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: 65535,
    minValue: 1,
    maxValue: 2884,
    startColor: '#ccfbf1',
    endColor: '#0f766e',
  },
  human_footprint_2022: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: null,
    minValue: 0,
    maxValue: 100,
    startColor: '#fee2e2',
    endColor: '#991b1b',
  },
  hhm: {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue: null,
    minValue: 0,
    maxValue: 100,
    startColor: '#ecfeff',
    endColor: '#155e75',
  },
  coberturas: {
    valueType: 'categorical',
    renderMode: 'categorical',
    noDataValue: null,
    classColors: [
      {
        value: 1,
        color: '#166534',
        englishLabel: 'Forest / semi-natural',
        spanishLabel: 'Bosques y áreas seminaturales',
        label: 'Forest / semi-natural',
      },
      {
        value: 2,
        color: '#a3e635',
        englishLabel: 'Agriculture',
        spanishLabel: 'Territorios agrícolas',
        label: 'Agriculture',
      },
      {
        value: 3,
        color: '#0ea5e9',
        englishLabel: 'Wetlands',
        spanishLabel: 'Áreas Húmedas',
        label: 'Wetlands',
      },
      {
        value: 4,
        color: '#2563eb',
        englishLabel: 'Water',
        spanishLabel: 'Superficies de Agua',
        label: 'Water',
      },
      {
        value: 5,
        color: '#f97316',
        englishLabel: 'Urban / artificial',
        spanishLabel: 'Territorios Artificializados',
        label: 'Urban / artificial',
      },
    ],
  },
};

const forcedRenderingOverrideLayerIds = new Set([
  'species_richness_mammals',
  'species_richness_birds',
  'species_richness_amphibians',
  'species_richness_reptiles',
  'species_richness_plants',
]);

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
    spanishLabel: 'Áreas de conservación',
    englishLabel: 'Conservation Areas',
    frontendGroup: 'Conservation Areas',
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
  zonas_reserva_campesina_constituida: 'cultural_and_ethnic_territories',
  ramsar: 'ecosystems',
  biosphere_reserves: 'ecosystems',
  reservas_forestales_ley_2_1959: 'ecosystems',
  kba_aica: 'species_and_biodiversity',
  marine_ecosystems: 'ecosystems',
  runap: 'management_figures',
  omecs: 'management_figures',
  comunidades: 'cultural_and_ethnic_territories',
  resguardos: 'cultural_and_ethnic_territories',
  siraps: 'administrative_boundaries',
  siraps_territorial: 'administrative_boundaries',
  siraps_territorial_updated: 'administrative_boundaries',
  siraps_thematic: 'administrative_boundaries',
  admin_departments: 'administrative_boundaries',
  admin_municipalities: 'administrative_boundaries',
  human_footprint_2022: 'socioeconomic',
  human_footprint_2030: 'prospective_models',
  net_benefit: 'socioeconomic',
  coberturas: 'socioeconomic',
  conflict: 'conflict_and_security',
  climate_refugia: 'prospective_models',
};

const tooltipOverrideByLayerId = {
  siraps: `SIRAP stands for Sistema Regional de Áreas Protegidas, Colombia's regional protected area system. This is the SIRAP boundaries layer, so the Spanish source term "límites" refers to the boundary lines shown on the map. The combined layer includes territorial SIRAP boundaries plus thematic additions such as Eje Cafetero and Macizo.`,
  siraps_territorial:
    'Territorial SIRAPs are the broad regional conservation systems used as overarching SIRAP categories.',
  siraps_territorial_updated:
    'Authoritative Territorial SIRAP boundaries for view-only comparison. Selection and metrics are unavailable until this source is recalculated.',
  siraps_thematic:
    'Thematic SIRAPs are special additions, such as Eje Cafetero and Macizo, that may overlap territorial SIRAPs.',
};

const metricAuditLayerIds = new Set(['conflict', 'recarga_agua_subterranea_moderado_alto']);
const redistributionBlockedLayerIds = new Set(['kba_aica']);

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
    notes: 'RUNAP and OMEC layers map to the existing Conservation Areas overlay group.',
  },
  administrative_boundaries: {
    frontendCategoryIds: ['group-admin-boundaries'],
    status: 'maps_cleanly',
    notes:
      'Administrative boundary layers map to the existing Administrative Boundaries sidebar group.',
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
    notes: 'Solution layers currently appear in the existing Conservation Areas overlay group.',
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
  'geojson',
  'geotiff',
  'geotiff or feature service',
  'shapefile',
]);

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

async function loadMarineEcosystemRendering() {
  const raw = await fs.readFile(MARINE_ECOSYSTEM_CATEGORIES_CSV, 'utf-8');
  const [header, ...rows] = parseCsv(raw);
  const labelIndex = header.indexOf('biome');
  const valueIndex = header.indexOf('biome_id');
  if (labelIndex < 0 || valueIndex < 0) {
    throw new Error('Marine ecosystem categories must include biome and biome_id columns');
  }

  return {
    valueType: 'categorical',
    renderMode: 'categorical',
    noDataValue: 0,
    classColors: rows.map((row) => {
      const label = row[labelIndex];
      const value = Number(row[valueIndex]);
      const ecosystemGroup = label.split(/\s+en\s+/iu)[0] || label;
      const hue = hashStringToPositiveInt(ecosystemGroup) % 360;
      const lightness = 40 + (hashStringToPositiveInt(label) % 21);
      return {
        value,
        color: hslToHex(hue, 58, lightness),
        label,
      };
    }),
  };
}

function isDisplayCandidate(row) {
  const normalizedFormat = row.data_format.toLowerCase();
  return [...displayAssetFormats].some((format) => normalizedFormat.includes(format));
}

export function shouldIncludeManifestRow(row) {
  const layerId = toLayerId(row.layer_id);
  if (redistributionBlockedLayerIds.has(layerId)) {
    return false;
  }

  return (
    (isTrue(row.in_use_now) || metricAuditLayerIds.has(layerId)) &&
    isDisplayCandidate(row)
  );
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

async function readSolutionBlobInventory() {
  const blobs = [];

  for (const prefix of SOLUTION_BLOB_PREFIXES) {
    blobs.push(...(await listBlobPrefix(prefix)));
  }

  const unique = new Map();
  for (const blob of blobs) {
    unique.set(blob.pathname, blob);
  }

  return [...unique.values()];
}

function isSolutionMetadataBlob(blob) {
  return path.posix.extname(blob.pathname).toLowerCase() === '.json';
}

function isSolutionRasterBlob(blob) {
  const extension = path.posix.extname(blob.pathname).toLowerCase();
  return extension === '.tif' || extension === '.tiff';
}

async function fetchJson(url) {
  const response = await fetch(url, { method: 'GET', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function createSolutionCatalog(solutionBlobInventory) {
  const metadataBlobs = solutionBlobInventory.filter(isSolutionMetadataBlob);
  const rasterByPath = new Map(
    solutionBlobInventory.filter(isSolutionRasterBlob).map((blob) => [blob.pathname, blob]),
  );
  const rasterPathsUsed = new Set();
  const solutionIdsUsed = new Set();
  const included = [];
  const skipped = [];
  const solutions = [];

  for (const metadataBlob of metadataBlobs) {
    let metadata;
    try {
      metadata = await fetchJson(metadataBlob.url);
    } catch (error) {
      skipped.push({
        pathname: metadataBlob.pathname,
        reason: 'malformed_or_unreadable_metadata',
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const metadataDirectory = path.posix.dirname(metadataBlob.pathname);
    const metadataStem = path.posix.basename(metadataBlob.pathname, '.json');
    const rasterPath = metadata.raster_file
      ? path.posix.join(metadataDirectory, metadata.raster_file)
      : `${metadataDirectory}/${metadataStem}.tif`;
    const rasterBlob = rasterByPath.get(rasterPath);

    if (!rasterBlob) {
      skipped.push({
        pathname: metadataBlob.pathname,
        reason: 'missing_raster_pair',
        expectedRasterPath: rasterPath,
      });
      continue;
    }

    const solution = createSolutionManifestEntry({
      metadata,
      metadataBlob,
      rasterBlob,
    });

    if (solutionIdsUsed.has(solution.id)) {
      skipped.push({
        pathname: metadataBlob.pathname,
        reason: 'duplicate_solution_id',
        solutionId: solution.id,
      });
      continue;
    }

    solutionIdsUsed.add(solution.id);
    rasterPathsUsed.add(rasterBlob.pathname);
    solutions.push(solution);
    included.push({
      id: solution.id,
      name: solution.name,
      scope: solution.scope,
      displayUrl: solution.displayUrl,
      metadataUrl: solution.metadataUrl,
    });
  }

  const unmatchedRasters = [...rasterByPath.values()]
    .filter((blob) => !rasterPathsUsed.has(blob.pathname))
    .map((blob) => ({
      pathname: blob.pathname,
      url: blob.url,
      bytes: blob.bytes,
    }));

  solutions.sort((a, b) => a.name.localeCompare(b.name));

  return {
    solutions,
    report: {
      generatedAt: GENERATED_AT,
      whyThisReportExists: {
        purpose:
          'Shows how Vercel Blob solution rasters and metadata files were converted into manifest.solutions.',
        intendedAudience: 'Developers and reviewers validating Solution Finder data readiness.',
        howToUse:
          'Check skipped and unmatchedRasters before assuming the solution catalog represents every intended run.',
      },
      sourcePrefixes: SOLUTION_BLOB_PREFIXES,
      counts: {
        blobInventoryEntries: solutionBlobInventory.length,
        metadataFiles: metadataBlobs.length,
        rasterFiles: rasterByPath.size,
        includedSolutions: solutions.length,
        skippedMetadataFiles: skipped.length,
        unmatchedRasters: unmatchedRasters.length,
      },
      included,
      skipped,
      unmatchedRasters,
    },
  };
}

export function createSolutionManifestEntry({ metadata, metadataBlob, rasterBlob }) {
  const inputLayerIds = normalizeSolutionInputLayerIds(metadata.input_layer_ids);
  const coverage = normalizeSolutionCoverage(metadata.coverage);
  const scope = normalizeSolutionScope(metadata.scope, metadataBlob.pathname);
  const domain = normalizeSolutionDomain(metadata.domain, scope);
  const structuredTargets = buildStructuredTargets(coverage, metadata);
  const id = toLayerId(
    metadata.id ||
      metadata.run_name ||
      path.posix.basename(rasterBlob.pathname, path.extname(rasterBlob.pathname)),
  );
  const name = metadata.run_name || id;
  const finderInputs = {
    domain,
    scope,
    targetFeatureSet: inferSolutionTargetFeatureSet({ metadata, structuredTargets }),
    targetFeatureIds: inputLayerIds.features,
    targetPercent: inferTargetPercent(metadata.target_percent, coverage),
    structuredTargets,
    costLayerId: inputLayerIds.cost,
    includeLayerIds: inputLayerIds.includes,
    excludeLayerIds: inputLayerIds.excludes,
  };

  return {
    id,
    name,
    description:
      metadata.description ||
      createSolutionDescription({
        name,
        finderInputs,
        inputLayerIds,
      }),
    domain,
    scope,
    ...(scope === 'sirap' ? { sirapId: inferSirapIdFromPath(metadataBlob.pathname) } : {}),
    displayUrl: rasterBlob.url,
    metadataUrl: metadataBlob.url,
    rasterFile: path.posix.basename(rasterBlob.pathname),
    metadataFile: path.posix.basename(metadataBlob.pathname),
    blobPath: rasterBlob.pathname,
    generatedAt: metadata.generated_at_utc ?? null,
    finderInputs,
    inputLayerIds,
    summaryMetrics: normalizeSolutionSummaryMetrics(metadata.evaluation, coverage),
    coverage,
    precomputedMetricUrls: createSolutionPrecomputedMetricUrls(id, {}, domain),
    rendering: DEFAULT_SOLUTION_RENDERING,
  };
}

function normalizeSolutionInputLayerIds(inputLayerIds = {}) {
  return {
    features: normalizeIdList(inputLayerIds.features),
    cost: normalizeSolutionInputId(inputLayerIds.cost),
    includes: normalizeIdList(inputLayerIds.includes),
    excludes: normalizeIdList(inputLayerIds.excludes),
  };
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeSolutionInputId).filter(Boolean);
}

function normalizeSolutionInputId(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return toLayerId(value.replace(/^(FEAT|COST|INCL|EXCL)_/i, ''));
}

export function normalizeSolutionCoverage(coverage) {
  if (!Array.isArray(coverage)) {
    return [];
  }

  return coverage.map((row) => ({
    feature:
      typeof row.feature === 'string' && row.feature.trim().length > 0
        ? row.feature.trim()
        : 'unknown',
    met: parseBooleanOrNull(row.met),
    relativeTarget: parseFiniteNumberOrNull(row.relative_target),
    relativeHeld: parseFiniteNumberOrNull(row.relative_held),
    relativeShortfall: parseFiniteNumberOrNull(row.relative_shortfall),
    type:
      typeof (row.type ?? row.feature_type) === 'string'
        ? (row.type ?? row.feature_type).trim()
        : null,
    targetDimension:
      typeof (row.targetDimension ?? row.target_dimension) === 'string'
        ? (row.targetDimension ?? row.target_dimension).trim()
        : null,
    evaluated:
      typeof (row.evaluated ?? row.evaluation_source) === 'string'
        ? (row.evaluated ?? row.evaluation_source).trim()
        : null,
  }));
}

const STRUCTURED_TARGET_DIMENSIONS = [
  'ecosystems',
  'strategicEcosystems',
  'ecosystemServices',
  'speciesRepresentation',
  'espRn',
];

export function buildStructuredTargets(coverage, metadata = {}) {
  const dimensions = Object.fromEntries(
    STRUCTURED_TARGET_DIMENSIONS.map((dimension) => [dimension, []]),
  );
  const authoritativeRows = coverage.filter((row) => row.evaluated === 'prioritizr_model');
  const rows =
    authoritativeRows.length > 0
      ? authoritativeRows
      : coverage.filter(
          (row) =>
            row.evaluated === null &&
            coverage.length === 1 &&
            normalizeTargetFeatureId(row.feature) === 'ecosistemas',
        );
  const explicitFeatureSet = normalizeTargetFeatureId(metadata.target_feature_set);

  for (const row of rows) {
    if (typeof row.relativeTarget !== 'number') continue;
    const featureId = normalizeTargetFeatureId(row.feature);
    const type = (row.type ?? '').toLowerCase();
    let dimension = null;
    if (STRUCTURED_TARGET_DIMENSIONS.includes(row.targetDimension)) {
      dimension = row.targetDimension;
    } else if (/^esprn(?:_|$)/i.test(featureId)) dimension = 'espRn';
    else if (type.includes('species') && explicitFeatureSet.includes('esp_rn')) {
      dimension = 'espRn';
    } else if (type.includes('species')) dimension = 'speciesRepresentation';
    else if (type.includes('service') || type.includes('servicio')) dimension = 'ecosystemServices';
    else if (['paramos', 'bosque_seco', 'humedales', 'wetlands', 'manglares'].includes(featureId)) {
      dimension = 'strategicEcosystems';
    } else if (type.includes('ecosystem') || featureId === 'ecosistemas') {
      dimension = 'ecosystems';
    }
    if (dimension) {
      dimensions[dimension].push({
        featureId,
        targetPercent: Number((row.relativeTarget * 100).toFixed(6)),
      });
    }
  }
  for (const dimension of STRUCTURED_TARGET_DIMENSIONS) {
    dimensions[dimension].sort((left, right) => left.featureId.localeCompare(right.featureId));
  }
  return {
    format: 'solution-target-metadata-v1',
    sourceEvaluation: authoritativeRows.length > 0 ? 'prioritizr_model' : 'legacy-single-ecosystem',
    ...dimensions,
  };
}

function normalizeTargetFeatureId(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeSolutionSummaryMetrics(evaluation = {}, coverage = []) {
  return {
    nSelected: parseFiniteNumberOrNull(evaluation.n_selected),
    totalCost: parseFiniteNumberOrNull(evaluation.cost),
    pctTargetsMet: parseFiniteNumberOrNull(evaluation.pct_targets_met),
    coverageRowCount: coverage.length,
  };
}

function parseFiniteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseBooleanOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return null;
}

function normalizeSolutionScope(scope, pathname) {
  if (typeof scope === 'string' && scope.trim().length > 0) {
    return toLayerId(scope);
  }

  const [, maybeScope] = pathname.split('/');
  return maybeScope ? toLayerId(maybeScope) : 'unknown';
}

export function normalizeSolutionDomain(domain, scope) {
  const normalizedDomain =
    typeof domain === 'string' && domain.trim().length > 0 ? toLayerId(domain) : null;
  if (normalizedDomain === 'land' || normalizedDomain === 'marine') {
    return normalizedDomain;
  }
  return scope === 'marine' ? 'marine' : 'land';
}

function inferSirapIdFromPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const sirapIndex = parts.indexOf('sirap');
  if (sirapIndex < 0 || !parts[sirapIndex + 1]) {
    return null;
  }
  return toLayerId(parts[sirapIndex + 1]);
}

function inferTargetPercent(configuredTargetPercent, coverage) {
  const configured = parseFiniteNumberOrNull(configuredTargetPercent);
  if (configured !== null) {
    return configured;
  }
  const ecosystemTargets = coverage
    .filter(
      (row) =>
        typeof row.relativeTarget === 'number' &&
        normalizeTargetFeatureId(row.feature) === 'ecosistemas' &&
        (row.evaluated === 'prioritizr_model' || row.evaluated === null),
    )
    .map((row) => Number((row.relativeTarget * 100).toFixed(6)));
  const uniqueTargets = [...new Set(ecosystemTargets)];
  if (uniqueTargets.length > 1) {
    throw new Error(`ecosystem/MEC target rows disagree: ${uniqueTargets.join(', ')}`);
  }
  return uniqueTargets[0] ?? null;
}

export function inferSolutionTargetFeatureSet({ metadata, structuredTargets }) {
  if (typeof metadata.target_feature_set === 'string' && metadata.target_feature_set.trim()) {
    return toLayerId(metadata.target_feature_set);
  }
  if (structuredTargets.espRn.length > 0) return 'esp_rn';
  if (structuredTargets.speciesRepresentation.length > 0) return 'species';
  if (structuredTargets.strategicEcosystems.length > 0) return 'strategic_ecosystems';
  if (structuredTargets.ecosystemServices.length > 0) return 'ecosystem_services';
  if (structuredTargets.ecosystems.length > 0) return 'ecosystems';
  return null;
}

function createSolutionDescription({ name, finderInputs, inputLayerIds }) {
  const targetLabel =
    typeof finderInputs.targetPercent === 'number'
      ? `${finderInputs.targetPercent}% ${finderInputs.targetFeatureSet ?? 'target'}`
      : (finderInputs.targetFeatureSet ?? 'configured target');
  const includeLabel =
    inputLayerIds.includes.length > 0
      ? `includes ${inputLayerIds.includes.join(', ')}`
      : 'no include layers';
  const costLabel = inputLayerIds.cost ? `${inputLayerIds.cost} cost` : 'no cost layer';
  return `${name} solution for ${targetLabel}; ${includeLabel}; ${costLabel}.`;
}

function createCategories(rows, layerEntries, existingManifestIndex, speciesTaxa) {
  const categories = new Map();

  for (const row of rows) {
    const id = inferProposedCategoryId(row);
    const proposedCategory = proposedManifestCategories[id];
    const layerIds = layerEntries
      .filter((entry) => entry.manifestLayer.category === id)
      .map((entry) => entry.manifestLayer.id);

    if (!categories.has(id)) {
      const existingCategory = existingManifestIndex?.categoriesById?.get(id) ?? null;
      const styleDefaults = pickCategoryStyleDefaults(id, existingCategory);
      const subcategories =
        id === SPECIES_AND_BIODIVERSITY_CATEGORY_ID
          ? buildSpeciesSubcategories(speciesTaxa, existingManifestIndex)
          : preserveExistingSubcategories(existingCategory);

      categories.set(id, {
        id,
        spanishLabel: proposedCategory.spanishLabel,
        englishLabel: proposedCategory.englishLabel,
        ...(styleDefaults ? { styleDefaults } : {}),
        ...(subcategories.length > 0 ? { subcategories } : {}),
        layerIds,
      });
    }
  }

  return [...categories.values()].sort((a, b) => a.spanishLabel.localeCompare(b.spanishLabel));
}

function pickCategoryStyleDefaults(categoryId, existingCategory) {
  const existingDefaults =
    existingCategory && typeof existingCategory.styleDefaults === 'object'
      ? existingCategory.styleDefaults
      : null;
  if (existingDefaults) {
    return { ...existingDefaults };
  }
  const palette = getCategoryPalette(categoryId);
  if (palette === CATEGORY_PALETTE_FALLBACK && !CATEGORY_PALETTE[categoryId]) {
    return null;
  }
  return { ...palette };
}

function preserveExistingSubcategories(existingCategory) {
  if (!existingCategory || !Array.isArray(existingCategory.subcategories)) {
    return [];
  }
  return existingCategory.subcategories
    .filter((subcategory) => subcategory && typeof subcategory.id === 'string')
    .map((subcategory) => ({
      id: subcategory.id,
      spanishLabel: subcategory.spanishLabel ?? subcategory.id,
      englishLabel: subcategory.englishLabel ?? null,
      ...(subcategory.styleDefaults ? { styleDefaults: { ...subcategory.styleDefaults } } : {}),
      layerIds: Array.isArray(subcategory.layerIds) ? [...subcategory.layerIds] : [],
    }));
}

/**
 * Builds the species-and-biodiversity subcategories from the live species manifest's
 * taxa, preferring any existing subcategory styleDefaults. Brand-new taxa get a
 * hashed hue offset over the species palette so they're visually distinct.
 *
 * Falls back to whatever subcategories exist in the prior manifest when species
 * taxa cannot be loaded (e.g. offline, blob fetch failed).
 */
function buildSpeciesSubcategories(speciesTaxa, existingManifestIndex) {
  if (!Array.isArray(speciesTaxa) || speciesTaxa.length === 0) {
    return preserveExistingSubcategories(
      existingManifestIndex?.categoriesById?.get(SPECIES_AND_BIODIVERSITY_CATEGORY_ID) ?? null,
    );
  }

  const palette = getCategoryPalette(SPECIES_AND_BIODIVERSITY_CATEGORY_ID);
  return speciesTaxa.map((taxon) => {
    const path = `${SPECIES_AND_BIODIVERSITY_CATEGORY_ID}.${taxon.id}`;
    const existing = existingManifestIndex?.subcategoriesByPath?.get(path) ?? null;
    const offset = hueOffsetForLayer(taxon.id);
    const seededDefaults = {
      selectedColor: shiftHexHue(palette.selectedColor, offset),
      startColor: shiftHexHue(palette.startColor, offset),
      endColor: shiftHexHue(palette.endColor, offset),
    };

    return {
      id: taxon.id,
      spanishLabel: taxon.spanishLabel ?? existing?.spanishLabel ?? taxon.label ?? taxon.id,
      englishLabel: taxon.englishLabel ?? existing?.englishLabel ?? taxon.label ?? null,
      styleDefaults: existing?.styleDefaults ? { ...existing.styleDefaults } : seededDefaults,
      layerIds: Array.isArray(existing?.layerIds) ? [...existing.layerIds] : [],
    };
  });
}

/**
 * Fetches the public species manifest to seed `species_and_biodiversity.subcategories`.
 * Returns `[]` (and logs a warning) if the manifest is unreachable so the generator
 * can still complete; existing subcategories will be preserved instead.
 */
async function fetchSpeciesTaxa() {
  try {
    const response = await fetch(SPECIES_MANIFEST_URL, { method: 'GET', redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const speciesManifest = await response.json();
    const taxaById = new Map();
    for (const layer of speciesManifest.layers ?? []) {
      if (!layer || typeof layer.taxonId !== 'string' || !layer.taxonId) {
        continue;
      }
      if (taxaById.has(layer.taxonId)) {
        continue;
      }
      taxaById.set(layer.taxonId, {
        id: layer.taxonId,
        label: layer.taxonLabel ?? null,
        spanishLabel: layer.taxonLabel ?? layer.taxonId,
        englishLabel: layer.taxonLabel ?? null,
      });
    }
    return [...taxaById.values()].sort((a, b) =>
      String(a.spanishLabel).localeCompare(String(b.spanishLabel)),
    );
  } catch (error) {
    console.warn(
      `[generate:layer-manifest] could not fetch species manifest for subcategories: ${
        (error instanceof Error && error.message) || String(error)
      }`,
    );
    return [];
  }
}

export async function createLayerEntry(row, blobByPath, existingManifestIndex) {
  const labels = splitMultilineLabel(row.layer_name);
  const id = toLayerId(row.layer_id);
  const existingLayer = existingManifestIndex?.layersById?.get(id) ?? null;
  const blobPath = toBlobPath(row.storage_location, row.filename);
  const isCollection = blobPath?.endsWith('/');
  const matchedBlob = blobPath ? blobByPath.get(blobPath) : null;
  const remoteUrl = /^https?:\/\//i.test(row.storage_location) ? row.storage_location : '';
  const dataRole = inferDataRole(row);
  const discoveredDisplayReference =
    dataRole === 'reference_layer' && blobPath
      ? createDeterministicReferenceDisplayReference(blobPath)
      : createDisplayReference({
          row,
          blobPath,
          isCollection,
          matchedBlob,
          remoteUrl,
        });
  const displayReference = preserveExistingDisplayReference(
    discoveredDisplayReference,
    existingLayer,
  );
  const roleInMetricCalculation = inferRoleInMetricCalculation(dataRole);
  const categoryId = inferProposedCategoryId(row);
  const { rendering, renderingInference } = await inferRenderingConfig({
    row,
    id,
    dataRole,
    categoryId,
    displayReference,
    existingLayer,
  });
  const styleOverride = existingLayer?.styleOverride ?? null;

  return {
    manifestLayer: {
      id,
      spanishLabel: labels[0] || row.layer_name,
      englishLabel: labels[1] || englishLabelOverrideByLayerId[id] || null,
      description: row.layer_description,
      tooltip: tooltipOverrideByLayerId[id] ?? null,
      dataRole,
      category: categoryId,
      roleInMetricCalculation,
      ...(dataRole === 'reference_layer'
        ? {
            requiredForSolution: false,
            selectableInFinder: false,
            visibleInMapLayers: true,
          }
        : {}),
      ...toDisplayUrlFields(displayReference),
      ...(row.layer_id === 'species'
        ? { speciesManifestUrl: `${PUBLIC_BLOB_HOST}/manifests/species.manifest.json` }
        : {}),
      metadataUrl:
        dataRole === 'reference_layer' && blobPath
          ? createReferenceMetadataUrl(blobPath)
          : createBackedMetadataUrl(id, blobByPath),
      compressedDataForLiveMetricsUrl: null,
      precomputedMetricUrls: {},
      rendering,
      ...(styleOverride !== null ? { styleOverride } : {}),
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

export function createDeterministicReferenceDisplayReference(blobPath) {
  return {
    status: 'matched',
    type: 'file',
    url: `${PUBLIC_BLOB_HOST}/${blobPath}`,
    blobPath,
  };
}

export function createReferenceMetadataUrl(blobPath) {
  const metadataPath = blobPath.replace(/\.geojson$/i, '.metadata.json');
  return `${PUBLIC_BLOB_HOST}/${metadataPath}`;
}

export function createBackedMetadataUrl(layerId, blobByPath) {
  const metadataPath = `metadata/${layerId}.metadata.json`;
  return blobByPath.has(metadataPath) ? `${PUBLIC_BLOB_HOST}/${metadataPath}` : null;
}

export function preserveExistingDisplayReference(discoveredReference, existingLayer) {
  if (discoveredReference.status === 'matched' || !existingLayer) {
    return discoveredReference;
  }
  if (typeof existingLayer.displayUrl === 'string' && existingLayer.displayUrl) {
    return {
      status: 'matched',
      type: 'file',
      url: existingLayer.displayUrl,
      blobPath: discoveredReference.blobPath,
    };
  }
  if (
    typeof existingLayer.displayCollectionUrl === 'string' &&
    existingLayer.displayCollectionUrl
  ) {
    return {
      status: 'matched',
      type: 'collection',
      url: existingLayer.displayCollectionUrl,
      blobPath: discoveredReference.blobPath,
      collectionPattern: discoveredReference.collectionPattern,
    };
  }
  return discoveredReference;
}

export function preserveReleaseLayerRendering(generatedLayer, publishedLayer, releaseId) {
  if (!releaseId || !publishedLayer?.rendering) {
    return generatedLayer;
  }

  return {
    ...generatedLayer,
    rendering: structuredClone(publishedLayer.rendering),
  };
}

async function inferRenderingConfig({
  row,
  id,
  dataRole,
  categoryId,
  displayReference,
  existingLayer,
}) {
  const override = renderingOverrideByLayerId[id];
  if (override) {
    const rendering = forcedRenderingOverrideLayerIds.has(id)
      ? override
      : pickRenderingForLayer({
          inferredRendering: override,
          layerId: id,
          categoryId,
          existingLayer,
        });
    return {
      rendering,
      renderingInference: {
        strategy: 'manual_override',
        classification: rendering.valueType,
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
        const inferred = toBinaryRenderingConfig(characteristics);
        return {
          rendering: pickRenderingForLayer({
            inferredRendering: inferred,
            layerId: id,
            categoryId,
            existingLayer,
          }),
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
        const inferred = toContinuousRenderingConfig(characteristics);
        return {
          rendering: pickRenderingForLayer({
            inferredRendering: inferred,
            layerId: id,
            categoryId,
            existingLayer,
          }),
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

  const fallbackInferred = inferLegacyRenderingConfig({ row, id, dataRole });
  const rendering = pickRenderingForLayer({
    inferredRendering: fallbackInferred,
    layerId: id,
    categoryId,
    existingLayer,
  });
  return {
    rendering,
    renderingInference: {
      strategy: isRasterCandidate ? 'fallback_after_uncertain_sampling' : 'legacy_non_raster',
      classification: rendering.valueType,
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
    return {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: null,
      minValue: null,
      maxValue: null,
      startColor: null,
      endColor: null,
    };
  }

  if (
    layerGroupId === 'ecosistemas_estrategicos' ||
    modelGroupId === 'incluye' ||
    modelGroupId === 'limites' ||
    dataRole === 'include_layer' ||
    dataRole === 'administrative_boundary'
  ) {
    return {
      valueType: 'binary',
      renderMode: 'mask',
      noDataValue: 255,
      selectedValue: 1,
      selectedColor: null,
    };
  }

  return {
    valueType: 'binary',
    renderMode: 'mask',
    noDataValue: 255,
    selectedValue: 1,
    selectedColor: null,
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
    typeof sample.min === 'number' && typeof sample.max === 'number'
      ? sample.max - sample.min
      : null;
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

function toBinaryRenderingConfig(characteristics) {
  const selectedValue = inferSelectedBinaryValue(
    characteristics.sample.uniqueValues,
    characteristics.noDataValue,
  );
  const fallbackNoDataValue = inferNoDataFromBinaryValues(characteristics.sample.uniqueValues);

  return {
    valueType: 'binary',
    renderMode: 'mask',
    noDataValue:
      typeof characteristics.noDataValue === 'number'
        ? characteristics.noDataValue
        : fallbackNoDataValue,
    selectedValue,
    selectedColor: null,
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

function toContinuousRenderingConfig(characteristics) {
  const minValue =
    typeof characteristics.sample.min === 'number' ? characteristics.sample.min : null;
  const maxValue =
    typeof characteristics.sample.max === 'number' ? characteristics.sample.max : null;
  const hasValidRange =
    typeof minValue === 'number' && typeof maxValue === 'number' && maxValue > minValue;

  return {
    valueType: 'continuous',
    renderMode: 'gradient',
    noDataValue:
      typeof characteristics.noDataValue === 'number' ? characteristics.noDataValue : null,
    minValue: hasValidRange ? minValue : null,
    maxValue: hasValidRange ? maxValue : null,
    startColor: null,
    endColor: null,
  };
}

function normalizeNumericValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Resolves the final rendering for a layer by combining inference with what was
 * already in the previous manifest. Mode-stable layers preserve their existing
 * colors byte-for-byte while refreshing inferred scale/value metadata. Mode-flipped
 * layers carry the previous color forward
 * (binary mask `selectedColor` becomes new gradient `endColor`, gradient
 * `endColor` becomes new mask `selectedColor`). Brand-new layers seed from the
 * curated category palette with a small per-layer hue offset.
 */
export function pickRenderingForLayer({ inferredRendering, layerId, categoryId, existingLayer }) {
  const palette = getCategoryPalette(categoryId);
  const existingRendering = existingLayer?.rendering ?? null;

  if (!existingRendering || !isEditableRenderMode(existingRendering.renderMode)) {
    return seedRenderingFromPalette(inferredRendering, palette, layerId);
  }

  if (existingRendering.renderMode === inferredRendering.renderMode) {
    return mergeInferredRenderingWithExistingStyle(inferredRendering, existingRendering);
  }

  if (existingRendering.renderMode === 'mask' && inferredRendering.renderMode === 'gradient') {
    const carriedEndColor = existingRendering.selectedColor ?? palette.endColor;
    return {
      ...inferredRendering,
      startColor: lightenHexColor(carriedEndColor, 0.55),
      endColor: carriedEndColor,
    };
  }

  if (existingRendering.renderMode === 'gradient' && inferredRendering.renderMode === 'mask') {
    return {
      ...inferredRendering,
      selectedColor: existingRendering.endColor ?? palette.endColor,
    };
  }

  return seedRenderingFromPalette(inferredRendering, palette, layerId);
}

function mergeInferredRenderingWithExistingStyle(inferredRendering, existingRendering) {
  if (inferredRendering.renderMode === 'mask') {
    return {
      ...inferredRendering,
      selectedColor: existingRendering.selectedColor ?? inferredRendering.selectedColor,
    };
  }

  if (inferredRendering.renderMode === 'gradient') {
    return {
      ...inferredRendering,
      startColor: existingRendering.startColor ?? inferredRendering.startColor,
      endColor: existingRendering.endColor ?? inferredRendering.endColor,
    };
  }

  return inferredRendering;
}

function seedRenderingFromPalette(inferredRendering, palette, layerId) {
  const offset = hueOffsetForLayer(layerId);
  if (inferredRendering.renderMode === 'mask') {
    return {
      ...inferredRendering,
      selectedColor: shiftHexHue(palette.selectedColor, offset),
    };
  }

  return {
    ...inferredRendering,
    startColor: shiftHexHue(palette.startColor, offset),
    endColor: shiftHexHue(palette.endColor, offset),
  };
}

function isEditableRenderMode(mode) {
  return mode === 'mask' || mode === 'gradient';
}

function hueOffsetForLayer(layerId) {
  const seed = hashStringToPositiveInt(String(layerId));
  const span = LAYER_HUE_OFFSET_RANGE_DEGREES * 2 + 1;
  return (seed % span) - LAYER_HUE_OFFSET_RANGE_DEGREES;
}

function createManifestIndex(parsed, source) {
  const layersById = new Map();
  if (Array.isArray(parsed?.layers)) {
    for (const layer of parsed.layers) {
      if (layer && typeof layer.id === 'string') {
        layersById.set(layer.id, layer);
      }
    }
  }

  const categoriesById = new Map();
  const subcategoriesByPath = new Map();
  if (Array.isArray(parsed?.categories)) {
    for (const category of parsed.categories) {
      if (!category || typeof category.id !== 'string') {
        continue;
      }
      categoriesById.set(category.id, category);
      if (Array.isArray(category.subcategories)) {
        for (const subcategory of category.subcategories) {
          if (subcategory && typeof subcategory.id === 'string') {
            subcategoriesByPath.set(`${category.id}.${subcategory.id}`, subcategory);
          }
        }
      }
    }
  }

  return { manifest: parsed, source, layersById, categoriesById, subcategoriesByPath };
}

async function loadExistingManifest(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return createManifestIndex(parsed, filePath);
}

async function loadPublishedManifest() {
  const uncachedUrl = `${RUNTIME_MANIFEST_BLOB_URL}?v=${Date.now()}`;
  let response;
  try {
    response = await fetch(uncachedUrl, { method: 'GET', redirect: 'follow' });
  } catch (error) {
    console.warn(
      `[generate:layer-manifest] failed to fetch published manifest: ${
        (error instanceof Error && error.message) || String(error)
      }`,
    );
    return null;
  }

  if (!response.ok) {
    console.warn(
      `[generate:layer-manifest] failed to fetch published manifest: ${response.status} ${response.statusText}`,
    );
    return null;
  }

  try {
    return createManifestIndex(await response.json(), RUNTIME_MANIFEST_BLOB_URL);
  } catch (error) {
    console.warn(
      `[generate:layer-manifest] failed to parse published manifest: ${
        (error instanceof Error && error.message) || String(error)
      }`,
    );
    return null;
  }
}

function hashStringToPositiveInt(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createPublishedSolutionCatalogReport(solutionCatalogReport, solutions, source) {
  return {
    ...solutionCatalogReport,
    counts: {
      ...solutionCatalogReport.counts,
      publishedManifestSolutionsUsed: solutions.length,
    },
    solutionSource: {
      strategy: 'published_manifest',
      source,
      reason:
        'Preserved the solution catalog currently published in Vercel so generated layer updates do not replace the active solution set.',
    },
    publishedManifestSolutions: solutions.map((solution) => ({
      id: solution.id,
      name: solution.name,
      scope: solution.scope,
      displayUrl: solution.displayUrl,
      metadataUrl: solution.metadataUrl,
    })),
  };
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
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function hexToHsl(hexColor) {
  const normalized = String(hexColor || '')
    .trim()
    .replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

function shiftHexHue(hexColor, hueOffsetDegrees) {
  const hsl = hexToHsl(hexColor);
  if (!hsl) {
    return hexColor;
  }
  return hslToHex(hsl.h + hueOffsetDegrees, hsl.s, hsl.l);
}

/**
 * Returns a lighter version of `hexColor` by raising its lightness toward 100%.
 * `factor` is a value in [0, 1]: 0 keeps the color unchanged, 1 returns near-white.
 */
function lightenHexColor(hexColor, factor) {
  const hsl = hexToHsl(hexColor);
  if (!hsl) {
    return hexColor;
  }
  const clampedFactor = Math.max(0, Math.min(1, factor));
  const nextL = hsl.l + (95 - hsl.l) * clampedFactor;
  const nextS = Math.max(0, hsl.s - hsl.s * clampedFactor * 0.4);
  return hslToHex(hsl.h, nextS, nextL);
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

export function inferDataRole(row) {
  const layerId = row.layer_id.toLowerCase();
  const modelGroup = row.model_group.toLowerCase();
  const layerGroup = row.layer_group.toLowerCase();

  if (layerId === 'species') {
    return 'manifest_for_species_layers';
  }
  if (modelGroup.includes('referencia') || modelGroup.includes('reference')) {
    return 'reference_layer';
  }
  if (modelGroup.includes('costo') || layerGroup.includes('costo')) {
    return 'cost_layer';
  }
  if (modelGroup.includes('incluye')) {
    return 'include_layer';
  }
  if (
    modelGroup.includes('limites') ||
    modelGroup.includes('boundaries') ||
    layerGroup.includes('limite')
  ) {
    return 'administrative_boundary';
  }

  return 'feature_layer';
}

export function inferRoleInMetricCalculation(dataRole) {
  return 'none';
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

async function extractCurrentFrontendCategories() {
  const source = await fs.readFile(LEFT_SIDEBAR_SOURCE_PATH, 'utf-8');
  const groupStart = source.indexOf('private createDefaultGroups(): LayerGroup[]');
  const groupEnd = source.indexOf('private layerRow(', groupStart);
  const groupSource =
    groupStart >= 0 && groupEnd > groupStart ? source.slice(groupStart, groupEnd) : '';
  const categories = [
    {
      id: 'management-figures',
      title: 'Conservation Areas',
      source: 'createDefaultOverlays',
      notes:
        'Overlay card above category groups; currently contains solution, RUNAP, and OMEC rows.',
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
  const frontendById = new Map(
    currentFrontendCategories.map((category) => [category.id, category]),
  );
  const manifestCategoryMappings = categories.map((category) => {
    const rule = categoryMappingRules[category.id];
    const frontendCategoryIds = rule?.frontendCategoryIds ?? [];
    const layerMappings = category.layerIds.map((layerId) => {
      const layer = layerEntries.find((entry) => entry.manifestLayer.id === layerId)?.manifestLayer;
      const frontendCategoryId =
        rule?.layerLevelFrontendCategoryIds?.[layerId] ?? frontendCategoryIds[0] ?? null;

      return {
        layerId,
        spanishLabel: layer?.spanishLabel ?? null,
        dataRole: layer?.dataRole ?? null,
        frontendCategoryId,
        frontendCategoryTitle: frontendCategoryId
          ? (frontendById.get(frontendCategoryId)?.title ?? null)
          : null,
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

function buildReport({
  allRows,
  includedRows,
  layerEntries,
  blobInventory,
  solutionCatalogReport,
  categoryMappingReport,
}) {
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
    .filter((row) => !shouldIncludeManifestRow(row))
    .map((row) => {
      const layerId = toLayerId(row.layer_id);
      return {
        layerId: row.layer_id,
        displayName: splitMultilineLabel(row.layer_name)[0] || row.layer_name,
        reason: redistributionBlockedLayerIds.has(layerId)
          ? 'public redistribution requires documented written permission'
          : isTrue(row.in_use_now)
            ? 'row is not a display candidate'
            : 'in_use_now is not TRUE and layer is not metric-audit allowlisted',
      };
    });

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
      intendedAudience:
        'Developers validating Blob Storage contents before wiring layers into the tool.',
      howToUse:
        'Check missingRequired first, then extraAvailable and includedRowMetadataGaps, before treating the generated manifest as ready for frontend integration.',
    },
    sourceCsv: path.relative(repoRoot, REQUIRED_LAYERS_CSV),
    policy: {
      includedRows:
        'Rows with en_uso_actual / in_use_now set to TRUE, plus metric-audit allowlisted layers needed for finalized metrics review',
      metricAuditAllowlistedLayerIds: [...metricAuditLayerIds],
      redistributionBlockedLayerIds: [...redistributionBlockedLayerIds],
      speciesHandling:
        'Species rasters are represented as one collection pointer, not one layer per TIFF',
      liveManifest:
        'Generated to frontend/public/data/layer-manifest/manifest.json and ignored by git',
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
      generatedSolutions: solutionCatalogReport.counts.includedSolutions,
      skippedSolutionMetadataFiles: solutionCatalogReport.counts.skippedMetadataFiles,
      unmatchedSolutionRasters: solutionCatalogReport.counts.unmatchedRasters,
      manifestCategoriesNeedingReview: categoryMappingReport.counts.manifestCategoriesNeedingReview,
      frontendCategoriesWithoutManifestMapping:
        categoryMappingReport.counts.frontendCategoriesWithoutManifestMapping,
      renderingInferenceLowConfidence: renderingInferenceCounts.lowConfidence,
    },
    missingRequired,
    extraAvailable,
    includedRowMetadataGaps,
    categoryMappingSummary: {
      reportPath: path.relative(repoRoot, CATEGORY_MAPPING_REPORT_PATH),
      manifestCategoriesNeedingReview: categoryMappingReport.counts.manifestCategoriesNeedingReview,
      frontendCategoriesWithoutManifestMapping:
        categoryMappingReport.counts.frontendCategoriesWithoutManifestMapping,
    },
    solutionCatalogSummary: {
      reportPath: path.relative(repoRoot, SOLUTION_RECONCILIATION_REPORT_PATH),
      generatedSolutions: solutionCatalogReport.counts.includedSolutions,
      skippedSolutionMetadataFiles: solutionCatalogReport.counts.skippedMetadataFiles,
      unmatchedSolutionRasters: solutionCatalogReport.counts.unmatchedRasters,
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
  renderingOverrideByLayerId.marine_ecosystems = await loadMarineEcosystemRendering();
  const cliArgs = process.argv.slice(2);
  const registeredSolutionBlobPrefixes = getRegisteredSolutionBlobPrefixes(cliArgs);
  const requestedReleaseId = getReleaseId(cliArgs);
  const catalogPath = getCatalogPath(cliArgs);
  if (requestedReleaseId && !catalogPath) {
    throw new Error('release generation requires an explicit --catalog <path> catalog');
  }
  const releaseCatalog = catalogPath ? await readSolutionCatalog(catalogPath) : null;
  if (requestedReleaseId && requestedReleaseId !== releaseCatalog.releaseId) {
    throw new Error(
      `--release-id "${requestedReleaseId}" does not match catalog releaseId "${releaseCatalog.releaseId}"`,
    );
  }
  const releaseId = releaseCatalog?.releaseId ?? null;

  const csvRaw = await fs.readFile(REQUIRED_LAYERS_CSV, 'utf-8');
  const rows = rowsToObjects(parseCsv(csvRaw), columnAliases);
  const includedRows = rows.filter(shouldIncludeManifestRow);
  const blobInventory = await readBlobInventory();
  const solutionBlobInventory = await readSolutionBlobInventory();
  const blobByPath = new Map(blobInventory.map((blob) => [blob.pathname, blob]));
  const publishedManifestIndex = await loadPublishedManifest();
  const localManifestIndex = await loadExistingManifest(GENERATED_MANIFEST_PATH);
  const existingManifestIndex = publishedManifestIndex ?? localManifestIndex;
  const speciesTaxa = await fetchSpeciesTaxa();
  const layerEntries = await Promise.all(
    includedRows.map((row) => createLayerEntry(row, blobByPath, existingManifestIndex)),
  );
  const resolvedLayerEntries = layerEntries.filter(
    (entry) => entry.reconciliation.displayReference.status === 'matched',
  );
  const solutionCatalog = await createSolutionCatalog(solutionBlobInventory);
  const categories = createCategories(
    includedRows,
    resolvedLayerEntries,
    existingManifestIndex,
    speciesTaxa,
  );
  const releaseBoundaryUrls = createReleaseBoundaryUrls(releaseId);
  const layers = resolvedLayerEntries.map((entry) => {
    const generatedLayer =
      entry.manifestLayer.id === 'siraps' && releaseBoundaryUrls
        ? {
            ...entry.manifestLayer,
            displayUrl: releaseBoundaryUrls.sirapBoundaryUrl,
            metadataUrl: releaseBoundaryUrls.sirapMetadataUrl,
          }
        : entry.manifestLayer;

    return preserveReleaseLayerRendering(
      generatedLayer,
      existingManifestIndex?.layersById.get(generatedLayer.id),
      releaseId,
    );
  });
  const {
    solutions: selectedSolutions,
    preservedPublishedSolutions,
    preservedExistingSolutions,
  } = selectManifestSolutions({
    publishedManifestIndex,
    generatedSolutions: solutionCatalog.solutions,
    existingManifestIndex,
    registeredSolutionBlobPrefixes,
    releaseId,
  });
  const solutions = releaseCatalog
    ? bindManifestSolutionsToCatalog(selectedSolutions, releaseCatalog)
    : selectedSolutions;
  if (releaseCatalog) {
    validateManifestAgainstCatalog(
      {
        releaseId,
        catalogVersion: releaseCatalog.catalogVersion,
        solutions,
      },
      releaseCatalog,
    );
  }
  const solutionCatalogReport =
    preservedPublishedSolutions.length > 0
      ? createPublishedSolutionCatalogReport(
          solutionCatalog.report,
          preservedPublishedSolutions,
          publishedManifestIndex.source,
        )
      : preservedExistingSolutions.length > 0
        ? {
            ...solutionCatalog.report,
            counts: {
              ...solutionCatalog.report.counts,
              preservedExistingSolutions: preservedExistingSolutions.length,
            },
            preservedExistingSolutions: preservedExistingSolutions.map((solution) => ({
              id: solution.id,
              name: solution.name,
              scope: solution.scope,
              displayUrl: solution.displayUrl,
              metadataUrl: solution.metadataUrl,
            })),
          }
        : solutionCatalog.report;
  if (preservedPublishedSolutions.length > 0) {
    console.log(
      `[generate:layer-manifest] preserving ${preservedPublishedSolutions.length} published solution(s) from ${publishedManifestIndex.source}`,
    );
  }
  if (solutionCatalog.solutions.length === 0 && solutions.length > 0) {
    console.warn(
      `[generate:layer-manifest] preserving ${solutions.length} existing solution(s) because Blob metadata fetch returned none`,
    );
  }
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
    solutionCatalogReport,
    categoryMappingReport,
  });

  const manifest = {
    version: MANIFEST_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    publicBlobHost: PUBLIC_BLOB_HOST,
    ...(releaseId ? { releaseId } : {}),
    ...(releaseCatalog ? { catalogVersion: releaseCatalog.catalogVersion } : {}),
    sourceCsv: path.relative(repoRoot, REQUIRED_LAYERS_CSV),
    categories,
    layers,
    solutions,
    referenceData: {
      speciesLookup: {
        description:
          'Species range lookup table with IUCN status and taxonomic class, used for biodiversity metric pre-calculation. Source: biomod species range model outputs with updated IUCN assessments.',
        blobPathname: 'inputs/metadata/biomod_spp_ranges_updatedIUCN.csv',
        url: `${PUBLIC_BLOB_HOST}/inputs/metadata/biomod_spp_ranges_updatedIUCN.csv`,
        fields: ['scientific_name', 'class', 'iucn_status'],
        note: 'Local copy at data/biomod_spp_ranges_updatedIUCN.csv is gitignored; download from url above.',
      },
    },
  };

  const nextManifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const archivedManifestPath = await archiveExistingManifestIfChanged(nextManifestJson);

  await writeJson(GENERATED_MANIFEST_PATH, manifest);
  await writeJson(CATEGORY_MAPPING_REPORT_PATH, categoryMappingReport);
  await writeJson(REPORT_PATH, report);
  await writeJson(SOLUTION_RECONCILIATION_REPORT_PATH, solutionCatalogReport);
  await writeText(CATEGORY_REVIEW_CSV_PATH, toCsv(createCategoryReviewRows(rows)));

  console.log(
    `[generate:layer-manifest] wrote ${path.relative(repoRoot, GENERATED_MANIFEST_PATH)}`,
  );
  if (archivedManifestPath) {
    console.log(
      `[generate:layer-manifest] archived ${path.relative(repoRoot, archivedManifestPath)}`,
    );
  }
  console.log(
    `[generate:layer-manifest] wrote ${path.relative(repoRoot, CATEGORY_MAPPING_REPORT_PATH)}`,
  );
  console.log(`[generate:layer-manifest] wrote ${path.relative(repoRoot, REPORT_PATH)}`);
  console.log(
    `[generate:layer-manifest] wrote ${path.relative(repoRoot, SOLUTION_RECONCILIATION_REPORT_PATH)}`,
  );
  console.log(
    `[generate:layer-manifest] wrote ${path.relative(repoRoot, CATEGORY_REVIEW_CSV_PATH)}`,
  );
  console.log(
    `[generate:layer-manifest] ${layers.length} layer(s), ${solutions.length} solution(s), ${report.counts.missingRequired} missing required, ${report.counts.extraAvailable} extra available`,
  );
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(`[generate:layer-manifest] ${error.message}`);
    process.exit(1);
  });
}
