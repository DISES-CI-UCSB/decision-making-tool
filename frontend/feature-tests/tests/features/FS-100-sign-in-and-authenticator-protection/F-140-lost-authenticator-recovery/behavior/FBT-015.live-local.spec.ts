import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  approvedAccessControls,
  authenticatorCodeScreen,
  authenticatorSetupScreen,
  firebaseTotpParameters,
  headerSignOutButton,
  openAppSignedOut,
  provideTestSignInCredentials,
  readAuthenticatorSetupKey,
  signInWithGoogleThroughTestHook,
  submitAuthenticatorCode,
  waitForFreshCodeWindow,
} from '../../../../support/browser/test-sign-in.ts';
import {
  startLocalSigningService,
  type LocalSigningService,
} from '../../../../support/downloads/local-signing-service.ts';
import { requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
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

function authenticatorOf(account: TestAccount): TestAccountAuthenticator {
  if (!account.authenticator) throw new Error('The test account was created without an authenticator.');
  return account.authenticator;
}

/**
 * The old authenticator's current code, or null in the rare window where it equals a code the new key accepts
 * (one window either side of now), because then a refusal would not prove the old key stopped working.
 */
function oldAuthenticatorCodeUnlikeNewKey(
  oldAuthenticator: TestAccountAuthenticator,
  newSetupKey: string,
  nowMs: number,
): string | null {
  const windowMs = firebaseTotpParameters.periodSeconds * 1000;
  const newKeyCodes = new Set(
    [-1, 0, 1].map((offset) => totpCode(newSetupKey, firebaseTotpParameters, nowMs + offset * windowMs)),
  );
  const oldCode = totpCode(oldAuthenticator.secretKey, oldAuthenticator.parameters, nowMs);
  return newKeyCodes.has(oldCode) ? null : oldCode;
}

/** Calls the Metrics API's reset endpoint directly, as a script holding someone's sign-in token could. */
async function requestAuthenticatorReset(
  request: APIRequestContext,
  serviceUrl: string,
  targetUid: string,
  idToken: string,
): Promise<{ status: number; reason: string | undefined }> {
  const response = await request.post(`${serviceUrl}/admin/users/${encodeURIComponent(targetUid)}/reset-authenticator`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const body = (await response.json().catch(() => null)) as { detail?: { status?: string } } | null;
  return { status: response.status(), reason: body?.detail?.status };
}

/**
 * The page server proxies /metrics-api to the deployed Metrics API. Admin requests go to the local Metrics API
 * instead, so the browser exercises this checkout's backend together with this checkout's web app.
 */
async function sendAdminRequestsToLocalService(page: Page, serviceUrl: string): Promise<void> {
  await page.route('**/metrics-api/admin/**', async (route) => {
    const { pathname, search } = new URL(route.request().url());
    const response = await route.fetch({ url: `${serviceUrl}${pathname.replace(/^\/metrics-api/, '')}${search}` });
    await route.fulfill({ response });
  });
}

test.describe('FBT-015', () => {
  let factory: TestAccountFactory;
  let localService: LocalSigningService | undefined;
  let superAdmin: TestAccount;
  let superAdminWithoutAuthenticator: TestAccount;
  let regionalAdmin: TestAccount;
  let personWhoLostTheirPhone: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    localService = await startLocalSigningService({ signedUrlTtlSeconds: 900 });
    factory = createTestAccountFactory();
    [superAdmin, superAdminWithoutAuthenticator, regionalAdmin, personWhoLostTheirPhone] = await Promise.all([
      factory.create({
        status: 'active',
        role: 'super-admin',
        allowedSirapIds: [],
        authenticator: true,
        signInWithAuthenticator: false,
      }),
      factory.create({ status: 'active', role: 'super-admin', allowedSirapIds: [], authenticator: false }),
      factory.create({
        status: 'active',
        role: 'sirap-admin',
        allowedSirapIds: ['orinoquia'],
        administeredSirapIds: ['orinoquia'],
        authenticator: true,
      }),
      factory.create({
        status: 'active',
        role: 'user',
        allowedSirapIds: [],
        authenticator: true,
        signInWithAuthenticator: false,
      }),
    ]);
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
    await localService?.stop();
  });

  test(
    "After an admin resets someone's authenticator, their next sign-in asks for a new one, and codes from the old one stop working.",
    async ({ page, browser, request }) => {
      test.setTimeout(150_000);
      await narrateCatalogTest('FBT-015');
      if (!localService) throw new Error('The local Metrics API did not start.');
      const serviceUrl = localService.url;
      const oldAuthenticator = authenticatorOf(personWhoLostTheirPhone);
      const adminReadiness = observeLiveReadiness(page);
      const personContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
      const personPage = await personContext.newPage();
      const personReadiness = observeLiveReadiness(personPage);

      try {
        await test.step('A regional admin and a super-admin signed in without an authenticator are both refused a reset, and the person stays signed in', async () => {
          const byRegionalAdmin = await requestAuthenticatorReset(
            request,
            serviceUrl,
            personWhoLostTheirPhone.uid,
            regionalAdmin.idToken,
          );
          expect(byRegionalAdmin.status, `refusal reason: ${byRegionalAdmin.reason}`).toBe(403);
          const withoutAuthenticator = await requestAuthenticatorReset(
            request,
            serviceUrl,
            personWhoLostTheirPhone.uid,
            superAdminWithoutAuthenticator.idToken,
          );
          expect(withoutAuthenticator.status, `refusal reason: ${withoutAuthenticator.reason}`).toBe(403);
          const stillSignedIn = await requestSignedUrl(
            request,
            serviceConfig.objects.national,
            personWhoLostTheirPhone.idToken,
            serviceUrl,
          );
          expect(stillSignedIn.status, `refusal reason: ${stillSignedIn.body?.detail?.status}`).toBe(200);
        });

        await test.step('A super-admin signs in with their authenticator and opens the person in Access management', async () => {
          const adminAuthenticator = authenticatorOf(superAdmin);
          await sendAdminRequestsToLocalService(page, serviceUrl);
          await provideTestSignInCredentials(page, superAdmin);
          await adminReadiness.whenServicesRespond(async () => {
            await openAppSignedOut(page);
            await signInWithGoogleThroughTestHook(page);
          });
          const codeScreen = authenticatorCodeScreen(page);
          await waitForFreshCodeWindow(adminAuthenticator.lastCodeAcceptedAtMs, adminAuthenticator.parameters);
          await submitAuthenticatorCode(
            codeScreen,
            totpCode(adminAuthenticator.secretKey, adminAuthenticator.parameters, Date.now()),
          );
          const usersSection = page.locator('#admin-access-panel-users-section');
          const personToggle = page.locator(`#admin-access-panel-user-toggle-${personWhoLostTheirPhone.uid}`);
          await adminReadiness.whenServicesRespond(async () => {
            await expect(codeScreen).toHaveCount(0, { timeout: 20_000 });
            await page.locator('#foundation-header-admin-access-button').click();
            // The panel can re-render while the new sign-in's access profile settles, which resets its tab and search.
            await expect(async () => {
              await page.getByRole('tab', { name: 'Active Users' }).click({ timeout: 5_000 });
              await usersSection.getByRole('searchbox', { name: 'Search by name' }).fill(personWhoLostTheirPhone.email);
              if ((await personToggle.getAttribute('aria-expanded', { timeout: 5_000 })) !== 'true') {
                await personToggle.click({ timeout: 5_000 });
              }
              await expect(personToggle).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
            }).toPass({ timeout: 45_000 });
          });
        });

        await test.step('Clicking Reset authenticator asks the super-admin to confirm the person\'s identity first, then reports the reset', async () => {
          const personCard = page.locator(`#admin-access-panel-user-card-${personWhoLostTheirPhone.uid}`);
          let confirmMessage = '';
          page.once('dialog', (dialog) => {
            confirmMessage = dialog.message();
            void dialog.accept();
          });
          await personCard.getByRole('button', { name: /^(Reset authenticator|Restablecer autenticador)$/ }).click();
          await expect
            .poll(() => confirmMessage, { message: 'a confirmation dialog opens before the reset' })
            .not.toBe('');
          expect(confirmMessage).toContain(personWhoLostTheirPhone.email);
          expect(confirmMessage).toMatch(/registered email|correo electrónico registrado/);
          expect(confirmMessage).toMatch(/phone or video call|llamada telefónica o videollamada/);
          await expect(personCard.getByRole('status')).toHaveText(
            /Authenticator reset|Autenticador restablecido/,
            { timeout: 20_000 },
          );
        });

        await test.step("The person's earlier sign-in has ended", async () => {
          const afterReset = await requestSignedUrl(
            request,
            serviceConfig.objects.national,
            personWhoLostTheirPhone.idToken,
            serviceUrl,
          );
          expect(afterReset.status, `refusal reason: ${afterReset.body?.detail?.status}`).toBe(401);
        });

        let newSetupKey = '';
        let newCodeAcceptedAtMs = 0;
        await test.step("The person's next sign-in shows authenticator setup with a new key, not the code screen", async () => {
          await provideTestSignInCredentials(personPage, personWhoLostTheirPhone);
          await personReadiness.whenServicesRespond(async () => {
            await openAppSignedOut(personPage);
            await signInWithGoogleThroughTestHook(personPage);
          });
          const setupScreen = authenticatorSetupScreen(personPage);
          await expect(setupScreen.getByRole('img', { name: 'Authenticator QR code' })).toBeVisible();
          await expect(authenticatorCodeScreen(personPage)).toHaveCount(0);
          newSetupKey = await readAuthenticatorSetupKey(personPage);
          expect(newSetupKey === oldAuthenticator.secretKey, 'the setup screen offers a new key').toBe(false);
          newCodeAcceptedAtMs = Date.now();
          await submitAuthenticatorCode(setupScreen, totpCode(newSetupKey, firebaseTotpParameters, newCodeAcceptedAtMs));
          await personReadiness.whenServicesRespond(async () => {
            await expect(setupScreen).toHaveCount(0, { timeout: 20_000 });
          });
          await expect(approvedAccessControls(personPage).sirapAccessButton).toBeVisible();
        });

        await test.step('After signing out and back in, a code from the old authenticator is refused and the person stays at public access', async () => {
          await headerSignOutButton(personPage).click();
          await personReadiness.whenServicesRespond(async () => {
            await signInWithGoogleThroughTestHook(personPage);
          });
          const codeScreen = authenticatorCodeScreen(personPage);
          await expect(codeScreen.getByRole('heading', { name: 'Enter authenticator code' })).toBeVisible();
          let oldCode = oldAuthenticatorCodeUnlikeNewKey(oldAuthenticator, newSetupKey, Date.now());
          while (oldCode === null) {
            await waitForFreshCodeWindow(Date.now(), firebaseTotpParameters);
            oldCode = oldAuthenticatorCodeUnlikeNewKey(oldAuthenticator, newSetupKey, Date.now());
          }
          await submitAuthenticatorCode(codeScreen, oldCode);
          await personReadiness.whenServicesRespond(async () => {
            await expect(codeScreen.getByRole('alert')).toHaveText(wrongCodeMessage, { timeout: 20_000 });
          });
          await expect(approvedAccessControls(personPage).tierChip).toHaveCount(0);
          await expect(approvedAccessControls(personPage).sirapAccessButton).toHaveCount(0);
        });

        await test.step('A code from the new authenticator signs the person in with their approved access', async () => {
          const codeScreen = authenticatorCodeScreen(personPage);
          await waitForFreshCodeWindow(newCodeAcceptedAtMs, firebaseTotpParameters);
          await submitAuthenticatorCode(codeScreen, totpCode(newSetupKey, firebaseTotpParameters, Date.now()));
          await personReadiness.whenServicesRespond(async () => {
            await expect(codeScreen).toHaveCount(0, { timeout: 20_000 });
          });
          await expect(approvedAccessControls(personPage).tierChip).toHaveText(/^\s*(Tier|Nivel) 2\s*$/);
        });
      } finally {
        await test.info().attach('live network summary', {
          body: JSON.stringify(
            { superAdmin: adminReadiness.networkSummary(), person: personReadiness.networkSummary() },
            null,
            2,
          ),
          contentType: 'application/json',
        });
        await personContext.close();
      }
    },
  );
});
