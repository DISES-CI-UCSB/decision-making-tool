import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  RUNTIME_COMPACT_SOLUTION_PROFILE,
  buildRuntimeReleaseManifest,
  compactRuntimeSolution,
} from './runtime-release-manifest.mjs';

const HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';
const RELEASE_ID = 'solutions-v0-2-0-20260805';

function solution(id, domain = 'land') {
  const rasterFile = `${id}.tif`;
  return {
    id,
    name: id,
    description: `${id} description`,
    domain,
    scope: domain === 'marine' ? 'marine' : 'national',
    displayUrl: `${HOST}/solutions/${rasterFile}`,
    metadataUrl: `${HOST}/solutions/${id}.json`,
    rasterFile,
    metadataFile: `${id}.json`,
    blobPath: `solutions/${rasterFile}`,
    rasterSha256: domain === 'land' ? 'a'.repeat(64) : 'b'.repeat(64),
    generatedAt: '2026-08-05T00:00:00Z',
    precomputedMetricUrls: {},
    finderInputs: {
      domain,
      scope: domain === 'marine' ? 'marine' : 'national',
      targetFeatureSet: 'esp_rn',
      targetFeatureIds: ['species'],
      targetPercent: null,
      structuredTargets: {
        format: 'solution-target-metadata-v1',
        sourceEvaluation: 'prioritizr_model',
        ecosystems: [],
        strategicEcosystems: [],
        ecosystemServices: [],
        speciesRepresentation: [],
        espRn: [
          { featureId: 'species-a', targetPercent: 17 },
          { featureId: 'species-b', targetPercent: 22.5 },
          { featureId: 'species-c', targetPercent: 30 },
        ],
      },
      costLayerId: 'human_footprint',
      includeLayerIds: ['runap'],
      excludeLayerIds: [],
    },
    inputLayerIds: {
      features: ['species'],
      cost: 'human_footprint',
      includes: ['runap'],
      excludes: [],
    },
    summaryMetrics: {
      nSelected: 10,
      totalCost: 20,
      pctTargetsMet: 30,
      coverageRowCount: 3,
    },
    coverage: [
      {
        feature: 'species-a',
        met: true,
        relativeTarget: 0.17,
        relativeHeld: 0.2,
        relativeShortfall: 0,
      },
    ],
    sourceProvenance: { metadataSha256: 'not-runtime-data' },
    rendering: {
      valueType: 'categorical',
      renderMode: 'categorical',
      noDataValue: 255,
    },
  };
}

describe('runtime release manifest compaction', () => {
  it('omits analysis coverage while preserving heterogeneous EspRN targets exactly', () => {
    const source = solution('land-solution');
    const compact = compactRuntimeSolution(source);

    assert.deepStrictEqual(compact.coverage, []);
    assert.deepStrictEqual(
      compact.finderInputs.structuredTargets,
      source.finderInputs.structuredTargets,
    );
    assert.deepStrictEqual(
      compact.finderInputs.structuredTargets.espRn.map(({ targetPercent }) => targetPercent),
      [17, 22.5, 30],
    );
    assert.strictEqual(compact.summaryMetrics.coverageRowCount, 3);
    assert.strictEqual('sourceProvenance' in compact, false);
  });

  it('uses frozen preflight solutions with current base layers and release binding', () => {
    const land = solution('land-solution');
    const marine = solution('marine-solution', 'marine');
    const catalog = {
      format: 'solution-catalog-v1',
      catalogVersion: '0.2.0',
      releaseId: RELEASE_ID,
      expectedSolutionCount: 2,
      expectedLandSolutionCount: 1,
      expectedMarineSolutionCount: 1,
      solutions: [land, marine].map((entry) => ({
        solutionId: entry.id,
        solutionBasename: entry.rasterFile,
        domain: entry.domain,
        rasterSha256: entry.rasterSha256,
      })),
    };
    const baseManifest = {
      version: '0.2.0',
      generatedAt: 'old',
      publicBlobHost: HOST,
      sourceCsv: 'data/layers.csv',
      categories: [{ id: 'base-category', spanishLabel: 'Base', layerIds: [] }],
      layers: [{ id: 'base-layer' }],
      solutions: [{ id: 'legacy-solution' }],
      referenceData: { speciesLookup: { url: `${HOST}/species.csv` } },
    };
    const preflightManifest = {
      releaseId: RELEASE_ID,
      catalogVersion: '0.2.0',
      generatedAt: '2026-08-05T00:00:00Z',
      solutions: [land, marine],
    };

    const result = buildRuntimeReleaseManifest({
      baseManifest,
      preflightManifest,
      catalog,
    });

    assert.deepStrictEqual(result.solutions.map(({ id }) => id), [
      'land-solution',
      'marine-solution',
    ]);
    assert.deepStrictEqual(result.categories, baseManifest.categories);
    assert.deepStrictEqual(result.layers, baseManifest.layers);
    assert.deepStrictEqual(result.referenceData, baseManifest.referenceData);
    assert.strictEqual(result.releaseId, RELEASE_ID);
    assert.strictEqual(result.catalogVersion, '0.2.0');
    assert.strictEqual(result.solutionDataProfile, RUNTIME_COMPACT_SOLUTION_PROFILE);
  });

  it('rebinds stale preflight artifact URLs onto the current release contract', () => {
    const land = solution('land-solution');
    const marine = solution('marine-solution', 'marine');
    land.precomputedMetricUrls = {
      goals: `${HOST}/releases/${RELEASE_ID}/goals/land-solution.goals.json`,
      cache: `${HOST}/releases/${RELEASE_ID}/regular/verbose/land-solution.metrics.json`,
      compactCache: `${HOST}/releases/${RELEASE_ID}/regular/compact/land-solution.metrics.compact.json`,
    };
    marine.precomputedMetricUrls = {
      goals: `${HOST}/releases/${RELEASE_ID}/goals/marine-solution.goals.json`,
    };

    const [compactLand, compactMarine] = [land, marine].map((entry) =>
      compactRuntimeSolution(entry, { releaseId: RELEASE_ID }),
    );

    assert.strictEqual(
      compactLand.precomputedMetricUrls.goals,
      `${HOST}/releases/${RELEASE_ID}/goals/v3/land-solution.goals.json`,
    );
    assert.strictEqual(
      compactLand.precomputedMetricUrls.cache,
      `${HOST}/releases/${RELEASE_ID}/regular/verbose/land-solution.metrics.json`,
    );
    assert.strictEqual(
      compactMarine.precomputedMetricUrls.goals,
      `${HOST}/releases/${RELEASE_ID}/goals/v3/marine-solution.goals.json`,
    );
    assert.strictEqual(compactMarine.precomputedMetricUrls.mecV2ByGeography, undefined);
  });

  it('leaves artifact URLs untouched when no release is supplied', () => {
    const land = solution('land-solution');
    land.precomputedMetricUrls = { goals: `${HOST}/metrics/goals/land-solution.goals.json` };

    assert.deepStrictEqual(
      compactRuntimeSolution(land).precomputedMetricUrls,
      land.precomputedMetricUrls,
    );
  });

  it('binds a release-scoped display COG per publishing domain', () => {
    const land = solution('land-solution');
    const marine = solution('marine-solution', 'marine');

    const [compactLand, compactMarine] = [land, marine].map((entry) =>
      compactRuntimeSolution(entry, { releaseId: RELEASE_ID }),
    );

    assert.strictEqual(
      compactLand.displayCogUrl,
      `${HOST}/releases/${RELEASE_ID}/solutions/land/land-solution.epsg9377.cog.tif`,
    );
    assert.strictEqual(
      compactMarine.displayCogUrl,
      `${HOST}/releases/${RELEASE_ID}/solutions/marine/marine-solution.epsg9377.cog.tif`,
    );
  });

  it('leaves the display COG unbound for a domain that publishes none', () => {
    const unpublished = solution('not-a-domain-solution', 'not-a-domain');

    assert.strictEqual(
      'displayCogUrl' in compactRuntimeSolution(unpublished, { releaseId: RELEASE_ID }),
      false,
    );
  });

  it('rebinds a stale preflight display COG onto the current release', () => {
    const land = solution('land-solution');
    land.displayCogUrl = `${HOST}/solutions/nacional/land-solution.epsg9377.cog.tif`;

    assert.strictEqual(
      compactRuntimeSolution(land, { releaseId: RELEASE_ID }).displayCogUrl,
      `${HOST}/releases/${RELEASE_ID}/solutions/land/land-solution.epsg9377.cog.tif`,
    );
  });

  it('leaves the display COG unbound when no release is supplied', () => {
    assert.strictEqual('displayCogUrl' in compactRuntimeSolution(solution('land-solution')), false);
  });
});
