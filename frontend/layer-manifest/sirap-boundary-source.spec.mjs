import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { BOUNDARY_SOURCES } from './lib/artifact-documents.mjs';
import { parseCsv, rowsToObjects } from './lib/csv.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const pathname =
  'inputs/boundaries/sirap/v3/' +
  'sha256-1372ce888f8c4c0f160da9c4ce553254542f160bb82bfd6a1da5730da4493e5c/' +
  'siraps_authoritative_combined_v3.geojson';
const url = `https://aagibolq28slyfof.public.blob.vercel-storage.com/${pathname}`;
const sha256 = '1372ce888f8c4c0f160da9c4ce553254542f160bb82bfd6a1da5730da4493e5c';
const catalogSha256 = 'adc614dbf2ce94297b3b635e01a04a98d9f3ccf6727447e7b72d08f2144be5ba';
const geometryCollectionSha256 =
  '54d3a53363488dd304398fdcad2288b16c7333db978df14b340eded815ee5d12';

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

  it('keeps the Python registry and artifact validator on one immutable source', async () => {
    const source = await readFile(
      path.join(
        repoRoot,
        'data/metrics/python/metrics_pipeline/boundaries/boundary_loader.py',
      ),
      'utf-8',
    );
    const pythonSource = parsePythonSirapSource(source);
    const artifactSource = BOUNDARY_SOURCES.siraps;

    assert.equal(new URL(artifactSource.url).pathname.slice(1), pathname);
    assert.deepEqual(pythonSource, {
      url,
      sha256,
      catalogSha256,
      geometryCollectionSha256,
    });
    assert.deepEqual(
      {
        url: artifactSource.url,
        sha256: artifactSource.sha256,
        catalogSha256: artifactSource.catalogSha256,
        geometryCollectionSha256: artifactSource.geometryCollectionSha256,
      },
      pythonSource,
    );
  });
});

function parsePythonSirapSource(source) {
  const start = source.indexOf('"siraps": BoundarySourceSpec(');
  const end = source.indexOf('\n    "runaps": BoundarySourceSpec(', start);
  assert.notEqual(start, -1, 'Python SIRAP boundary source is missing');
  assert.notEqual(end, -1, 'Python SIRAP boundary source is not bounded by RUNAP');

  const block = source.slice(start, end);
  const host = requiredMatch(source, /^PUBLIC_BLOB_HOST = "([^"]+)"$/m, 'public blob host');
  const urlBlock = requiredMatch(block, /url=\(\s*([\s\S]*?)\s*\),/, 'SIRAP URL block');
  const url = [...urlBlock.matchAll(/"(.*?)"/g)]
    .map((match) => match[1])
    .join('')
    .replace('{PUBLIC_BLOB_HOST}', host);

  return {
    url,
    sha256: requiredMatch(block, /expected_sha256="([^"]+)"/, 'source checksum'),
    catalogSha256: requiredMatch(
      block,
      /expected_catalog_sha256="([^"]+)"/,
      'catalog checksum',
    ),
    geometryCollectionSha256: requiredMatch(
      block,
      /expected_geometry_collection_sha256="([^"]+)"/,
      'geometry collection checksum',
    ),
  };
}

function requiredMatch(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Python ${label} is missing`);
  return match[1];
}
