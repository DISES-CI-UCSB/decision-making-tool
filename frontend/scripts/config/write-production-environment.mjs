import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(frontendRoot, '..');
const productionEnvironmentPath = path.resolve(
  frontendRoot,
  'src/environments/environment.production.ts',
);

const optionalLocalEnvPath = path.resolve(repoRoot, '.env.production.local');

await loadLocalEnvIfPresent(optionalLocalEnvPath);

const firebaseConfig = {
  apiKey: readRequiredEnv('FIREBASE_API_KEY'),
  authDomain: readRequiredEnv('FIREBASE_AUTH_DOMAIN'),
  projectId: readRequiredEnv('FIREBASE_PROJECT_ID'),
  storageBucket: readRequiredEnv('FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readRequiredEnv('FIREBASE_MESSAGING_SENDER_ID'),
  appId: readRequiredEnv('FIREBASE_APP_ID'),
  measurementId: readOptionalEnv('FIREBASE_MEASUREMENT_ID'),
};

const environmentFile = `export const environment = {
  production: true,
  firebase: {
    enabled: true,
    config: ${toTsObjectLiteral(firebaseConfig, 4)},
    accessRequestNotificationEmail: ${toTsString(readOptionalEnv('ACCESS_REQUEST_NOTIFICATION_EMAIL'))},
  },
  googleClientId: ${toTsString(readOptionalEnv('GOOGLE_CLIENT_ID'))},
  manifestBlobUrl: ${toTsString(readOptionalEnv('MANIFEST_BLOB_URL'))},
  blobAssetProxyPath: ${toTsString(readOptionalEnv('BLOB_ASSET_PROXY_PATH') || '/api/blob-proxy/')},
  ENABLE_MANIFEST_EDITOR: ${readBooleanEnv('ENABLE_MANIFEST_EDITOR', false)},
  bypassLoginForDevelopment: false,
  allowSirapWithoutAuth: false,
  // SIRAP layer visibility flags — override via Vercel env vars when ready to enable.
  // SIRAP_LAYER_TERRITORIAL and SIRAP_LAYER_THEMATIC default to false until data
  // is verified production-ready.
  sirapLayers: {
    combined: ${readBooleanEnv('SIRAP_LAYER_COMBINED', true)},
    territorial: ${readBooleanEnv('SIRAP_LAYER_TERRITORIAL', false)},
    thematic: ${readBooleanEnv('SIRAP_LAYER_THEMATIC', false)},
  },
} as const;

export type AppEnvironment = typeof environment;
`;

await writeFile(productionEnvironmentPath, environmentFile, 'utf-8');
console.log('[write-production-environment] wrote Firebase-enabled Angular production environment');

async function loadLocalEnvIfPresent(envPath) {
  let rawEnv;
  try {
    rawEnv = await readFile(envPath, 'utf-8');
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

function readRequiredEnv(key) {
  const value = readOptionalEnv(key);
  if (!value) {
    throw new Error(`${key} is required to build the production Angular environment`);
  }
  return value;
}

function readOptionalEnv(key) {
  return process.env[key]?.trim() ?? '';
}

function readBooleanEnv(key, fallback) {
  const value = readOptionalEnv(key).toLowerCase();
  if (!value) {
    return fallback;
  }
  return ['1', 'true', 'yes'].includes(value);
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

function toTsObjectLiteral(value, indentSpaces) {
  const indent = ' '.repeat(indentSpaces);
  const innerIndent = ' '.repeat(indentSpaces + 2);
  const entries = Object.entries(value)
    .map(([key, entryValue]) => `${innerIndent}${key}: ${toTsString(entryValue)},`)
    .join('\n');
  return `{\n${entries}\n${indent}}`;
}

function toTsString(value) {
  return JSON.stringify(value ?? '');
}
