import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseCsv, rowsToObjects } from './lib/csv.mjs';
import { createSolutionPrecomputedMetricUrls } from './lib/metric-urls.mjs';
import {
  buildStructuredTargets,
  inferSolutionTargetFeatureSet,
  normalizeSolutionCoverage,
} from './generate-manifest.mjs';

const DIMENSION_BY_FEATURE_TYPE = new Map([
  ['ecosystem', 'ecosystems'],
  ['strategic ecosystem', 'strategicEcosystems'],
  ['ecosystem service', 'ecosystemServices'],
]);
const SOLUTION_RENDERING = {
  valueType: 'categorical',
  renderMode: 'categorical',
  noDataValue: 255,
  classColors: [
    { value: 1, color: '#16a34a', label: 'New coverage' },
    { value: 2, color: '#2563eb', label: 'Existing protected areas' },
  ],
};

function parseArgs(argv) {
  const args = { releaseRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--release-root') {
      args.releaseRoot = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  if (!args.releaseRoot) {
    throw new Error('--release-root is required');
  }
  return args;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function speciesDimension(solutionId) {
  if (solutionId.includes('_esprn_')) return 'espRn';
  if (solutionId.includes('_esprep')) return 'speciesRepresentation';
  throw new Error(
    `${solutionId} has prioritizr species rows without an explicit EspRN/EspRep design token`,
  );
}

function targetDimension(solutionId, row) {
  const featureType = String(row.feature_type ?? '')
    .trim()
    .toLowerCase();
  if (featureType === 'species') return speciesDimension(solutionId);
  return DIMENSION_BY_FEATURE_TYPE.get(featureType) ?? null;
}

function ecosystemScalar(solutionId, structuredTargets) {
  const values = new Set(structuredTargets.ecosystems.map((entry) => entry.targetPercent));
  if (values.size !== 1 || ![17, 30].includes([...values][0])) {
    throw new Error(
      `${solutionId} must have exactly one ecosystem scalar of 17 or 30; got ${[...values].join(
        ', ',
      )}`,
    );
  }
  return [...values][0];
}

function deriveInputLayerIds(solutionId, structuredTargets) {
  const features = [
    ['ecosystems', 'ecosystems'],
    ['strategicEcosystems', 'strategic_ecosystems'],
    ['ecosystemServices', 'ecosystem_services'],
    ['speciesRepresentation', 'species_representation'],
    ['espRn', 'esp_rn'],
  ]
    .filter(([dimension]) => structuredTargets[dimension].length > 0)
    .map(([, layerId]) => layerId);
  const costMatch = solutionId.match(/_(iheh20(?:22|30))$/);
  if (!costMatch) {
    throw new Error(`${solutionId} has no explicit IHEH cost-layer token`);
  }
  return {
    features,
    cost: costMatch[1],
    includes: ['runap', ...(solutionId.includes('_omec_') ? ['omec'] : [])],
    excludes: [],
  };
}

async function regenerateSolution(solution, releaseRoot, catalogEntry, releaseId) {
  if (solution.domain !== 'land') {
    return {
      ...solution,
      rasterSha256: catalogEntry.rasterSha256,
      precomputedMetricUrls: createSolutionPrecomputedMetricUrls(solution.id, {}, solution.domain, {
        releaseId,
      }),
    };
  }
  const summaryFilename = solution.sourceProvenance?.sourceSummaryFilename;
  const expectedSha256 = solution.sourceProvenance?.sourceSummarySha256;
  if (!summaryFilename || !expectedSha256) {
    throw new Error(`${solution.id} is missing authoritative summary provenance`);
  }
  const summaryPath = path.join(releaseRoot, 'staged-inputs', 'land', solution.metadataFile);
  const summary = await fs.readFile(summaryPath);
  if (sha256(summary) !== expectedSha256) {
    throw new Error(`${solution.id} summary checksum does not match source provenance`);
  }
  if (path.basename(summaryPath) !== `${solution.id}_summary.csv`) {
    throw new Error(`${solution.id} staged summary filename is not canonical`);
  }

  const rows = rowsToObjects(parseCsv(summary.toString('utf8'))).map((row) => ({
    ...row,
    target_dimension: targetDimension(solution.id, row),
  }));
  const coverage = normalizeSolutionCoverage(rows);
  const structuredTargets = buildStructuredTargets(coverage);
  const targetPercent = ecosystemScalar(solution.id, structuredTargets);
  const targetFeatureSet = inferSolutionTargetFeatureSet({
    metadata: {},
    structuredTargets,
  });
  const inputLayerIds = deriveInputLayerIds(solution.id, structuredTargets);

  const finderInputs = {
    ...solution.finderInputs,
    targetFeatureSet,
    targetFeatureIds: inputLayerIds.features,
    targetPercent,
    structuredTargets,
    costLayerId: inputLayerIds.cost,
    includeLayerIds: inputLayerIds.includes,
    excludeLayerIds: inputLayerIds.excludes,
  };
  const regenerated = {
    ...solution,
    rasterSha256: catalogEntry.rasterSha256,
    generatedAt: solution.generatedAt ?? null,
    coverage,
    finderInputs,
    inputLayerIds,
    rendering: solution.rendering ?? SOLUTION_RENDERING,
    precomputedMetricUrls: createSolutionPrecomputedMetricUrls(solution.id, {}, solution.domain, {
      releaseId,
    }),
    summaryMetrics: {
      nSelected: solution.summaryMetrics?.nSelected ?? null,
      totalCost: solution.summaryMetrics?.totalCost ?? null,
      pctTargetsMet: solution.summaryMetrics?.pctTargetsMet ?? null,
      coverageRowCount: coverage.length,
    },
  };
  if (regenerated.scope !== 'sirap') {
    delete regenerated.sirapId;
  }
  return regenerated;
}

async function main() {
  const { releaseRoot } = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(releaseRoot, 'preflight', 'manifest.json');
  const catalogPath = path.join(releaseRoot, 'solution-catalog.json');
  const [manifest, catalog] = await Promise.all([
    fs.readFile(manifestPath, 'utf8').then(JSON.parse),
    fs.readFile(catalogPath, 'utf8').then(JSON.parse),
  ]);
  const catalogById = new Map(catalog.solutions.map((solution) => [solution.solutionId, solution]));
  if (
    manifest.solutions.length !== catalog.expectedSolutionCount ||
    manifest.solutions.some((solution) => !catalogById.has(solution.id))
  ) {
    throw new Error('Frozen manifest solution IDs do not exactly match the catalog');
  }

  const solutions = [];
  for (const solution of manifest.solutions) {
    solutions.push(
      await regenerateSolution(
        solution,
        releaseRoot,
        catalogById.get(solution.id),
        catalog.releaseId,
      ),
    );
  }
  const distribution = solutions
    .filter((solution) => solution.domain === 'land')
    .reduce((counts, solution) => {
      const target = solution.finderInputs.targetPercent;
      counts[target] = (counts[target] ?? 0) + 1;
      return counts;
    }, {});
  if (distribution[17] !== 41 || distribution[30] !== 41) {
    throw new Error(
      `Frozen land target distribution must be 41×17 and 41×30; got ${JSON.stringify(
        distribution,
      )}`,
    );
  }

  const output = `${JSON.stringify({ ...manifest, solutions }, null, 2)}\n`;
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, output);
  await fs.rename(temporaryPath, manifestPath);
  console.log(
    `[regenerate-frozen-targets] wrote ${manifestPath}; land targets=${JSON.stringify(
      distribution,
    )}`,
  );
}

await main();
