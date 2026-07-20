import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadLocalEnv } from '../../../layer-manifest/load-local-env.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '../../..');

const BLOB_TOKEN_ENV = 'BLOB_READ_WRITE_TOKEN';
const PUBLIC_BLOB_HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';
const MEC_LAYER_URL =
  'https://visualizador.ideam.gov.co/gisserver/rest/services/Estado_Ecosistemas/MapServer/1';
const MEC_QUERY_URL = `${MEC_LAYER_URL}/query`;
const IDEAM_ECOSYSTEMS_URL = 'https://www.ideam.gov.co/ecosistemas';
const MEC_MAP_VIEWER_URL =
  'https://www.arcgis.com/apps/mapviewer/index.html?url=https://visualizador.ideam.gov.co/gisserver/rest/services/Estado_Ecosistemas/FeatureServer/1&source=sd';
const SUMMARY_PATHNAME = 'inputs/features/ecosystems/ecosystem-classification-summary.json';
const METADATA_PATHNAME = 'metadata/ecosistemas.metadata.json';

const BIOME_FAMILY_LABELS = [
  'Orobioma',
  'Zonobioma',
  'Hidrobioma',
  'Helobioma',
  'Peinobioma',
  'Litobioma',
  'Halobioma',
];

const CLASSIFICATION_QUERIES = [
  {
    view: 'broadBiomeContext',
    field: 'gran_bioma',
    label: 'Broad Biome Context',
  },
  {
    view: 'biomeRegion',
    field: 'bioma_iavh',
    label: 'IAvH Biome-Region Class',
  },
  {
    view: 'broadEcosystem',
    field: 'ecos_sintesis',
    label: 'Broad Ecosystem Type',
  },
  {
    view: 'detailedEcosystem',
    field: 'ecos_general',
    label: 'Detailed Ecosystem Type',
  },
];

function extractFirstUrl(output) {
  const match = output.match(/https:\/\/\S+/);
  return match ? match[0] : null;
}

function toBiomeFamily(value) {
  if (!value) {
    return 'Other/N.A.';
  }
  return BIOME_FAMILY_LABELS.find((family) => value.startsWith(family)) ?? 'Other/N.A.';
}

function roundMetric(value, decimals = 3) {
  return Number(value.toFixed(decimals));
}

function normalizeMetricRow(label, areaHectares, polygonCount) {
  const hectares = Number(areaHectares) || 0;
  return {
    label: label || 'N.A.',
    areaHectares: roundMetric(hectares),
    areaSquareKilometers: roundMetric(hectares / 100),
    polygonCount: Number(polygonCount) || 0,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function queryGroupedStats(field) {
  const outStatistics = [
    {
      statisticType: 'count',
      onStatisticField: 'objectid',
      outStatisticFieldName: 'polygon_count',
    },
    {
      statisticType: 'sum',
      onStatisticField: 'area_ha',
      outStatisticFieldName: 'area_ha_sum',
    },
  ];
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    returnGeometry: 'false',
    groupByFieldsForStatistics: field,
    outStatistics: JSON.stringify(outStatistics),
    orderByFields: 'area_ha_sum DESC',
    resultRecordCount: '2000',
  });
  const payload = await fetchJson(`${MEC_QUERY_URL}?${params.toString()}`);
  if (payload.error) {
    throw new Error(`MEC grouped stats failed for ${field}: ${JSON.stringify(payload.error)}`);
  }
  return (payload.features ?? []).map((feature) => feature.attributes ?? {});
}

function aggregateBiomeFamilies(biomeRegionRows) {
  const families = new Map();
  for (const row of biomeRegionRows) {
    const family = toBiomeFamily(row.bioma_iavh);
    const current = families.get(family) ?? {
      label: family,
      areaHectares: 0,
      polygonCount: 0,
    };
    current.areaHectares += Number(row.area_ha_sum) || 0;
    current.polygonCount += Number(row.polygon_count) || 0;
    families.set(family, current);
  }
  return Array.from(families.values())
    .map((row) => normalizeMetricRow(row.label, row.areaHectares, row.polygonCount))
    .sort((a, b) => b.areaHectares - a.areaHectares || a.label.localeCompare(b.label));
}

function toClassificationSection({ view, field, label }, rows) {
  return {
    view,
    label,
    sourceField: field,
    valueCount: rows.length,
    values: rows.map((row) => normalizeMetricRow(row[field], row.area_ha_sum, row.polygon_count)),
  };
}

async function putBlob(token, sourcePath, pathname) {
  const { stdout, stderr } = await execFileAsync('vercel', [
    'blob',
    'put',
    sourcePath,
    '--pathname',
    pathname,
    '--force',
    '--rw-token',
    token,
    '--no-color',
  ]);
  const output = `${stdout}\n${stderr}`;
  const url = extractFirstUrl(output);
  if (!url) {
    throw new Error(`Upload for ${pathname} did not return a public URL`);
  }
  return url;
}

async function main() {
  await loadLocalEnv(frontendRoot);
  const token = process.env[BLOB_TOKEN_ENV];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV} missing (set in repo or frontend .env.local)`);
  }

  const generatedAt = new Date().toISOString();
  const groupedRows = new Map();
  for (const query of CLASSIFICATION_QUERIES) {
    groupedRows.set(query.field, await queryGroupedStats(query.field));
  }

  const biomeRegionRows = groupedRows.get('bioma_iavh') ?? [];
  const summary = {
    version: '1.0.0',
    generatedAt,
    source: {
      name: 'MEC 2024 official ecosystem map for Colombia',
      layerUrl: MEC_LAYER_URL,
      queryUrl: MEC_QUERY_URL,
      areaField: 'area_ha',
      polygonCountField: 'objectid',
      ideamOverviewUrl: IDEAM_ECOSYSTEMS_URL,
      mapViewerUrl: MEC_MAP_VIEWER_URL,
    },
    classifications: [
      {
        view: 'biomeFamily',
        label: 'Biome Family',
        sourceField: 'bioma_iavh',
        derivation: 'DISES rollup from IAvH biome-region label prefixes',
        valueCount: 8,
        values: aggregateBiomeFamilies(biomeRegionRows),
      },
      ...CLASSIFICATION_QUERIES.map((query) =>
        toClassificationSection(query, groupedRows.get(query.field) ?? []),
      ),
    ],
  };

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecosystem-classification-'));
  const summaryPath = path.join(tempDir, 'ecosystem-classification-summary.json');
  const metadataPath = path.join(tempDir, 'ecosistemas.metadata.json');
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  const summaryUrl = await putBlob(token, summaryPath, SUMMARY_PATHNAME);
  const metadata = {
    version: '1.0.0',
    generatedAt,
    layerId: 'ecosistemas',
    title: 'Ecosistemas Continentales Marinos y Costeros 100K 2024',
    source: summary.source,
    references: {
      classificationSummaryUrl: summaryUrl,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
  const metadataUrl = await putBlob(token, metadataPath, METADATA_PATHNAME);

  console.log(`[ecosystems] classification summary: ${summaryUrl}`);
  console.log(`[ecosystems] metadata: ${metadataUrl}`);
}

main().catch((error) => {
  console.error(`[ecosystems] ${(error instanceof Error && error.message) || String(error)}`);
  process.exit(1);
});
