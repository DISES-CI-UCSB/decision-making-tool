import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  appendCanonicalCsvRecord,
  prepareViewLayerRegistration,
} from './view-layer-registration.mjs';

describe('view-only layer registration', () => {
  it('prepares immutable Blob paths, manifest fields, and a canonical CSV row', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'view-layer-registration-'));
    const filePath = path.join(temporaryRoot, 'wetlands.geojson');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-74, 4],
                  [-74, 5],
                  [-73, 5],
                  [-74, 4],
                ],
              ],
            },
          },
        ],
      }),
    );
    try {
      const result = await prepareViewLayerRegistration({
        filePath,
        layerId: 'example_wetlands',
        spanishLabel: 'Humedales de ejemplo',
        englishLabel: 'Example Wetlands',
        description: 'A view-only example.',
        category: 'ecosystems',
        sourceOrg: 'Example Org',
        sourceUrl: 'https://example.com/source',
        publicBlobHost: 'https://example.com',
      });

      assert.equal(
        result.geojsonPathname,
        'inputs/reference/example_wetlands/v0.1.0/example_wetlands.geojson',
      );
      assert.equal(result.layer.dataRole, 'reference_layer');
      assert.equal(result.layer.roleInMetricCalculation, 'none');
      assert.equal(result.layer.visibleInMapLayers, true);
      assert.equal(result.csvRecord.length, 22);
      assert.equal(result.csvRecord[4], 'referencia\nreference');
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('rejects empty or unsupported local files', async () => {
    await assert.rejects(
      () =>
        prepareViewLayerRegistration({
          filePath: '/tmp/layer.zip',
          layerId: 'layer',
          spanishLabel: 'Capa',
          englishLabel: 'Layer',
          description: 'Layer',
          category: 'ecosystems',
          sourceOrg: 'Org',
          sourceUrl: 'https://example.com',
          publicBlobHost: 'https://example.com',
        }),
      /finalized \.geojson files/,
    );
  });

  it('appends the canonical CSV row idempotently', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'view-layer-csv-'));
    const csvPath = path.join(temporaryRoot, 'layers.csv');
    const record = ['example_layer', 'Example'];
    await fs.writeFile(csvPath, 'id,name\n');
    try {
      assert.equal(await appendCanonicalCsvRecord(csvPath, record, 'example_layer'), true);
      assert.equal(await appendCanonicalCsvRecord(csvPath, record, 'example_layer'), false);
      assert.equal(await fs.readFile(csvPath, 'utf8'), 'id,name\nexample_layer,Example\n');
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
