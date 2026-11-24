import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  chooseSirapRegion,
  displayLayer,
  layerDownloadButton,
  listRegionFilesOnPrivateBucket,
  mapLayersPanel,
  openScenarioFinder,
  expectSignedMetricsRead,
  recordFileRequests,
  recordSigningRequests,
  requestEvidence,
  scenarioFinder,
  signInWithAuthenticatorCode,
  viewMap,
  availableLayer,
} from '../../../../support/browser/regional-files-in-app.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { observeLiveReadiness } from '../../../../support/network/live-readiness.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

const ejeCafeteroLayerLabels = [
  'Eje Cafetero Wetlands',
  'Humedales del Eje Cafetero',
  'Complementary Conservation Strategies',
  'Estrategias Complementarias de Conservación',
];
/** Eje Cafetero files by path. The public SIRAP boundary outlines (siraps_*) are national layers and are allowed. */
const ejeCafeteroPath = /eje[-_]cafetero/i;
const isSirapBoundaryOutline = (path: string) => /(^|\/)siraps?[_-][^/]*$/i.test(path);

test.describe('FBT-030', () => {
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

  test("A regional user sees and downloads their own region's layers, and the other region stays hidden.", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await narrateCatalogTest('FBT-030');
    const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
    const orinoquiaKeys = await listRegionFilesOnPrivateBucket(page, 'orinoquia');
    const fileRequests = recordFileRequests(page, new URL(baseURL!).origin);
    const signingRequests = recordSigningRequests(page);
    const allRequestPaths: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      try {
        allRequestPaths.push(decodeURIComponent(`${url.origin}${url.pathname}`));
      } catch {
        allRequestPaths.push(`${url.origin}${url.pathname}`);
      }
    });
    let displayedBytes: Buffer = Buffer.alloc(0);

    try {
      await test.step('An Orinoquía user signs in with their authenticator', async () => {
        await signInWithAuthenticatorCode(page, regionalUser, whenServicesRespond);
      });

      await test.step('The SIRAP scope offers Orinoquía and no Eje Cafetero', async () => {
        await openScenarioFinder(page);
        await scenarioFinder(page).getByRole('radio', { name: 'SIRAP', exact: true }).click();
        const regionChoice = scenarioFinder(page).getByRole('combobox');
        await expect(regionChoice.getByRole('option', { name: 'SIRAP Orinoquía' })).toHaveCount(1);
        await expect(regionChoice.getByRole('option', { name: /Eje Cafetero/ })).toHaveCount(0);
      });

      await test.step('An Orinoquía scenario opens on the map and its metrics load', async () => {
        await chooseSirapRegion(page, 'SIRAP Orinoquía');
        const scenarioOpenedAtMs = Date.now();
        await viewMap(page, whenServicesRespond);
        await whenServicesRespond(async () => {
          await expectSignedMetricsRead(fileRequests, scenarioOpenedAtMs);
        });
      });

      await test.step('The layer list shows the Orinoquía layers, and Orinoquía Savannas draws on the map', async () => {
        await expect(availableLayer(page, 'Orinoquía Savannas')).toHaveCount(1);
        await expect(availableLayer(page, 'Congriales')).toHaveCount(1);
        displayedBytes = await displayLayer(page, 'Orinoquía Savannas', 'orinoquia_savannas.geojson', whenServicesRespond);
      });

      await test.step('Downloading Orinoquía Savannas saves the same file the map drew', async () => {
        const downloadStarted = page.waitForEvent('download', { timeout: 30_000 });
        await layerDownloadButton(page, 'Orinoquía Savannas').click();
        const download = await downloadStarted;
        expect(download.suggestedFilename()).toBe('orinoquia_savannas.geojson');
        const saved = readFileSync(await download.path());
        expect(saved.byteLength, 'saved file size').toBeGreaterThan(0);
        expect(saved.equals(displayedBytes), 'saved bytes equal the bytes the map loaded').toBe(true);
      });

      await test.step('Searching the layer list finds no Eje Cafetero layer', async () => {
        const layerSearch = mapLayersPanel(page).getByRole('textbox', { name: 'Search available layers' });
        // The panel-wide count reads "N matches"; each group's own count reads "N layer matches".
        const searchResultCount = mapLayersPanel(page).getByText(/^\s*\d+ match(es)?\s*$/);
        for (const label of ejeCafeteroLayerLabels) {
          // A regional match first, so a count of 0 below comes from this search and not an earlier one.
          await layerSearch.fill('Congriales');
          await expect(searchResultCount).toHaveText(/^\s*[1-9]/);
          await layerSearch.fill(label);
          await expect(searchResultCount, `searching for "${label}"`).toHaveText(/^\s*0\s/);
        }
        await layerSearch.fill('');
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

    await test.step('Every Orinoquía file loaded through a signed link, never from Vercel Blob or the plain bucket address', async () => {
      expect(orinoquiaKeys.size, 'Orinoquía files listed in the catalog').toBeGreaterThan(0);
      const orinoquiaRequests = fileRequests.filter(({ objectKey }) => orinoquiaKeys.has(objectKey));
      const unsigned = orinoquiaRequests.filter(({ route }) => route === 'public-blob' || route === 'bucket-plain');
      expect(unsigned.map(({ address, route }) => `${route} ${address}`), 'Orinoquía files read without a signed link').toEqual([]);
      const failed = orinoquiaRequests.filter(
        ({ status, failure }) => failure !== null || (status !== 200 && status !== 206),
      );
      expect(failed.map(({ address, status, failure }) => `${status ?? failure} ${address}`), 'failed Orinoquía file reads').toEqual([]);
      const signedKeys = orinoquiaRequests.map(({ objectKey }) => objectKey);
      expect(signedKeys.some((key) => key.includes('/solutions/sirap/')), 'the scenario raster').toBe(true);
      expect(signedKeys.some((key) => key.includes('.metrics')), 'a scenario metrics file').toBe(true);
      expect(signedKeys.some((key) => key.endsWith('/orinoquia_savannas.geojson')), 'the Orinoquía Savannas file').toBe(true);
      const refusedSigning = signingRequests.filter(({ status }) => status !== 200);
      expect(refusedSigning, "signing requests refused for the user's own region").toEqual([]);
    });

    await test.step('The browser asked for no Eje Cafetero file and no link to one', async () => {
      const ejeCafeteroRequests = allRequestPaths.filter(
        (path) => ejeCafeteroPath.test(path) && !isSirapBoundaryOutline(path),
      );
      expect([...new Set(ejeCafeteroRequests)], 'Eje Cafetero requests').toEqual([]);
      const ejeCafeteroLinks = signingRequests.filter(({ objectName }) => objectName !== null && ejeCafeteroPath.test(objectName));
      expect(ejeCafeteroLinks, 'links asked for Eje Cafetero files').toEqual([]);
    });
  });
});
