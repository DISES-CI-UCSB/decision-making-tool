import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHydrationPackage } from '../shared/hydration-package.mjs';
import { RUNTIME_MANIFEST_BLOB_URL } from '../shared/runtime-manifest.constants.mjs';
import { loadLocalEnv } from './load-local-env.mjs';
import { main as publishManifest } from './publish-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, './releases/0.3.5/catalog.json');

function parseArgs(rawArgs) {
  return {
    dryRun: rawArgs.includes('--dry-run'),
    expectedLiveSha256: rawArgs.includes('--expected-live-sha256')
      ? rawArgs[rawArgs.indexOf('--expected-live-sha256') + 1]
      : null,
  };
}

async function fetchLiveManifest() {
  const response = await fetch(`${RUNTIME_MANIFEST_BLOB_URL}?v=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch live catalog: HTTP ${response.status}`);
  }
  return response.json();
}

export async function mergeHydrationPackage(liveManifest, generatedAt = new Date().toISOString()) {
  return {
    ...liveManifest,
    generatedAt,
    hydrationPackage: buildHydrationPackage(liveManifest.publicBlobHost),
    manualEdit: {
      editorName: 'publish-hydration-package',
      editedAt: generatedAt,
      source: 'hydration-package-v1',
    },
  };
}

async function main(rawArgs = process.argv.slice(2)) {
  await loadLocalEnv(path.resolve(__dirname, '..'));
  const args = parseArgs(rawArgs);
  const liveManifest = await fetchLiveManifest();
  const nextManifest = await mergeHydrationPackage(liveManifest);
  const sourcePath = path.resolve('/tmp/dmt-manifest-with-hydration.json');
  await writeFile(sourcePath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  console.log(`[publish-hydration-package] wrote ${sourcePath}`);
  console.log(
    `[publish-hydration-package] default grid ${nextManifest.hydrationPackage.defaultReferenceGrid} ${nextManifest.hydrationPackage.referenceGrids['land-solution'].crs}`,
  );

  const publishArgs = [
    '--source',
    sourcePath,
    '--catalog',
    CATALOG_PATH,
    '--display-only',
    '--confirm-release',
    nextManifest.releaseId,
  ];
  if (args.dryRun) {
    publishArgs.push('--dry-run');
  } else if (args.expectedLiveSha256) {
    publishArgs.push('--expected-live-sha256', args.expectedLiveSha256);
  } else {
    throw new Error('Live publish requires --dry-run first, then --expected-live-sha256 <digest>');
  }
  await publishManifest(publishArgs);
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(`[publish-hydration-package] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
