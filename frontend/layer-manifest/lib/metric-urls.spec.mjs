import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createPrecomputedMetricUrls,
  createSolutionPrecomputedMetricUrls,
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

  it('sanitizes goals IDs and derives nick-runs compact cache URLs', () => {
    assert.deepStrictEqual(
      createSolutionPrecomputedMetricUrls(
        'regional/run one',
        { custom: 'https://example.com/custom.json' },
        `${BLOB_HOST}/solutions/nick-runs/2026-05-27/solution.tif`,
      ),
      {
        custom: 'https://example.com/custom.json',
        goals: `${BLOB_HOST}/metrics/goals/regional_run_one.goals.json`,
        compactCache: `${BLOB_HOST}/metrics/nick-runs/2026-05-27/compact-cache/regional/run one.metrics.compact.json`,
      },
    );
  });

  it('preserves an existing compact cache when no nick-runs URL can be derived', () => {
    const result = createSolutionPrecomputedMetricUrls(
      'solution',
      { compactCache: 'https://example.com/verified.json' },
      'not a URL',
    );
    assert.strictEqual(result.compactCache, 'https://example.com/verified.json');
  });
});
