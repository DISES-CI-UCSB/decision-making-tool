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

const existingFirebaseConfig = await readExistingFirebaseConfig(productionEnvironmentPath);

const firebaseConfig = {
  apiKey: readRequiredEnv('FIREBASE_API_KEY', existingFirebaseConfig.apiKey),
  authDomain: readRequiredEnv('FIREBASE_AUTH_DOMAIN', existingFirebaseConfig.authDomain),
  projectId: readRequiredEnv('FIREBASE_PROJECT_ID', existingFirebaseConfig.projectId),
  storageBucket: readRequiredEnv('FIREBASE_STORAGE_BUCKET', existingFirebaseConfig.storageBucket),
  messagingSenderId: readRequiredEnv(
    'FIREBASE_MESSAGING_SENDER_ID',
    existingFirebaseConfig.messagingSenderId,
  ),
  appId: readRequiredEnv('FIREBASE_APP_ID', existingFirebaseConfig.appId),
  measurementId: readOptionalEnv('FIREBASE_MEASUREMENT_ID') || existingFirebaseConfig.measurementId,
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
  blobAssetProxyPath: ${toTsString(readOptionalEnv('BLOB_ASSET_PROXY_PATH'))},
  metricsApiBaseUrl: ${toTsString(readOptionalEnv('METRICS_API_BASE_URL') || '/metrics-api')},
  ENABLE_MANIFEST_EDITOR: ${readBooleanEnv('ENABLE_MANIFEST_EDITOR', false)},
  bypassLoginForDevelopment: false,
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

async function readExistingFirebaseConfig(environmentPath) {
  let environmentSource;
  try {
    environmentSource = await readFile(environmentPath, 'utf-8');
  } catch {
    return {};
  }

  return {
    apiKey: readStringProperty(environmentSource, 'apiKey'),
    authDomain: readStringProperty(environmentSource, 'authDomain'),
    projectId: readStringProperty(environmentSource, 'projectId'),
    storageBucket: readStringProperty(environmentSource, 'storageBucket'),
    messagingSenderId: readStringProperty(environmentSource, 'messagingSenderId'),
    appId: readStringProperty(environmentSource, 'appId'),
    measurementId: readStringProperty(environmentSource, 'measurementId'),
  };
}

function readStringProperty(source, propertyName) {
  const match = source.match(new RegExp(`${propertyName}: ['"]([^'"]*)['"]`));
  return match?.[1] ?? '';
}

function readRequiredEnv(key, fallback = '') {
  const value = readOptionalEnv(key) || fallback;
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
