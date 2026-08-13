import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseCsv, rowsToObjects } from './lib/csv.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const pathname = 'inputs/boundaries/sirap/siraps_authoritative_combined_v3.geojson';
const url = `https://aagibolq28slyfof.public.blob.vercel-storage.com/${pathname}`;
const sha256 = '1372ce888f8c4c0f160da9c4ce553254542f160bb82bfd6a1da5730da4493e5c';

describe('authoritative SIRAP metric source contracts', () => {
  it('leaves the manifest-generator source row on the current frontend boundary', async () => {
    const source = await readFile(
      path.join(
        repoRoot,
        'data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv',
      ),
      'utf-8',
    );
    const [headers, ...rows] = parseCsv(source);
    const layerIdIndex = headers.findIndex((header) => header.includes('layer_id'));
    const filenameIndex = headers.findIndex((header) => header.includes('filename'));
    const storageLocationIndex = headers.findIndex((header) => header.includes('storage_location'));
    const siraps = rows.find((row) => row[layerIdIndex] === 'siraps');

    assert.ok(siraps);
    assert.equal(siraps[filenameIndex], 'siraps_merged_polygon_v2.geojson');
    assert.equal(
      siraps[storageLocationIndex],
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
    );
  });

  it('keeps the registry URL, checksum, and feature count aligned', async () => {
    const source = await readFile(
      path.join(repoRoot, 'data/boundaries/boundary_sources.csv'),
      'utf-8',
    );
    const rows = rowsToObjects(parseCsv(source));
    const siraps = rows.find((row) => row.id === 'ADMIN_SIRAP');

    assert.ok(siraps);
    assert.equal(siraps.repo_path_or_url, url);
    assert.equal(siraps.sha256, sha256);
    assert.equal(siraps.feature_count, '8');
    assert.equal(siraps.id_field, 'sirap_id');
    assert.equal(siraps.name_field, 'sirap_name');
  });
});
