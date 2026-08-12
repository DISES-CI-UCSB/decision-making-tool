import {
  createSolutionDisplayCogUrl,
  createSolutionPrecomputedMetricUrls,
} from './metric-urls.mjs';
import { validateManifestAgainstCatalog } from './solution-catalog.mjs';

export const RUNTIME_COMPACT_SOLUTION_PROFILE = 'runtime-compact-v1';

/**
 * Artifact URLs are rebound from the release contract rather than trusted from the
 * frozen preflight manifest, so a republished artifact directory reaches runtime
 * without regenerating preflight.
 */
export const REBOUND_RUNTIME_FIELDS = ['precomputedMetricUrls', 'displayCogUrl'];

const RUNTIME_SOLUTION_FIELDS = [
  'id',
  'name',
  'description',
  'domain',
  'scope',
  'sirapId',
  'displayUrl',
  'displayCogUrl',
  'metadataUrl',
  'rasterFile',
  'metadataFile',
  'blobPath',
  'rasterSha256',
  'generatedAt',
  'precomputedMetricUrls',
  'finderInputs',
  'inputLayerIds',
  'summaryMetrics',
  'rendering',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cloneDefinedFields(source, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, structuredClone(source[field])]),
  );
}

function runtimeSolutionDomain(solution) {
  return (
    solution.domain ??
    solution.finderInputs?.domain ??
    (solution.scope === 'marine' ? 'marine' : 'land')
  );
}

export function compactRuntimeSolution(
  solution,
  { releaseId = null, speciesGoalsInventory = null, speciesGoalsBaseUrl = undefined } = {},
) {
  assert(solution && typeof solution === 'object', 'runtime solution source must be an object');
  assert(
    Array.isArray(solution.coverage),
    `${solution.id ?? 'solution'} coverage must be an array`,
  );
  assert(
    solution.finderInputs?.structuredTargets,
    `${solution.id ?? 'solution'} must include structuredTargets before runtime compaction`,
  );

  const compact = {
    ...cloneDefinedFields(solution, RUNTIME_SOLUTION_FIELDS),
    coverage: [],
  };
  if (releaseId) {
    const domain = runtimeSolutionDomain(solution);
    compact.precomputedMetricUrls = createSolutionPrecomputedMetricUrls(
      solution.id,
      solution.precomputedMetricUrls ?? {},
      domain,
      { releaseId, speciesGoalsInventory, speciesGoalsBaseUrl },
    );
    const displayCogUrl = createSolutionDisplayCogUrl(solution.rasterFile, domain, { releaseId });
    if (displayCogUrl) {
      compact.displayCogUrl = displayCogUrl;
    } else {
      delete compact.displayCogUrl;
    }
  }
  return compact;
}

export function compactRuntimeLayer(layer, { backedMetadataUrls = null } = {}) {
  const compact = structuredClone(layer);
  compact.roleInMetricCalculation = 'none';
  compact.compressedDataForLiveMetricsUrl = null;
  compact.precomputedMetricUrls = {};
  if (backedMetadataUrls && compact.metadataUrl && !backedMetadataUrls.has(compact.metadataUrl)) {
    compact.metadataUrl = null;
  }
  return compact;
}

export function buildRuntimeReleaseManifest({
  baseManifest,
  preflightManifest,
  catalog,
  speciesGoalsInventory = null,
  speciesGoalsBaseUrl = undefined,
  backedLayerMetadataUrls = null,
}) {
  assert(baseManifest && typeof baseManifest === 'object', 'base manifest must be an object');
  assert(
    preflightManifest && typeof preflightManifest === 'object',
    'preflight manifest must be an object',
  );
  assert(Array.isArray(baseManifest.categories), 'base manifest categories must be an array');
  assert(Array.isArray(baseManifest.layers), 'base manifest layers must be an array');
  assert(
    Array.isArray(preflightManifest.solutions),
    'preflight manifest solutions must be an array',
  );

  validateManifestAgainstCatalog(preflightManifest, catalog);

  if (
    speciesGoalsInventory !== null &&
    (speciesGoalsInventory?.format !== 'species-goals-release-inventory-index-v1' ||
      speciesGoalsInventory.releaseId !== catalog.releaseId ||
      typeof speciesGoalsInventory.solutions !== 'object')
  ) {
    throw new Error('species goals release inventory is invalid or stale');
  }
  const solutions = preflightManifest.solutions.map((solution) =>
    compactRuntimeSolution(solution, {
      releaseId: catalog.releaseId,
      speciesGoalsInventory: speciesGoalsInventory?.solutions?.[solution.id] ?? null,
      speciesGoalsBaseUrl,
    }),
  );
  const manifest = {
    version: baseManifest.version,
    generatedAt: preflightManifest.generatedAt,
    publicBlobHost: baseManifest.publicBlobHost,
    sourceCsv: baseManifest.sourceCsv,
    releaseId: catalog.releaseId,
    catalogVersion: catalog.catalogVersion,
    solutionDataProfile: RUNTIME_COMPACT_SOLUTION_PROFILE,
    categories: structuredClone(baseManifest.categories),
    layers: baseManifest.layers.map((layer) =>
      compactRuntimeLayer(layer, { backedMetadataUrls: backedLayerMetadataUrls }),
    ),
    solutions,
    ...(baseManifest.referenceData
      ? { referenceData: structuredClone(baseManifest.referenceData) }
      : {}),
  };

  validateManifestAgainstCatalog(manifest, catalog);
  assertRuntimeCompactionPreservesSemantics(preflightManifest.solutions, solutions, {
    reboundFields: REBOUND_RUNTIME_FIELDS,
  });
  return manifest;
}

export function assertRuntimeCompactionPreservesSemantics(
  sourceSolutions,
  compactSolutions,
  { reboundFields = [] } = {},
) {
  assert(
    sourceSolutions.length === compactSolutions.length,
    'runtime compaction must preserve the solution count',
  );

  for (let index = 0; index < sourceSolutions.length; index += 1) {
    const source = sourceSolutions[index];
    const compact = compactSolutions[index];
    assert(source.id === compact.id, 'runtime compaction must preserve solution order and IDs');
    assert(compact.coverage.length === 0, `${source.id} runtime coverage must be empty`);
    for (const field of RUNTIME_SOLUTION_FIELDS) {
      if (reboundFields.includes(field)) {
        continue;
      }
      if (source[field] === undefined) {
        assert(compact[field] === undefined, `${source.id} unexpectedly gained ${field}`);
        continue;
      }
      assert(
        JSON.stringify(compact[field]) === JSON.stringify(source[field]),
        `${source.id} runtime compaction altered ${field}`,
      );
    }
  }
}
