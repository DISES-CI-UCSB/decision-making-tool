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

  it('preserves existing keys while refreshing goals and deriving a nick-runs compact cache URL', () => {
    const result = createSolutionPrecomputedMetricUrls(
      'demo_solution',
      {
        custom: 'https://example.com/custom.json',
        goals: 'https://example.com/stale-goals.json',
        compactCache: 'https://example.com/stale-compact.json',
      },
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/nick-runs/2026-05-27/demo_solution.tif',
    );

    assert.deepStrictEqual(result, {
      custom: 'https://example.com/custom.json',
      goals:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/goals/demo_solution.goals.json',
      compactCache:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/nick-runs/2026-05-27/compact-cache/demo_solution.metrics.compact.json',
    });
  });

  it('does not seed a generic compact cache URL without a nick-runs display URL', () => {
    const result = createSolutionPrecomputedMetricUrls(
      'demo_solution',
      { custom: 'https://example.com/custom.json' },
      'https://example.com/solutions/demo_solution.tif',
    );

    assert.deepStrictEqual(result, {
      custom: 'https://example.com/custom.json',
      goals:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/goals/demo_solution.goals.json',
    });
  });

  it('preserves an existing compact cache URL when no run can be derived', () => {
    const result = createSolutionPrecomputedMetricUrls(
      'demo_solution',
      { compactCache: 'https://example.com/verified-compact.json' },
      'not a URL',
    );

    assert.strictEqual(result.compactCache, 'https://example.com/verified-compact.json');
  });
});
