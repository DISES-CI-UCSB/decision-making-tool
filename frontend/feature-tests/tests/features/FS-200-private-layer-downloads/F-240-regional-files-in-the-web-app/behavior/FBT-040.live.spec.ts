import { expect, test, type Page, type Request } from '@playwright/test';
import { signInDeployedSite } from '../../../../support/browser/deployed-site-sign-in.ts';
import {
  chooseSirapRegion,
  displayLayer,
  openScenarioFinder,
  recordFileRequests,
  type FileRequestRecord,
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

const signerAddress = `${serviceConfig.serviceUrl}/downloads/signed-url`;

/** One call from the page to the Blob URL Signing Service, with no token and no link it returned. */
interface SignerCall {
  status: number | null;
  failure: string | null;
}

function recordSignerCalls(page: Page): SignerCall[] {
  const calls: SignerCall[] = [];
  const byRequest = new Map<Request, SignerCall>();
  page.on('request', (request) => {
    if (request.method() !== 'POST' || request.url().split('?')[0] !== signerAddress) return;
    const call: SignerCall = { status: null, failure: null };
    calls.push(call);
    byRequest.set(request, call);
  });
  page.on('requestfinished', async (request) => {
    const call = byRequest.get(request);
    if (call) call.status = (await request.response())?.status() ?? null;
  });
  page.on('requestfailed', (request) => {
    const call = byRequest.get(request);
    if (call) call.failure = request.failure()?.errorText ?? 'failed';
  });
  return calls;
}

/** An Orinoquía file is a stored file whose object key names Orinoquía. Catalog manifests are not files here. */
const isOrinoquiaFile = ({ objectKey }: FileRequestRecord) =>
  /orinoqu/i.test(objectKey) && !objectKey.endsWith('/manifest.json');
const isSignedBucketRead = ({ route }: FileRequestRecord) => route === 'bucket-signed';
const loadedOk = ({ status, failure }: FileRequestRecord) => failure === null && (status === 200 || status === 206);

function routeCounts(records: FileRequestRecord[]): string {
  const counts = new Map<string, number>();
  for (const { route } of records) counts.set(route, (counts.get(route) ?? 0) + 1);
  return JSON.stringify(Object.fromEntries(counts));
}

test.describe('FBT-040', () => {
  let factory: TestAccountFactory;
  let orinoquiaUser: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    orinoquiaUser = await factory.create({
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
    "On the GTIC test site, a signed-in Orinoquia user's map loads Orinoquia files from the private bucket through signed links.",
    async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await narrateCatalogTest('FBT-040');
      const { networkSummary, whenServicesRespond } = observeLiveReadiness(page);
      const fileRequests = recordFileRequests(page, new URL(baseURL!).origin);
      const signerCalls = recordSignerCalls(page);
      const orinoquiaRequests = () => fileRequests.filter(isOrinoquiaFile);

      try {
        await test.step('An Orinoquia user, signed in outside the browser, opens the deployed site and the app shows them signed in', async () => {
          await signInDeployedSite(page, baseURL!, orinoquiaUser);
        });

        await test.step('The user opens an Orinoquia scenario and displays Orinoquía Savannas', async () => {
          await openScenarioFinder(page);
          await chooseSirapRegion(page, 'SIRAP Orinoquía');
          await viewMap(page, whenServicesRespond);
          await displayLayer(page, 'Orinoquía Savannas', 'orinoquia_savannas.geojson', whenServicesRespond);
        });
      } finally {
        await test.info().attach('live network summary', {
          body: JSON.stringify(networkSummary(), null, 2),
          contentType: 'application/json',
        });
        await test.info().attach('file and signer requests', {
          body: JSON.stringify({ fileRequests: orinoquiaRequests(), signerCalls }, null, 2),
          contentType: 'application/json',
        });
      }

      await test.step('Orinoquia files loaded from the private bucket through signed links', async () => {
        const signedLoads = orinoquiaRequests().filter((record) => isSignedBucketRead(record) && loadedOk(record));
        expect(
          signedLoads.length,
          `Orinoquia file requests that went to https://storage.googleapis.com/${serviceConfig.bucket}/ with a signature and returned 200 or 206 ` +
            `(Orinoquia file requests by route: ${routeCounts(orinoquiaRequests())})`,
        ).toBeGreaterThan(0);
      });

      await test.step('The Blob URL Signing Service answered every signing call from the page with 200', async () => {
        expect(signerCalls.length, `calls from the page to ${signerAddress}`).toBeGreaterThan(0);
        expect(
          signerCalls.map(({ status, failure }) => `${status ?? failure}`),
          'signing call outcomes',
        ).toEqual(signerCalls.map(() => '200'));
      });

      await test.step('No signed bucket request failed, including by cross-origin (CORS) or network errors', async () => {
        const failed = orinoquiaRequests().filter((record) => isSignedBucketRead(record) && !loadedOk(record));
        expect(
          failed.map(({ address, status, failure }) => `${status ?? failure} ${address}`),
          'failed signed Orinoquia file requests',
        ).toEqual([]);
      });

      await test.step('No Orinoquia file was requested from the public Vercel Blob host or the plain bucket address', async () => {
        const unsigned = orinoquiaRequests().filter(({ route }) => route === 'public-blob' || route === 'bucket-plain');
        expect(unsigned.map(({ route, address }) => `${route} ${address}`), 'Orinoquia reads without a signed link').toEqual(
          [],
        );
      });
    },
  );
});
