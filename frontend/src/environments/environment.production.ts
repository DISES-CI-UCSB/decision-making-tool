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
  manifestBlobUrl: '',
  blobAssetProxyPath: '',
  metricsApiBaseUrl: '/metrics-api',
  ENABLE_MANIFEST_EDITOR: true,
  bypassLoginForDevelopment: false,
} as const;

export type AppEnvironment = typeof environment;
