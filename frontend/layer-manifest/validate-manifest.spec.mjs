import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { validateManifest } from './validate-manifest.mjs';

describe('solution precomputedMetricUrls validation', () => {
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
});

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
