import { strict as assert } from 'node:assert';
import { validateManifest } from '../validate-manifest.mjs';

const BLOCKED_LAYER_IDS = new Set(['kba_aica']);
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextPatchVersion(version) {
  const match = SEMVER_PATTERN.exec(version ?? '');
  assert(match, `catalogVersion must be a stable MAJOR.MINOR.PATCH version; got "${version}"`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function solutionCatalogFromManifest(manifest) {
  const catalogVersion = manifest.solutionCatalogVersion ?? manifest.catalogVersion;
  const solutions = manifest.solutions.map((solution) => ({
    solutionId: solution.id,
    solutionBasename: solution.rasterFile,
    domain: solution.domain ?? solution.finderInputs?.domain ?? 'land',
    rasterSha256: solution.rasterSha256,
  }));
  const landCount = solutions.filter((solution) => solution.domain === 'land').length;
  return {
    format: 'solution-catalog-v1',
    catalogVersion,
    releaseId: manifest.releaseId,
    expectedSolutionCount: solutions.length,
    expectedLandSolutionCount: landCount,
    expectedMarineSolutionCount: solutions.length - landCount,
    solutions,
  };
}

export function createCatalogPatch({
  liveManifest,
  generatedManifest,
  addLayerIds = [],
  removeLayerIds = [],
  generatedAt = new Date().toISOString(),
}) {
  assert(liveManifest?.releaseId, 'live manifest must be a published release');
  assert(Array.isArray(generatedManifest?.layers), 'generated manifest must contain layers');
  assert(addLayerIds.length > 0 || removeLayerIds.length > 0, 'catalog patch has no layer changes');

  const liveLayersById = new Map(liveManifest.layers.map((layer) => [layer.id, layer]));
  const generatedLayersById = new Map(generatedManifest.layers.map((layer) => [layer.id, layer]));
  const additions = addLayerIds.map((layerId) => {
    assert(!BLOCKED_LAYER_IDS.has(layerId), `${layerId} is blocked from public redistribution`);
    assert(!liveLayersById.has(layerId), `layer "${layerId}" is already in the live catalog`);
    const layer = generatedLayersById.get(layerId);
    assert(layer, `layer "${layerId}" is missing from the generated manifest`);
    assert(layer.dataRole === 'reference_layer', `layer "${layerId}" is not view-only`);
    return structuredClone(layer);
  });

  const removals = new Set(
    removeLayerIds.map((layerId) => {
      const layer = liveLayersById.get(layerId);
      assert(layer, `layer "${layerId}" is not in the live catalog`);
      assert(layer.dataRole === 'reference_layer', `layer "${layerId}" is not view-only`);
      return layerId;
    }),
  );
  const categories = structuredClone(liveManifest.categories);
  for (const category of categories) {
    category.layerIds = category.layerIds.filter((layerId) => !removals.has(layerId));
    for (const subcategory of category.subcategories ?? []) {
      subcategory.layerIds = subcategory.layerIds.filter((layerId) => !removals.has(layerId));
    }
  }

  for (const layer of additions) {
    addLayerToCategory(categories, layer);
  }

  const solutionCatalogVersion = liveManifest.solutionCatalogVersion ?? liveManifest.catalogVersion;
  return {
    ...structuredClone(liveManifest),
    generatedAt,
    catalogVersion: nextPatchVersion(liveManifest.catalogVersion),
    solutionCatalogVersion,
    categories,
    layers: [
      ...liveManifest.layers
        .filter((layer) => !removals.has(layer.id))
        .map((layer) => structuredClone(layer)),
      ...additions,
    ],
    manualEdit: {
      editorName: 'catalog-patch-cli',
      editedAt: generatedAt,
      source: 'view-only-layer-patch',
    },
  };
}

export async function validateCatalogPatch(
  liveManifest,
  candidate,
  manifestPath = 'catalog-patch',
) {
  assert.equal(candidate.releaseId, liveManifest.releaseId, 'releaseId changed');
  assert.equal(candidate.version, liveManifest.version, 'manifest schema version changed');
  assert.equal(
    candidate.solutionCatalogVersion,
    liveManifest.solutionCatalogVersion ?? liveManifest.catalogVersion,
    'solutionCatalogVersion changed',
  );
  assert.deepEqual(candidate.solutions, liveManifest.solutions, 'solutions changed');
  assert.equal(
    candidate.catalogVersion,
    nextPatchVersion(liveManifest.catalogVersion),
    'catalogVersion is not the next patch version',
  );

  const liveLayerById = new Map(liveManifest.layers.map((layer) => [layer.id, layer]));
  const candidateLayerIds = new Set(candidate.layers.map((layer) => layer.id));
  for (const liveLayer of liveManifest.layers) {
    if (!candidateLayerIds.has(liveLayer.id)) {
      assert.equal(
        liveLayer.dataRole,
        'reference_layer',
        `removed layer "${liveLayer.id}" is not view-only`,
      );
    }
  }
  for (const layer of candidate.layers) {
    const liveLayer = liveLayerById.get(layer.id);
    if (liveLayer) {
      assert.deepEqual(layer, liveLayer, `existing layer "${layer.id}" changed`);
    } else {
      assert(!BLOCKED_LAYER_IDS.has(layer.id), `${layer.id} is blocked from public redistribution`);
      assert.equal(layer.dataRole, 'reference_layer', `new layer "${layer.id}" is not view-only`);
    }
  }
  assert.deepEqual(
    categoryMetadata(candidate.categories),
    categoryMetadata(liveManifest.categories),
    'category metadata changed',
  );

  const catalog = solutionCatalogFromManifest(liveManifest);
  await validateManifest(candidate, manifestPath, { catalog });
  return catalog;
}

function addLayerToCategory(categories, layer) {
  const [categoryId, subcategoryId] = layer.category.split('.');
  const category = categories.find((entry) => entry.id === categoryId);
  assert(category, `layer "${layer.id}" references missing live category "${categoryId}"`);
  if (!subcategoryId) {
    if (!category.layerIds.includes(layer.id)) {
      category.layerIds.push(layer.id);
    }
    return;
  }
  const subcategory = category.subcategories?.find((entry) => entry.id === subcategoryId);
  assert(
    subcategory,
    `layer "${layer.id}" references missing live subcategory "${layer.category}"`,
  );
  if (!subcategory.layerIds.includes(layer.id)) {
    subcategory.layerIds.push(layer.id);
  }
}

function categoryMetadata(categories) {
  return categories.map((category) => ({
    ...category,
    layerIds: [],
    subcategories: (category.subcategories ?? []).map((subcategory) => ({
      ...subcategory,
      layerIds: [],
    })),
  }));
}
