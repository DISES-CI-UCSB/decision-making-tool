import { expect, test } from '@playwright/test';
import {
  approvedAccessControls,
  authenticatorCodeScreen,
  authenticatorSetupScreen,
  firebaseTotpParameters,
  headerSignInButton,
  headerSignOutButton,
  openAppSignedOut,
  provideTestSignInCredentials,
  readAuthenticatorSetupKey,
  signInWithGoogleThroughTestHook,
  submitAuthenticatorCode,
  waitForFreshCodeWindow,
} from '../../../../support/browser/test-sign-in.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { totpCode } from '../../../../support/downloads/totp.ts';
import { observeLiveReadiness } from '../../../../support/network/live-readiness.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-010', () => {
  let factory: TestAccountFactory;
  let returningUser: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    returningUser = await factory.create({
      status: 'active',
      role: 'user',
      allowedSirapIds: [],
      authenticator: false,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    'After signing out, a user with an authenticator is asked only for the 6-digit code, not a new QR code.',
    async ({ page }) => {
      test.setTimeout(90_000);
      await narrateCatalogTest('FBT-010');
      const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
      const setupScreen = authenticatorSetupScreen(page);
      const codeScreen = authenticatorCodeScreen(page);
      const { tierChip, sirapAccessButton } = approvedAccessControls(page);

      try {
        let setupKey = '';
        let lastCodeAcceptedAtMs = 0;
        await test.step('A user signs in with Google, sets up an authenticator, and gets their approved access', async () => {
          await provideTestSignInCredentials(page, returningUser);
          await whenServicesRespond(async () => {
            await openAppSignedOut(page);
            await signInWithGoogleThroughTestHook(page);
            await expect(setupScreen.getByRole('img', { name: 'Authenticator QR code' })).toBeVisible();
          });
          setupKey = await readAuthenticatorSetupKey(page);
          lastCodeAcceptedAtMs = Date.now();
          await submitAuthenticatorCode(setupScreen, totpCode(setupKey, firebaseTotpParameters, lastCodeAcceptedAtMs));
          await whenServicesRespond(async () => {
            await expect(setupScreen).toHaveCount(0, { timeout: 20_000 });
          });
          await expect(sirapAccessButton).toBeVisible();
        });

        await test.step('The user signs out from the header and is back to public access', async () => {
          await headerSignOutButton(page).click();
          await expect(headerSignInButton(page)).toBeVisible();
          await expect(tierChip).toHaveCount(0);
          await expect(sirapAccessButton).toHaveCount(0);
        });

        await test.step('Signing in with Google again asks only for the 6-digit code, with no QR code or setup key', async () => {
          await whenServicesRespond(async () => {
            await signInWithGoogleThroughTestHook(page);
          });
          await expect(codeScreen.getByRole('heading', { name: 'Enter authenticator code' })).toBeVisible();
          await expect(codeScreen.getByLabel('Authentication code')).toBeVisible();
          await expect(setupScreen).toHaveCount(0);
          await expect(page.getByRole('img', { name: 'Authenticator QR code' })).toHaveCount(0);
          await expect(page.locator('#auth-modal-mfa-enroll-secret-value')).toHaveCount(0);
          await expect(tierChip).toHaveCount(0);
        });

        await test.step('Entering the next 6-digit code from the same authenticator restores their approved access', async () => {
          await waitForFreshCodeWindow(lastCodeAcceptedAtMs, firebaseTotpParameters);
          await submitAuthenticatorCode(codeScreen, totpCode(setupKey, firebaseTotpParameters, Date.now()));
          await whenServicesRespond(async () => {
            await expect(codeScreen).toHaveCount(0, { timeout: 20_000 });
          });
          await expect(tierChip).toHaveText(/^\s*(Tier|Nivel) 2\s*$/);
          await expect(sirapAccessButton).toBeVisible();
          await expect(setupScreen).toHaveCount(0);
        });
      } finally {
        await test.info().attach('live network summary', {
          body: JSON.stringify(networkSummary(), null, 2),
          contentType: 'application/json',
        });
      }
    },
  );
});
