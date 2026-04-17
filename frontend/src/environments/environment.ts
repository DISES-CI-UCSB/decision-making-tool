/**
 * Runtime environment config.
 *
 * `googleClientId` — OAuth 2.0 Client ID from Google Cloud Console.
 * Leave empty to run the auth modal with a stubbed Google flow
 * (resolves a fake María Gómez profile after 300 ms so the MVP
 * request-access flow demos end-to-end without external dependencies).
 *
 * TODO: once Google OAuth is registered under a PNNC / Spatial Lab
 * project, populate this value (and the ES build-specific override)
 * and the stub will silently switch off.
 */
export const environment = {
  production: false,
  googleClientId: '',
  // Temporary dev override: keep SIRAP boundaries testable while auth approval
  // flow remains mocked/pending (UCS-181 in progress).
  allowSirapWithoutAuth: true,
} as const;

export type AppEnvironment = typeof environment;
