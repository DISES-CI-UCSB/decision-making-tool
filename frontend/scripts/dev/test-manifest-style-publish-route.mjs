import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const frontendRoot = path.resolve(import.meta.dirname, '../..');
const repoRoot = path.resolve(frontendRoot, '..');

await loadEnv(path.resolve(repoRoot, '.env.local'));
await loadEnv(path.resolve(repoRoot, '.env.production.local'));
await loadEnv(path.resolve(frontendRoot, '.env.local'));

const routeUrl = await transpileRouteToTempFile(
  path.resolve(frontendRoot, 'api/dev/manifest-style-publish.ts'),
);
const requireRoute = createRequire(import.meta.url);
const handler = requireRoute(routeUrl);

const method = process.argv.includes('--post') ? 'POST' : 'GET';
const requestId = readArgValue('--request-id');
const idToken = process.env.FIREBASE_ID_TOKEN?.trim() ?? '';

const req = {
  method,
  headers: idToken ? { authorization: `Bearer ${idToken}` } : {},
  body: method === 'POST' ? { requestId } : undefined,
};

const res = {
  statusCode: 200,
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(payload) {
    console.log(JSON.stringify({ statusCode: this.statusCode, payload }, null, 2));
  },
};

await handler(req, res);

async function transpileRouteToTempFile(routePath) {
  const source = await readFile(routePath, 'utf-8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
    },
    fileName: routePath,
  });
  const tempRoot = path.resolve(frontendRoot, '.angular/tmp');
  await mkdir(tempRoot, { recursive: true });
  const tempDirectory = await mkdtemp(path.join(tempRoot, 'manifest-style-publish-route-'));
  const tempRoutePath = path.resolve(tempDirectory, 'manifest-style-publish.cjs');
  await writeFile(tempRoutePath, transpiled.outputText, 'utf-8');
  return tempRoutePath;
}

async function loadEnv(filePath) {
  let rawEnv;
  try {
    rawEnv = await readFile(filePath, 'utf-8');
  } catch {
    return;
  }

  for (const line of rawEnv.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const [rawKey, ...rawValueParts] = trimmed.split('=');
    const key = rawKey.trim();
    const value = unquoteEnvValue(rawValueParts.join('=').trim());
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return process.argv[index + 1] ?? '';
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
