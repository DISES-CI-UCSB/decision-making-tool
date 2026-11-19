import { expect, test, type Page } from '@playwright/test';
import {
  approvedAccessControls,
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

/**
 * The Firestore web SDK's write channels: the Write stream (set, update, delete, batched writes) and the REST
 * commit used by transactions. Reads use other channels and are never intercepted; intercepting the streaming
 * Listen channel stops the app from loading the SIRAP catalog batches.
 */
const firestoreWriteRequest =
  /^https:\/\/firestore\.googleapis\.com\/(google\.firestore\.v1\.Firestore\/Write\/|v1\/[^?]*:(commit|batchWrite)(\?|$))/;

/**
 * The walkthrough must not write anyone's data, real people included, so the page's Firestore writes are refused
 * from the moment the sign-in is done. Returns the refused requests' paths.
 */
async function refuseFirestoreWrites(page: Page): Promise<string[]> {
  const refusedWrites: string[] = [];
  await page.route(firestoreWriteRequest, (route) => {
    refusedWrites.push(new URL(route.request().url()).pathname);
    return route.abort('blockedbyclient');
  });
  return refusedWrites;
}

function layerFileResponse(page: Page, fileName: string) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith(`/${fileName}`) && response.ok(),
    { timeout: 20_000 },
  );
}

test.describe('FBT-032', () => {
  let factory: TestAccountFactory;
  let superAdmin: TestAccount;
  let authenticator: TestAccountAuthenticator;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    superAdmin = await factory.create({
      status: 'active',
      role: 'super-admin',
      allowedSirapIds: [],
      authenticator: true,
      signInWithAuthenticator: false,
    });
    if (!superAdmin.authenticator) throw new Error('The super-admin was created without an authenticator.');
    authenticator = superAdmin.authenticator;
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test('A super-admin sees both regions and the admin tools.', async ({ page }) => {
    test.setTimeout(120_000);
    await narrateCatalogTest('FBT-032');
    const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
    const codeScreen = authenticatorCodeScreen(page);
    const { tierChip, sirapAccessButton } = approvedAccessControls(page);
    const adminConsoleButton = page.getByRole('button', { name: 'Admin console' });
    const finder = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('radiogroup', { name: 'Planning domain' }) });
    const regionChoice = finder.getByRole('combobox');
    const viewMap = finder.getByRole('button', { name: 'View map', exact: true });
    const layerPanel = page
      .getByRole('complementary')
      .filter({ has: page.getByRole('heading', { name: 'Map Layers' }) });
    const ecosystemGroup = layerPanel.getByRole('button', { name: /^Ecosystems \d+ layers?$/ });
    /** The innermost layer-list card whose name button reads exactly `name`. */
    const availableLayer = (name: string) =>
      layerPanel
        .getByRole('article')
        .filter({ has: page.getByRole('button', { name, exact: true }) })
        .filter({ hasNot: page.getByRole('article') });

    async function viewSirapRegion(regionLabel: string): Promise<void> {
      await finder.getByRole('radio', { name: 'SIRAP', exact: true }).click();
      await regionChoice.selectOption({ label: regionLabel });
      await whenServicesRespond(async () => {
        await expect(viewMap).toBeEnabled({ timeout: 20_000 });
        await viewMap.click();
        await expect(finder).toHaveCount(0, { timeout: 20_000 });
        await expect(layerPanel.getByRole('heading', { name: 'Active Scenario' })).toBeVisible({ timeout: 20_000 });
      });
      if ((await ecosystemGroup.getAttribute('aria-expanded')) !== 'true') await ecosystemGroup.click();
      await expect(ecosystemGroup).toHaveAttribute('aria-expanded', 'true');
    }

    async function displayLayer(name: string, fileName: string): Promise<void> {
      const fileLoaded = layerFileResponse(page, fileName);
      await availableLayer(name).getByRole('button', { name: 'Display', exact: true }).click();
      await whenServicesRespond(async () => {
        await fileLoaded;
      });
      await expect(layerPanel.getByRole('button', { name: `Toggle display for ${name}` })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }

    let refusedWrites: string[] = [];
    try {
      await test.step('A super-admin signs in with their authenticator and the header offers Tier 3, SIRAP access, and the Admin console', async () => {
        await provideTestSignInCredentials(page, superAdmin);
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
          await expect(adminConsoleButton).toBeVisible();
        });
        await expect(tierChip).toHaveText(/^\s*Tier 3\s*$/);
        await expect(sirapAccessButton).toBeVisible();
      });

      await test.step('The Admin console opens without writing anything and names them a super admin with access to, and administration of, all SIRAPs', async () => {
        refusedWrites = await refuseFirestoreWrites(page);
        await adminConsoleButton.click();
        const adminConsole = page.getByRole('dialog', { name: 'Access management' });
        await expect(adminConsole.locator('#admin-access-panel-administrator-role-value')).toHaveText('Super admin');
        await expect(adminConsole.locator('#admin-access-panel-administrator-data-access-value')).toHaveText(
          'All SIRAPs',
        );
        await expect(adminConsole.locator('#admin-access-panel-administrator-assignments-value')).toHaveText(
          'All SIRAPs',
        );
        await whenServicesRespond(async () => {
          await expect(adminConsole.getByText('Loading access management...')).toHaveCount(0, { timeout: 20_000 });
        });
        expect(refusedWrites, 'Firestore writes attempted while the Admin console opened').toEqual([]);
        await adminConsole.getByRole('button', { name: 'Close access requests panel' }).click();
        await expect(adminConsole).toHaveCount(0);
      });

      await test.step('The scenario finder offers the SIRAP scope with both Orinoquía and Eje Cafetero', async () => {
        await page.getByRole('button', { name: 'Select scenario' }).click();
        await expect(finder.getByRole('radiogroup', { name: 'Scenario scope' })).toBeVisible();
        await finder.getByRole('radio', { name: 'SIRAP', exact: true }).click();
        await expect(regionChoice.getByRole('option', { name: 'SIRAP Orinoquía' })).toHaveCount(1);
        await expect(regionChoice.getByRole('option', { name: 'SIRAP Eje Cafetero' })).toHaveCount(1);
      });

      await test.step('An Orinoquía scenario lists the Orinoquía layers, and Orinoquía Savannas opens on the map', async () => {
        await viewSirapRegion('SIRAP Orinoquía');
        await expect(availableLayer('Orinoquía Savannas')).toHaveCount(1);
        await expect(availableLayer('Congriales')).toHaveCount(1);
        await displayLayer('Orinoquía Savannas', 'orinoquia_savannas.geojson');
      });

      await test.step('An Eje Cafetero scenario lists the Eje Cafetero layers, and Eje Cafetero Wetlands opens on the map', async () => {
        await layerPanel.getByRole('button', { name: 'Change', exact: true }).click();
        await viewSirapRegion('SIRAP Eje Cafetero');
        await expect(availableLayer('Eje Cafetero Wetlands')).toHaveCount(1);
        await expect(availableLayer('Complementary Conservation Strategies (ECC)')).toHaveCount(1);
        await displayLayer('Eje Cafetero Wetlands', 'eje_cafetero_wetlands.geojson');
      });
    } finally {
      await test.info().attach('live network summary', {
        body: JSON.stringify(networkSummary(), null, 2),
        contentType: 'application/json',
      });
      await test.info().attach('refused Firestore writes', {
        body: JSON.stringify(refusedWrites, null, 2),
        contentType: 'application/json',
      });
    }
  });
});
