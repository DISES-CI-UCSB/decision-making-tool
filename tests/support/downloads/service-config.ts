import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_BLOB_HOST,
  RUNTIME_CATALOG_RELEASE_INDEX_BLOB_URL,
} from '../../../frontend/shared/runtime-manifest.constants.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Where the Blob URL Signing Service tests point. Every value has an environment
 * override, so the same tests can target a local server or the deployed VM.
 */
export const serviceConfig = {
  /** Base URL of the deployed Metrics API that hosts the Blob URL Signing Service. */
  serviceUrl: (process.env.DMT_TEST_SERVICE_URL ?? 'https://api.decision-making-support-tool.xyz').replace(
    /\/+$/,
    '',
  ),
  /** Test-only Firebase Admin key. It stays on the machine running the tests. Never read or logged. */
  adminKeyFile:
    process.env.DMT_TEST_FIREBASE_ADMIN_KEY_FILE ??
    path.join(repositoryRoot, 'dises-decision-making-tool-firebase-adminsdk-fbsvc-e3654dc485.json'),
  /** Public web configuration, copied from frontend/src/environments/environment.ts. Not secret. */
  firebaseWebConfig: {
    apiKey: process.env.DMT_TEST_FIREBASE_API_KEY ?? 'AIzaSyBlZ0fv5aT5ZSB9GVRAfvmV8mi8fxvf45E',
    authDomain: 'dises-decision-making-tool.firebaseapp.com',
    projectId: 'dises-decision-making-tool',
  },
  /**
   * Bucket project's signing key, used only by a Metrics API that a test starts on this machine.
   * Handed to that server by path. Never read or logged by the tests.
   */
  gcsSignerKeyFile:
    process.env.DMT_TEST_GCS_SIGNER_KEY_FILE ??
    path.join(repositoryRoot, 'pnn-priorizando-la-naturaleza_service_account_key.json'),
  /** Python that runs a local Metrics API. Defaults to the backend's own virtual environment. */
  backendPython:
    process.env.DMT_TEST_BACKEND_PYTHON ??
    (process.platform === 'win32'
      ? path.join(repositoryRoot, 'backend', '.venv', 'Scripts', 'python.exe')
      : path.join(repositoryRoot, 'backend', '.venv', 'bin', 'python')),
  /** Port for a Metrics API that a test starts on this machine. */
  localServicePort: Number(process.env.DMT_TEST_LOCAL_SERVICE_PORT ?? 8838),
  bucket: process.env.DMT_TEST_GCS_BUCKET ?? 'pnn-priorizando-la-naturaleza',
  /** Old public Vercel Blob host. A file's address there is this host plus its object key. */
  publicBlobHost: (process.env.DMT_TEST_PUBLIC_BLOB_HOST ?? PUBLIC_BLOB_HOST).replace(/\/+$/, ''),
  /** The catalog release index the production web app loads; it lists every published manifest. */
  catalogReleaseIndexUrl: process.env.DMT_TEST_CATALOG_RELEASE_INDEX_URL ?? RUNTIME_CATALOG_RELEASE_INDEX_BLOB_URL,
  /** Most requests one bulk check keeps in flight at once against a single host. */
  bulkCheckConcurrency: Number(process.env.DMT_TEST_BULK_CHECK_CONCURRENCY ?? 16),
  /**
   * Object keys that the deployed download catalog must contain (national, Orinoquia, Eje Cafetero)
   * and one real bucket object that the catalog must leave out. Verified 2026-10-16 against bucket
   * pnn-priorizando-la-naturaleza and the VM catalog built from the national 3.7.1 and
   * sirap-2026-09-09-v7-endemic manifests.
   */
  objects: {
    national: process.env.DMT_TEST_NATIONAL_OBJECT ?? 'inputs/reference/ramsar/v0.1.0/ramsar.geojson',
    orinoquia:
      process.env.DMT_TEST_ORINOQUIA_OBJECT ??
      'inputs/reference/orinoquia_savannas/v0.1.0/orinoquia_savannas.metadata.json',
    ejeCafetero:
      process.env.DMT_TEST_EJE_CAFETERO_OBJECT ??
      'inputs/reference/eje_cafetero_wetlands/v0.1.0/eje_cafetero_wetlands.metadata.json',
    unlisted: process.env.DMT_TEST_UNLISTED_OBJECT ?? 'releases/catalog-v3-7-1/manifest.json',
  },
} as const;
