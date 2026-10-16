import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  bucket: process.env.DMT_TEST_GCS_BUCKET ?? 'pnn-priorizando-la-naturaleza',
  /**
   * Object keys that the deployed download catalog must contain (national, Orinoquia, Eje Cafetero)
   * and one real bucket object that the catalog must leave out.
   */
  objects: {
    national: process.env.DMT_TEST_NATIONAL_OBJECT ?? 'releases/catalog-v3-7-0/manifest.json',
    orinoquia: process.env.DMT_TEST_ORINOQUIA_OBJECT ?? 'releases/catalog-v3-7-1/manifest.json',
    ejeCafetero:
      process.env.DMT_TEST_EJE_CAFETERO_OBJECT ?? 'catalog-releases/3.7.1/catalog-release-index.json',
    unlisted: process.env.DMT_TEST_UNLISTED_OBJECT ?? 'releases/catalog-v3-2-0/manifest.json',
  },
} as const;
