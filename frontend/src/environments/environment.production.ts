export const environment = {
  production: true,
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
    accessRequestNotificationEmail: '',
  },
  googleClientId: '',
  manifestBlobUrl: '/api/blob-proxy/manifest/manifest.json',
  blobAssetProxyPath: '/api/blob-proxy/',
  ENABLE_MANIFEST_EDITOR: true,
  bypassLoginForDevelopment: false,
  allowSirapWithoutAuth: true,
  // SIRAP layer visibility flags — controls which boundary layer types appear
  // in the sidebar and are registered on the map.
  // Production: only the combined review layer is shown for now.
  // Enable territorial/thematic once their data is fully verified production-ready.
  sirapLayers: {
    combined: true,
    territorial: false,
    thematic: false,
  },
} as const;

export type AppEnvironment = typeof environment;
