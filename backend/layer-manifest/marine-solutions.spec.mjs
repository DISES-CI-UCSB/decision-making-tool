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

  it('derives sorted structured targets only from prioritizr model rows', () => {
    const entry = createSolutionManifestEntry({
      metadata: {
        id: 'structured_targets',
        run_name: 'Structured targets',
        scope: 'nacional',
        target_feature_set: 'ecosystems_and_esp_rn',
        input_layer_ids: {
          features: ['FEAT_ECOSYSTEMS'],
          cost: 'COST_HF',
          includes: ['INCL_RUNAP'],
          excludes: [],
        },
        coverage: [
          {
            feature: 'Haematopus palliatus',
            feature_type: 'species',
            evaluated: 'prioritizr_model',
            relative_target: 0.23,
          },
          {
            feature: 'ecosistemas',
            type: 'ecosystem',
            evaluated: 'prioritizr_model',
            relative_target: 0.17,
          },
          {
            feature: 'Hypericum strictum',
            feature_type: 'species',
            evaluated: 'prioritizr_model',
            relative_target: 0.11,
          },
          {
            feature: 'paramos',
            type: 'ecosystem',
            evaluated: 'post-hoc',
            relative_target: 0.3,
          },
        ],
      },
      metadataBlob: {
        pathname: 'solutions/nacional/structured_targets.json',
        url: 'https://example.com/structured.json',
      },
      rasterBlob: {
        pathname: 'solutions/nacional/structured_targets.tif',
        url: 'https://example.com/structured.tif',
      },
    });

    assert.equal(entry.finderInputs.targetPercent, 17);
    assert.deepEqual(entry.finderInputs.structuredTargets.espRn, [
      { featureId: 'haematopus_palliatus', targetPercent: 23 },
      { featureId: 'hypericum_strictum', targetPercent: 11 },
    ]);
    assert.deepEqual(entry.finderInputs.structuredTargets.ecosystems, [
      { featureId: 'ecosistemas', targetPercent: 17 },
    ]);
    assert.deepEqual(entry.finderInputs.structuredTargets.strategicEcosystems, []);
  });
});
