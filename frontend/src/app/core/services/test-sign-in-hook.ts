import type { signInWithPopup } from 'firebase/auth';

/** Same shape as Firebase's `signInWithPopup`, so the Google sign-in code can call either one. */
export type FirstFactorSignIn = typeof signInWithPopup;

/**
 * Test Sign-In Hook, production stub: always null, so Google's popup is the only first-factor sign-in.
 * Only the `e2e` Angular build configuration replaces this file, with test-sign-in-hook.e2e.ts.
 */
export function testFirstFactorSignIn(): FirstFactorSignIn | null {
  return null;
}
