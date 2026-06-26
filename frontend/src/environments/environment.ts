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
    // Optional: set this locally after installing Firebase's Trigger Email
    // extension. Empty means access requests are recorded but no email doc is
    // created.
    accessRequestNotificationEmail: '',
  },
  googleClientId: '',
  manifestBlobUrl: '',
  blobAssetProxyPath: '',
  metricsApiBaseUrl: '/metrics-api',
  ENABLE_MANIFEST_EDITOR: true,
  // Keep the real Firebase auth flow active during local development by default.
  bypassLoginForDevelopment: false,
} as const;

export type AppEnvironment = typeof environment;
