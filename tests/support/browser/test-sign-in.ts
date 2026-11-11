import { expect, type Locator, type Page } from '@playwright/test';
import type { TestAccount } from '../downloads/test-accounts.ts';
import { millisUntilFreshCode, totpCode, type TotpParameters } from '../downloads/totp.ts';

/**
 * Signs a throwaway `@dmt-test.invalid` account into the local web app through the Test Sign-In Hook.
 * The hook exists only in the `e2e` Angular build configuration
 * (frontend/src/app/core/services/test-sign-in-hook.e2e.ts). It reads `window.__dmtTestSignIn` and replaces only
 * Google's popup sign-in; the authenticator setup and code screens that follow are the app's real ones.
 */

/** The window property the Test Sign-In Hook reads. */
interface TestSignInWindow {
  __dmtTestSignIn?: { email: string; password: string };
}

/** Hands the account's email and password to the Test Sign-In Hook before any app script runs, on every page load. */
export async function provideTestSignInCredentials(page: Page, account: TestAccount): Promise<void> {
  await page.addInitScript(
    (credentials) => {
      (window as TestSignInWindow).__dmtTestSignIn = credentials;
    },
    { email: account.email, password: account.password },
  );
}

export const headerSignInButton = (page: Page) =>
  page.getByRole('button', { name: /Iniciar sesión \/ Registrarse|Login \/ Register/ });

export const headerSignOutButton = (page: Page) =>
  page.getByRole('button', { name: /^(Cerrar sesión|Logout)$/ });

/**
 * Approved-only header controls, located by element id so an absence check cannot pass just because the
 * sign-in dialog hides the header from assistive technology while it is open.
 */
export const approvedAccessControls = (page: Page) => ({
  tierChip: page.locator('#foundation-header-auth-tier-chip'),
  sirapAccessButton: page.locator('#foundation-header-sirap-access-button'),
});

export const authenticatorSetupScreen = (page: Page) => page.locator('#auth-modal-mfa-enroll');
export const authenticatorCodeScreen = (page: Page) => page.locator('#auth-modal-mfa-challenge');
export const scannerRemovalNoticeScreen = (page: Page) => page.locator('#auth-modal-scanner-removal-notice');

/** Opens the app signed out and closes the welcome video, which opens on every page load. */
export async function openAppSignedOut(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('dialog', { name: /Vea el recorrido|Watch the walkthrough/ })
    .getByRole('button', { name: /^(Cerrar|Close)$/ })
    .click();
  await expect(headerSignInButton(page)).toBeVisible();
}

/**
 * Opens the sign-in dialog from the header and chooses Continue with Google, then waits for the authenticator
 * setup screen, the code screen, or the email-scanner notice that comes before setup. A build without the Test
 * Sign-In Hook opens Google's real popup instead; that is reported as its own error so it is not mistaken for an
 * app failure.
 */
export async function signInWithGoogleThroughTestHook(page: Page): Promise<void> {
  let googlePopupOpened = false;
  const onPopup = (popup: Page) => {
    googlePopupOpened = true;
    void popup.close().catch(() => undefined);
  };
  page.on('popup', onPopup);
  try {
    await headerSignInButton(page).click();
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(
      authenticatorSetupScreen(page).or(authenticatorCodeScreen(page)).or(scannerRemovalNoticeScreen(page)),
    ).toBeVisible({ timeout: 20_000 });
  } catch (error) {
    if (googlePopupOpened) {
      throw new Error(
        'Continue with Google opened Google\'s sign-in popup, so this app build has no Test Sign-In Hook. ' +
          'Serve the app with the e2e Angular configuration (ng serve --configuration e2e).',
        { cause: error },
      );
    }
    const entryError = page.locator('#auth-modal-entry-error');
    if (await entryError.isVisible()) {
      throw new Error(`The sign-in dialog showed an error: ${await entryError.innerText()}`, { cause: error });
    }
    throw error;
  } finally {
    page.off('popup', onPopup);
  }
}

/**
 * Firebase's authenticator settings for this project, as `TotpMultiFactorGenerator.generateSecret` reports them.
 * The setup screen shows only the key, so a test that sets up an authenticator in the app uses these values.
 */
export const firebaseTotpParameters: TotpParameters = { algorithm: 'SHA1', digits: 6, periodSeconds: 30 };

/**
 * Reads the key the setup screen offers for typing instead of scanning. The key is a secret, so the check
 * reports only whether it looks like a base32 key, never the key itself.
 */
export async function readAuthenticatorSetupKey(page: Page): Promise<string> {
  const keyText = authenticatorSetupScreen(page).locator('#auth-modal-mfa-enroll-secret-value');
  const readKey = async () => (await keyText.innerText()).replace(/\s+/g, '');
  await expect
    .poll(async () => /^[A-Z2-7]{16,}=*$/.test(await readKey()), {
      message: 'the setup screen shows a base32 key to type',
    })
    .toBe(true);
  return readKey();
}

/** Types a 6-digit code into the open setup or code screen and submits it. */
export async function submitAuthenticatorCode(screen: Locator, code: string): Promise<void> {
  await screen.getByLabel('Authentication code').fill(code);
  await screen.getByRole('button', { name: /^Verify( and continue)?$/ }).click();
}

/** Waits until a code from a later window than the last accepted one exists; Firebase rejects a reused code. */
export async function waitForFreshCodeWindow(lastCodeAcceptedAtMs: number, parameters: TotpParameters): Promise<void> {
  const waitMs = millisUntilFreshCode(Date.now(), lastCodeAcceptedAtMs, parameters.periodSeconds);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

/**
 * A 6-digit code that matches none of the codes for the 10 windows before or after now, so no clock-drift
 * allowance Firebase applies can make it valid.
 */
export function wrongAuthenticatorCode(secretKey: string, parameters: TotpParameters, nowMs: number): string {
  const windowMs = parameters.periodSeconds * 1000;
  const nearbyCodes = new Set(
    Array.from({ length: 21 }, (_, index) => totpCode(secretKey, parameters, nowMs + (index - 10) * windowMs)),
  );
  for (let candidate = 0; ; candidate += 1) {
    const code = String(candidate).padStart(parameters.digits, '0');
    if (!nearbyCodes.has(code)) return code;
  }
}
