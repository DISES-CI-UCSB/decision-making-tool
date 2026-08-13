import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH } from '../shared/runtime-manifest.constants.mjs';
import { readSolutionCatalog } from './lib/solution-catalog.mjs';
import { buildRuntimeReleaseManifest } from './lib/runtime-release-manifest.mjs';
import { validateManifest } from './validate-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const frontendRoot = path.dirname(path.dirname(__filename));
const localRuntimeManifestPath = path.join(frontendRoot, LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH);

export function speciesGoalsBaseUrlForOutput(outputPath) {
  return path.resolve(outputPath) === localRuntimeManifestPath ? '' : undefined;
}

export function parseArgs(args) {
  const values = {};
  const literalOptions = new Set(['aoi-coverage-preview-solution']);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!option?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`expected --option value pairs; received "${option ?? ''}"`);
    }
    const key = option.slice(2);
    values[key] = literalOptions.has(key) ? value : path.resolve(process.cwd(), value);
  }
  for (const required of ['base-manifest', 'preflight-manifest', 'catalog', 'output']) {
    if (!values[required]) {
      throw new Error(`--${required} is required`);
    }
  }
  return values;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

export async function findReachableLayerMetadataUrls(layers, fetchImpl = fetch) {
  const urls = [
    ...new Set(
      layers
        .map((layer) => layer.metadataUrl)
        .filter((url) => typeof url === 'string' && url.length > 0),
    ),
  ];
  const reachableUrls = new Set();

  for (const url of urls) {
    let response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' });
    if (response.status === 403 || response.status === 405) {
      response = await fetchImpl(url, { method: 'GET', redirect: 'follow' });
    }
    if (response.ok) {
      reachableUrls.add(url);
    }
  }

  return reachableUrls;
}

export async function buildReleaseManifestFromFiles({
  baseManifestPath,
  preflightManifestPath,
  catalogPath,
  outputPath,
  releaseArtifactInventoryPath = null,
  speciesGoalsInventoryPath = null,
  speciesGoalsCatalogPath = null,
  aoiCoveragePreviewSolutionId = null,
}) {
  const [
    baseManifest,
    preflightManifest,
    catalog,
    releaseArtifactInventory,
    speciesGoalsInventory,
    speciesGoalsCatalog,
  ] = await Promise.all([
    readJson(baseManifestPath),
    readJson(preflightManifestPath),
    readSolutionCatalog(catalogPath),
    releaseArtifactInventoryPath ? readJson(releaseArtifactInventoryPath) : null,
    speciesGoalsInventoryPath ? readJson(speciesGoalsInventoryPath) : null,
    speciesGoalsCatalogPath ? readJson(speciesGoalsCatalogPath) : null,
  ]);
  const backedLayerMetadataUrls = await findReachableLayerMetadataUrls(baseManifest.layers);
  const localArtifactBaseUrl =
    aoiCoveragePreviewSolutionId === null ? undefined : speciesGoalsBaseUrlForOutput(outputPath);
  const manifest = buildRuntimeReleaseManifest({
    baseManifest,
    preflightManifest,
    catalog,
    releaseArtifactInventory,
    speciesGoalsInventory,
    speciesGoalsCatalog,
    speciesGoalsBaseUrl: localArtifactBaseUrl,
    releaseArtifactBaseUrl: localArtifactBaseUrl,
    aoiCoveragePreviewSolutionId,
    backedLayerMetadataUrls,
  });
  await validateManifest(manifest, outputPath, {
    catalog,
    aoiCoveragePreviewSolutionId,
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest)}\n`, 'utf-8');
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output;
  const manifest = await buildReleaseManifestFromFiles({
    baseManifestPath: args['base-manifest'],
    preflightManifestPath: args['preflight-manifest'],
    catalogPath: args.catalog,
    outputPath,
    releaseArtifactInventoryPath: args['artifact-inventory'] ?? null,
    speciesGoalsInventoryPath: args['species-goals-inventory'] ?? null,
    speciesGoalsCatalogPath: args['species-goals-catalog'] ?? null,
    aoiCoveragePreviewSolutionId: args['aoi-coverage-preview-solution'] ?? null,
  });
  const bytes = (await fs.stat(outputPath)).size;
  const domainCounts = manifest.solutions.reduce((counts, solution) => {
    counts[solution.domain] = (counts[solution.domain] ?? 0) + 1;
    return counts;
  }, {});
  console.log(
    `[build:release-manifest] wrote ${path.relative(process.cwd(), outputPath)} ` +
      `(${bytes} bytes, ${manifest.solutions.length} solutions, ` +
      `${domainCounts.land ?? 0} land, ${domainCounts.marine ?? 0} marine)`,
  );
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(`[build:release-manifest] ${error.message}`);
    process.exit(1);
  });
}
