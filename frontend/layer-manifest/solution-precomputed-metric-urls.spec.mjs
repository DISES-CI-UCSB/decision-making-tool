import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createSolutionPrecomputedMetricUrls } from './lib/metric-urls.mjs';

describe('createSolutionPrecomputedMetricUrls', () => {
  it('sanitizes slashes and spaces in the goals path', () => {
    const result = createSolutionPrecomputedMetricUrls('regional/run one');

    assert.strictEqual(
      result.goals,
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/goals/regional_run_one.goals.json',
    );
  });

  it('preserves existing aliases while refreshing production sidecar URLs', () => {
    const result = createSolutionPrecomputedMetricUrls(
      'demo_solution',
      {
        custom: 'https://example.com/custom.json',
        goals: 'https://example.com/stale-goals.json',
        compactCache: 'https://example.com/stale-compact.json',
      },
      'land',
    );

    assert.strictEqual(result.custom, 'https://example.com/custom.json');
    assert.strictEqual(
      result.goals,
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/goals/demo_solution.goals.json',
    );
    assert.strictEqual(
      result.compactCache,
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/nick-runs/2026-05-27/compact-cache/demo_solution.metrics.compact.json',
    );
    assert.strictEqual(Object.keys(result.mecByGeography).length, 6);
    assert.strictEqual(Object.keys(result.mecV2ByGeography).length, 6);
    assert.match(
      result.mecV2ByGeography.national,
      /metrics\/mec-cache-v2\/demo_solution\/national\.mec\.compact\.json$/,
    );
  });
});
