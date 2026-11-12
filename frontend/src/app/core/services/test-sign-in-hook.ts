import type { reauthenticateWithPopup, signInWithPopup } from 'firebase/auth';

/** Same shape as Firebase's `signInWithPopup`, so the Google sign-in code can call either one. */
export type FirstFactorSignIn = typeof signInWithPopup;
/** Same shape as Firebase's `reauthenticateWithPopup`, so the Google re-authentication code can call either one. */
export type Reauthentication = typeof reauthenticateWithPopup;

/**
 * Test Sign-In Hook, production stub: always null, so Google's popup is the only first-factor sign-in.
 * Only the `e2e` Angular build configuration replaces this file, with test-sign-in-hook.e2e.ts.
 */
export function testFirstFactorSignIn(): FirstFactorSignIn | null {
  return null;
}

/** Production stub: always null, so Google's popup is the only re-authentication. */
export function testReauthentication(): Reauthentication | null {
  return null;
}
