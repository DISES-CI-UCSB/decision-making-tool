import { expect, test } from '@playwright/test';
import {
  approvedAccessControls,
  authenticatorSetupScreen,
  firebaseTotpParameters,
  openAppSignedOut,
  provideTestSignInCredentials,
  readAuthenticatorSetupKey,
  signInWithGoogleThroughTestHook,
  submitAuthenticatorCode,
} from '../../../../support/browser/test-sign-in.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { totpCode } from '../../../../support/downloads/totp.ts';
import { observeLiveReadiness } from '../../../../support/network/live-readiness.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-009', () => {
  let factory: TestAccountFactory;
  let newUser: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    newUser = await factory.create({
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
    'A new user who scans the QR code and enters the 6-digit code gets their approved access; until then they stay at public access.',
    async ({ page }) => {
      test.setTimeout(60_000);
      await narrateCatalogTest('FBT-009');
      const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
      const setupScreen = authenticatorSetupScreen(page);
      const { tierChip, sirapAccessButton } = approvedAccessControls(page);

      try {
        await test.step('A new user with an approved account and no authenticator opens the app and signs in with Google', async () => {
          await provideTestSignInCredentials(page, newUser);
          await whenServicesRespond(async () => {
            await openAppSignedOut(page);
            await signInWithGoogleThroughTestHook(page);
          });
        });

        let setupKey = '';
        await test.step('The app asks them to set up an authenticator with a QR code and a key they can type', async () => {
          await expect(setupScreen.getByRole('heading', { name: 'Set up authenticator' })).toBeVisible();
          await whenServicesRespond(async () => {
            await expect(setupScreen.getByRole('img', { name: 'Authenticator QR code' })).toBeVisible();
          });
          setupKey = await readAuthenticatorSetupKey(page);
        });

        await test.step('Until a code is entered, the header offers authenticator setup and shows no approved-access tier or SIRAP access', async () => {
          // The header's setup button appears only after the app has read the account and decided it needs an
          // authenticator, so the absence checks below run after that decision rather than before it.
          await expect(page.locator('#foundation-header-mfa-setup-button')).toBeVisible();
          await expect(tierChip).toHaveCount(0);
          await expect(sirapAccessButton).toHaveCount(0);
        });

        await test.step('Entering the current 6-digit code closes setup and shows their approved access', async () => {
          await submitAuthenticatorCode(setupScreen, totpCode(setupKey, firebaseTotpParameters, Date.now()));
          await whenServicesRespond(async () => {
            await expect(setupScreen).toHaveCount(0, { timeout: 20_000 });
          });
          await expect(tierChip).toHaveText(/^\s*(Tier|Nivel) 2\s*$/);
          await expect(sirapAccessButton).toBeVisible();
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
