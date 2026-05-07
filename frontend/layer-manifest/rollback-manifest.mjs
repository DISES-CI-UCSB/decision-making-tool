import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadLocalEnv } from './load-local-env.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ARCHIVE_PREFIX = 'manifests/archive/';
const DEFAULT_LIMIT = 50;
const DEFAULT_TARGET_PATH = 'manifests/manifest.json';
const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';

function parseBlobListOutput(output) {
  const blobs = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Vercel CLI') || trimmed.startsWith('Fetching blobs')) {
      continue;
    }
    if (trimmed.startsWith('Uploaded At') || trimmed.startsWith('> To display')) {
      continue;
    }

    const match = trimmed.match(/^\S+\s+(\d+)\s+(\S+)\s+(https:\/\/\S+)$/);
    if (!match) {
      continue;
    }

    blobs.push({
      bytes: Number(match[1]),
      pathname: match[2],
      url: match[3],
    });
  }

  return blobs;
}

function parseArgs(rawArgs) {
  const args = {
    prefix: DEFAULT_ARCHIVE_PREFIX,
    limit: DEFAULT_LIMIT,
    use: null,
    to: DEFAULT_TARGET_PATH,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }
    if (value === '--prefix') {
      args.prefix = rawArgs[index + 1] ?? args.prefix;
      index += 1;
      continue;
    }
    if (value === '--limit') {
      const nextValue = Number(rawArgs[index + 1]);
      if (Number.isFinite(nextValue) && nextValue > 0) {
        args.limit = Math.floor(nextValue);
      }
      index += 1;
      continue;
    }
    if (value === '--use') {
      args.use = rawArgs[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === '--to') {
      args.to = rawArgs[index + 1] ?? args.to;
      index += 1;
      continue;
    }
  }

  return args;
}

function printUsage() {
  console.log('[rollback:layer-manifest] Usage:');
  console.log('  npm --prefix frontend run rollback:layer-manifest');
  console.log('  npm --prefix frontend run rollback:layer-manifest -- --use <index|pathname|url>');
  console.log('  npm --prefix frontend run rollback:layer-manifest -- --use 0 --to manifests/manifest.json');
}

async function listArchiveBlobs(token, prefix, limit) {
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

  return parseBlobListOutput(`${stdout}\n${stderr}`)
    .filter((blob) => blob.pathname.endsWith('.json'))
    .sort((a, b) => b.pathname.localeCompare(a.pathname));
}

function resolveSelectedBlob(blobs, useValue) {
  if (!useValue) {
    return null;
  }

  if (/^\d+$/.test(useValue)) {
    const index = Number(useValue);
    return blobs[index] ?? null;
  }

  return blobs.find((blob) => blob.pathname === useValue || blob.url === useValue) ?? null;
}

function extractUrl(output) {
  const match = output.match(/https:\/\/\S+/);
  return match ? match[0] : null;
}

async function copyBlob(token, fromUrlOrPathname, toPathname) {
  const { stdout, stderr } = await execFileAsync('vercel', [
    'blob',
    'copy',
    fromUrlOrPathname,
    toPathname,
    '--rw-token',
    token,
    '--no-color',
  ]);

  const output = `${stdout}\n${stderr}`;
  return {
    output,
    copiedUrl: extractUrl(output),
  };
}

async function main() {
  await loadLocalEnv(path.resolve(__dirname, '..'));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const token = process.env[BLOB_TOKEN_ENV_VAR];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV_VAR} is required to list/copy archived manifests`);
  }

  const archivedBlobs = await listArchiveBlobs(token, args.prefix, args.limit);
  if (archivedBlobs.length === 0) {
    console.log(`[rollback:layer-manifest] No archived manifests found for prefix "${args.prefix}"`);
    return;
  }

  console.log(
    `[rollback:layer-manifest] Found ${archivedBlobs.length} archived manifest(s) under "${args.prefix}"`,
  );
  archivedBlobs.forEach((blob, index) => {
    console.log(`[rollback:layer-manifest] [${index}] ${blob.pathname} (${blob.bytes} bytes)`);
    console.log(`[rollback:layer-manifest]      ${blob.url}`);
  });

  if (!args.use) {
    console.log('[rollback:layer-manifest] Pass --use <index|pathname|url> to republish one archive.');
    return;
  }

  const selected = resolveSelectedBlob(archivedBlobs, args.use);
  if (!selected) {
    throw new Error(`Could not resolve --use "${args.use}" to a listed archive entry`);
  }

  const { copiedUrl } = await copyBlob(token, selected.url, args.to);
  console.log(`[rollback:layer-manifest] Republished archive to pathname "${args.to}"`);
  console.log(`[rollback:layer-manifest] Source archive: ${selected.url}`);
  if (copiedUrl) {
    console.log(`[rollback:layer-manifest] New manifest URL: ${copiedUrl}`);
  }
}

main().catch((error) => {
  console.error(`[rollback:layer-manifest] ${(error instanceof Error && error.message) || String(error)}`);
  process.exit(1);
});
