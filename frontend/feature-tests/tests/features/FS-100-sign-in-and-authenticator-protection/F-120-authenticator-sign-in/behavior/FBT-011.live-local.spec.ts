import { expect, test } from '@playwright/test';
import {
  approvedAccessControls,
  authenticatorCodeScreen,
  openAppSignedOut,
  provideTestSignInCredentials,
  signInWithGoogleThroughTestHook,
  submitAuthenticatorCode,
  waitForFreshCodeWindow,
  wrongAuthenticatorCode,
} from '../../../../support/browser/test-sign-in.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountAuthenticator,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { totpCode } from '../../../../support/downloads/totp.ts';
import { observeLiveReadiness } from '../../../../support/network/live-readiness.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

/** The app's message for a rejected code (TOTP_RETRY_MESSAGE in frontend/src/app/features/auth/services/totp-mfa.service.ts). */
const wrongCodeMessage = 'That code was incorrect or expired. Try the current 6-digit code.';

test.describe('FBT-011', () => {
  let factory: TestAccountFactory;
  let userWithAuthenticator: TestAccount;
  let authenticator: TestAccountAuthenticator;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    userWithAuthenticator = await factory.create({
      status: 'active',
      role: 'user',
      allowedSirapIds: [],
      authenticator: true,
      signInWithAuthenticator: false,
    });
    if (!userWithAuthenticator.authenticator) throw new Error('The test account was created without an authenticator.');
    authenticator = userWithAuthenticator.authenticator;
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test('Entering a wrong 6-digit code shows an error and does not sign the person in.', async ({ page }) => {
    test.setTimeout(75_000);
    await narrateCatalogTest('FBT-011');
    const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
    const codeScreen = authenticatorCodeScreen(page);
    const { tierChip, sirapAccessButton } = approvedAccessControls(page);

    try {
      await test.step('A user with an authenticator signs in with Google and is asked for their 6-digit code', async () => {
        await provideTestSignInCredentials(page, userWithAuthenticator);
        await whenServicesRespond(async () => {
          await openAppSignedOut(page);
          await signInWithGoogleThroughTestHook(page);
        });
        await expect(codeScreen.getByRole('heading', { name: 'Enter authenticator code' })).toBeVisible();
      });

      await test.step('Entering a wrong code shows the incorrect-code error and keeps the code screen open', async () => {
        const { secretKey, parameters } = authenticator;
        await submitAuthenticatorCode(codeScreen, wrongAuthenticatorCode(secretKey, parameters, Date.now()));
        await whenServicesRespond(async () => {
          await expect(codeScreen.getByRole('alert')).toHaveText(wrongCodeMessage, { timeout: 20_000 });
        });
        await expect(codeScreen.getByLabel('Authentication code')).toBeVisible();
      });

      await test.step('After the wrong code the person is not signed in and has no approved access', async () => {
        // By id: the open dialog hides the header from role queries, which would make a role-based absence check vacuous.
        await expect(page.locator('#foundation-header-logout-button')).toHaveCount(0);
        await expect(page.locator('#foundation-header-auth-toggle-button')).toBeVisible();
        await expect(tierChip).toHaveCount(0);
        await expect(sirapAccessButton).toHaveCount(0);
      });

      await test.step('Entering the right code next signs them in with their approved access', async () => {
        await waitForFreshCodeWindow(authenticator.lastCodeAcceptedAtMs, authenticator.parameters);
        await submitAuthenticatorCode(
          codeScreen,
          totpCode(authenticator.secretKey, authenticator.parameters, Date.now()),
        );
        await whenServicesRespond(async () => {
          await expect(codeScreen).toHaveCount(0, { timeout: 20_000 });
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
  });
});
