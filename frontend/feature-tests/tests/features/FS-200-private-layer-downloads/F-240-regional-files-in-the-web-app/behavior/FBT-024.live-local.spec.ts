import { readFileSync } from 'node:fs';
import { expect, test, type Download } from '@playwright/test';
import {
  availableLayer,
  chooseSirapRegion,
  isSigningServiceRequest,
  layerDownloadButton,
  listRegionFilesOnPrivateBucket,
  mapLayersPanel,
  openScenarioFinder,
  recordFileRequests,
  recordSigningRequests,
  requestEvidence,
  signingRequestObjectName,
  signInWithAuthenticatorCode,
  viewMap,
} from '../../../../support/browser/regional-files-in-app.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { observeLiveReadiness } from '../../../../support/network/live-readiness.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

const regionalLayerName = 'Orinoquía Savannas';
const regionalFileName = 'orinoquia_savannas.geojson';
/** Stand-in bytes for the allowed download, so the check does not depend on the real file. */
const allowedFileBytes = Buffer.from('{"type":"FeatureCollection","features":[],"dmtTest":"FBT-024"}');

interface MockedReply {
  status: number;
  json: unknown;
}

/** A link shaped like the service's, for a file the test serves itself. Its signature is a placeholder. */
function placeholderSignedLink(objectName: string): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const path = objectName.split('/').map(encodeURIComponent).join('/');
  const query = new URLSearchParams({
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': 'dmt-test',
    'X-Goog-Date': date,
    'X-Goog-Expires': '900',
    'X-Goog-SignedHeaders': 'host',
    'X-Goog-Signature': '0'.repeat(64),
  });
  return `https://storage.googleapis.com/${serviceConfig.bucket}/${path}?${query}`;
}

const refusals = [
  {
    reason: 'needs region access',
    reply: { status: 403, json: { detail: { status: 'layer_forbidden', message: 'This account cannot download that object.' } } },
    message: /access to this region/i,
  },
  {
    reason: 'needs authenticator sign-in',
    reply: { status: 403, json: { detail: { status: 'mfa_required', message: 'SIRAP downloads require an authenticator sign-in.' } } },
    message: /authenticator code/i,
  },
  {
    reason: 'not signed in',
    reply: { status: 401, json: { detail: { status: 'invalid_token', message: 'The Firebase ID token is invalid.' } } },
    message: /sign-in has expired/i,
  },
  {
    reason: 'signing service unavailable',
    reply: { status: 503, json: { detail: { status: 'broker_not_configured', message: 'The Blob URL Signing Service is not configured.' } } },
    message: /download service is unavailable/i,
  },
] satisfies Array<{ reason: string; reply: MockedReply; message: RegExp }>;

test.describe('FBT-024', () => {
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

  test(
    'Clicking Download on a layer the user may open saves the file; on a layer they may not open, the app explains why instead of starting a broken download.',
    async ({ page, baseURL }) => {
      test.setTimeout(150_000);
      await narrateCatalogTest('FBT-024');
      const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
      await listRegionFilesOnPrivateBucket(page, 'orinoquia');
      const fileRequests = recordFileRequests(page, new URL(baseURL!).origin);
      const signingRequests = recordSigningRequests(page);
      const downloads: Download[] = [];
      page.on('download', (download) => downloads.push(download));

      let mockedReply: MockedReply | ((objectName: string) => MockedReply) | null = null;
      const mockedObjectNames: string[] = [];
      const regionalFileRequests = () => fileRequests.filter(({ objectKey }) => objectKey.endsWith(`/${regionalFileName}`));

      try {
        await test.step('An Orinoquía user signs in with their authenticator', async () => {
          await signInWithAuthenticatorCode(page, regionalUser, whenServicesRespond);
        });

        await test.step('Download on a national public layer saves it from its public address without asking the signing service', async () => {
          await openScenarioFinder(page);
          await viewMap(page, whenServicesRespond);
          await mapLayersPanel(page).getByRole('textbox', { name: 'Search available layers' }).fill('RAMSAR');
          const nationalDownload = mapLayersPanel(page).getByRole('button', { name: /^Download .*RAMSAR/i }).first();
          const signingRequestsBefore = signingRequests.length;
          const downloadStarted = page.waitForEvent('download', { timeout: 20_000 });
          await nationalDownload.click();
          const download = await downloadStarted;
          expect(new URL(download.url()).origin, 'national download host').toBe(serviceConfig.publicBlobHost);
          expect(download.suggestedFilename()).toMatch(/\.(geojson|json|tiff?|zip)$/i);
          await download.cancel();
          expect(signingRequests.length, 'signing requests for the national download').toBe(signingRequestsBefore);
          await mapLayersPanel(page).getByRole('textbox', { name: 'Search available layers' }).fill('');
        });

        await test.step('An Orinoquía scenario lists Orinoquía Savannas with a Download button', async () => {
          await openScenarioFinder(page);
          await chooseSirapRegion(page, 'SIRAP Orinoquía');
          await viewMap(page, whenServicesRespond);
          await expect(layerDownloadButton(page, regionalLayerName)).toBeVisible();
        });

        // Only this layer's file is answered by the test; every other signing request reaches the real service.
        await page.route(isSigningServiceRequest, async (route) => {
          const objectName = signingRequestObjectName(route.request());
          if (!objectName?.endsWith(`/${regionalFileName}`) || mockedReply === null) {
            await route.fallback();
            return;
          }
          mockedObjectNames.push(objectName);
          const reply = typeof mockedReply === 'function' ? mockedReply(objectName) : mockedReply;
          await route.fulfill({ status: reply.status, json: reply.json, headers: { 'cache-control': 'no-store' } });
        });
        await page.route(
          (url) => decodeURIComponent(url.pathname).endsWith(`/${regionalFileName}`),
          (route) => route.fulfill({ status: 200, contentType: 'application/geo+json', body: allowedFileBytes }),
        );

        for (const refusal of refusals) {
          await test.step(`A refusal because the person ${refusal.reason} shows its explanation and starts no download`, async () => {
            mockedReply = refusal.reply;
            const askedBefore = mockedObjectNames.length;
            const fileRequestsBefore = regionalFileRequests().length;
            const downloadsBefore = downloads.length;
            await layerDownloadButton(page, regionalLayerName).click();
            await expect(availableLayer(page, regionalLayerName).getByRole('alert')).toHaveText(refusal.message);
            expect(mockedObjectNames.length, 'the app asks the signing service on every click').toBe(askedBefore + 1);
            // A broken download would start right after the refusal arrives; give it time to appear.
            await page.waitForTimeout(1_500);
            expect(downloads.length, 'downloads started after a refusal').toBe(downloadsBefore);
            expect(regionalFileRequests().length, 'file requests after a refusal').toBe(fileRequestsBefore);
          });
        }

        await test.step('An allowed reply saves the file under its own name and clears the explanation', async () => {
          mockedReply = (objectName) => ({
            status: 200,
            json: {
              url: placeholderSignedLink(objectName),
              expires_at: new Date(Date.now() + 900_000).toISOString(),
              object_name: objectName,
              method: 'GET',
            },
          });
          const downloadStarted = page.waitForEvent('download', { timeout: 20_000 });
          await layerDownloadButton(page, regionalLayerName).click();
          const download = await downloadStarted;
          expect(download.suggestedFilename()).toBe(regionalFileName);
          const savedPath = await download.path();
          expect(readFileSync(savedPath).equals(allowedFileBytes), 'saved bytes equal the served file').toBe(true);
          await expect(availableLayer(page, regionalLayerName).getByRole('alert')).toHaveCount(0);
          expect(
            regionalFileRequests().every(({ route }) => route === 'private-file-proxy' || route === 'bucket-signed'),
            'the allowed download reads the file through its signed link',
          ).toBe(true);
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
    },
  );
});
