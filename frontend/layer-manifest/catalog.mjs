import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.mjs';
import { publishManifestRevision, readLiveManifestIdentity } from './publish-manifest.mjs';
import { createCatalogPatch, validateCatalogPatch } from './lib/catalog-patch.mjs';
import {
  appendCanonicalCsvRecord,
  prepareViewLayerRegistration,
} from './lib/view-layer-registration.mjs';
import {
  PUBLIC_BLOB_HOST,
  RUNTIME_MANIFEST_BLOB_PATHNAME,
} from '../shared/runtime-manifest.constants.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');
const canonicalCsvPath = path.resolve(
  repoRoot,
  'data/Capas de entrada _ Input Layers - Capas de entrada requeridas (2).csv',
);
const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';

export function parseCatalogArgs(rawArgs) {
  const [command = 'help', ...values] = rawArgs;
  const args = {
    command,
    addLayerIds: [],
    removeLayerIds: [],
    dryRun: false,
    yes: false,
    json: false,
    filePath: null,
    spanishLabel: null,
    englishLabel: null,
    description: null,
    category: null,
    sourceOrg: null,
    sourceUrl: null,
    assetVersion: 'v0.1.0',
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--layer-id') {
      args.addLayerIds.push(requiredValue(values, ++index, '--layer-id'));
    } else if (value === '--remove-layer-id') {
      args.removeLayerIds.push(requiredValue(values, ++index, '--remove-layer-id'));
    } else if (value === '--dry-run') {
      args.dryRun = true;
    } else if (value === '--yes') {
      args.yes = true;
    } else if (value === '--json') {
      args.json = true;
    } else if (value === '--file') {
      args.filePath = path.resolve(requiredValue(values, ++index, '--file'));
    } else if (value === '--name-es') {
      args.spanishLabel = requiredValue(values, ++index, '--name-es');
    } else if (value === '--name-en') {
      args.englishLabel = requiredValue(values, ++index, '--name-en');
    } else if (value === '--description') {
      args.description = requiredValue(values, ++index, '--description');
    } else if (value === '--category') {
      args.category = requiredValue(values, ++index, '--category');
    } else if (value === '--source-org') {
      args.sourceOrg = requiredValue(values, ++index, '--source-org');
    } else if (value === '--source-url') {
      args.sourceUrl = requiredValue(values, ++index, '--source-url');
    } else if (value === '--asset-version') {
      args.assetVersion = requiredValue(values, ++index, '--asset-version');
    } else {
      throw new Error(`unknown option "${value}"`);
    }
  }
  return args;
}

export function catalogPatchSummary(liveManifest, candidate, addLayerIds, removeLayerIds) {
  const addedLayers = candidate.layers.filter((layer) => addLayerIds.includes(layer.id));
  return {
    livePathname: RUNTIME_MANIFEST_BLOB_PATHNAME,
    catalogVersionFrom: liveManifest.catalogVersion,
    catalogVersionTo: candidate.catalogVersion,
    solutionCatalogVersion: candidate.solutionCatalogVersion,
    releaseId: candidate.releaseId,
    addedLayers: addedLayers.map((layer) => ({
      id: layer.id,
      displayUrl: layer.displayUrl,
      metadataUrl: layer.metadataUrl,
      category: layer.category,
    })),
    removedLayerIds: removeLayerIds,
    solutionCount: candidate.solutions.length,
    solutionsChanged: false,
    metricsRecalculationRequired: false,
  };
}

async function run() {
  await loadLocalEnv(frontendRoot);
  const args = parseCatalogArgs(process.argv.slice(2));
  if (args.command === 'help') {
    printUsage();
    return;
  }
  const token = process.env[BLOB_TOKEN_ENV_VAR];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV_VAR} is required`);
  }
  const liveIdentity = await readLiveManifestIdentity(token, RUNTIME_MANIFEST_BLOB_PATHNAME);
  if (!liveIdentity) {
    throw new Error('live catalog manifest was not found');
  }
  const liveManifest = JSON.parse(liveIdentity.contents);

  if (args.command === 'status') {
    printValue(
      {
        pathname: liveIdentity.pathname,
        catalogVersion: liveManifest.catalogVersion,
        solutionCatalogVersion: liveManifest.solutionCatalogVersion ?? liveManifest.catalogVersion,
        releaseId: liveManifest.releaseId,
        layerCount: liveManifest.layers.length,
        solutionCount: liveManifest.solutions.length,
      },
      args.json,
    );
    return;
  }
  if (!['publish-patch', 'add-view-layer'].includes(args.command)) {
    throw new Error(`unknown catalog command "${args.command}"`);
  }

  const registration = args.command === 'add-view-layer' ? await prepareRegistration(args) : null;
  const generatedManifest = registration
    ? { layers: [registration.layer] }
    : await generateManifestSnapshot();
  const addLayerIds = registration ? [registration.layer.id] : args.addLayerIds;
  const candidate = createCatalogPatch({
    liveManifest,
    generatedManifest,
    addLayerIds,
    removeLayerIds: args.removeLayerIds,
  });
  await validateCatalogPatch(liveManifest, candidate);
  if (!registration) {
    await assertPatchAssetsReachable(liveManifest, candidate, token);
  }
  const summary = catalogPatchSummary(liveManifest, candidate, addLayerIds, args.removeLayerIds);
  if (registration) {
    summary.localFile = args.filePath;
    summary.uploads = [registration.geojsonPathname, registration.metadataPathname];
  }
  printValue(summary, args.json);

  if (!args.dryRun && !args.yes) {
    const response = await promptForConfirmation(candidate.catalogVersion);
    if (response !== 'yes') {
      throw new Error('catalog patch cancelled; type "yes" or pass --yes to publish');
    }
  }

  const sourceContents = `${JSON.stringify(candidate)}\n`;
  if (!args.dryRun && registration) {
    await uploadRegistrationAssets(registration, token);
    await assertPatchAssetsReachable(liveManifest, candidate, token);
    await appendCanonicalCsvRecord(canonicalCsvPath, registration.csvRecord, registration.layer.id);
  }
  await publishManifestRevision({
    token,
    sourceContents,
    releaseId: candidate.releaseId,
    targetPathname: RUNTIME_MANIFEST_BLOB_PATHNAME,
    expectedLiveManifest: liveIdentity,
    dryRun: args.dryRun,
  });
  if (!args.dryRun) {
    console.log(
      `[catalog] published catalog ${candidate.catalogVersion}; solutions and metrics remain bound to ${candidate.solutionCatalogVersion}`,
    );
  }
}

async function prepareRegistration(args) {
  const values = { ...args };
  if (values.addLayerIds.length > 1) {
    throw new Error('add-view-layer accepts one --layer-id per invocation');
  }
  if (!values.addLayerIds[0] && values.filePath) {
    values.addLayerIds = [
      path
        .basename(values.filePath, path.extname(values.filePath))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, ''),
    ];
  }
  const prompts = [
    ['spanishLabel', 'Spanish layer name'],
    ['englishLabel', 'English layer name'],
    ['description', 'Layer description'],
    ['category', 'Sidebar category ID'],
    ['sourceOrg', 'Source organization'],
    ['sourceUrl', 'Source URL'],
  ];
  const missing = prompts.filter(([key]) => !values[key]);
  if (missing.length > 0 && values.yes) {
    throw new Error(
      `non-interactive add-view-layer requires: ${missing.map(([, label]) => label).join(', ')}`,
    );
  }
  if (missing.length > 0) {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (const [key, label] of missing) {
        values[key] = (await terminal.question(`${label}: `)).trim();
      }
    } finally {
      terminal.close();
    }
  }
  return prepareViewLayerRegistration({
    filePath: values.filePath,
    layerId: values.addLayerIds[0],
    spanishLabel: values.spanishLabel,
    englishLabel: values.englishLabel,
    description: values.description,
    category: values.category,
    sourceOrg: values.sourceOrg,
    sourceUrl: values.sourceUrl,
    assetVersion: values.assetVersion,
    publicBlobHost: PUBLIC_BLOB_HOST,
  });
}

async function uploadRegistrationAssets(registration, token) {
  await putRegistrationAsset({
    pathname: registration.geojsonPathname,
    contents: registration.contents,
    contentType: 'application/geo+json',
    token,
  });
  await putRegistrationAsset({
    pathname: registration.metadataPathname,
    contents: registration.metadataContents,
    contentType: 'application/json',
    token,
  });
}

async function putRegistrationAsset({ pathname, contents, contentType, token }) {
  const { get, head, put } = await import('@vercel/blob');
  try {
    const existing = await head(pathname, { token });
    if (existing.size !== contents.byteLength) {
      throw new Error(
        `${pathname} already exists with ${existing.size} bytes; expected ${contents.byteLength}. Use a new --asset-version.`,
      );
    }
    const existingBlob = await get(pathname, { access: 'public', token });
    if (!existingBlob?.stream) {
      throw new Error(`could not verify existing Blob content for ${pathname}`);
    }
    const existingContents = Buffer.from(await new Response(existingBlob.stream).arrayBuffer());
    if (!existingContents.equals(contents)) {
      throw new Error(
        `${pathname} already exists with different content. Use a new --asset-version.`,
      );
    }
    console.log(`[catalog] reusing existing ${pathname}`);
    return;
  } catch (error) {
    if (!isBlobNotFound(error)) throw error;
  }
  await put(pathname, contents, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType,
    token,
  });
}

async function generateManifestSnapshot() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dises-catalog-patch-'));
  const outputPath = path.join(temporaryRoot, 'generated-manifest.json');
  try {
    await execFileAsync(
      process.execPath,
      [path.resolve(__dirname, 'generate-manifest.mjs'), '--output', outputPath],
      { cwd: frontendRoot, maxBuffer: 20 * 1024 * 1024 },
    );
    return JSON.parse(await fs.readFile(outputPath, 'utf8'));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function assertPatchAssetsReachable(liveManifest, candidate, token) {
  const { head } = await import('@vercel/blob');
  const liveIds = new Set(liveManifest.layers.map((layer) => layer.id));
  const urls = candidate.layers
    .filter((layer) => !liveIds.has(layer.id))
    .flatMap((layer) => [layer.displayUrl, layer.displayCollectionUrl, layer.metadataUrl])
    .filter((url) => typeof url === 'string');
  for (const url of urls) {
    if (!url.startsWith(`${PUBLIC_BLOB_HOST}/`)) {
      throw new Error(`catalog patch asset must use the configured Blob host: ${url}`);
    }
    try {
      await head(url, { token });
    } catch (error) {
      throw new Error(`catalog patch asset is not reachable: ${url} (${error.message})`);
    }
  }
}

function isBlobNotFound(error) {
  return error?.name === 'BlobNotFoundError' || error?.status === 404 || error?.statusCode === 404;
}

async function promptForConfirmation(catalogVersion) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (
      await terminal.question(
        `Publish this patch to production as catalog ${catalogVersion}? Type "yes": `,
      )
    )
      .trim()
      .toLowerCase();
  } finally {
    terminal.close();
  }
}

function requiredValue(values, index, option) {
  const value = values[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function printValue(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value));
    return;
  }
  console.log(`[catalog] production path: ${value.livePathname ?? value.pathname}`);
  console.log(
    value.catalogVersionFrom
      ? `[catalog] catalog: ${value.catalogVersionFrom} -> ${value.catalogVersionTo}`
      : `[catalog] catalog: ${value.catalogVersion}`,
  );
  console.log(
    `[catalog] solution catalog: ${value.solutionCatalogVersion}; release: ${value.releaseId}`,
  );
  if (value.addedLayers) {
    if (value.localFile) {
      console.log(`[catalog] local file: ${value.localFile}`);
      for (const pathname of value.uploads) {
        console.log(`[catalog] upload -> ${pathname}`);
      }
    }
    for (const layer of value.addedLayers) {
      console.log(`[catalog] add ${layer.id} -> ${layer.displayUrl}`);
    }
    for (const layerId of value.removedLayerIds) {
      console.log(`[catalog] remove ${layerId}`);
    }
    console.log(`[catalog] ${value.solutionCount} solutions unchanged; metrics recalculation: no`);
  } else {
    console.log(`[catalog] ${value.layerCount} layers; ${value.solutionCount} solutions`);
  }
}

function printUsage() {
  console.log('npm run catalog -- status [--json]');
  console.log(
    'npm run catalog -- publish-patch --layer-id <id> [--layer-id <id> ...] [--dry-run|--yes] [--json]',
  );
  console.log('npm run catalog -- publish-patch --remove-layer-id <id> [--dry-run|--yes] [--json]');
  console.log(
    'npm run catalog -- add-view-layer --file <layer.geojson> [--layer-id <id>] --name-es <name> --name-en <name> --description <text> --category <id> --source-org <org> --source-url <url> [--dry-run|--yes]',
  );
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isCalledDirectly) {
  run().catch((error) => {
    console.error(`[catalog] ${error.message}`);
    process.exit(1);
  });
}
