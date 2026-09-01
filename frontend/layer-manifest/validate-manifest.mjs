import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
  PUBLIC_BLOB_HOST,
} from '../shared/runtime-manifest.constants.mjs';
import { readSolutionCatalog, validateManifestAgainstCatalog } from './lib/solution-catalog.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const examplePath = path.resolve(__dirname, './manifest.example.json');
const generatedManifestPath = path.resolve(__dirname, '..', LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH);
const APPROVED_LOCAL_PUBLIC_PATH_PREFIXES = ['/assets/', '/data/', '/releases/'];
export const MARINE_TARGET_FEATURE_SET = 'marine_ecosystems_and_mangroves';
export const MARINE_TARGET_PERCENTS = [30, 50];

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

function assertNumberOrNull(value, label) {
  assert(
    value === null || (typeof value === 'number' && Number.isFinite(value)),
    `${label} must be null or a finite number`,
  );
}

function assertBooleanOrNull(value, label) {
  assert(value === null || typeof value === 'boolean', `${label} must be null or a boolean`);
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

function assertSolutionPrecomputedMetricUrls(value, label, solution) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);

  for (const [key, urlOrMap] of Object.entries(value)) {
    assertString(key, `${label} key`);
    if (key === 'mecByGeography' || key === 'mecV2ByGeography') {
      assertGeographyUrls(urlOrMap, `${label}.${key}`, MEC_GEOGRAPHY_LEVELS);
      const domain =
        solution.domain === 'marine' ||
        solution.finderInputs?.domain === 'marine' ||
        solution.scope === 'marine' ||
        solution.blobPath?.startsWith('solutions/marine/')
          ? 'marine'
          : 'land';
      assert(domain === 'land', `${label}.${key} is only valid for land solutions`);
      continue;
    }
    if (key === 'speciesGoalsByGeography') {
      assertGeographyUrls(
        urlOrMap,
        `${label}.${key}`,
        solution.scope === 'sirap' ? SIRAP_SPECIES_GEOGRAPHY_LEVELS : MEC_GEOGRAPHY_LEVELS,
      );
      const domain =
        solution.domain === 'marine' ||
        solution.finderInputs?.domain === 'marine' ||
        solution.scope === 'marine' ||
        solution.blobPath?.startsWith('solutions/marine/')
          ? 'marine'
          : 'land';
      assert(domain === 'land', `${label}.${key} is only valid for land solutions`);
      continue;
    }
    assertString(urlOrMap, `${label}.${key}`);
    assertValidUrl(urlOrMap, `${label}.${key}`);
  }
}

function assertGeographyUrls(value, label, expectedLevels) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const keys = Object.keys(value);
  assert(
    keys.length === expectedLevels.length &&
      expectedLevels.every((level) => keys.includes(level)),
    `${label} must contain exactly: ${expectedLevels.join(', ')}`,
  );
  assertUrlMap(value, label);
}

function assertStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  for (const [index, item] of value.entries()) {
    assertString(item, `${label}[${index}]`);
  }
}

function assertHexColorOrNull(value, label) {
  assert(
    value === null || /^#[0-9a-fA-F]{6}$/.test(value),
    `${label} must be null or a #RRGGBB color`,
  );
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
  'data_used_for_cached_metric_calculation',
  'boundary_used_for_precomputed_metric_lookup',
  'data_used_for_live_metric_calculation_and_precomputed_metric_lookup',
];

const RENDER_VALUE_TYPES = ['binary', 'categorical', 'continuous'];
const RENDER_MODES = ['mask', 'gradient', 'categorical'];
const SOLUTION_DOMAINS = ['land', 'marine'];
const SOLUTION_DATA_PROFILES = ['runtime-compact-v1'];
const MEC_GEOGRAPHY_LEVELS = [
  'national',
  'departments',
  'municipalities',
  'siraps',
  'runaps',
  'omecs',
];
const SIRAP_SPECIES_GEOGRAPHY_LEVELS = ['siraps', 'departments', 'municipalities'];
const CATEGORY_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CATEGORY_PATH_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)?$/;
const COLOR_DEFAULT_FIELDS = ['selectedColor', 'startColor', 'endColor'];

function assertColorDefaults(value, label) {
  if (value === undefined) {
    return;
  }
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) {
    assert(
      COLOR_DEFAULT_FIELDS.includes(key),
      `${label}.${key} is not a recognized color default (allowed: ${COLOR_DEFAULT_FIELDS.join(', ')})`,
    );
    assertHexColorOrNull(value[key], `${label}.${key}`);
  }
}

function getDisplayUrls(layer) {
  return [layer.displayUrl, layer.displayCollectionUrl].filter(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

function getDisplayCogUrl(layer) {
  return typeof layer.displayCogUrl === 'string' && layer.displayCogUrl.trim().length > 0
    ? layer.displayCogUrl
    : null;
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
    args.includes('--check-remote-display-urls') || process.env.CHECK_REMOTE_DISPLAY_URLS === 'true'
  );
}

function shouldCheckReachability(url) {
  return url.startsWith('https://') && !url.endsWith('/');
}

export async function validateManifest(manifest, manifestPath, options = {}) {
  assert(
    manifest && typeof manifest === 'object' && !Array.isArray(manifest),
    'Manifest root must be an object',
  );
  assertString(manifest.version, 'version');
  assertString(manifest.generatedAt, 'generatedAt');
  assertString(manifest.publicBlobHost, 'publicBlobHost');
  assertString(manifest.sourceCsv, 'sourceCsv');
  if ('releaseId' in manifest) {
    assertString(manifest.releaseId, 'releaseId');
    assert(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.releaseId),
      'releaseId must be lowercase and hyphenated',
    );
    assertString(manifest.catalogVersion, 'catalogVersion');
    assert(
      options.catalog,
      'release manifest validation requires an explicit --catalog <path> catalog',
    );
    assert(
      manifest.publicBlobHost === PUBLIC_BLOB_HOST,
      `release publicBlobHost must equal the configured Blob host "${PUBLIC_BLOB_HOST}"`,
    );
  }
  if ('solutionDataProfile' in manifest) {
    assertOneOf(manifest.solutionDataProfile, SOLUTION_DATA_PROFILES, 'solutionDataProfile');
  }
  if ('manualEdit' in manifest && manifest.manualEdit !== undefined) {
    assert(
      manifest.manualEdit &&
        typeof manifest.manualEdit === 'object' &&
        !Array.isArray(manifest.manualEdit),
      'manualEdit must be an object when provided',
    );
    assertString(manifest.manualEdit.editorName, 'manualEdit.editorName');
    assertString(manifest.manualEdit.editedAt, 'manualEdit.editedAt');
    if ('source' in manifest.manualEdit) {
      assertNullableString(manifest.manualEdit.source, 'manualEdit.source');
    }
  }
  assert(Array.isArray(manifest.categories), 'categories must be an array');
  assert(Array.isArray(manifest.layers), 'layers must be an array');
  assert(Array.isArray(manifest.solutions), 'solutions must be an array');

  const subcategoryIdsByCategoryId = new Map();
  const categoryIds = manifest.categories.map((category, index) => {
    assert(category && typeof category === 'object', `categories[${index}] must be an object`);
    assertString(category.id, `categories[${index}].id`);
    assert(
      CATEGORY_ID_PATTERN.test(category.id),
      `categories[${index}].id must match ${CATEGORY_ID_PATTERN}`,
    );
    assertString(category.spanishLabel, `categories[${index}].spanishLabel`);
    if ('englishLabel' in category) {
      assertNullableString(category.englishLabel, `categories[${index}].englishLabel`);
    }
    assertColorDefaults(category.styleDefaults, `categories[${index}].styleDefaults`);
    assert(Array.isArray(category.layerIds), `categories[${index}].layerIds must be an array`);

    const subcategoryIds = new Set();
    if ('subcategories' in category && category.subcategories !== undefined) {
      assert(
        Array.isArray(category.subcategories),
        `categories[${index}].subcategories must be an array`,
      );
      category.subcategories.forEach((subcategory, subIndex) => {
        const subLabel = `categories[${index}].subcategories[${subIndex}]`;
        assert(subcategory && typeof subcategory === 'object', `${subLabel} must be an object`);
        assertString(subcategory.id, `${subLabel}.id`);
        assert(
          CATEGORY_ID_PATTERN.test(subcategory.id),
          `${subLabel}.id must match ${CATEGORY_ID_PATTERN}`,
        );
        assert(
          !subcategoryIds.has(subcategory.id),
          `${subLabel}.id is duplicated: ${subcategory.id}`,
        );
        subcategoryIds.add(subcategory.id);
        assertString(subcategory.spanishLabel, `${subLabel}.spanishLabel`);
        if ('englishLabel' in subcategory) {
          assertNullableString(subcategory.englishLabel, `${subLabel}.englishLabel`);
        }
        assertColorDefaults(subcategory.styleDefaults, `${subLabel}.styleDefaults`);
        assert(Array.isArray(subcategory.layerIds), `${subLabel}.layerIds must be an array`);
      });
    }
    subcategoryIdsByCategoryId.set(category.id, subcategoryIds);
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
    assertString(layer.category, `layers[${index}].category`);
    assert(
      CATEGORY_PATH_PATTERN.test(layer.category),
      `layers[${index}].category must match ${CATEGORY_PATH_PATTERN}`,
    );
    const dotIndex = layer.category.indexOf('.');
    const categoryId = dotIndex < 0 ? layer.category : layer.category.slice(0, dotIndex);
    const subcategoryId = dotIndex < 0 ? null : layer.category.slice(dotIndex + 1);
    assert(
      knownCategoryIds.has(categoryId),
      `layers[${index}].category references unknown category: ${categoryId}`,
    );
    if (subcategoryId !== null) {
      const subcategoryIds = subcategoryIdsByCategoryId.get(categoryId);
      assert(
        subcategoryIds && subcategoryIds.has(subcategoryId),
        `layers[${index}].category references unknown subcategory: ${categoryId}.${subcategoryId}`,
      );
    }
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
    if ('displayCogUrl' in layer) {
      assertUrlOrNull(layer.displayCogUrl, `layers[${index}].displayCogUrl`);
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
    assert(layer.rendering && typeof layer.rendering === 'object', `layers[${index}].rendering`);
    assertOneOf(
      layer.rendering.valueType,
      RENDER_VALUE_TYPES,
      `layers[${index}].rendering.valueType`,
    );
    assertOneOf(layer.rendering.renderMode, RENDER_MODES, `layers[${index}].rendering.renderMode`);
    if ('noDataValue' in layer.rendering && layer.rendering.noDataValue !== null) {
      assert(
        typeof layer.rendering.noDataValue === 'number' &&
          Number.isFinite(layer.rendering.noDataValue),
        `layers[${index}].rendering.noDataValue must be a finite number or null`,
      );
    }
    if ('selectedValue' in layer.rendering && layer.rendering.selectedValue !== null) {
      assert(
        typeof layer.rendering.selectedValue === 'number' &&
          Number.isFinite(layer.rendering.selectedValue),
        `layers[${index}].rendering.selectedValue must be a finite number or null`,
      );
    }
    if ('selectedColor' in layer.rendering) {
      assertHexColorOrNull(
        layer.rendering.selectedColor,
        `layers[${index}].rendering.selectedColor`,
      );
    }
    if ('minValue' in layer.rendering && layer.rendering.minValue !== null) {
      assert(
        typeof layer.rendering.minValue === 'number' && Number.isFinite(layer.rendering.minValue),
        `layers[${index}].rendering.minValue must be a finite number or null`,
      );
    }
    if ('maxValue' in layer.rendering && layer.rendering.maxValue !== null) {
      assert(
        typeof layer.rendering.maxValue === 'number' && Number.isFinite(layer.rendering.maxValue),
        `layers[${index}].rendering.maxValue must be a finite number or null`,
      );
    }
    if ('startColor' in layer.rendering) {
      assertHexColorOrNull(layer.rendering.startColor, `layers[${index}].rendering.startColor`);
    }
    if ('endColor' in layer.rendering) {
      assertHexColorOrNull(layer.rendering.endColor, `layers[${index}].rendering.endColor`);
    }
    if ('classColors' in layer.rendering) {
      assert(
        Array.isArray(layer.rendering.classColors),
        `layers[${index}].rendering.classColors must be an array`,
      );
      for (const [classIndex, classColor] of layer.rendering.classColors.entries()) {
        assert(
          classColor && typeof classColor === 'object',
          `layers[${index}].rendering.classColors[${classIndex}] must be an object`,
        );
        assert(
          typeof classColor.value === 'number' && Number.isFinite(classColor.value),
          `layers[${index}].rendering.classColors[${classIndex}].value must be a finite number`,
        );
        assertHexColorOrNull(
          classColor.color,
          `layers[${index}].rendering.classColors[${classIndex}].color`,
        );
      }
    }

    if (layer.dataRole === 'administrative_boundary') {
      const expectedRole = manifest.releaseId
        ? 'none'
        : 'boundary_used_for_precomputed_metric_lookup';
      assert(
        layer.roleInMetricCalculation === expectedRole,
        `layers[${index}].roleInMetricCalculation must be ${expectedRole} for administrative_boundary layers`,
      );
    }

    if (layer.dataRole === 'reference_layer') {
      assert(
        layer.roleInMetricCalculation === 'none',
        `layers[${index}].roleInMetricCalculation must be none for reference_layer layers`,
      );
      assert(
        layer.requiredForSolution === false,
        `layers[${index}].requiredForSolution must be false for reference_layer layers`,
      );
      assert(
        layer.selectableInFinder === false,
        `layers[${index}].selectableInFinder must be false for reference_layer layers`,
      );
      assert(
        layer.visibleInMapLayers === true,
        `layers[${index}].visibleInMapLayers must be true for reference_layer layers`,
      );
      assert(
        layer.compressedDataForLiveMetricsUrl === null,
        `layers[${index}].compressedDataForLiveMetricsUrl must be null for reference_layer layers`,
      );
      assert(
        Object.keys(layer.precomputedMetricUrls).length === 0,
        `layers[${index}].precomputedMetricUrls must be empty for reference_layer layers`,
      );
    }

    if (manifest.releaseId) {
      assert(
        layer.roleInMetricCalculation === 'none',
        `layers[${index}].roleInMetricCalculation must be none because release manifests do not support layer-side metric calculation`,
      );
      assert(
        layer.compressedDataForLiveMetricsUrl === null,
        `layers[${index}].compressedDataForLiveMetricsUrl must be null in release manifests`,
      );
      assert(
        Object.keys(layer.precomputedMetricUrls).length === 0,
        `layers[${index}].precomputedMetricUrls must be empty in release manifests`,
      );
    }

    if (options.checkRemoteDisplayUrls) {
      const displayCogUrl = getDisplayCogUrl(layer);
      if (displayCogUrl && shouldCheckReachability(displayCogUrl)) {
        remoteDisplayUrls.push({ url: displayCogUrl, label: `layers[${index}].displayCogUrl` });
      }
      for (const url of getDisplayUrls(layer)) {
        if (shouldCheckReachability(url)) {
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
    if (Array.isArray(category.subcategories)) {
      for (const [subIndex, subcategory] of category.subcategories.entries()) {
        for (const layerId of subcategory.layerIds) {
          assertString(layerId, `categories[${index}].subcategories[${subIndex}].layerIds item`);
          assert(
            knownLayerIds.has(layerId),
            `categories[${index}].subcategories[${subIndex}].layerIds references unknown layer: ${layerId}`,
          );
        }
      }
    }
  }

  const solutionIds = manifest.solutions.map((solution, index) => {
    validateSolution(solution, index, remoteDisplayUrls, options);
    if (manifest.solutionDataProfile === 'runtime-compact-v1') {
      assert(
        solution.coverage.length === 0,
        `solutions[${index}].coverage must be empty for runtime-compact-v1`,
      );
      assert(
        solution.finderInputs.structuredTargets,
        `solutions[${index}].finderInputs.structuredTargets is required for runtime-compact-v1`,
      );
    }
    return solution.id;
  });

  assertUnique(solutionIds, 'solutions.id');
  if (manifest.releaseId) {
    validateManifestAgainstCatalog(manifest, options.catalog);
    const land = manifest.solutions.filter((solution) => {
      const domain =
        solution.domain ??
        solution.finderInputs?.domain ??
        (solution.scope === 'marine' ? 'marine' : 'land');
      return domain !== 'marine';
    });
    const marine = manifest.solutions.filter((solution) => !land.includes(solution));
    for (const solution of land) {
      const urls = solution.precomputedMetricUrls ?? {};
      const allowOriginRelative = options.aoiCoveragePreviewSolutionId === solution.id;
      assertRequiredReleaseMetricUrls(solution, manifest.releaseId, allowOriginRelative);
      assert(!('mecByGeography' in urls), `${solution.id} must omit MEC v1 in release mode`);
      if (solution.scope === 'sirap') {
        assertGeographyUrls(
          urls.mecV2ByGeography,
          `${solution.id}.mecV2ByGeography`,
          MEC_GEOGRAPHY_LEVELS,
        );
        assertString(
          urls.speciesGoalsCatalog,
          `${solution.id}.speciesGoalsCatalog`,
        );
        assertGeographyUrls(
          urls.speciesGoalsByGeography,
          `${solution.id}.speciesGoalsByGeography`,
          SIRAP_SPECIES_GEOGRAPHY_LEVELS,
        );
      } else {
        assertGeographyUrls(
          urls.mecV2ByGeography,
          `${solution.id}.mecV2ByGeography`,
          MEC_GEOGRAPHY_LEVELS,
        );
      }
      assertReleaseMetricUrls(solution, manifest.releaseId, allowOriginRelative);
    }
    for (const solution of marine) {
      const urls = solution.precomputedMetricUrls ?? {};
      assertRequiredReleaseMetricUrls(solution, manifest.releaseId);
      assert(
        !urls.mecByGeography && !urls.mecV2ByGeography,
        `${solution.id} must not advertise terrestrial MEC URLs`,
      );
      assertReleaseMetricUrls(solution, manifest.releaseId);
      assertMarineFinderContract(solution);
    }
  }

  for (const { url, label } of remoteDisplayUrls) {
    await assertReachable(url, label);
  }

  return {
    manifestPath,
    categoryCount: manifest.categories.length,
    layerCount: manifest.layers.length,
    solutionCount: manifest.solutions.length,
    checkedRemoteDisplayUrlCount: remoteDisplayUrls.length,
  };
}

function assertRequiredReleaseMetricUrls(solution, releaseId, allowOriginRelative = false) {
  const urls = solution.precomputedMetricUrls ?? {};
  const keys = ['goals', 'cache', 'compactCache'];
  for (const key of keys) {
    assertReleaseMetricUrl(
      urls[key],
      releaseId,
      `${solution.id} precomputedMetricUrls.${key}`,
      allowOriginRelative,
    );
  }
}

function assertReleaseMetricUrls(solution, releaseId, allowOriginRelative = false) {
  for (const [key, value] of Object.entries(solution.precomputedMetricUrls ?? {})) {
    const urls =
      value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value) : [value];
    for (const url of urls) {
      assertReleaseMetricUrl(
        url,
        releaseId,
        `${solution.id} precomputedMetricUrls.${key}`,
        allowOriginRelative,
      );
    }
  }
}

function assertReleaseMetricUrl(value, releaseId, label, allowOriginRelative = false) {
  assert(typeof value === 'string', `${label} must be a URL`);
  let parsed;
  try {
    parsed = new URL(value, PUBLIC_BLOB_HOST);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  const expectedOrigin = new URL(PUBLIC_BLOB_HOST).origin;
  const isOriginRelative = value.startsWith('/');
  assert(
    (allowOriginRelative && isOriginRelative) ||
      (!isOriginRelative && parsed.origin === expectedOrigin),
    `${label} must use configured Blob origin${
      allowOriginRelative ? ' or an origin-relative preview URL' : ''
    }`,
  );
  assert(
    parsed.pathname.startsWith(`/releases/${releaseId}/`),
    `${label} must use exact release pathname prefix`,
  );
}

/**
 * The Solution Finder only offers marine solutions when these two fields carry the
 * exact contract shape, so a nullable-string check is not enough to keep the
 * "Explore selected solution" button reachable.
 */
function assertMarineFinderContract(solution) {
  const finderInputs = solution.finderInputs ?? {};
  assert(
    finderInputs.targetFeatureSet === MARINE_TARGET_FEATURE_SET,
    `${solution.id} finderInputs.targetFeatureSet must be ` +
      `"${MARINE_TARGET_FEATURE_SET}", found ${JSON.stringify(finderInputs.targetFeatureSet)}`,
  );
  assert(
    MARINE_TARGET_PERCENTS.includes(finderInputs.targetPercent),
    `${solution.id} finderInputs.targetPercent must be one of ` +
      `${MARINE_TARGET_PERCENTS.join(', ')}, found ${JSON.stringify(finderInputs.targetPercent)}`,
  );
}

function validateSolution(solution, index, remoteDisplayUrls, options) {
  assert(solution && typeof solution === 'object', `solutions[${index}] must be an object`);
  assertString(solution.id, `solutions[${index}].id`);
  assertString(solution.name, `solutions[${index}].name`);
  assertString(solution.description, `solutions[${index}].description`);
  if ('domain' in solution) {
    assertOneOf(solution.domain, SOLUTION_DOMAINS, `solutions[${index}].domain`);
  }
  assertString(solution.scope, `solutions[${index}].scope`);
  if ('sirapId' in solution) {
    assertNullableString(solution.sirapId, `solutions[${index}].sirapId`);
  }
  assertString(solution.displayUrl, `solutions[${index}].displayUrl`);
  assertValidUrl(solution.displayUrl, `solutions[${index}].displayUrl`);
  if ('displayCogUrl' in solution) {
    assertUrlOrNull(solution.displayCogUrl, `solutions[${index}].displayCogUrl`);
  }
  assertString(solution.metadataUrl, `solutions[${index}].metadataUrl`);
  assertValidUrl(solution.metadataUrl, `solutions[${index}].metadataUrl`);
  assertString(solution.rasterFile, `solutions[${index}].rasterFile`);
  assertString(solution.metadataFile, `solutions[${index}].metadataFile`);
  assertString(solution.blobPath, `solutions[${index}].blobPath`);
  if ('rasterSha256' in solution) {
    assert(
      typeof solution.rasterSha256 === 'string' && /^[0-9a-f]{64}$/.test(solution.rasterSha256),
      `solutions[${index}].rasterSha256 must be a lowercase SHA-256 digest`,
    );
  }
  assertNullableString(solution.generatedAt, `solutions[${index}].generatedAt`);
  if ('capabilities' in solution && solution.capabilities !== undefined) {
    validateSolutionCapabilities(solution.capabilities, `solutions[${index}].capabilities`);
  }
  validateSolutionFinderInputs(solution.finderInputs, `solutions[${index}].finderInputs`);
  validateSolutionInputLayerIds(solution.inputLayerIds, `solutions[${index}].inputLayerIds`);
  validateSolutionSummaryMetrics(solution.summaryMetrics, `solutions[${index}].summaryMetrics`);
  validateSolutionCoverage(solution.coverage, `solutions[${index}].coverage`);
  validateRendering(solution.rendering, `solutions[${index}].rendering`);
  if ('precomputedMetricUrls' in solution && solution.precomputedMetricUrls !== undefined) {
    assertSolutionPrecomputedMetricUrls(
      solution.precomputedMetricUrls,
      `solutions[${index}].precomputedMetricUrls`,
      solution,
    );
  }

  if (options.checkRemoteDisplayUrls) {
    remoteDisplayUrls.push({ url: solution.displayUrl, label: `solutions[${index}].displayUrl` });
    if (solution.displayCogUrl) {
      remoteDisplayUrls.push({
        url: solution.displayCogUrl,
        label: `solutions[${index}].displayCogUrl`,
      });
    }
    remoteDisplayUrls.push({ url: solution.metadataUrl, label: `solutions[${index}].metadataUrl` });
  }
}

function validateSolutionCapabilities(capabilities, label) {
  assert(
    capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities),
    `${label} must be an object`,
  );
  const keys = Object.keys(capabilities);
  assert(
    keys.every((key) => key === 'aoiCoverageMetrics'),
    `${label} contains an unsupported capability`,
  );
  if ('aoiCoverageMetrics' in capabilities) {
    assert(capabilities.aoiCoverageMetrics === 'v2', `${label}.aoiCoverageMetrics must be "v2"`);
  }
}

function validateSolutionFinderInputs(finderInputs, label) {
  assert(finderInputs && typeof finderInputs === 'object', `${label} must be an object`);
  if ('domain' in finderInputs) {
    assertOneOf(finderInputs.domain, SOLUTION_DOMAINS, `${label}.domain`);
  }
  assertString(finderInputs.scope, `${label}.scope`);
  assertNullableString(finderInputs.targetFeatureSet, `${label}.targetFeatureSet`);
  assertStringArray(finderInputs.targetFeatureIds, `${label}.targetFeatureIds`);
  assertNumberOrNull(finderInputs.targetPercent, `${label}.targetPercent`);
  if (finderInputs.structuredTargets !== undefined) {
    validateStructuredTargets(finderInputs.structuredTargets, `${label}.structuredTargets`);
  }
  assertNullableString(finderInputs.costLayerId, `${label}.costLayerId`);
  assertStringArray(finderInputs.includeLayerIds, `${label}.includeLayerIds`);
  assertStringArray(finderInputs.excludeLayerIds, `${label}.excludeLayerIds`);
}

function validateStructuredTargets(targets, label) {
  assert(
    targets && typeof targets === 'object' && !Array.isArray(targets),
    `${label} must be an object`,
  );
  assert(
    targets.format === 'solution-target-metadata-v1',
    `${label}.format must be solution-target-metadata-v1`,
  );
  assertOneOf(
    targets.sourceEvaluation,
    ['prioritizr_model', 'final_summary_csv', 'legacy-single-ecosystem'],
    `${label}.sourceEvaluation`,
  );
  for (const dimension of [
    'ecosystems',
    'strategicEcosystems',
    'ecosystemServices',
    'speciesRepresentation',
    'espRn',
  ]) {
    const entries = targets[dimension];
    assert(Array.isArray(entries), `${label}.${dimension} must be an array`);
    let previousFeatureId = '';
    for (const [index, entry] of entries.entries()) {
      assert(
        entry && typeof entry === 'object' && !Array.isArray(entry),
        `${label}.${dimension}[${index}] must be an object`,
      );
      assertString(entry.featureId, `${label}.${dimension}[${index}].featureId`);
      assert(
        Number.isFinite(entry.targetPercent) &&
          entry.targetPercent >= 0 &&
          entry.targetPercent <= 100,
        `${label}.${dimension}[${index}].targetPercent must be between 0 and 100`,
      );
      assert(
        entry.featureId > previousFeatureId,
        `${label}.${dimension} must be uniquely sorted by featureId`,
      );
      previousFeatureId = entry.featureId;
    }
  }
}

function validateSolutionInputLayerIds(inputLayerIds, label) {
  assert(inputLayerIds && typeof inputLayerIds === 'object', `${label} must be an object`);
  assertStringArray(inputLayerIds.features, `${label}.features`);
  assertNullableString(inputLayerIds.cost, `${label}.cost`);
  assertStringArray(inputLayerIds.includes, `${label}.includes`);
  assertStringArray(inputLayerIds.excludes, `${label}.excludes`);
}

function validateSolutionSummaryMetrics(summaryMetrics, label) {
  assert(summaryMetrics && typeof summaryMetrics === 'object', `${label} must be an object`);
  assertNumberOrNull(summaryMetrics.nSelected, `${label}.nSelected`);
  assertNumberOrNull(summaryMetrics.totalCost, `${label}.totalCost`);
  assertNumberOrNull(summaryMetrics.pctTargetsMet, `${label}.pctTargetsMet`);
  assert(
    Number.isSafeInteger(summaryMetrics.coverageRowCount) && summaryMetrics.coverageRowCount >= 0,
    `${label}.coverageRowCount must be a non-negative integer`,
  );
}

function validateSolutionCoverage(coverage, label) {
  assert(Array.isArray(coverage), `${label} must be an array`);
  for (const [index, row] of coverage.entries()) {
    assert(row && typeof row === 'object', `${label}[${index}] must be an object`);
    assertString(row.feature, `${label}[${index}].feature`);
    assertBooleanOrNull(row.met, `${label}[${index}].met`);
    assertNumberOrNull(row.relativeTarget, `${label}[${index}].relativeTarget`);
    assertNumberOrNull(row.relativeHeld, `${label}[${index}].relativeHeld`);
    assertNumberOrNull(row.relativeShortfall, `${label}[${index}].relativeShortfall`);
  }
}

function validateRendering(rendering, label) {
  assert(rendering && typeof rendering === 'object', label);
  assertOneOf(rendering.valueType, RENDER_VALUE_TYPES, `${label}.valueType`);
  assertOneOf(rendering.renderMode, RENDER_MODES, `${label}.renderMode`);
  if ('noDataValue' in rendering) {
    assertNumberOrNull(rendering.noDataValue, `${label}.noDataValue`);
  }
  if ('selectedValue' in rendering) {
    assertNumberOrNull(rendering.selectedValue, `${label}.selectedValue`);
  }
  if ('selectedColor' in rendering) {
    assertHexColorOrNull(rendering.selectedColor, `${label}.selectedColor`);
  }
  if ('minValue' in rendering) {
    assertNumberOrNull(rendering.minValue, `${label}.minValue`);
  }
  if ('maxValue' in rendering) {
    assertNumberOrNull(rendering.maxValue, `${label}.maxValue`);
  }
  if ('startColor' in rendering) {
    assertHexColorOrNull(rendering.startColor, `${label}.startColor`);
  }
  if ('endColor' in rendering) {
    assertHexColorOrNull(rendering.endColor, `${label}.endColor`);
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

function parseCliArgs(cliArgs) {
  const includeExample = cliArgs.includes('--include-example');
  const catalogIndex = cliArgs.indexOf('--catalog');
  const catalogArg = catalogIndex >= 0 ? cliArgs[catalogIndex + 1] : null;
  if (catalogIndex >= 0 && (!catalogArg || catalogArg.startsWith('--'))) {
    throw new Error('--catalog requires a path');
  }
  const catalogPath = catalogIndex >= 0 ? path.resolve(process.cwd(), catalogArg) : null;
  const valueOptionIndexes = new Set(catalogIndex >= 0 ? [catalogIndex, catalogIndex + 1] : []);
  const targetArgs = cliArgs.filter(
    (arg, index) => !arg.startsWith('--') && !valueOptionIndexes.has(index),
  );
  return { catalogPath, includeExample, targetArgs };
}

async function getTargetPaths(targetArgs, includeExample) {
  if (targetArgs.length > 0) {
    return targetArgs.map((arg) => path.resolve(process.cwd(), arg));
  }

  const paths = [];

  if (await exists(generatedManifestPath)) {
    paths.push(generatedManifestPath);
  }
  if (includeExample && (await exists(examplePath))) {
    paths.push(examplePath);
  }

  return paths;
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const checkRemoteDisplayUrls = shouldCheckRemoteDisplayUrls(cliArgs);
  const { catalogPath, includeExample, targetArgs } = parseCliArgs(cliArgs);
  const catalog = catalogPath ? await readSolutionCatalog(catalogPath) : null;
  const targetPaths = await getTargetPaths(targetArgs, includeExample);

  for (const targetPath of targetPaths) {
    const manifest = await readJson(targetPath);
    const result = await validateManifest(manifest, targetPath, {
      catalog,
      checkRemoteDisplayUrls,
    });
    console.log(
      `[validate:layer-manifest] ${path.relative(process.cwd(), result.manifestPath)} passed (${result.layerCount} layer(s), ${result.solutionCount} solution(s), ${result.categoryCount} categories)`,
    );
    if (checkRemoteDisplayUrls) {
      console.log(
        `[validate:layer-manifest] checked ${result.checkedRemoteDisplayUrlCount} remote display URL(s)`,
      );
    }
  }
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(`[validate:layer-manifest] ${error.message}`);
    process.exit(1);
  });
}
