import { expect, test, type Page } from '@playwright/test';
import {
  authenticatorCodeScreen,
  openAppSignedOut,
  provideTestSignInCredentials,
  signInWithGoogleThroughTestHook,
  submitAuthenticatorCode,
  waitForFreshCodeWindow,
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

const accessManagementConsole = (page: Page) => page.getByRole('dialog', { name: 'Access management' });

test.describe('FBT-031', () => {
  let factory: TestAccountFactory;
  let orinoquiaAdmin: TestAccount;
  let authenticator: TestAccountAuthenticator;
  /** Asked for Orinoquía and Eje Cafetero. */
  let twoRegionRequester: TestAccount;
  /** Asked only for Eje Cafetero. */
  let ejeCafeteroRequester: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    [orinoquiaAdmin, twoRegionRequester, ejeCafeteroRequester] = await Promise.all([
      factory.create({
        status: 'active',
        role: 'sirap-admin',
        allowedSirapIds: ['orinoquia'],
        administeredSirapIds: ['orinoquia'],
        authenticator: true,
        signInWithAuthenticator: false,
      }),
      factory.create({ status: 'active', role: 'user', allowedSirapIds: [], authenticator: false }),
      factory.create({ status: 'active', role: 'user', allowedSirapIds: [], authenticator: false }),
    ]);
    if (!orinoquiaAdmin.authenticator) throw new Error('The regional admin was created without an authenticator.');
    authenticator = orinoquiaAdmin.authenticator;
    await Promise.all([
      factory.createPendingSirapAccessRequest(twoRegionRequester.uid, 'orinoquia'),
      factory.createPendingSirapAccessRequest(twoRegionRequester.uid, 'eje-cafetero'),
      factory.createPendingSirapAccessRequest(ejeCafeteroRequester.uid, 'eje-cafetero'),
    ]);
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test('A regional admin can review and decide access requests only for their own region.', async ({ page }) => {
    test.setTimeout(90_000);
    await narrateCatalogTest('FBT-031');
    const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
    const codeScreen = authenticatorCodeScreen(page);
    const adminConsole = accessManagementConsole(page);
    const requestSearch = adminConsole.getByRole('searchbox', { name: 'Search by name' });
    const noMatchingRequests = adminConsole.getByRole('heading', { name: 'No matching SIRAP request groups' });
    const twoRegionGroup = adminConsole.getByRole('button', { name: twoRegionRequester.email });
    const requestRow = (requester: TestAccount, sirapId: string) =>
      page.locator(`#admin-access-panel-sirap-request-row-${requester.uid}_${sirapId}`);

    try {
      await test.step('An Orinoquía regional admin signs in with their authenticator and is offered the Admin console', async () => {
        await provideTestSignInCredentials(page, orinoquiaAdmin);
        await whenServicesRespond(async () => {
          await openAppSignedOut(page);
          await signInWithGoogleThroughTestHook(page);
        });
        await expect(codeScreen.getByRole('heading', { name: 'Enter authenticator code' })).toBeVisible();
        await waitForFreshCodeWindow(authenticator.lastCodeAcceptedAtMs, authenticator.parameters);
        await submitAuthenticatorCode(
          codeScreen,
          totpCode(authenticator.secretKey, authenticator.parameters, Date.now()),
        );
        await whenServicesRespond(async () => {
          await expect(codeScreen).toHaveCount(0, { timeout: 20_000 });
          await expect(page.getByRole('button', { name: 'Admin console' })).toBeVisible();
        });
      });

      await test.step('The Admin console names them a SIRAP administrator of Orinoquía only and loads without errors', async () => {
        await page.getByRole('button', { name: 'Admin console' }).click();
        await expect(adminConsole.locator('#admin-access-panel-administrator-role-value')).toHaveText(
          'SIRAP administrator',
        );
        await expect(adminConsole.locator('#admin-access-panel-administrator-assignments-value')).toHaveText(
          'SIRAP Orinoquía',
        );
        await whenServicesRespond(async () => {
          await expect(adminConsole.getByText('Loading access management...')).toHaveCount(0, { timeout: 20_000 });
        });
        await expect(adminConsole.getByRole('alert')).toHaveCount(0);
        await expect(adminConsole.getByRole('tab', { name: 'Pending SIRAP Requests' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
      });

      await test.step("A person who asked for both regions shows only their Orinoquía request, with no Eje Cafetero request or decision buttons", async () => {
        await requestSearch.fill(twoRegionRequester.email);
        await expect(twoRegionGroup).toHaveCount(1);
        await expect(twoRegionGroup).toContainText(/\b1 requested SIRAP(?!s)/);
        await twoRegionGroup.click();
        const orinoquiaRequest = requestRow(twoRegionRequester, 'orinoquia');
        await expect(orinoquiaRequest).toContainText('SIRAP Orinoquía');
        await expect(orinoquiaRequest.getByRole('button', { name: 'Approve' })).toBeVisible();
        await expect(requestRow(twoRegionRequester, 'eje-cafetero')).toHaveCount(0);
        await expect(adminConsole.getByText(/Eje Cafetero/)).toHaveCount(0);
      });

      await test.step('A person who asked only for Eje Cafetero does not appear in the pending requests', async () => {
        await requestSearch.fill(ejeCafeteroRequester.email);
        await expect(noMatchingRequests).toBeVisible();
        await expect(requestRow(ejeCafeteroRequester, 'eje-cafetero')).toHaveCount(0);
        await requestSearch.fill(twoRegionRequester.email);
        await expect(twoRegionGroup).toHaveCount(1);
      });

      await test.step('Approving the Orinoquía request removes it from the pending list and grants that person Orinoquía only', async () => {
        if ((await twoRegionGroup.getAttribute('aria-expanded')) !== 'true') await twoRegionGroup.click();
        await requestRow(twoRegionRequester, 'orinoquia').getByRole('button', { name: 'Approve' }).click();
        await whenServicesRespond(async () => {
          await expect(noMatchingRequests).toBeVisible({ timeout: 20_000 });
        });
        await expect(adminConsole.getByRole('alert')).toHaveCount(0);

        const decided = await factory.readAsAdmin(`sirapAccessRequests/${twoRegionRequester.uid}_orinoquia`);
        expect(decided?.status).toBe('approved');
        expect(decided?.decidedBy).toBe(orinoquiaAdmin.uid);
        const granted = await factory.readAsAdmin(`users/${twoRegionRequester.uid}`);
        expect(granted?.allowedSirapIds).toEqual(['orinoquia']);
        expect(granted?.role).toBe('sirap-user');
      });

      await test.step('Both Eje Cafetero requests stay pending and undecided, and neither person holds Eje Cafetero access', async () => {
        const requesters = { 'two-region requester': twoRegionRequester, 'Eje Cafetero requester': ejeCafeteroRequester };
        for (const [label, requester] of Object.entries(requesters)) {
          const request = await factory.readAsAdmin(`sirapAccessRequests/${requester.uid}_eje-cafetero`);
          expect(request?.status, label).toBe('pending');
          expect(request?.decidedBy, label).toBeUndefined();
          const record = await factory.readAsAdmin(`users/${requester.uid}`);
          expect(record?.allowedSirapIds, label).not.toContain('eje-cafetero');
        }
        expect((await factory.readAsAdmin(`users/${ejeCafeteroRequester.uid}`))?.role).toBe('user');
      });
    } finally {
      await test.info().attach('live network summary', {
        body: JSON.stringify(networkSummary(), null, 2),
        contentType: 'application/json',
      });
    }
  });
});
