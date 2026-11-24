import { randomBytes } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  getAuth,
  getMultiFactorResolver,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
} from 'firebase/auth';
import { serviceConfig } from '../downloads/service-config.ts';
import type { TestAccount } from '../downloads/test-accounts.ts';
import { totpCode } from '../downloads/totp.ts';
import { approvedAccessControls, waitForFreshCodeWindow } from './test-sign-in.ts';

/**
 * Signs a throwaway `@dmt-test.invalid` account into a DEPLOYED web app, which has no Test Sign-In Hook.
 *
 * The test signs the account in outside the browser (email and password, then the authenticator's second-factor
 * code) with the Firebase client library, takes the saved sign-in (`user.toJSON()`), and writes it into the site's
 * own browser storage exactly where the app's Firebase library keeps it: IndexedDB database
 * `firebaseLocalStorageDb`, object store `firebaseLocalStorage`, key `firebase:authUser:<apiKey>:[DEFAULT]`.
 * After a reload the app finds that saved sign-in and shows the account as signed in. The apiKey must be the one
 * the deployed build uses (it is the same Firebase web key as `serviceConfig.firebaseWebConfig.apiKey`).
 *
 * The saved sign-in holds tokens, so it is never logged, and a Playwright trace of these tests stays local.
 */

const savedSignInDatabase = 'firebaseLocalStorageDb';
const savedSignInStore = 'firebaseLocalStorage';

/** A small same-origin document; it opens fast, runs none of the app, and gives the page the site's storage. */
const sameOriginDocumentPath = '/favicon.ico';

export interface DeployedSiteSignIn {
  /** The account's second-factor Firebase ID token. A secret; never log it. */
  idToken: string;
}

/** Opens a lightweight page on the site's own origin, so `page.evaluate` runs with that Origin and storage. */
export async function openSameOriginDocument(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL.replace(/\/+$/, '')}${sameOriginDocumentPath}`);
}

/** Email-and-password sign-in, then the authenticator code, in Node. Returns the user's saved sign-in. */
async function signInOutsideBrowser(account: TestAccount): Promise<{ saved: Record<string, unknown>; idToken: string }> {
  const authenticator = account.authenticator;
  if (!authenticator) throw new Error('The account was created without an authenticator.');
  const app = initializeApp(serviceConfig.firebaseWebConfig, `dmt-deployed-sign-in-${randomBytes(4).toString('hex')}`);
  const auth = getAuth(app);
  try {
    // Firebase rejects a code it has already accepted, so use the next code window.
    await waitForFreshCodeWindow(authenticator.lastCodeAcceptedAtMs, authenticator.parameters);
    let challenge: unknown = null;
    try {
      await signInWithEmailAndPassword(auth, account.email, account.password);
    } catch (error) {
      challenge = error;
    }
    if ((challenge as { code?: string } | null)?.code !== 'auth/multi-factor-auth-required') {
      throw new Error('Sign-in did not ask for the authenticator code.');
    }
    const resolver = getMultiFactorResolver(auth, challenge as never);
    const hint = resolver.hints.find((candidate) => candidate.factorId === 'totp');
    if (!hint) throw new Error('The sign-in challenge offered no authenticator factor.');
    const { user } = await resolver.resolveSignIn(
      TotpMultiFactorGenerator.assertionForSignIn(
        hint.uid,
        totpCode(authenticator.secretKey, authenticator.parameters, Date.now()),
      ),
    );
    // The app's own Firebase app is the default one, and its saved sign-in is keyed and named for it.
    const saved = { ...(user.toJSON() as Record<string, unknown>), appName: '[DEFAULT]' };
    return { saved, idToken: await user.getIdToken() };
  } finally {
    await signOut(auth).catch(() => undefined);
    await deleteApp(app).catch(() => undefined);
  }
}

/** Writes the saved sign-in where the app's Firebase library reads it. Runs on the site's origin. */
async function writeSavedSignIn(page: Page, key: string, saved: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ database, store, recordKey, value }) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open(database, 1);
        opening.onupgradeneeded = () => {
          if (!opening.result.objectStoreNames.contains(store)) {
            opening.result.createObjectStore(store, { keyPath: 'fbase_key' });
          }
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const transaction = db.transaction(store, 'readwrite');
          transaction.objectStore(store).put({ fbase_key: recordKey, value });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    { database: savedSignInDatabase, store: savedSignInStore, recordKey: key, value: saved },
  );
}

/**
 * Signs the account in outside the browser, saves that sign-in in the site's storage, reloads the app, closes the
 * welcome video, switches the deployed (Spanish by default) app to English, and waits until the header offers SIRAP
 * access, the signed-in state. Leaves the page on the app's home view.
 */
export async function signInDeployedSite(page: Page, baseURL: string, account: TestAccount): Promise<DeployedSiteSignIn> {
  const { saved, idToken } = await signInOutsideBrowser(account);
  await openSameOriginDocument(page, baseURL);
  await writeSavedSignIn(page, `firebase:authUser:${serviceConfig.firebaseWebConfig.apiKey}:[DEFAULT]`, saved);

  await page.goto('/');
  const welcomeVideo = page.getByRole('dialog', { name: /Vea el recorrido|Watch the walkthrough/ });
  await welcomeVideo.getByRole('button', { name: /^(Cerrar|Close)$/ }).click();
  const switchToEnglish = page.locator('#foundation-header-language-toggle-link-en');
  if (await switchToEnglish.isVisible()) await switchToEnglish.click();
  await expect(approvedAccessControls(page).sirapAccessButton, 'the app shows the injected sign-in').toBeVisible({
    timeout: 30_000,
  });
  return { idToken };
}
