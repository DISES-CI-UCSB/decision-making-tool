import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { createLayerEntry } from './generate-manifest.mjs';
import { parseCsv } from './lib/csv.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const filename = 'siraps_territorial_authoritative_v3.geojson';
const assetPath = path.join(repoRoot, 'data/boundaries/sirap', filename);
const metadataPath = assetPath.replace(/\.geojson$/, '.metadata.json');
const expectedSha256 = '7826e6cc0c34eb69446bb410427d8023415d6886339b624a2c0a6b990000db5d';

describe('authoritative Territorial SIRAP source', () => {
  it('contains the exact six-feature authoritative catalog', async () => {
    const raw = await readFile(assetPath);
    const collection = JSON.parse(raw);

    assert.equal(createHash('sha256').update(raw).digest('hex'), expectedSha256);
    assert.deepEqual(
      collection.features.map(({ properties }) => [
        properties.source_code,
        properties.sirap_id,
        properties.sirap_name,
      ]),
      [
        ['DTAM', 'territorial_territorial_amazonia_3', 'Territorial Amazonia'],
        [
          'DTAN',
          'territorial_territorial_andes_nororientales_4',
          'Territorial Andes Nororientales',
        ],
        ['DTAO', 'territorial_territorial_andes_occidentales_5', 'Territorial Andes Occidentales'],
        ['DTCA', 'territorial_territorial_caribe_6', 'Territorial Caribe'],
        ['DTOR', 'territorial_territorial_orinoquia_7', 'Territorial Orinoquia'],
        ['DTPA', 'territorial_territorial_pacifico_8', 'Territorial Pacifico'],
      ],
    );
    assert.ok(
      collection.features.every(({ geometry }) =>
        ['Polygon', 'MultiPolygon'].includes(geometry.type),
      ),
    );
  });

  it('preserves distinct old, authoritative, and thematic source rows', async () => {
    const { headers, rows } = await readSourceRows();
    const layerIdIndex = headers.findIndex((header) => header.includes('layer_id'));
    const filenameIndex = headers.findIndex((header) => header.includes('filename'));
    const byId = new Map(rows.map((row) => [row[layerIdIndex], row]));

    assert.equal(byId.get('siraps')?.[filenameIndex], 'siraps_merged_polygon_v2.geojson');
    assert.equal(byId.get('siraps_territorial')?.[filenameIndex], 'siraps_territorial.geojson');
    assert.equal(byId.get('siraps_thematic')?.[filenameIndex], 'siraps_thematic.geojson');
    assert.equal(byId.get('siraps_territorial_updated')?.[filenameIndex], filename);
  });

  it('demotes the old source and promotes the authoritative six-feature source', async () => {
    const { headers, rows } = await readSourceRows();
    const oldEntry = await createLayerEntry(
      sourceRowById(headers, rows, 'siraps_territorial'),
      new Map(),
      null,
    );
    const authoritativeEntry = await createLayerEntry(
      sourceRowById(headers, rows, 'siraps_territorial_updated'),
      new Map(),
      null,
    );
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const adjacentMetadataUrl =
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/boundaries/sirap/siraps_territorial_authoritative_v3.metadata.json';

    assert.deepEqual(
      {
        englishLabel: oldEntry.manifestLayer.englishLabel,
        spanishLabel: oldEntry.manifestLayer.spanishLabel,
        description: oldEntry.manifestLayer.description,
        dataRole: oldEntry.manifestLayer.dataRole,
        roleInMetricCalculation: oldEntry.manifestLayer.roleInMetricCalculation,
        requiredForSolution: oldEntry.manifestLayer.requiredForSolution,
        selectableInFinder: oldEntry.manifestLayer.selectableInFinder,
        visibleInMapLayers: oldEntry.manifestLayer.visibleInMapLayers,
      },
      {
        englishLabel: 'Territorial SIRAPs (outdated)',
        spanishLabel: 'SIRAP territoriales (desactualizados)',
        description:
          'Outdated Territorial SIRAP boundaries retained as a view-only comparison layer.',
        dataRole: 'reference_layer',
        roleInMetricCalculation: 'none',
        requiredForSolution: false,
        selectableInFinder: false,
        visibleInMapLayers: true,
      },
    );
    assert.deepEqual(
      {
        englishLabel: authoritativeEntry.manifestLayer.englishLabel,
        spanishLabel: authoritativeEntry.manifestLayer.spanishLabel,
        description: authoritativeEntry.manifestLayer.description,
        dataRole: authoritativeEntry.manifestLayer.dataRole,
        category: authoritativeEntry.manifestLayer.category,
        roleInMetricCalculation: authoritativeEntry.manifestLayer.roleInMetricCalculation,
        metadataUrl: authoritativeEntry.manifestLayer.metadataUrl,
      },
      {
        englishLabel: 'Territorial SIRAPs',
        spanishLabel: 'SIRAP territoriales',
        description:
          'Authoritative six-feature Territorial SIRAP boundaries used for AOI selection and metric lookup.',
        dataRole: 'administrative_boundary',
        category: 'administrative_boundaries',
        roleInMetricCalculation: 'boundary_used_for_precomputed_metric_lookup',
        metadataUrl: adjacentMetadataUrl,
      },
    );
    assert.equal(metadata.featureCount, 6);
    assert.equal(metadata.stableIdField, 'sirap_id');
    assert.equal(metadata.pathname, `inputs/boundaries/sirap/${filename}`);
  });
});

async function readSourceRows() {
  const csvPath = path.join(
    repoRoot,
    'data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv',
  );
  const [headers, ...rows] = parseCsv(await readFile(csvPath, 'utf8'));
  return { headers, rows };
}

function sourceRowById(headers, rows, layerId) {
  const fieldNames = [
    'layer_id',
    'layer_name',
    'layer_group',
    'layer_description',
    'model_group',
    'filename',
    'storage_location',
    'data_format',
  ];
  const indexes = Object.fromEntries(
    fieldNames.map((fieldName) => [
      fieldName,
      headers.findIndex((header) => header.includes(fieldName)),
    ]),
  );
  const row = rows.find((candidate) => candidate[indexes.layer_id] === layerId);
  assert.ok(row);
  return Object.fromEntries(
    fieldNames.map((fieldName) => [fieldName, row[indexes[fieldName]] ?? '']),
  );
}
