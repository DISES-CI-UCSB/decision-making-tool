import {
  createSolutionDisplayCogUrl,
  createSolutionPrecomputedMetricUrls,
  MEC_GEOGRAPHY_LEVELS,
} from './metric-urls.mjs';
import { solutionCatalogSha256, validateManifestAgainstCatalog } from './solution-catalog.mjs';

export const RUNTIME_COMPACT_SOLUTION_PROFILE = 'runtime-compact-v1';
export const RELEASE_ARTIFACT_INVENTORY_FORMAT = 'solution-release-artifact-inventory-v1';
const RELEASE_ARTIFACT_COMPONENTS = new Set(['regularVerbose', 'regularCompact', 'goals', 'mecV2']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Artifact URLs are rebound from the release contract rather than trusted from the
 * frozen preflight manifest, so a republished artifact directory reaches runtime
 * without regenerating preflight.
 */
export const REBOUND_RUNTIME_FIELDS = ['precomputedMetricUrls', 'displayCogUrl', 'capabilities'];

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
  'capabilities',
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
  {
    releaseId = null,
    speciesGoalsInventory = null,
    speciesGoalsBaseUrl = undefined,
    releaseArtifactBaseUrl = undefined,
    includeSpeciesGoalsTargetOverlay = true,
    aoiCoverageMetricsV2Eligible = undefined,
  } = {},
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
      {
        releaseId,
        speciesGoalsInventory,
        speciesGoalsBaseUrl,
        releaseArtifactBaseUrl,
        includeSpeciesGoalsTargetOverlay,
      },
    );
    const displayCogUrl = createSolutionDisplayCogUrl(solution.rasterFile, domain, { releaseId });
    if (displayCogUrl) {
      compact.displayCogUrl = displayCogUrl;
    } else {
      delete compact.displayCogUrl;
    }
  }
  if (aoiCoverageMetricsV2Eligible !== undefined) {
    if (aoiCoverageMetricsV2Eligible) {
      compact.capabilities = { aoiCoverageMetrics: 'v2' };
    } else {
      delete compact.capabilities;
    }
  }
  return compact;
}

function validateReleaseArtifactInventory(inventory, catalog, previewSolutionId = null) {
  assert(
    inventory?.format === RELEASE_ARTIFACT_INVENTORY_FORMAT,
    'release artifact inventory format is invalid',
  );
  assert(
    inventory.releaseId === catalog.releaseId,
    'release artifact inventory releaseId is stale',
  );
  assert(
    inventory.catalogSha256 === solutionCatalogSha256(catalog),
    'release artifact inventory catalog SHA is stale',
  );
  assert(
    inventory.catalogVersion === catalog.catalogVersion,
    'release artifact inventory catalogVersion is stale',
  );
  assert(
    Array.isArray(inventory.artifacts),
    'release artifact inventory artifacts must be an array',
  );
  assert(
    inventory.artifactCount === inventory.artifacts.length,
    'release artifact inventory artifactCount does not match artifacts',
  );
  const catalogIds = new Set(catalog.solutions.map((solution) => solution.solutionId));
  const artifactKeys = new Set();
  for (const [index, artifact] of inventory.artifacts.entries()) {
    const label = `release artifact inventory artifacts[${index}]`;
    assert(artifact && typeof artifact === 'object', `${label} must be an object`);
    assert(RELEASE_ARTIFACT_COMPONENTS.has(artifact.component), `${label}.component is invalid`);
    assert(catalogIds.has(artifact.solutionId), `${label}.solutionId is not in the catalog`);
    assert(
      typeof artifact.sha256 === 'string' && SHA256_PATTERN.test(artifact.sha256),
      `${label}.sha256 is invalid`,
    );
    assert(typeof artifact.path === 'string' && artifact.path, `${label}.path is invalid`);
    assert(
      typeof artifact.blobPath === 'string' && artifact.blobPath,
      `${label}.blobPath is invalid`,
    );
    const isMecV2 = artifact.component === 'mecV2';
    assert(
      isMecV2
        ? MEC_GEOGRAPHY_LEVELS.includes(artifact.geographyLevel)
        : artifact.geographyLevel === null,
      `${label}.geographyLevel is invalid`,
    );
    const key = `${artifact.component}:${artifact.solutionId}:${artifact.geographyLevel ?? ''}`;
    assert(!artifactKeys.has(key), `${label} duplicates artifact ${key}`);
    artifactKeys.add(key);
  }
  const expectedSolutions =
    previewSolutionId === null
      ? catalog.solutions
      : catalog.solutions.filter((solution) => solution.solutionId === previewSolutionId);
  assert(
    previewSolutionId === null || expectedSolutions[0]?.domain === 'land',
    'AOI coverage preview solution must be a land solution',
  );
  const expectedArtifactKeys = new Set(
    expectedSolutions.flatMap((solution) => [
      `regularVerbose:${solution.solutionId}:`,
      `regularCompact:${solution.solutionId}:`,
      `goals:${solution.solutionId}:`,
      ...(solution.domain === 'land'
        ? MEC_GEOGRAPHY_LEVELS.map((level) => `mecV2:${solution.solutionId}:${level}`)
        : []),
    ]),
  );
  assert(
    artifactKeys.size === expectedArtifactKeys.size &&
      [...expectedArtifactKeys].every((key) => artifactKeys.has(key)),
    previewSolutionId === null
      ? 'release artifact inventory is not the complete canonical catalog inventory'
      : `release artifact inventory is not complete and target-only for preview solution "${previewSolutionId}"`,
  );
}

function hasCompleteMecV2Inventory(inventory, solutionId) {
  if (!Array.isArray(inventory?.artifacts)) {
    return false;
  }
  const levels = inventory.artifacts
    .filter((artifact) => artifact?.component === 'mecV2' && artifact.solutionId === solutionId)
    .map((artifact) => artifact.geographyLevel);
  return (
    levels.length === MEC_GEOGRAPHY_LEVELS.length &&
    MEC_GEOGRAPHY_LEVELS.every((level) => levels.includes(level)) &&
    new Set(levels).size === levels.length
  );
}

function hasCompleteSpeciesGoalsInventory(inventory, solutionId, releaseId) {
  return (
    inventory?.format === 'species-goals-release-inventory-v1' &&
    inventory.validated === true &&
    inventory.solutionId === solutionId &&
    inventory.releaseId === releaseId &&
    inventory.catalogValidated === true &&
    Array.isArray(inventory.validatedGeographyLevels) &&
    inventory.validatedGeographyLevels.length === MEC_GEOGRAPHY_LEVELS.length &&
    MEC_GEOGRAPHY_LEVELS.every(
      (level, index) => inventory.validatedGeographyLevels[index] === level,
    )
  );
}

export function supportsAoiCoverageMetricsV2({
  solution,
  releaseArtifactInventory,
  speciesGoalsInventory,
  releaseId,
}) {
  return (
    runtimeSolutionDomain(solution) === 'land' &&
    hasCompleteMecV2Inventory(releaseArtifactInventory, solution.id) &&
    hasCompleteSpeciesGoalsInventory(speciesGoalsInventory, solution.id, releaseId)
  );
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
  releaseArtifactInventory = null,
  speciesGoalsInventory = null,
  speciesGoalsCatalog = null,
  speciesGoalsBaseUrl = undefined,
  releaseArtifactBaseUrl = undefined,
  aoiCoveragePreviewSolutionId = null,
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
  if (aoiCoveragePreviewSolutionId !== null) {
    assert(
      catalog.solutions.some((solution) => solution.solutionId === aoiCoveragePreviewSolutionId),
      `AOI coverage preview solution "${aoiCoveragePreviewSolutionId}" is not in the catalog`,
    );
    validateManifestAgainstCatalog(baseManifest, catalog);
    assert(
      releaseArtifactInventory !== null &&
        speciesGoalsInventory !== null &&
        speciesGoalsCatalog !== null,
      'AOI coverage preview requires artifact, species inventory, and species catalog evidence',
    );
  }

  if (releaseArtifactInventory !== null) {
    validateReleaseArtifactInventory(
      releaseArtifactInventory,
      catalog,
      aoiCoveragePreviewSolutionId,
    );
  }
  if (
    speciesGoalsInventory !== null &&
    (speciesGoalsInventory?.format !== 'species-goals-release-inventory-index-v1' ||
      speciesGoalsInventory.releaseId !== catalog.releaseId ||
      speciesGoalsCatalog?.format !== 'species-goals-catalog-v1' ||
      speciesGoalsCatalog.provenance?.releaseId !== catalog.releaseId ||
      typeof speciesGoalsCatalog.catalogSha256 !== 'string' ||
      !SHA256_PATTERN.test(speciesGoalsCatalog.catalogSha256) ||
      speciesGoalsInventory.catalogSha256 !== speciesGoalsCatalog.catalogSha256 ||
      !speciesGoalsInventory.solutions ||
      typeof speciesGoalsInventory.solutions !== 'object' ||
      Array.isArray(speciesGoalsInventory.solutions))
  ) {
    throw new Error('species goals release inventory is invalid or stale');
  }
  if (aoiCoveragePreviewSolutionId !== null) {
    const inventorySolutionIds = Object.keys(speciesGoalsInventory.solutions);
    assert(
      inventorySolutionIds.length === 1 && inventorySolutionIds[0] === aoiCoveragePreviewSolutionId,
      `species goals release inventory must contain only preview solution "${aoiCoveragePreviewSolutionId}"`,
    );
    assert(
      hasCompleteSpeciesGoalsInventory(
        speciesGoalsInventory.solutions[aoiCoveragePreviewSolutionId],
        aoiCoveragePreviewSolutionId,
        catalog.releaseId,
      ),
      `species goals release inventory is incomplete for preview solution "${aoiCoveragePreviewSolutionId}"`,
    );
  }
  const preflightById = new Map(
    preflightManifest.solutions.map((solution) => [solution.id, solution]),
  );
  const sourceSolutions =
    aoiCoveragePreviewSolutionId === null
      ? preflightManifest.solutions
      : baseManifest.solutions.map((solution) =>
          solution.id === aoiCoveragePreviewSolutionId ? preflightById.get(solution.id) : solution,
        );
  const solutions = sourceSolutions.map((solution) => {
    if (aoiCoveragePreviewSolutionId !== null && solution.id !== aoiCoveragePreviewSolutionId) {
      return structuredClone(solution);
    }
    const solutionSpeciesGoalsInventory = speciesGoalsInventory?.solutions?.[solution.id] ?? null;
    return compactRuntimeSolution(solution, {
      releaseId: catalog.releaseId,
      speciesGoalsInventory: solutionSpeciesGoalsInventory,
      speciesGoalsBaseUrl,
      releaseArtifactBaseUrl,
      includeSpeciesGoalsTargetOverlay: aoiCoveragePreviewSolutionId === null,
      aoiCoverageMetricsV2Eligible:
        releaseArtifactInventory !== null &&
        (aoiCoveragePreviewSolutionId === null || solution.id === aoiCoveragePreviewSolutionId) &&
        supportsAoiCoverageMetricsV2({
          solution,
          releaseArtifactInventory,
          speciesGoalsInventory: solutionSpeciesGoalsInventory,
          releaseId: catalog.releaseId,
        }),
    });
  });
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
  if (aoiCoveragePreviewSolutionId === null) {
    assertRuntimeCompactionPreservesSemantics(preflightManifest.solutions, solutions, {
      reboundFields: REBOUND_RUNTIME_FIELDS,
    });
  } else {
    const previewIndex = solutions.findIndex(
      (solution) => solution.id === aoiCoveragePreviewSolutionId,
    );
    assertRuntimeCompactionPreservesSemantics(
      [preflightById.get(aoiCoveragePreviewSolutionId)],
      [solutions[previewIndex]],
      { reboundFields: REBOUND_RUNTIME_FIELDS },
    );
    for (const solution of solutions) {
      if (solution.id === aoiCoveragePreviewSolutionId) {
        continue;
      }
      const baseSolution = baseManifest.solutions.find((candidate) => candidate.id === solution.id);
      assert(
        JSON.stringify(solution) === JSON.stringify(baseSolution),
        `${solution.id} changed during target-only preview assembly`,
      );
    }
  }
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
