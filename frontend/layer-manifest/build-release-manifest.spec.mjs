import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { findReachableLayerMetadataUrls } from './build-release-manifest.mjs';

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
