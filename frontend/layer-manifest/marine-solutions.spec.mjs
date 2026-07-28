import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createSolutionManifestEntry } from './generate-manifest.mjs';

describe('marine solution manifest entries', () => {
  it('keeps explicit marine domain and model labels', () => {
    const entry = createSolutionManifestEntry({
      metadata: {
        id: 'marine_ecos30_mang30_runap_hhm',
        run_name: 'Marine 30% · RUNAP · HHM',
        description: 'Marine ecosystem and mangrove targets at 30%.',
        domain: 'marine',
        scope: 'marine',
        target_feature_set: 'marine_ecosystems_and_mangroves',
        target_percent: 30,
        input_layer_ids: {
          features: ['FEAT_MARINE_ECOSYSTEMS', 'FEAT_MANGROVES'],
          cost: 'COST_HHM',
          includes: ['INCL_RUNAP'],
          excludes: [],
        },
        coverage: [],
      },
      metadataBlob: {
        pathname: 'solutions/marine/marine_ecos30_mang30_runap_hhm.json',
        url: 'https://example.com/marine.json',
      },
      rasterBlob: {
        pathname: 'solutions/marine/marine_ecos30_mang30_runap_hhm.tif',
        url: 'https://example.com/marine.tif',
      },
    });

    assert.strictEqual(entry.domain, 'marine');
    assert.strictEqual(entry.finderInputs.domain, 'marine');
    assert.strictEqual(entry.finderInputs.targetFeatureSet, 'marine_ecosystems_and_mangroves');
    assert.strictEqual(entry.finderInputs.targetPercent, 30);
    assert.deepStrictEqual(entry.coverage, []);
    assert.strictEqual(entry.description, 'Marine ecosystem and mangrove targets at 30%.');
    assert.match(
      entry.precomputedMetricUrls.compactCache,
      /compact-cache\/marine_ecos30_mang30_runap_hhm\.metrics\.compact\.json$/,
    );
    assert.strictEqual(entry.precomputedMetricUrls.mecByGeography, undefined);
    assert.strictEqual(entry.precomputedMetricUrls.mecV2ByGeography, undefined);
  });
});
