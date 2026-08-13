import { strict as assert } from 'node:assert';
import path from 'node:path';
import { describe, it } from 'node:test';
import { findReachableLayerMetadataUrls, parseArgs } from './build-release-manifest.mjs';

describe('release layer metadata discovery', () => {
  it('retains only metadata URLs proven reachable', async () => {
    const backedUrl = 'https://example.com/metadata/backed.metadata.json';
    const missingUrl = 'https://example.com/metadata/missing.metadata.json';
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return { ok: url === backedUrl, status: url === backedUrl ? 200 : 404 };
    };

    const result = await findReachableLayerMetadataUrls(
      [{ metadataUrl: backedUrl }, { metadataUrl: missingUrl }, { metadataUrl: null }],
      fetchImpl,
    );

    assert.deepStrictEqual(result, new Set([backedUrl]));
    assert.deepStrictEqual(
      requests.map(({ url, options }) => [url, options.method]),
      [
        [backedUrl, 'HEAD'],
        [missingUrl, 'HEAD'],
      ],
    );
  });
});

describe('release manifest CLI arguments', () => {
  it('keeps the preview solution ID literal while resolving evidence paths', () => {
    const values = parseArgs([
      '--base-manifest',
      'base.json',
      '--preflight-manifest',
      'preflight.json',
      '--catalog',
      'catalog.json',
      '--artifact-inventory',
      'preview-inventory.json',
      '--species-goals-inventory',
      'species-inventory.json',
      '--species-goals-catalog',
      'species-catalog.json',
      '--aoi-coverage-preview-solution',
      'selected_solution',
      '--output',
      'manifest.json',
    ]);

    assert.strictEqual(values['aoi-coverage-preview-solution'], 'selected_solution');
    assert.strictEqual(values['artifact-inventory'], path.resolve('preview-inventory.json'));
    assert.strictEqual(values['species-goals-catalog'], path.resolve('species-catalog.json'));
  });

  it('rejects a preview option without its solution ID', () => {
    assert.throws(
      () =>
        parseArgs([
          '--base-manifest',
          'base.json',
          '--preflight-manifest',
          'preflight.json',
          '--catalog',
          'catalog.json',
          '--output',
          'manifest.json',
          '--aoi-coverage-preview-solution',
        ]),
      /expected --option value pairs/,
    );
  });
});
