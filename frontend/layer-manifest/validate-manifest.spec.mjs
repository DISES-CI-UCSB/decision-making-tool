import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { validateManifest } from './validate-manifest.mjs';

const BLOB_HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';

describe('solution precomputedMetricUrls validation', () => {
  it('accepts the versioned known-AOI coverage capability', async () => {
    const manifest = createManifest();
    manifest.solutions[0].capabilities = { aoiCoverageMetrics: 'v2' };

    await assert.doesNotReject(validateManifest(manifest, 'manifest.json'));
  });

  it('rejects unknown known-AOI coverage capability versions', async () => {
    const manifest = createManifest();
    manifest.solutions[0].capabilities = { aoiCoverageMetrics: 'v3' };

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /capabilities\.aoiCoverageMetrics must be "v2"/,
    );
  });

  it('accepts an optional map of named URLs', async () => {
    const manifest = createManifest({
      goals: 'https://example.com/metrics/goals/demo.goals.json',
      compactCache: '/data/metrics/demo.metrics.compact.json',
    });

    const result = await validateManifest(manifest, 'manifest.json');

    assert.strictEqual(result.solutionCount, 1);
  });

  it('allows solutions that omit precomputedMetricUrls', async () => {
    const manifest = createManifest();

    await assert.doesNotReject(validateManifest(manifest, 'manifest.json'));
  });

  it('rejects non-object precomputedMetricUrls values', async () => {
    const manifest = createManifest(['https://example.com/not-a-map.json']);

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /solutions\[0\]\.precomputedMetricUrls must be an object/,
    );
  });

  it('rejects invalid URLs in precomputedMetricUrls', async () => {
    const manifest = createManifest({ goals: 'not-a-url' });

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /solutions\[0\]\.precomputedMetricUrls\.goals must be a syntactically valid URL/,
    );
  });

  it('accepts separate six-URL v1 and v2 MEC maps for land solutions', async () => {
    const manifest = createManifest({
      compactCache: 'https://example.com/metrics/demo.metrics.compact.json',
      mecByGeography: createMecUrls(),
      mecV2ByGeography: createMecUrls('mec-cache-v2'),
    });

    await assert.doesNotReject(validateManifest(manifest, 'manifest.json'));
  });

  it('rejects incomplete MEC geography URL maps', async () => {
    const manifest = createManifest({
      mecByGeography: {
        national: 'https://example.com/metrics/mec/demo/national.mec.compact.json',
      },
    });

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /mecByGeography must contain exactly: national, departments, municipalities, siraps, runaps, omecs/,
    );
  });

  it('rejects incomplete MEC v2 geography URL maps', async () => {
    const manifest = createManifest({
      mecV2ByGeography: {
        national: 'https://example.com/metrics/mec-cache-v2/demo/national.mec.compact.json',
      },
    });

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /mecV2ByGeography must contain exactly: national, departments, municipalities, siraps, runaps, omecs/,
    );
  });

  it('rejects land MEC geography URLs on marine solutions', async () => {
    const manifest = createManifest({
      mecByGeography: createMecUrls(),
      mecV2ByGeography: createMecUrls('mec-cache-v2'),
    });
    manifest.solutions[0].domain = 'marine';
    manifest.solutions[0].scope = 'marine';

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /mecByGeography is only valid for land solutions/,
    );
  });

  it('rejects v2 MEC geography URLs on marine solutions', async () => {
    const manifest = createManifest({
      mecV2ByGeography: createMecUrls('mec-cache-v2'),
    });
    manifest.solutions[0].domain = 'marine';
    manifest.solutions[0].scope = 'marine';

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /mecV2ByGeography is only valid for land solutions/,
    );
  });
});

describe('catalog-driven release validation', () => {
  it('fails closed when a release manifest is validated without a catalog', async () => {
    const manifest = createReleaseManifest();

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /requires an explicit --catalog <path>/,
    );
  });

  it('accepts exact catalog counts, domains, IDs, and immutable metric URLs', async () => {
    const manifest = createReleaseManifest();
    const catalog = createReleaseCatalog();

    await assert.doesNotReject(validateManifest(manifest, 'manifest.json', { catalog }));
  });

  it('rejects a release whose solution ID set differs from the catalog', async () => {
    const manifest = createReleaseManifest();
    manifest.solutions[0].id = 'unexpected_solution';

    await assert.rejects(
      validateManifest(manifest, 'manifest.json', { catalog: createReleaseCatalog() }),
      /missing: demo_solution; unexpected: unexpected_solution/,
    );
  });

  it('rejects any release metric URL outside the release prefix', async () => {
    const manifest = createReleaseManifest();
    manifest.solutions[0].precomputedMetricUrls.goals =
      'https://example.com/metrics/goals/demo_solution.goals.json';

    await assert.rejects(
      validateManifest(manifest, 'manifest.json', { catalog: createReleaseCatalog() }),
      /precomputedMetricUrls.goals must use configured Blob origin/,
    );
  });

  it('rejects release-looking substrings outside the exact pathname prefix', async () => {
    const manifest = createReleaseManifest();
    manifest.solutions[0].precomputedMetricUrls.goals = `${BLOB_HOST}/metrics/releases/${manifest.releaseId}/goals/demo_solution.goals.json`;

    await assert.rejects(
      validateManifest(manifest, 'manifest.json', { catalog: createReleaseCatalog() }),
      /must use exact release pathname prefix/,
    );
  });

  it('allows release-scoped origin-relative metrics only for the selected preview solution', async () => {
    const manifest = createReleaseManifest();
    const urls = manifest.solutions[0].precomputedMetricUrls;
    for (const [key, value] of Object.entries(urls)) {
      urls[key] =
        typeof value === 'string'
          ? value.replace(BLOB_HOST, '')
          : Object.fromEntries(
              Object.entries(value).map(([level, url]) => [level, url.replace(BLOB_HOST, '')]),
            );
    }
    const catalog = createReleaseCatalog();

    await assert.doesNotReject(
      validateManifest(manifest, 'manifest.json', {
        catalog,
        aoiCoveragePreviewSolutionId: 'demo_solution',
      }),
    );
    await assert.rejects(
      validateManifest(manifest, 'manifest.json', { catalog }),
      /must use configured Blob origin/,
    );
  });

  it('accepts release layers only when unsupported metric sidecars are absent', async () => {
    const manifest = createReleaseManifest();
    addReleaseLayer(manifest);

    await assert.doesNotReject(
      validateManifest(manifest, 'manifest.json', { catalog: createReleaseCatalog() }),
    );
  });

  it('rejects inherited layer-side metric claims in release manifests', async () => {
    const manifest = createReleaseManifest();
    addReleaseLayer(manifest);
    manifest.layers[0].roleInMetricCalculation = 'data_used_for_live_metric_calculation';
    manifest.layers[0].compressedDataForLiveMetricsUrl = `${BLOB_HOST}/metrics/live/ecosistemas.bin.gz`;

    await assert.rejects(
      validateManifest(manifest, 'manifest.json', { catalog: createReleaseCatalog() }),
      /roleInMetricCalculation must be none because release manifests do not support layer-side metric calculation/,
    );
  });
});

describe('marine finder contract validation', () => {
  it('accepts the marine target feature set and both approved target percents', async () => {
    for (const targetPercent of [30, 50]) {
      const manifest = createMarineReleaseManifest({ targetPercent });

      await assert.doesNotReject(
        validateManifest(manifest, 'manifest.json', { catalog: createMarineReleaseCatalog() }),
      );
    }
  });

  it('rejects a marine solution whose targetFeatureSet regressed to the land fallback', async () => {
    const manifest = createMarineReleaseManifest({ targetFeatureSet: 'strategic_ecosystems' });

    await assert.rejects(
      validateManifest(manifest, 'manifest.json', { catalog: createMarineReleaseCatalog() }),
      /finderInputs\.targetFeatureSet must be "marine_ecosystems_and_mangroves"/,
    );
  });

  it('rejects a marine solution with a null targetPercent', async () => {
    const manifest = createMarineReleaseManifest({ targetPercent: null });

    await assert.rejects(
      validateManifest(manifest, 'manifest.json', { catalog: createMarineReleaseCatalog() }),
      /finderInputs\.targetPercent must be one of 30, 50, found null/,
    );
  });

  it('rejects a marine solution with an off-contract targetPercent', async () => {
    const manifest = createMarineReleaseManifest({ targetPercent: 17 });

    await assert.rejects(
      validateManifest(manifest, 'manifest.json', { catalog: createMarineReleaseCatalog() }),
      /finderInputs\.targetPercent must be one of 30, 50, found 17/,
    );
  });
});

describe('runtime compact solution validation', () => {
  it('accepts explicit coverage omission when structured targets are retained', async () => {
    const manifest = createManifest();
    manifest.solutionDataProfile = 'runtime-compact-v1';
    manifest.solutions[0].finderInputs.structuredTargets = createStructuredTargets();
    manifest.solutions[0].finderInputs.structuredTargets.sourceEvaluation = 'final_summary_csv';

    await assert.doesNotReject(validateManifest(manifest, 'manifest.json'));
  });

  it('rejects compact solutions that omit structured target semantics', async () => {
    const manifest = createManifest();
    manifest.solutionDataProfile = 'runtime-compact-v1';

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /finderInputs\.structuredTargets is required for runtime-compact-v1/,
    );
  });

  it('rejects compact-profile manifests that still embed analysis coverage', async () => {
    const manifest = createManifest();
    manifest.solutionDataProfile = 'runtime-compact-v1';
    manifest.solutions[0].finderInputs.structuredTargets = createStructuredTargets();
    manifest.solutions[0].coverage.push({
      feature: 'species-a',
      met: true,
      relativeTarget: 0.225,
      relativeHeld: 0.3,
      relativeShortfall: 0,
    });

    await assert.rejects(
      validateManifest(manifest, 'manifest.json'),
      /coverage must be empty for runtime-compact-v1/,
    );
  });
});

function createStructuredTargets() {
  return {
    format: 'solution-target-metadata-v1',
    sourceEvaluation: 'prioritizr_model',
    ecosystems: [],
    strategicEcosystems: [],
    ecosystemServices: [],
    speciesRepresentation: [],
    espRn: [{ featureId: 'species-a', targetPercent: 22.5 }],
  };
}

function createMecUrls(directory = 'mec') {
  return Object.fromEntries(
    ['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'].map((level) => [
      level,
      `https://example.com/metrics/${directory}/demo/${level}.mec.compact.json`,
    ]),
  );
}

function createManifest(precomputedMetricUrls) {
  const solution = {
    id: 'demo_solution',
    name: 'Demo solution',
    description: 'A solution used to validate the manifest contract.',
    scope: 'national',
    sirapId: null,
    displayUrl: 'https://example.com/solutions/demo.tif',
    metadataUrl: 'https://example.com/solutions/demo.json',
    rasterFile: 'demo.tif',
    metadataFile: 'demo.json',
    blobPath: 'solutions/demo.tif',
    generatedAt: null,
    finderInputs: {
      scope: 'national',
      targetFeatureSet: null,
      targetFeatureIds: [],
      targetPercent: null,
      costLayerId: null,
      includeLayerIds: [],
      excludeLayerIds: [],
    },
    inputLayerIds: {
      features: [],
      cost: null,
      includes: [],
      excludes: [],
    },
    summaryMetrics: {
      nSelected: null,
      totalCost: null,
      pctTargetsMet: null,
      coverageRowCount: 0,
    },
    coverage: [],
    rendering: {
      valueType: 'categorical',
      renderMode: 'categorical',
      noDataValue: 255,
    },
  };

  if (precomputedMetricUrls !== undefined) {
    solution.precomputedMetricUrls = precomputedMetricUrls;
  }

  return {
    version: '0.2.0',
    generatedAt: '2026-07-20T00:00:00.000Z',
    publicBlobHost: 'https://example.com',
    sourceCsv: 'test.csv',
    categories: [],
    layers: [],
    solutions: [solution],
  };
}

function createReleaseManifest() {
  const releaseId = 'catalog-2026-08-04';
  const prefix = `${BLOB_HOST}/releases/${releaseId}`;
  const manifest = createManifest({
    goals: `${prefix}/goals/demo_solution.goals.json`,
    cache: `${prefix}/regular/verbose/demo_solution.metrics.json`,
    compactCache: `${prefix}/regular/compact/demo_solution.metrics.compact.json`,
    mecV2ByGeography: Object.fromEntries(
      ['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'].map((level) => [
        level,
        `${prefix}/mec/v2/demo_solution/${level}.mec.compact.json`,
      ]),
    ),
  });
  manifest.releaseId = releaseId;
  manifest.catalogVersion = '0.1.0';
  manifest.publicBlobHost = BLOB_HOST;
  manifest.solutions[0].domain = 'land';
  manifest.solutions[0].displayUrl = `${BLOB_HOST}/solutions/demo.tif`;
  manifest.solutions[0].metadataUrl = `${BLOB_HOST}/solutions/demo.json`;
  manifest.solutions[0].rasterSha256 = 'a'.repeat(64);
  return manifest;
}

function addReleaseLayer(manifest) {
  manifest.categories.push({
    id: 'ecosystems',
    spanishLabel: 'Ecosistemas',
    layerIds: ['ecosistemas'],
  });
  manifest.layers.push({
    id: 'ecosistemas',
    spanishLabel: 'Ecosistemas',
    englishLabel: 'Ecosystems',
    description: 'Ecosystem layer',
    tooltip: null,
    dataRole: 'feature_layer',
    category: 'ecosystems',
    roleInMetricCalculation: 'none',
    displayUrl: `${BLOB_HOST}/inputs/features/ecosystems/ecosistemas.tif`,
    metadataUrl: `${BLOB_HOST}/metadata/ecosistemas.metadata.json`,
    compressedDataForLiveMetricsUrl: null,
    precomputedMetricUrls: {},
    rendering: {
      valueType: 'categorical',
      renderMode: 'categorical',
    },
  });
}

function createMarineReleaseManifest({
  targetFeatureSet = 'marine_ecosystems_and_mangroves',
  targetPercent = 30,
} = {}) {
  const manifest = createReleaseManifest();
  const solution = manifest.solutions[0];
  delete solution.precomputedMetricUrls.mecV2ByGeography;
  solution.domain = 'marine';
  solution.scope = 'marine';
  solution.finderInputs.domain = 'marine';
  solution.finderInputs.scope = 'marine';
  solution.finderInputs.targetFeatureSet = targetFeatureSet;
  solution.finderInputs.targetPercent = targetPercent;
  solution.finderInputs.targetFeatureIds = ['marine_ecosystems', 'mangroves'];
  return manifest;
}

function createMarineReleaseCatalog() {
  const catalog = createReleaseCatalog();
  catalog.expectedLandSolutionCount = 0;
  catalog.expectedMarineSolutionCount = 1;
  catalog.solutions[0].domain = 'marine';
  return catalog;
}

function createReleaseCatalog() {
  return {
    format: 'solution-catalog-v1',
    catalogVersion: '0.1.0',
    releaseId: 'catalog-2026-08-04',
    expectedSolutionCount: 1,
    expectedLandSolutionCount: 1,
    expectedMarineSolutionCount: 0,
    solutions: [
      {
        solutionId: 'demo_solution',
        solutionBasename: 'demo.tif',
        domain: 'land',
        rasterSha256: 'a'.repeat(64),
      },
    ],
  };
}
