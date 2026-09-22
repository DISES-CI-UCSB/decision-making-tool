import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_PRESENCE_KEYS = [
  'hasBlobToken',
  'hasFirebaseProjectId',
  'hasFirebaseServiceAccountJson',
  'hasFirebaseClientEmail',
  'hasFirebasePrivateKey',
  'manifestWritesEnabled',
  'productionManifestWritesEnabled',
];

describe('secrets-probe GET (SEC-07)', () => {
  it('rejects unauthenticated GET without reporting whether publish secrets exist', async () => {
    const previousEnv = {
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
      FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
      FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
      ENABLE_MANIFEST_EDITOR_WRITES: process.env.ENABLE_MANIFEST_EDITOR_WRITES,
      ALLOW_PRODUCTION_MANIFEST_EDITOR_WRITES: process.env.ALLOW_PRODUCTION_MANIFEST_EDITOR_WRITES,
      VERCEL_ENV: process.env.VERCEL_ENV,
    };

    process.env.BLOB_READ_WRITE_TOKEN = 'dummy-blob-token';
    process.env.FIREBASE_PROJECT_ID = 'dummy-project';
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account"}';
    process.env.FIREBASE_CLIENT_EMAIL = 'dummy@example.com';
    process.env.FIREBASE_PRIVATE_KEY = 'dummy-private-key';
    process.env.ENABLE_MANIFEST_EDITOR_WRITES = 'true';
    process.env.ALLOW_PRODUCTION_MANIFEST_EDITOR_WRITES = 'true';
    process.env.VERCEL_ENV = 'production';

    try {
      const handler = await loadPublishHandler();
      const result = await invokeHandler(handler, 'GET');

      assert.equal(result.statusCode, 405);
      assert.equal(result.payload.message, 'Method not allowed');
      for (const key of SECRET_PRESENCE_KEYS) {
        assert.equal(result.payload[key], undefined, `GET must not disclose ${key}`);
      }
      assert.equal(result.payload.vercelEnv, undefined);
    } finally {
      restoreEnv(previousEnv);
    }
  });
});

async function loadPublishHandler() {
  const routePath = path.resolve(frontendRoot, 'api/dev/manifest-style-publish.ts');
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
  const tempRoutePath = path.resolve(frontendRoot, 'api/dev/.secrets-probe-handler.cjs');
  await writeFile(tempRoutePath, transpiled.outputText, 'utf-8');
  try {
    return createRequire(import.meta.url)(tempRoutePath);
  } finally {
    await unlink(tempRoutePath).catch(() => undefined);
  }
}

async function invokeHandler(handler, method) {
  let statusCode = 200;
  let payload = {};
  await handler(
    { method, headers: {}, body: undefined },
    {
      status(nextStatusCode) {
        statusCode = nextStatusCode;
        return this;
      },
      json(nextPayload) {
        payload = nextPayload;
      },
    },
  );
  return { statusCode, payload };
}

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
