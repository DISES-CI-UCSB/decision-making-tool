import { expect, test } from '@playwright/test';
import {
  availableLayer,
  chooseSirapRegion,
  displayLayer,
  expectSignedMetricsRead,
  layerDisplayToggle,
  listRegionFilesOnPrivateBucket,
  openScenarioFinder,
  recordFileRequests,
  recordSigningRequests,
  requestEvidence,
  shortenSignedLinks,
  signInWithAuthenticatorCode,
  viewMap,
  type FileRequestRecord,
} from '../../../../support/browser/regional-files-in-app.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { observeLiveReadiness } from '../../../../support/network/live-readiness.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

/** Shorter than the app's 15-minute links so the wait takes minutes. The app's renewal timing scales with link life. */
const signedLinkLifeSeconds = 150;
/** How long past the first link's expiry the test waits, so no clock difference can keep that link alive. */
const pastExpiryMarginMs = 60_000;

const isSignedRoute = ({ route }: FileRequestRecord) => route === 'private-file-proxy' || route === 'bucket-signed';
const loadedOk = ({ status, failure }: FileRequestRecord) => failure === null && (status === 200 || status === 206);
const inProgress = ({ status, failure }: FileRequestRecord) => status === null && failure === null;

test.describe('FBT-025', () => {
  let factory: TestAccountFactory;
  let regionalUser: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    regionalUser = await factory.create({
      status: 'active',
      role: 'sirap-user',
      allowedSirapIds: ['orinoquia'],
      authenticator: true,
      signInWithAuthenticator: false,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test("A regional user's map layers keep loading after their first signed links expire.", async ({ page, baseURL }) => {
    test.setTimeout(6 * 60_000);
    await narrateCatalogTest('FBT-025');
    const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
    const orinoquiaKeys = await listRegionFilesOnPrivateBucket(page, 'orinoquia');
    await shortenSignedLinks(page, signedLinkLifeSeconds);
    const fileRequests = recordFileRequests(page, new URL(baseURL!).origin);
    const signingRequests = recordSigningRequests(page);
    const orinoquiaRequests = () => fileRequests.filter(({ objectKey }) => orinoquiaKeys.has(objectKey));
    let firstLinkExpiresAtMs = 0;

    try {
      await test.step('An Orinoquía user signs in, opens an Orinoquía scenario, and displays Orinoquía Savannas', async () => {
        await signInWithAuthenticatorCode(page, regionalUser, whenServicesRespond);
        await openScenarioFinder(page);
        await chooseSirapRegion(page, 'SIRAP Orinoquía');
        const scenarioOpenedAtMs = Date.now();
        await viewMap(page, whenServicesRespond);
        await whenServicesRespond(async () => {
          await expectSignedMetricsRead(fileRequests, scenarioOpenedAtMs);
        });
        await displayLayer(page, 'Orinoquía Savannas', 'orinoquia_savannas.geojson', whenServicesRespond);
      });

      await test.step('The first Orinoquía files loaded through signed links, and the earliest link expiry is known', async () => {
        const firstLinks = orinoquiaRequests().filter(isSignedRoute);
        expect(firstLinks.length, 'Orinoquía files loaded through a signed link').toBeGreaterThan(0);
        const expiries = firstLinks.flatMap(({ signedLinkExpiresAtMs }) =>
          signedLinkExpiresAtMs === null ? [] : [signedLinkExpiresAtMs],
        );
        expect(expiries.length, 'signed links that state their expiry').toBe(firstLinks.length);
        firstLinkExpiresAtMs = Math.min(...expiries);
        expect(firstLinkExpiresAtMs - Date.now(), 'the first link lives no longer than the test asked').toBeLessThanOrEqual(
          signedLinkLifeSeconds * 1000,
        );
      });

      await test.step('The session stays open until a minute past the first link expiry', async () => {
        const waitMs = firstLinkExpiresAtMs + pastExpiryMarginMs - Date.now();
        await page.waitForTimeout(Math.max(waitMs, 0));
        expect(Date.now()).toBeGreaterThan(firstLinkExpiresAtMs);
      });

      await test.step('After expiry, a new Orinoquía layer draws on the map', async () => {
        const clickedAtMs = Date.now();
        await availableLayer(page, 'Congriales').getByRole('button', { name: 'Display', exact: true }).click();
        await whenServicesRespond(async () => {
          await expect
            .poll(() => orinoquiaRequests().some((record) => record.startedAtMs >= clickedAtMs && loadedOk(record)), {
              message: 'a Congriales file loaded after the first links expired',
              timeout: 30_000,
            })
            .toBe(true);
        });
        await expect(layerDisplayToggle(page, 'Congriales')).toHaveAttribute('aria-pressed', 'true');
      });

      await test.step('After expiry, Orinoquía Savannas turns off and back on', async () => {
        const savannas = availableLayer(page, 'Orinoquía Savannas');
        await savannas.getByRole('button', { name: 'Displayed', exact: true }).click();
        await expect(savannas.getByRole('button', { name: 'Display', exact: true })).toBeVisible();
        await savannas.getByRole('button', { name: 'Display', exact: true }).click();
        await expect(layerDisplayToggle(page, 'Orinoquía Savannas')).toHaveAttribute('aria-pressed', 'true');
      });

      await test.step('Every Orinoquía read the app started has finished', async () => {
        await expect
          .poll(() => orinoquiaRequests().filter(inProgress).map(({ address }) => address), {
            message: 'Orinoquía reads still in progress',
            timeout: 30_000,
          })
          .toEqual([]);
      });
    } finally {
      await test.info().attach('live network summary', {
        body: JSON.stringify(networkSummary(), null, 2),
        contentType: 'application/json',
      });
      await test.info().attach('file and signing requests', {
        body: requestEvidence(fileRequests, signingRequests),
        contentType: 'application/json',
      });
    }

    await test.step('No Orinoquía file was read with an expired link, without a link, or unsuccessfully', async () => {
      const afterExpiry = orinoquiaRequests().filter(({ startedAtMs }) => startedAtMs > firstLinkExpiresAtMs);
      expect(afterExpiry.length, 'Orinoquía file reads after the first links expired').toBeGreaterThan(0);
      const unsigned = orinoquiaRequests().filter((record) => !isSignedRoute(record));
      expect(unsigned.map(({ route, address }) => `${route} ${address}`), 'reads without a signed link').toEqual([]);
      const expiredLinkReads = orinoquiaRequests().filter(
        ({ signedLinkExpiresAtMs, startedAtMs }) => signedLinkExpiresAtMs !== null && signedLinkExpiresAtMs <= startedAtMs,
      );
      expect(expiredLinkReads.map(({ address }) => address), 'reads that sent an expired link').toEqual([]);
      const failed = orinoquiaRequests().filter((record) => !loadedOk(record));
      expect(failed.map(({ address, status, failure }) => `${status ?? failure} ${address}`), 'failed reads').toEqual([]);
    });
  });
});
