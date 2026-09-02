import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_BLOB_HOST } from '../shared/runtime-manifest.constants.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const SPECIES_SOURCE_PREFIX = `${PUBLIC_BLOB_HOST}/inputs/features/species`;
const SPECIES_COG_PREFIX = `${PUBLIC_BLOB_HOST}/releases/species-display-cogs-v1`;
const STATIC_COG_PREFIX = `${SPECIES_COG_PREFIX}/view-layers`;
const SPECIES_REPORT_PATHS = [
  'data/metrics/generated/species-display-cogs/batch-3a/batch-3a-report.json',
  'data/metrics/generated/species-display-cogs/full-catalog-birds-start-end-report.json',
  'data/metrics/generated/species-display-cogs/full-catalog-plants-A-G-report.json',
  'data/metrics/generated/species-display-cogs/plants-g-m/full-catalog-plants-G-M-report.json',
  'data/metrics/generated/species-display-cogs/full-catalog-plants-M-S-report.json',
  'data/metrics/generated/species-display-cogs/plants-s-end/full-catalog-plants-S-end-report.json',
];
const STATIC_REPORT_PATHS = [
  'data/metrics/generated/view-layer-cogs/strategic-masks-batch-1-a93e7c2d/build-report.json',
  'data/metrics/generated/view-layer-cogs/inclusion-masks-batch-2-4de810f/build-report.json',
  'data/metrics/generated/view-layer-cogs/species-richness-batch-4-55f712c3/build-report.json',
];
const DISPLAYABLE_SPECIES_STATUSES = new Set(['uploaded_verified', 'resumed_verified']);
const TAXON_BY_CLASS = {
  Mammalia: { id: 'mammals', label: 'Mammals' },
  Aves: { id: 'birds', label: 'Birds' },
  Amphibia: { id: 'amphibians', label: 'Amphibians' },
  Squamata: { id: 'reptiles', label: 'Reptiles' },
  Crocodylia: { id: 'reptiles', label: 'Reptiles' },
  Magnoliopsida: { id: 'plants', label: 'Plants' },
};
const RICHNESS_LAYER_DETAILS = {
  'species-richness-mammals': {
    id: 'species_richness_mammals', es: 'Mamíferos', en: 'Mammals', min: 1, max: 142,
  },
  'species-richness-birds': {
    id: 'species_richness_birds', es: 'Aves', en: 'Birds', min: 1, max: 823,
  },
  'species-richness-amphibians': {
    id: 'species_richness_amphibians', es: 'Anfibios', en: 'Amphibians', min: 1, max: 56,
  },
  'species-richness-reptiles': {
    id: 'species_richness_reptiles', es: 'Reptiles', en: 'Reptiles', min: 1, max: 68,
  },
  'species-richness-plants': {
    id: 'species_richness_plants', es: 'Plantas', en: 'Plants', min: 1, max: 2884,
  },
};
const COG_GRADIENT_RANGE_OVERRIDES = {
  human_footprint_2022: { noDataValue: -9999 },
  human_footprint_2030: { minValue: 0, maxValue: 100, noDataValue: -9999 },
  hhm: { noDataValue: -9999 },
  // The source layer previously derived this range during client-side loading.
  // ImageryTileLayer needs it in the manifest, so retain those source bounds.
  net_benefit: { minValue: 0, maxValue: 2_147_483_648, noDataValue: -9999 },
};

function parseArgs(argv) {
  const values = { staticReportPaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error('expected --base-manifest, --version, and --output-dir option/value pairs');
    }
    if (option === '--static-report') {
      values.staticReportPaths.push(path.resolve(process.cwd(), value));
      index += 1;
      continue;
    }
    values[option.slice(2)] = value;
    index += 1;
  }
  for (const required of ['base-manifest', 'version', 'output-dir']) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(values.version)) {
    throw new Error('--version must be a semantic version');
  }
  return {
    baseManifestPath: path.resolve(process.cwd(), values['base-manifest']),
    version: values.version,
    outputDir: path.resolve(process.cwd(), values['output-dir']),
    staticReportPaths: values.staticReportPaths,
  };
}

async function readJson(filePath) {
  // Rasterio serializes NaN in diagnostic reports; it is not legal JSON but
  // none of the release-pointer fields depend on that diagnostic value.
  const contents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(contents.replaceAll(': NaN', ': null'));
}

function urlForPathname(pathname) {
  return `${PUBLIC_BLOB_HOST}/${pathname.split('/').map(encodeURIComponent).join('/')}`;
}

function sourceUrlForSpecies(filename) {
  return `${SPECIES_SOURCE_PREFIX}/${encodeURIComponent(filename)}`;
}

function toSpeciesId(scientificName) {
  return scientificName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function toSpeciesLayer(entry) {
  const taxon = TAXON_BY_CLASS[entry.class];
  if (!taxon) throw new Error(`unsupported species class for ${entry.filename}: ${entry.class}`);
  const layer = {
    id: toSpeciesId(entry.scientificName),
    taxonId: taxon.id,
    taxonLabel: taxon.label,
    commonName: entry.scientificName,
    scientificName: entry.scientificName,
    displayUrl: sourceUrlForSpecies(entry.filename),
    rendering: {
      valueType: 'binary',
      renderMode: 'mask',
      noDataValue: null,
      selectedValue: 1,
      selectedColor: '#bf18ab',
    },
  };
  if (DISPLAYABLE_SPECIES_STATUSES.has(entry.status)) {
    if (!entry.remotePathname || !entry.remoteUrl || !entry.remoteSha256 || !entry.outputSha256) {
      throw new Error(`verified COG record is incomplete: ${entry.filename}`);
    }
    if (entry.remoteSha256 !== entry.outputSha256) {
      throw new Error(`remote checksum mismatch recorded for ${entry.filename}`);
    }
    layer.displayCogUrl = entry.remoteUrl;
  }
  return layer;
}

function buildStaticCogUrls(reports) {
  const entries = reports.flatMap((report) => report.entries);
  const urls = new Map();
  for (const entry of entries) {
    if (!entry.layerId || !entry.outputPath || !entry.outputSha256) {
      throw new Error('static COG report contains an incomplete entry');
    }
    const filename = path.basename(entry.outputPath);
    if (entry.remoteUrl) {
      if (entry.remoteSha256 !== entry.outputSha256) {
        throw new Error(`remote checksum mismatch recorded for static layer ${entry.layerId}`);
      }
      urls.set(entry.layerId.replaceAll('-', '_'), entry.remoteUrl);
    } else {
      urls.set(entry.layerId.replaceAll('-', '_'), `${STATIC_COG_PREFIX}/${encodeURIComponent(filename)}`);
    }
  }
  return urls;
}

function addRichnessLayers(manifest, staticCogUrls) {
  const total = manifest.layers.find((layer) => layer.id === 'species_richness');
  if (!total) throw new Error('base manifest is missing species_richness');
  for (const [reportId, detail] of Object.entries(RICHNESS_LAYER_DETAILS)) {
    if (manifest.layers.some((layer) => layer.id === detail.id)) {
      continue;
    }
    const displayCogUrl = staticCogUrls.get(reportId.replaceAll('-', '_'));
    if (!displayCogUrl) throw new Error(`missing static COG report entry: ${reportId}`);
    const sourceFile = path.basename(displayCogUrl).replace('.epsg9377.cog.tif', '.tif');
    manifest.layers.push({
      ...total,
      id: detail.id,
      spanishLabel: `Riqueza de especies: ${detail.es}`,
      englishLabel: `Species Richness: ${detail.en}`,
      description: `${total.description} (${detail.en})`,
      displayUrl: `${PUBLIC_BLOB_HOST}/inputs/features/species_richness/${sourceFile}`,
      displayCogUrl,
      rendering: {
        ...total.rendering,
        noDataValue: 65535,
        minValue: detail.min,
        maxValue: detail.max,
      },
    });
    const category = manifest.categories.find((entry) => entry.id === total.category);
    category.layerIds.push(detail.id);
  }
}

function addHumanFootprint2030Layer(manifest) {
  const category = manifest.categories.find((entry) => entry.id === 'socioeconomic');
  if (!category) throw new Error('base manifest is missing socioeconomic category');

  if (!manifest.layers.some((layer) => layer.id === 'human_footprint_2030')) {
    manifest.layers.push({
      id: 'human_footprint_2030',
      spanishLabel: 'Índice de Huella Espacial Humana 2030',
      englishLabel: 'Human Footprint 2030',
      description: 'Projected human pressure in 2030; higher values indicate greater anticipated pressure.',
      tooltip: 'Shows projected human footprint intensity for future solution review.',
      dataRole: 'cost_layer',
      category: 'socioeconomic',
      roleInMetricCalculation: 'none',
      displayUrl: `${PUBLIC_BLOB_HOST}/inputs/costs/human_footprint_2030.tif`,
      metadataUrl: null,
      compressedDataForLiveMetricsUrl: null,
      precomputedMetricUrls: {},
      rendering: {
        valueType: 'continuous',
        renderMode: 'gradient',
        startColor: '#fee2e3',
        endColor: '#991b21',
        minValue: 0,
        maxValue: 100,
        noDataValue: -9999,
      },
    });
  }

  category.layerIds = category.layerIds.filter((layerId) => layerId !== 'human_footprint_2030');
  const humanFootprint2022Index = category.layerIds.indexOf('human_footprint_2022');
  category.layerIds.splice(
    humanFootprint2022Index >= 0 ? humanFootprint2022Index + 1 : category.layerIds.length,
    0,
    'human_footprint_2030',
  );
}

function buildDisplayOnlyCatalog(manifest) {
  const solutions = manifest.solutions
    .map((solution) => ({
      solutionId: solution.id,
      solutionBasename: solution.rasterFile,
      domain: solution.domain ?? (solution.scope === 'marine' ? 'marine' : 'land'),
      rasterSha256: solution.rasterSha256,
    }))
    .sort((left, right) => left.solutionId.localeCompare(right.solutionId));
  const expectedLandSolutionCount = solutions.filter((solution) => solution.domain === 'land').length;

  return {
    format: 'solution-catalog-v1',
    catalogVersion: manifest.catalogVersion,
    releaseId: manifest.releaseId,
    expectedSolutionCount: solutions.length,
    expectedLandSolutionCount,
    expectedMarineSolutionCount: solutions.length - expectedLandSolutionCount,
    solutions,
  };
}

export async function buildDisplayCogRelease({
  baseManifestPath,
  version,
  outputDir,
  staticReportPaths = [],
}) {
  const reportPaths = [
    ...SPECIES_REPORT_PATHS,
    ...STATIC_REPORT_PATHS,
    ...staticReportPaths.map((reportPath) => path.relative(repoRoot, reportPath)),
  ];
  const [baseManifest, ...reports] = await Promise.all([
    readJson(baseManifestPath),
    ...reportPaths.map((relativePath) =>
      readJson(path.join(repoRoot, relativePath)),
    ),
  ]);
  const speciesReports = reports.slice(0, SPECIES_REPORT_PATHS.length);
  const staticCogUrls = buildStaticCogUrls(reports.slice(SPECIES_REPORT_PATHS.length));
  const speciesEntries = speciesReports.flatMap((report) => report.entries);
  if (speciesEntries.length !== 8300) {
    throw new Error(`expected 8300 species records, received ${speciesEntries.length}`);
  }

  const statusCounts = speciesEntries.reduce((counts, entry) => {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    return counts;
  }, {});
  if (
    statusCounts.uploaded_verified + statusCounts.resumed_verified !== 8132 ||
    statusCounts.empty_source !== 166 ||
    statusCounts.approved_missing !== 2
  ) {
    throw new Error(`unexpected species status counts: ${JSON.stringify(statusCounts)}`);
  }

  const manifest = structuredClone(baseManifest);
  manifest.version = version;
  manifest.generatedAt = new Date().toISOString();
  manifest.layers = manifest.layers.map((layer) => {
    const displayCogUrl = staticCogUrls.get(layer.id);
    if (layer.id === 'species') {
      return {
        ...layer,
        speciesManifestUrl:
          layer.speciesManifestUrl ??
          `${SPECIES_COG_PREFIX}/manifests/species.manifest.v${version}.json`,
      };
    }
    if (!displayCogUrl) return layer;
    const renderingOverride = COG_GRADIENT_RANGE_OVERRIDES[layer.id];
    return {
      ...layer,
      displayCogUrl,
      ...(renderingOverride
        ? { rendering: { ...layer.rendering, ...renderingOverride } }
        : {}),
    };
  });
  addRichnessLayers(manifest, staticCogUrls);
  addHumanFootprint2030Layer(manifest);
  const speciesManifest = {
    version,
    generatedAt: manifest.generatedAt,
    publicBlobHost: PUBLIC_BLOB_HOST,
    sourcePrefix: `${SPECIES_SOURCE_PREFIX}/`,
    layerCount: speciesEntries.length,
    displayCogLayerCount: 8132,
    sourceOnlyLayerCount: 168,
    layers: speciesEntries.map(toSpeciesLayer).sort((left, right) => left.id.localeCompare(right.id)),
  };
  const displayOnlyCatalog = buildDisplayOnlyCatalog(manifest);
  const shouldWriteSpeciesManifest = !baseManifest.layers.some(
    (layer) => layer.id === 'species' && layer.speciesManifestUrl,
  );

  await fs.mkdir(outputDir, { recursive: true });
  const outputWrites = [
    fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    fs.writeFile(path.join(outputDir, 'catalog.json'), `${JSON.stringify(displayOnlyCatalog, null, 2)}\n`),
  ];
  if (shouldWriteSpeciesManifest) {
    outputWrites.push(fs.writeFile(
      path.join(outputDir, 'species.manifest.json'),
      `${JSON.stringify(speciesManifest, null, 2)}\n`,
    ));
  }
  await Promise.all(outputWrites);
  return { manifest, speciesManifest, displayOnlyCatalog, statusCounts, staticCogUrls };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await buildDisplayCogRelease(args);
  console.log(
    `[build:display-cog-release] wrote ${args.outputDir}: ${result.manifest.layers.length} layers, ` +
      `${result.speciesManifest.layerCount} species (${result.speciesManifest.displayCogLayerCount} COGs)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`[build:display-cog-release] ${error.message}`);
    process.exit(1);
  });
}
