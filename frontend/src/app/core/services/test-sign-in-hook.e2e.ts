import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  type Auth,
  type reauthenticateWithPopup,
  type signInWithPopup,
  type User,
} from 'firebase/auth';

/** Declared here, not imported: in the e2e build, './test-sign-in-hook' resolves to this file. */
export type FirstFactorSignIn = typeof signInWithPopup;
export type Reauthentication = typeof reauthenticateWithPopup;

/**
 * Test Sign-In Hook, e2e build only. The `e2e` Angular build configuration swaps this file in for
 * test-sign-in-hook.ts; production builds never contain it (FST-002 scans the production build for this marker).
 */
export const TEST_SIGN_IN_HOOK_MARKER = 'dmt-test-sign-in-hook:e2e-build-only';

/** Addresses the disposable test-account factory creates; `.invalid` can never reach a real inbox. */
const DISPOSABLE_EMAIL = /^dmt-test-[0-9a-f]{16}@dmt-test\.invalid$/;
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

interface TestSignInCredentials {
  email: string;
  password: string;
}

/** Set by Playwright's `page.addInitScript` before the app starts. */
interface TestSignInWindow {
  __dmtTestSignIn?: TestSignInCredentials;
}

/** The test credentials, only when the app runs on this machine and the email is a disposable one. */
function permittedTestCredentials(): TestSignInCredentials | null {
  const credentials = (window as TestSignInWindow).__dmtTestSignIn;
  if (!credentials) {
    return null;
  }
  if (!LOCAL_HOSTNAMES.has(location.hostname) || !DISPOSABLE_EMAIL.test(credentials.email)) {
    console.warn(
      `${TEST_SIGN_IN_HOOK_MARKER}: refused; it runs only on 127.0.0.1 or localhost for @dmt-test.invalid accounts.`,
    );
    return null;
  }
  return credentials;
}

/**
 * Returns a replacement for Google's popup that signs a disposable account in with email and password on the
 * app's own Auth instance, so Firebase's real authenticator challenge reaches the app's real screens.
 * Returns null, and Google's popup is used, unless the app runs on this machine and the email is a disposable one.
 */
export function testFirstFactorSignIn(): FirstFactorSignIn | null {
  const credentials = permittedTestCredentials();
  if (!credentials) {
    return null;
  }
  return (auth: Auth) => signInWithEmailAndPassword(auth, credentials.email, credentials.password);
}

/**
 * Returns a replacement for Google's re-authentication popup that re-authenticates the signed-in disposable
 * account with its email and password, for Firebase's auth/requires-recent-login during authenticator setup.
 * Returns null, and Google's popup is used, under the same conditions as testFirstFactorSignIn.
 */
export function testReauthentication(
  authApi: { reauthenticateWithCredential: typeof reauthenticateWithCredential } = {
    reauthenticateWithCredential,
  },
): Reauthentication | null {
  const credentials = permittedTestCredentials();
  if (!credentials) {
    return null;
  }
  return (user: User) =>
    authApi.reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(credentials.email, credentials.password),
    );
}
