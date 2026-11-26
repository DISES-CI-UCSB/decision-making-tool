import type { LayerLocale } from '../app/core/models';

const defaultLanguage: LayerLocale = 'en';

export const environment = {
  production: false,
  defaultLanguage,
  firebase: {
    enabled: true,
    config: {
      apiKey: 'AIzaSyBlZ0fv5aT5ZSB9GVRAfvmV8mi8fxvf45E',
      authDomain: 'dises-decision-making-tool.firebaseapp.com',
      projectId: 'dises-decision-making-tool',
      storageBucket: 'dises-decision-making-tool.firebasestorage.app',
      messagingSenderId: '961351909896',
      appId: '1:961351909896:web:81b07cc64cfe0ad7e4c7bd',
      measurementId: 'G-EGXWGXG26X',
    },
  },
  googleClientId: '',
  manifestBlobUrl:
    'https://storage.googleapis.com/pnn-priorizando-la-naturaleza-public/releases/catalog-v3-7-1/manifest.json',
  catalogReleaseIndexBlobUrl:
    'https://storage.googleapis.com/pnn-priorizando-la-naturaleza-public/catalog-releases/3.7.1-test-site-stage-b/catalog-release-index.json',
  sirapManifestBlobUrl: '',
  blobAssetProxyPath: '',
  solutionCapabilityOverrides: {
    eco17_estr17_esprep17_runap_omec_iheh2030: { aoiCoverageMetrics: 'v2' },
  },
  metricsApiBaseUrl: '/metrics-api',
  privateLayerBucketUrl: 'https://storage.googleapis.com/pnn-priorizando-la-naturaleza/',
  // Same-origin path to the Private Layer Bucket. Empty reads signed links directly, which needs a bucket CORS rule.
  privateFileProxyPath: '/private-files/',
  // Retired: the manifest style editor is archived; layer appearance in the map layers panel is the supported styling path.
  ENABLE_MANIFEST_EDITOR: false,
  // Keep the real Firebase auth flow active during local development by default.
  bypassLoginForDevelopment: false,
} as const;

export type AppEnvironment = typeof environment;
