import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templatePath = path.resolve(__dirname, './manifest.template.json');
const generatedManifestPath = path.resolve(__dirname, '../public/data/layer-manifest/manifest.json');
const APPROVED_LOCAL_PUBLIC_PATH_PREFIXES = ['/assets/', '/data/'];

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
    assertValidUrl(value, label);
  }
}

function assertValidUrl(value, label) {
  assert(!/\s/.test(value), `${label} must not contain whitespace`);

  if (value.startsWith('/')) {
    assert(!value.startsWith('//'), `${label} must not be a protocol-relative URL`);
    assert(
      APPROVED_LOCAL_PUBLIC_PATH_PREFIXES.some((prefix) => value.startsWith(prefix)),
      `${label} must use an approved local public path prefix: ${APPROVED_LOCAL_PUBLIC_PATH_PREFIXES.join(', ')}`,
    );

    try {
      new URL(value, 'http://localhost');
    } catch {
      throw new Error(`${label} must be a syntactically valid local public path`);
    }

    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a syntactically valid URL`);
  }

  assert(url.protocol === 'https:', `${label} must use https:// or an approved local public path`);
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
    assertString(url, `${label}.${key}`);
    assertValidUrl(url, `${label}.${key}`);
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

const LIVE_METRIC_CALCULATION_ROLES = [
  'data_used_for_live_metric_calculation',
  'data_used_for_live_metric_calculation_and_precomputed_metric_lookup',
];

function getDisplayUrls(layer) {
  return [layer.displayUrl, layer.displayCollectionUrl].filter(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

async function assertReachable(url, label) {
  let response = await fetch(url, { method: 'HEAD', redirect: 'follow' });

  if (response.status === 405 || response.status === 403) {
    response = await fetch(url, { method: 'GET', redirect: 'follow' });
  }

  assert(
    response.ok,
    `${label} failed reachability check with HTTP ${response.status} ${response.statusText}`,
  );
}

function shouldCheckRemoteDisplayUrls(args) {
  return (
    args.includes('--check-remote-display-urls') ||
    process.env.CHECK_REMOTE_DISPLAY_URLS === 'true'
  );
}

async function validateManifest(manifest, manifestPath, options = {}) {
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
  const remoteDisplayUrls = [];

  const layerIds = manifest.layers.map((layer, index) => {
    assert(layer && typeof layer === 'object', `layers[${index}] must be an object`);
    assertString(layer.id, `layers[${index}].id`);
    assertString(layer.spanishLabel, `layers[${index}].spanishLabel`);
    assert(
      'englishLabel' in layer,
      `layers[${index}].englishLabel must be present as a string or null`,
    );
    assertNullableString(layer.englishLabel, `layers[${index}].englishLabel`);
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
    assert(
      getDisplayUrls(layer).length > 0,
      `layers[${index}] must include a non-null displayUrl or displayCollectionUrl`,
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

    if (layer.dataRole === 'administrative_boundary') {
      assert(
        layer.roleInMetricCalculation === 'boundary_used_for_precomputed_metric_lookup',
        `layers[${index}].roleInMetricCalculation must be boundary_used_for_precomputed_metric_lookup for administrative_boundary layers`,
      );
    }

    if (LIVE_METRIC_CALCULATION_ROLES.includes(layer.roleInMetricCalculation)) {
      assert(
        typeof layer.compressedDataForLiveMetricsUrl === 'string' &&
          layer.compressedDataForLiveMetricsUrl.trim().length > 0,
        `layers[${index}].compressedDataForLiveMetricsUrl is required for live metric calculation layers`,
      );
    }

    if (options.checkRemoteDisplayUrls) {
      for (const url of getDisplayUrls(layer)) {
        if (url.startsWith('https://')) {
          remoteDisplayUrls.push({ url, label: `layers[${index}] display URL` });
        }
      }
    }

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

  for (const { url, label } of remoteDisplayUrls) {
    await assertReachable(url, label);
  }

  return {
    manifestPath,
    categoryCount: manifest.categories.length,
    layerCount: manifest.layers.length,
    checkedRemoteDisplayUrlCount: remoteDisplayUrls.length,
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function getTargetPaths() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

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
  const checkRemoteDisplayUrls = shouldCheckRemoteDisplayUrls(process.argv.slice(2));
  const targetPaths = await getTargetPaths();

  for (const targetPath of targetPaths) {
    const manifest = await readJson(targetPath);
    const result = await validateManifest(manifest, targetPath, { checkRemoteDisplayUrls });
    console.log(
      `[validate:layer-manifest] ${path.relative(process.cwd(), result.manifestPath)} passed (${result.layerCount} layer(s), ${result.categoryCount} categories)`,
    );
    if (checkRemoteDisplayUrls) {
      console.log(
        `[validate:layer-manifest] checked ${result.checkedRemoteDisplayUrlCount} remote display URL(s)`,
      );
    }
  }
}

main().catch((error) => {
  console.error(`[validate:layer-manifest] ${error.message}`);
  process.exit(1);
});
