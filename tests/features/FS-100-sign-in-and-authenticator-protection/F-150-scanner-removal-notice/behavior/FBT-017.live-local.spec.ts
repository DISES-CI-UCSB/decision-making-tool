import { expect, test } from '@playwright/test';
import {
  authenticatorSetupScreen,
  openAppSignedOut,
  provideTestSignInCredentials,
  scannerRemovalNoticeScreen,
  signInWithGoogleThroughTestHook,
} from '../../../../support/browser/test-sign-in.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { observeLiveReadiness } from '../../../../support/network/live-readiness.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-017', () => {
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

  test('A user who never set up an authenticator does not see the email-scanner notice.', async ({ page }) => {
    test.setTimeout(60_000);
    await narrateCatalogTest('FBT-017');
    const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
    const setupScreen = authenticatorSetupScreen(page);

    try {
      await test.step('The account has never set up an authenticator and has no saved setup time', async () => {
        const record = await factory.readAsAdmin(`users/${newUser.uid}`);
        expect(record).toBeDefined();
        expect(record).not.toHaveProperty('mfaEnrolledAt');
      });

      await test.step('The user opens the app and signs in with Google', async () => {
        await provideTestSignInCredentials(page, newUser);
        await whenServicesRespond(async () => {
          await openAppSignedOut(page);
          await signInWithGoogleThroughTestHook(page);
        });
      });

      await test.step('The app goes straight to authenticator setup with a QR code, and no email-scanner notice appears', async () => {
        await expect(setupScreen.getByRole('heading', { name: 'Set up authenticator' })).toBeVisible();
        await whenServicesRespond(async () => {
          await expect(setupScreen.getByRole('img', { name: 'Authenticator QR code' })).toBeVisible();
        });
        // The notice would come before setup, so once the QR code shows the app has already decided against it.
        await expect(scannerRemovalNoticeScreen(page)).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Your authenticator was removed' })).toHaveCount(0);
        await expect(page.getByText(/email security/)).toHaveCount(0);
      });
    } finally {
      await test.info().attach('live network summary', {
        body: JSON.stringify(networkSummary(), null, 2),
        contentType: 'application/json',
      });
    }
  });
});
