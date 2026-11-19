import { expect, test } from '@playwright/test';
import {
  approvedAccessControls,
  authenticatorSetupScreen,
  firebaseTotpParameters,
  headerSignInButton,
  headerSignOutButton,
  openAppSignedOut,
  provideTestSignInCredentials,
  readAuthenticatorSetupKey,
  scannerRemovalNoticeScreen,
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

test.describe('FBT-016', () => {
  let factory: TestAccountFactory;
  let scannedUser: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    scannedUser = await factory.create({
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
    "A user whose authenticator disappeared soon after setup sees a notice at sign-in explaining that their organization's email security probably removed it, with next steps.",
    async ({ page }) => {
      test.setTimeout(90_000);
      await narrateCatalogTest('FBT-016');
      const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
      const setupScreen = authenticatorSetupScreen(page);
      const notice = scannerRemovalNoticeScreen(page);

      try {
        await test.step('A user signs in with Google, sets up an authenticator in the app, and gets their approved access', async () => {
          await provideTestSignInCredentials(page, scannedUser);
          await whenServicesRespond(async () => {
            await openAppSignedOut(page);
            await signInWithGoogleThroughTestHook(page);
            await expect(setupScreen.getByRole('img', { name: 'Authenticator QR code' })).toBeVisible();
          });
          const setupKey = await readAuthenticatorSetupKey(page);
          await submitAuthenticatorCode(setupScreen, totpCode(setupKey, firebaseTotpParameters, Date.now()));
          await whenServicesRespond(async () => {
            await expect(setupScreen).toHaveCount(0, { timeout: 20_000 });
          });
          await expect(approvedAccessControls(page).sirapAccessButton).toBeVisible();
        });

        await test.step('Right after setup, the authenticator is removed and every session ended, as an email scanner opening the undo link does', async () => {
          await factory.removeAuthenticatorAndEndSessions(scannedUser.uid);
          const record = await factory.readAsAdmin(`users/${scannedUser.uid}`);
          test.info().annotations.push({
            type: 'diagnostic',
            description: `The users record ${record?.['mfaEnrolledAt'] ? 'holds' : 'does not hold'} a saved setup time.`,
          });
          await headerSignOutButton(page).click();
          await expect(headerSignInButton(page)).toBeVisible();
        });

        await test.step("Signing in again shows a notice, before any setup screen, that the organization's email security probably removed the authenticator", async () => {
          await whenServicesRespond(async () => {
            await signInWithGoogleThroughTestHook(page);
          });
          await expect(notice.getByRole('heading', { name: 'Your authenticator was removed' })).toBeVisible();
          await expect(notice).toContainText(/organization.s email security/);
          await expect(setupScreen).toHaveCount(0);
          await expect(page.getByRole('img', { name: 'Authenticator QR code' })).toHaveCount(0);
        });

        await test.step('The notice lists the next steps: set up again without waiting for the email, ask IT to stop scanning the links, or contact the DISES administrator', async () => {
          const nextSteps = notice.getByRole('listitem');
          await expect(nextSteps.filter({ hasText: /Set up your authenticator again/ })).toHaveCount(1);
          await expect(nextSteps.filter({ hasText: /Set up your authenticator again/ })).toContainText(/email/);
          await expect(nextSteps.filter({ hasText: /IT team/ })).toContainText('dises-decision-making-tool.firebaseapp.com');
          await expect(nextSteps.filter({ hasText: /DISES administrator/ })).toHaveCount(1);
        });

        await test.step('Choosing to set up again from the notice opens the setup screen with a new QR code', async () => {
          await notice.getByRole('button', { name: 'Set up authenticator again' }).click();
          await expect(setupScreen.getByRole('heading', { name: 'Set up authenticator' })).toBeVisible();
          await whenServicesRespond(async () => {
            await expect(setupScreen.getByRole('img', { name: 'Authenticator QR code' })).toBeVisible();
          });
          await expect(notice).toHaveCount(0);
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
