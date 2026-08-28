import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadLocalEnv } from './load-local-env.mjs';
import { parseBlobListOutput } from './lib/blob-cli-output.mjs';
import {
  readArtifactVerifications,
  validateManifestArtifactCompleteness,
} from './lib/release-artifacts.mjs';
import { readSolutionCatalog } from './lib/solution-catalog.mjs';
import { validateManifest } from './validate-manifest.mjs';
import {
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
  RUNTIME_MANIFEST_BLOB_PATHNAME,
} from '../shared/runtime-manifest.constants.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';
const DEFAULT_SOURCE_MANIFEST_PATH = path.resolve(
  __dirname,
  '..',
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
);
const DEFAULT_TARGET_PATHNAME = RUNTIME_MANIFEST_BLOB_PATHNAME;
const DEFAULT_ARCHIVE_PREFIX = 'manifest/archive/';
const IMMUTABLE_RELEASE_PREFIX = 'manifest/releases/';

export function parseArgs(rawArgs) {
  const args = {
    sourcePath: DEFAULT_SOURCE_MANIFEST_PATH,
    targetPathname: DEFAULT_TARGET_PATHNAME,
    archivePrefix: DEFAULT_ARCHIVE_PREFIX,
    catalogPath: null,
    artifactInventoryPaths: [],
    confirmReleaseId: null,
    expectedLiveSha256: null,
    confirmCreateFirstPointer: false,
    displayOnly: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }
    if (value === '--source') {
      args.sourcePath = path.resolve(process.cwd(), rawArgs[index + 1] ?? args.sourcePath);
      index += 1;
      continue;
    }
    if (value === '--target') {
      args.targetPathname = rawArgs[index + 1] ?? args.targetPathname;
      index += 1;
      continue;
    }
    if (value === '--archive-prefix') {
      args.archivePrefix = rawArgs[index + 1] ?? args.archivePrefix;
      index += 1;
      continue;
    }
    if (value === '--catalog') {
      const catalogArg = rawArgs[index + 1];
      if (!catalogArg || catalogArg.startsWith('--')) {
        throw new Error('--catalog requires a path');
      }
      args.catalogPath = path.resolve(process.cwd(), catalogArg);
      index += 1;
      continue;
    }
    if (value === '--artifact-inventory') {
      const inventoryArg = rawArgs[index + 1];
      if (!inventoryArg || inventoryArg.startsWith('--')) {
        throw new Error('--artifact-inventory requires a path');
      }
      args.artifactInventoryPaths.push(path.resolve(process.cwd(), inventoryArg));
      index += 1;
      continue;
    }
    if (value === '--confirm-release') {
      args.confirmReleaseId = rawArgs[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === '--expected-live-sha256') {
      const digest = rawArgs[index + 1];
      if (!/^[a-f0-9]{64}$/.test(digest ?? '')) {
        throw new Error('--expected-live-sha256 requires a lowercase SHA-256 digest');
      }
      args.expectedLiveSha256 = digest;
      index += 1;
      continue;
    }
    if (value === '--confirm-create-first-pointer') {
      args.confirmCreateFirstPointer = true;
      continue;
    }
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value === '--display-only') {
      args.displayOnly = true;
    }
  }

  return args;
}

function printUsage() {
  console.log('[publish:layer-manifest] Usage:');
  console.log(
    '  npm --prefix frontend run publish:layer-manifest -- --source <manifest> --catalog <catalog> --artifact-inventory <verification.json> [--artifact-inventory <verification.json> ...] --dry-run',
  );
  console.log(
    '  npm --prefix frontend run publish:layer-manifest -- --source <manifest> --catalog <catalog> --artifact-inventory <verification.json> [--artifact-inventory <verification.json> ...] --confirm-release <releaseId> --expected-live-sha256 <dry-run digest>',
  );
}

async function listBlobByPrefix(token, prefix, limit = 10) {
  const { stdout, stderr } = await execFileAsync('vercel', [
    'blob',
    'list',
    '--rw-token',
    token,
    '--limit',
    String(limit),
    '--prefix',
    prefix,
    '--no-color',
  ]);

  return parseBlobListOutput(`${stdout}\n${stderr}`);
}

export async function putLiveManifest(token, contents, pathname, destinationEtag) {
  const { put } = await import('@vercel/blob');
  return put(pathname, contents, {
    ...createLiveWriteOptions(destinationEtag),
    token,
  });
}

export function createLiveWriteOptions(destinationEtag) {
  return {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: Boolean(destinationEtag),
    ...(destinationEtag ? { ifMatch: destinationEtag } : {}),
    contentType: 'application/json',
  };
}

export function assertFirstPointerCreationConfirmed(currentManifest, confirmed) {
  if (!currentManifest && !confirmed) {
    throw new Error(
      'creating the first live manifest pointer requires --confirm-create-first-pointer and a single release captain',
    );
  }
}

export async function putImmutableBlob(token, contents, pathnameToUpload) {
  const { put } = await import('@vercel/blob');
  return put(pathnameToUpload, contents, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json',
    token,
  });
}

export function toArchivePathname(archivePrefix, timestampIso) {
  const safePrefix = archivePrefix.endsWith('/') ? archivePrefix : `${archivePrefix}/`;
  return `${safePrefix}manifest.${timestampIso.replace(/[:.]/g, '-')}.json`;
}

export function toImmutableReleasePathname(releaseId) {
  return `${IMMUTABLE_RELEASE_PREFIX}${releaseId}/revisions`;
}

export function createManifestRevisionId(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export function toImmutableManifestPathname(releaseId, contents) {
  return `${toImmutableReleasePathname(releaseId)}/${createManifestRevisionId(contents)}.json`;
}

export function assertLiveManifestUnchanged(expected, observed) {
  const useEtag = expected?.etag && observed?.etag;
  const expectedIdentity = expected
    ? `${expected.pathname}:${useEtag ? expected.etag : expected.contentSha256}`
    : 'missing';
  const observedIdentity = observed
    ? `${observed.pathname}:${useEtag ? observed.etag : observed.contentSha256}`
    : 'missing';
  if (expectedIdentity !== observedIdentity) {
    throw new Error('live manifest changed during promotion; retry from a fresh dry run');
  }
}

async function fetchBlobIdentity(blob, token = null) {
  if (!blob) return null;
  const separator = blob.url.includes('?') ? '&' : '?';
  let response;
  try {
    response = await fetchWithRetry(
      `${blob.url}${separator}verify=${Date.now()}-${Math.random()}`,
      {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
      },
    );
  } catch (error) {
    if (!token) throw error;
    const { get } = await import('@vercel/blob');
    const result = await get(blob.pathname, { access: 'public', token });
    if (!result) {
      throw new Error(`failed to read ${blob.pathname}: blob not found`);
    }
    const contents = await new Response(result.stream).text();
    const etag = result.headers.get('etag');
    if (!etag) {
      throw new Error(`failed to obtain an ETag concurrency guard for ${blob.pathname}`);
    }
    return {
      ...blob,
      contents,
      contentSha256: createManifestRevisionId(contents),
      etag,
    };
  }
  if (!response.ok) {
    throw new Error(`failed to read ${blob.pathname}: HTTP ${response.status}`);
  }
  const contents = await response.text();
  const etag = response.headers.get('etag');
  if (!etag) {
    throw new Error(`failed to obtain an ETag concurrency guard for ${blob.pathname}`);
  }
  return {
    ...blob,
    contents,
    contentSha256: createManifestRevisionId(contents),
    etag,
  };
}

async function fetchWithRetry(url, options, attempts = 10) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

export async function readLiveManifestIdentity(token, targetPathname) {
  const matches = await listBlobByPrefix(token, targetPathname, 5);
  const blob = matches.find((entry) => entry.pathname === targetPathname) ?? null;
  if (!blob) return null;
  const beforeDownload = await readLiveManifestHeadIdentity(token, targetPathname);
  const identity = await fetchBlobIdentity(blob, token);
  const afterDownload = await readLiveManifestHeadIdentity(token, targetPathname);
  assertLiveManifestUnchanged(beforeDownload, afterDownload);
  return {
    ...identity,
    etag: afterDownload.etag,
    size: afterDownload.size,
    uploadedAt: afterDownload.uploadedAt,
  };
}

export async function readLiveManifestHeadIdentity(token, targetPathname) {
  const { head } = await import('@vercel/blob');
  try {
    const blob = await head(targetPathname, { token });
    return {
      pathname: blob.pathname,
      etag: blob.etag,
      size: blob.size,
      uploadedAt: blob.uploadedAt,
    };
  } catch (error) {
    if (error?.name === 'BlobNotFoundError' || error?.status === 404 || error?.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function inspectPromotionRemoteState(
  { token, targetPathname, immutablePathname, sourceContents, baselineLiveManifest = null },
  operations = {},
) {
  const readLive = operations.readLiveManifestIdentity ?? readLiveManifestIdentity;
  const readLiveHead = operations.readLiveManifestHeadIdentity ?? readLiveManifestHeadIdentity;
  const listBlobs = operations.listBlobByPrefix ?? listBlobByPrefix;
  const fetchIdentity = operations.fetchBlobIdentity ?? fetchBlobIdentity;
  const currentRemoteManifest = baselineLiveManifest ?? (await readLive(token, targetPathname));
  const immutableMatches = await listBlobs(token, immutablePathname, 5);
  const immutableManifest =
    immutableMatches.find((blob) => blob.pathname === immutablePathname) ?? null;
  if (immutableManifest) {
    const immutableIdentity = await fetchIdentity(immutableManifest, token);
    if (immutableIdentity.contents !== sourceContents) {
      throw new Error(
        `immutable release manifest already exists with different content: ${immutablePathname}`,
      );
    }
  }
  const checkedLiveManifest = baselineLiveManifest
    ? await readLiveHead(token, targetPathname)
    : await readLive(token, targetPathname);
  assertLiveManifestUnchanged(currentRemoteManifest, checkedLiveManifest);
  return { currentRemoteManifest, immutableManifest };
}

export async function publishManifestRevision({
  token,
  sourceContents,
  releaseId,
  targetPathname = DEFAULT_TARGET_PATHNAME,
  archivePrefix = DEFAULT_ARCHIVE_PREFIX,
  expectedLiveManifest = null,
  dryRun = false,
  confirmCreateFirstPointer = false,
}) {
  const immutablePathname = toImmutableManifestPathname(releaseId, sourceContents);
  const { currentRemoteManifest, immutableManifest: existingImmutableManifest } =
    await inspectPromotionRemoteState({
      token,
      targetPathname,
      immutablePathname,
      sourceContents,
      baselineLiveManifest:
        expectedLiveManifest?.contents && expectedLiveManifest?.etag ? expectedLiveManifest : null,
    });
  if (expectedLiveManifest) {
    assertLiveManifestUnchanged(expectedLiveManifest, currentRemoteManifest);
  }

  let immutableManifest = existingImmutableManifest;
  if (dryRun) {
    if (!currentRemoteManifest) {
      console.log(
        '[publish:layer-manifest] dry run: live pointer is absent; creation requires one release captain and --confirm-create-first-pointer',
      );
    }
    console.log(
      `[publish:layer-manifest] dry run: remote checks passed; would preserve ${immutablePathname}, archive ${targetPathname}, and atomically promote the immutable revision`,
    );
    return { currentRemoteManifest, immutablePathname };
  }
  assertFirstPointerCreationConfirmed(currentRemoteManifest, confirmCreateFirstPointer);

  if (immutableManifest) {
    console.log(`[publish:layer-manifest] reusing immutable manifest ${immutablePathname}`);
  } else {
    immutableManifest = await putImmutableBlob(token, sourceContents, immutablePathname);
    console.log(`[publish:layer-manifest] preserved immutable manifest ${immutablePathname}`);
  }

  if (currentRemoteManifest) {
    const archivePathname = toArchivePathname(archivePrefix, new Date().toISOString());
    const archivedManifest = await putImmutableBlob(
      token,
      currentRemoteManifest.contents,
      archivePathname,
    );
    console.log(`[publish:layer-manifest] archived previous manifest to ${archivePathname}`);
    if (archivedManifest.url) {
      console.log(`[publish:layer-manifest] archive URL: ${archivedManifest.url}`);
    }
  } else {
    console.log('[publish:layer-manifest] no previous remote manifest found to archive');
  }

  const liveImmediatelyBeforePromotion = await readLiveManifestHeadIdentity(token, targetPathname);
  assertLiveManifestUnchanged(currentRemoteManifest, liveImmediatelyBeforePromotion);
  const promotedManifest = await putLiveManifest(
    token,
    sourceContents,
    targetPathname,
    currentRemoteManifest?.etag,
  );
  console.log(`[publish:layer-manifest] atomically promoted release to ${targetPathname}`);
  if (promotedManifest.url) {
    console.log(`[publish:layer-manifest] manifest URL: ${promotedManifest.url}`);
  }
  return { currentRemoteManifest, immutablePathname, promotedManifest };
}

export function assertDisplayOnlyRelease(previousManifest, nextManifest) {
  if (!previousManifest) {
    throw new Error('--display-only requires an existing live manifest');
  }
  const project = (manifest) =>
    manifest.solutions.map(({ id, displayUrl, metadataUrl, rasterFile, blobPath, rasterSha256 }) => ({
      id,
      displayUrl,
      metadataUrl,
      rasterFile,
      blobPath,
      rasterSha256,
    }));
  if (JSON.stringify(project(previousManifest)) !== JSON.stringify(project(nextManifest))) {
    throw new Error('--display-only cannot alter solution identities, sources, or metrics');
  }
}

export async function main(rawArgs = process.argv.slice(2)) {
  await loadLocalEnv(path.resolve(__dirname, '..'));
  const args = parseArgs(rawArgs);
  if (args.help) {
    printUsage();
    return;
  }

  await fs.access(args.sourcePath);
  const sourceContents = await fs.readFile(args.sourcePath, 'utf-8');
  const manifest = JSON.parse(sourceContents);
  if (!manifest.releaseId) {
    throw new Error('promotion requires a release manifest with releaseId');
  }
  if (!args.catalogPath) {
    throw new Error('promotion requires --catalog <path>');
  }
  const catalog = await readSolutionCatalog(args.catalogPath);
  await validateManifest(manifest, args.sourcePath, { catalog });
  if (!args.displayOnly) {
    const artifactVerifications = await readArtifactVerifications(
      args.artifactInventoryPaths,
      catalog,
    );
    validateManifestArtifactCompleteness(manifest, artifactVerifications);
  }
  if (args.confirmReleaseId !== manifest.releaseId && !args.dryRun) {
    throw new Error(
      `publishing release "${manifest.releaseId}" requires --confirm-release ${manifest.releaseId}`,
    );
  }
  if (!args.dryRun && !args.expectedLiveSha256 && !args.confirmCreateFirstPointer) {
    throw new Error(
      'publishing requires --expected-live-sha256 from the immediately preceding dry run',
    );
  }
  console.log(
    `[publish:layer-manifest] validated release ${manifest.releaseId} (catalog ${manifest.catalogVersion})`,
  );
  const token = process.env[BLOB_TOKEN_ENV_VAR];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV_VAR} is required`);
  }
  if (args.displayOnly) {
    const currentLiveManifest = await readLiveManifestIdentity(token, args.targetPathname);
    assertDisplayOnlyRelease(
      currentLiveManifest ? JSON.parse(currentLiveManifest.contents) : null,
      manifest,
    );
  }

  const result = await publishManifestRevision({
    token,
    sourceContents,
    releaseId: manifest.releaseId,
    targetPathname: args.targetPathname,
    archivePrefix: args.archivePrefix,
    expectedLiveManifest: args.expectedLiveSha256
      ? {
          pathname: args.targetPathname,
          contentSha256: args.expectedLiveSha256,
        }
      : null,
    dryRun: args.dryRun,
    confirmCreateFirstPointer: args.confirmCreateFirstPointer,
  });
  if (args.dryRun && result.currentRemoteManifest) {
    console.log(
      `[publish:layer-manifest] confirm with --expected-live-sha256 ${result.currentRemoteManifest.contentSha256}`,
    );
  }
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(
      `[publish:layer-manifest] ${(error instanceof Error && error.message) || String(error)}`,
    );
    process.exit(1);
  });
}
