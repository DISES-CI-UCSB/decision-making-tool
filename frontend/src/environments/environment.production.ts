export const environment = {
  production: true,
  googleClientId: '',
  manifestBlobUrl: '',
  ENABLE_MANIFEST_EDITOR: false,
  allowSirapWithoutAuth: false,
} as const;

export type AppEnvironment = typeof environment;
