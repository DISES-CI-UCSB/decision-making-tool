import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createPrecomputedMetricUrls,
  createSolutionDisplayCogUrl,
  createSolutionPrecomputedMetricUrls,
  defaultReleaseId,
  MEC_GEOGRAPHY_LEVELS,
} from './metric-urls.mjs';

const BLOB_HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';

describe('metric URL construction', () => {
  it('constructs role-specific layer metric URLs', () => {
    assert.deepStrictEqual(createPrecomputedMetricUrls('departments', 'none'), {});
    assert.deepStrictEqual(
      createPrecomputedMetricUrls('departments', 'boundary_used_for_precomputed_metric_lookup'),
      { byBoundaryFeature: `${BLOB_HOST}/metrics/precomputed/departments/by-feature.json` },
    );
    assert.deepStrictEqual(createPrecomputedMetricUrls('ecosystems', 'live'), {
      national: `${BLOB_HOST}/metrics/precomputed/ecosystems/nacional.json`,
    });
  });

  it('rejects solution IDs outside the canonical Python path contract', () => {
    for (const solutionId of ['Uppercase', 'unsafe.id', 'unsafe+id', 'unsafe/id', 'unsafe id']) {
      assert.throws(
        () => createSolutionPrecomputedMetricUrls(solutionId),
        /unsafe solutionId/,
      );
    }
  });

  it('constructs stable compact, goals, and MEC URLs for land solutions', () => {
    const result = createSolutionPrecomputedMetricUrls(
      'regional_run_one',
      { custom: 'https://example.com/custom.json' },
      'land',
    );

    assert.strictEqual(result.custom, 'https://example.com/custom.json');
    assert.strictEqual(result.goals, `${BLOB_HOST}/metrics/goals/regional_run_one.goals.json`);
    assert.strictEqual(
      result.compactCache,
      `${BLOB_HOST}/metrics/nick-runs/2026-05-27/compact-cache/regional_run_one.metrics.compact.json`,
    );
    assert.deepStrictEqual(Object.keys(result.mecByGeography), MEC_GEOGRAPHY_LEVELS);
    assert.deepStrictEqual(Object.keys(result.mecV2ByGeography), MEC_GEOGRAPHY_LEVELS);
    for (const level of MEC_GEOGRAPHY_LEVELS) {
      assert.strictEqual(
        result.mecByGeography[level],
        `${BLOB_HOST}/metrics/mec-cache/regional_run_one/${level}.mec.compact.json`,
      );
      assert.strictEqual(
        result.mecV2ByGeography[level],
        `${BLOB_HOST}/metrics/mec-cache-v2/regional_run_one/${level}.mec.compact.json`,
      );
    }
  });

  it('constructs compact and goals URLs without advertising land MEC shards for marine solutions', () => {
    const result = createSolutionPrecomputedMetricUrls(
      'marine_solution',
      {
        compactCache: 'https://example.com/stale.json',
        mecByGeography: { national: 'https://example.com/stale-mec.json' },
        mecV2ByGeography: { national: 'https://example.com/stale-mec-v2.json' },
      },
      'marine',
    );
    assert.strictEqual(
      result.compactCache,
      `${BLOB_HOST}/metrics/nick-runs/2026-05-27/compact-cache/marine_solution.metrics.compact.json`,
    );
    assert.strictEqual(result.mecByGeography, undefined);
    assert.strictEqual(result.mecV2ByGeography, undefined);
  });

  it('constructs an atomic release map without advertising MEC v1', () => {
    const releaseId = defaultReleaseId();
    const result = createSolutionPrecomputedMetricUrls('land_solution', {}, 'land', { releaseId });

    assert.equal(releaseId, 'sirap-polygon-v2-20260727');
    assert.equal(result.mecByGeography, undefined);
    assert.strictEqual(
      result.goals,
      `${BLOB_HOST}/releases/${releaseId}/goals/v3/land_solution.goals.json`,
    );
    assert.match(result.cache, new RegExp(`/releases/${releaseId}/regular/verbose/`));
    assert.match(result.compactCache, new RegExp(`/releases/${releaseId}/regular/compact/`));
    for (const url of Object.values(result.mecV2ByGeography)) {
      assert.match(url, new RegExp(`/releases/${releaseId}/mec/v2/`));
    }
  });
});

describe('display COG URL construction', () => {
  const releaseId = 'solutions-v0-2-0-20260805';

  it('places the COG beside its source raster under the release prefix', () => {
    assert.strictEqual(
      createSolutionDisplayCogUrl('Eco17+Estr17+RUNAP_IHEH2022.tif', 'land', { releaseId }),
      `${BLOB_HOST}/releases/${releaseId}/solutions/land/Eco17+Estr17+RUNAP_IHEH2022.epsg9377.cog.tif`,
    );
  });

  it('places marine COGs under their own domain directory', () => {
    assert.strictEqual(
      createSolutionDisplayCogUrl('Ecos30+RUNAP_HHM.tif', 'marine', { releaseId }),
      `${BLOB_HOST}/releases/${releaseId}/solutions/marine/Ecos30+RUNAP_HHM.epsg9377.cog.tif`,
    );
  });

  it('returns null for domains that publish no display COG', () => {
    assert.strictEqual(
      createSolutionDisplayCogUrl('Ecos30+RUNAP_HHM.tif', 'not-a-domain', { releaseId }),
      null,
    );
  });

  it('returns null without a release because COGs are release-scoped', () => {
    assert.strictEqual(createSolutionDisplayCogUrl('Eco17+RUNAP.tif', 'land', {}), null);
  });

  it('refuses to guess a basename when the raster file name is unusable', () => {
    assert.throws(() => createSolutionDisplayCogUrl('no-extension', 'land', { releaseId }), /raster file name/);
  });
});
