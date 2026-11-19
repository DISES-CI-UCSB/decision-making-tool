import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { selectManifestSolutions } from './solution-preservation.mjs';

const published = {
  id: 'published',
  displayUrl: 'https://example.com/published.tif',
  precomputedMetricUrls: { custom: 'https://example.com/published.json' },
};
const generated = {
  id: 'generated',
  displayUrl: 'https://example.com/generated.tif',
  precomputedMetricUrls: {},
};

describe('solution preservation policy', () => {
  it('prefers published solutions over generated and local solutions', () => {
    const result = selectManifestSolutions({
      publishedManifestIndex: { manifest: { solutions: [published] } },
      generatedSolutions: [generated],
      existingManifestIndex: { manifest: { solutions: [{ id: 'local' }] } },
    });

    assert.deepStrictEqual(
      result.solutions.map(({ id }) => id),
      ['published'],
    );
    assert.strictEqual(result.preservedPublishedSolutions.length, 1);
    assert.strictEqual(result.preservedExistingSolutions.length, 0);
    assert.strictEqual(
      result.solutions[0].precomputedMetricUrls.custom,
      published.precomputedMetricUrls.custom,
    );
    assert.match(result.solutions[0].precomputedMetricUrls.goals, /published\.goals\.json$/);
    assert.match(
      result.solutions[0].precomputedMetricUrls.compactCache,
      /compact-cache\/published\.metrics\.compact\.json$/,
    );
    assert.strictEqual(
      Object.keys(result.solutions[0].precomputedMetricUrls.mecByGeography).length,
      6,
    );
    assert.strictEqual(
      Object.keys(result.solutions[0].precomputedMetricUrls.mecV2ByGeography).length,
      6,
    );
  });

  it('merges only generated solutions from explicitly registered Blob prefixes', () => {
    const marine = {
      id: 'marine-30',
      blobPath: 'solutions/marine/marine-30.tif',
      displayUrl: 'https://example.com/marine-30.tif',
      precomputedMetricUrls: {},
    };
    const unrelated = {
      id: 'unrelated',
      blobPath: 'solutions/staging/unrelated.tif',
      displayUrl: 'https://example.com/unrelated.tif',
      precomputedMetricUrls: {},
    };

    const result = selectManifestSolutions({
      publishedManifestIndex: { manifest: { solutions: [published] } },
      generatedSolutions: [marine, unrelated],
      existingManifestIndex: null,
      registeredSolutionBlobPrefixes: ['solutions/marine/'],
    });

    assert.deepStrictEqual(
      result.solutions.map(({ id }) => id),
      ['published', 'marine-30'],
    );
    const marineResult = result.solutions.find(({ id }) => id === 'marine-30');
    assert.match(
      marineResult.precomputedMetricUrls.compactCache,
      /compact-cache\/marine-30\.metrics\.compact\.json$/,
    );
    assert.strictEqual(marineResult.precomputedMetricUrls.mecByGeography, undefined);
    assert.strictEqual(marineResult.precomputedMetricUrls.mecV2ByGeography, undefined);
  });

  it('uses generated solutions, preserves display COG URLs, and refreshes sidecar URLs', () => {
    const result = selectManifestSolutions({
      publishedManifestIndex: null,
      generatedSolutions: [generated],
      existingManifestIndex: {
        manifest: {
          solutions: [
            {
              id: 'generated',
              displayCogUrl: 'https://example.com/generated-cog.tif',
              precomputedMetricUrls: { compactCache: 'https://example.com/verified.json' },
            },
          ],
        },
      },
    });

    assert.strictEqual(result.solutions[0].displayCogUrl, 'https://example.com/generated-cog.tif');
    assert.strictEqual(
      result.solutions[0].precomputedMetricUrls.compactCache,
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/nick-runs/2026-05-27/compact-cache/generated.metrics.compact.json',
    );
  });

  it('uses the frozen catalog instead of published solutions for a release', () => {
    const result = selectManifestSolutions({
      publishedManifestIndex: { manifest: { solutions: [published] } },
      generatedSolutions: [generated],
      existingManifestIndex: null,
      releaseId: 'solutions-v0-2-0-20260805',
    });

    assert.deepStrictEqual(
      result.solutions.map(({ id }) => id),
      ['generated'],
    );
    assert.strictEqual(result.preservedPublishedSolutions.length, 0);
    assert.match(
      result.solutions[0].precomputedMetricUrls.compactCache,
      /releases\/solutions-v0-2-0-20260805\/regular\/compact\/generated\.metrics\.compact\.json$/,
    );
  });

  it('falls back to existing solutions only when no newer catalog exists', () => {
    const result = selectManifestSolutions({
      publishedManifestIndex: null,
      generatedSolutions: [],
      existingManifestIndex: { manifest: { solutions: [{ id: 'local' }] } },
    });

    assert.deepStrictEqual(
      result.solutions.map(({ id }) => id),
      ['local'],
    );
    assert.strictEqual(result.preservedExistingSolutions.length, 1);
  });
});
