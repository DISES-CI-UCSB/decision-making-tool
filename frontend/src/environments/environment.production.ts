export const environment = {
  production: true,
  firebase: {
    enabled: false,
    config: {
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: '',
      measurementId: '',
    },
    accessRequestNotificationEmail: '',
  },
  googleClientId: '',
  manifestBlobUrl: '',
  ENABLE_MANIFEST_EDITOR: false,
  allowSirapWithoutAuth: false,
} as const;

export type AppEnvironment = typeof environment;
