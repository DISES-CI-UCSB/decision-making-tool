import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templatePath = path.resolve(__dirname, './manifest.template.json');
const generatedManifestPath = path.resolve(__dirname, '../public/data/layer-manifest/manifest.json');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertString(value, label) {
  assert(
    typeof value === 'string' && value.trim().length > 0,
    `${label} must be a non-empty string`,
  );
}

function assertNullableString(value, label) {
  assert(
    value === null || (typeof value === 'string' && value.trim().length > 0),
    `${label} must be null or a non-empty string`,
  );
}

function assertUrlOrNull(value, label) {
  assertNullableString(value, label);
  if (value) {
    assert(
      value.startsWith('https://') || value.startsWith('/'),
      `${label} must be an HTTPS URL or local public path`,
    );
  }
}

function assertUnique(values, label) {
  const seen = new Set();
  const duplicates = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  assert(
    duplicates.size === 0,
    `${label} contains duplicate values: ${Array.from(duplicates).join(', ')}`,
  );
}

function assertOneOf(value, allowedValues, label) {
  assert(allowedValues.includes(value), `${label} must be one of: ${allowedValues.join(', ')}`);
}

function assertUrlMap(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);

  for (const [key, url] of Object.entries(value)) {
    assertString(key, `${label} key`);
    assertUrlOrNull(url, `${label}.${key}`);
  }
}

const DATA_ROLES = [
  'feature_layer',
  'manifest_for_species_layers',
  'species_layer',
  'cost_layer',
  'include_layer',
  'solution_layer',
  'administrative_boundary',
  'reference_layer',
];

const METRIC_CALCULATION_ROLES = [
  'none',
  'data_used_for_live_metric_calculation',
  'boundary_used_for_precomputed_metric_lookup',
  'data_used_for_live_metric_calculation_and_precomputed_metric_lookup',
];

function validateManifest(manifest, manifestPath) {
  assert(
    manifest && typeof manifest === 'object' && !Array.isArray(manifest),
    'Manifest root must be an object',
  );
  assertString(manifest.version, 'version');
  assertString(manifest.generatedAt, 'generatedAt');
  assertString(manifest.publicBlobHost, 'publicBlobHost');
  assertString(manifest.sourceCsv, 'sourceCsv');
  assert(Array.isArray(manifest.categories), 'categories must be an array');
  assert(Array.isArray(manifest.layers), 'layers must be an array');

  const categoryIds = manifest.categories.map((category, index) => {
    assert(category && typeof category === 'object', `categories[${index}] must be an object`);
    assertString(category.id, `categories[${index}].id`);
    assertString(category.spanishLabel, `categories[${index}].spanishLabel`);
    if ('englishLabel' in category) {
      assertNullableString(category.englishLabel, `categories[${index}].englishLabel`);
    }
    assert(Array.isArray(category.layerIds), `categories[${index}].layerIds must be an array`);
    return category.id;
  });

  assertUnique(categoryIds, 'categories.id');
  const knownCategoryIds = new Set(categoryIds);

  const layerIds = manifest.layers.map((layer, index) => {
    assert(layer && typeof layer === 'object', `layers[${index}] must be an object`);
    assertString(layer.id, `layers[${index}].id`);
    assertString(layer.spanishLabel, `layers[${index}].spanishLabel`);
    if ('englishLabel' in layer) {
      assertNullableString(layer.englishLabel, `layers[${index}].englishLabel`);
    }
    assertString(layer.description, `layers[${index}].description`);
    assertNullableString(layer.tooltip, `layers[${index}].tooltip`);
    assertOneOf(layer.dataRole, DATA_ROLES, `layers[${index}].dataRole`);
    assertString(layer.sidebarCategoryId, `layers[${index}].sidebarCategoryId`);
    assert(
      knownCategoryIds.has(layer.sidebarCategoryId),
      `layers[${index}].sidebarCategoryId is not listed in categories: ${layer.sidebarCategoryId}`,
    );
    assertOneOf(
      layer.roleInMetricCalculation,
      METRIC_CALCULATION_ROLES,
      `layers[${index}].roleInMetricCalculation`,
    );
    assert(
      'displayUrl' in layer || 'displayCollectionUrl' in layer,
      `layers[${index}] must include displayUrl or displayCollectionUrl`,
    );
    if ('displayUrl' in layer) {
      assertUrlOrNull(layer.displayUrl, `layers[${index}].displayUrl`);
    }
    if ('displayCollectionUrl' in layer) {
      assertUrlOrNull(layer.displayCollectionUrl, `layers[${index}].displayCollectionUrl`);
    }
    if ('speciesManifestUrl' in layer) {
      assertUrlOrNull(layer.speciesManifestUrl, `layers[${index}].speciesManifestUrl`);
    }
    assertUrlOrNull(layer.metadataUrl, `layers[${index}].metadataUrl`);
    assertUrlOrNull(
      layer.compressedDataForLiveMetricsUrl,
      `layers[${index}].compressedDataForLiveMetricsUrl`,
    );
    assertUrlMap(layer.precomputedMetricUrls, `layers[${index}].precomputedMetricUrls`);

    return layer.id;
  });

  assertUnique(layerIds, 'layers.id');
  const knownLayerIds = new Set(layerIds);

  for (const [index, category] of manifest.categories.entries()) {
    for (const layerId of category.layerIds) {
      assertString(layerId, `categories[${index}].layerIds item`);
      assert(
        knownLayerIds.has(layerId),
        `categories[${index}].layerIds references unknown layer: ${layerId}`,
      );
    }
  }

  return {
    manifestPath,
    categoryCount: manifest.categories.length,
    layerCount: manifest.layers.length,
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function getTargetPaths() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    return args.map((arg) => path.resolve(process.cwd(), arg));
  }

  const paths = [templatePath];

  if (await exists(generatedManifestPath)) {
    paths.push(generatedManifestPath);
  }

  return paths;
}

async function main() {
  const targetPaths = await getTargetPaths();

  for (const targetPath of targetPaths) {
    const manifest = await readJson(targetPath);
    const result = validateManifest(manifest, targetPath);
    console.log(
      `[validate:layer-manifest] ${path.relative(process.cwd(), result.manifestPath)} passed (${result.layerCount} layer(s), ${result.categoryCount} categories)`,
    );
  }
}

main().catch((error) => {
  console.error(`[validate:layer-manifest] ${error.message}`);
  process.exit(1);
});
