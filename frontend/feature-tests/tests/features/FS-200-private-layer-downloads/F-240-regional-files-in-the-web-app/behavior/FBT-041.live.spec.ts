import { expect, test, type Page } from '@playwright/test';
import { openSameOriginDocument, signInDeployedSite } from '../../../../support/browser/deployed-site-sign-in.ts';
import { recordFileRequests } from '../../../../support/browser/regional-files-in-app.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

const signerAddress = `${serviceConfig.serviceUrl}/downloads/signed-url`;
const orinoquiaObject = serviceConfig.objects.orinoquia;
const plainOrinoquiaAddress = `https://storage.googleapis.com/${serviceConfig.bucket}/${orinoquiaObject
  .split('/')
  .map(encodeURIComponent)
  .join('/')}`;

/** What a page fetch received. `refusal` is the signing service's `detail.status`, when the reply has one. */
interface PageFetchOutcome {
  status: number | null;
  refusal: string | null;
  /** Set when the browser blocked or lost the request, for example by a missing CORS permission. */
  error: string | null;
}

/** Runs a fetch inside the page, so the browser's real Origin and cross-origin (CORS) rules apply. */
async function fetchFromPage(
  page: Page,
  request: { url: string; method: 'GET' | 'POST'; idToken: string | null; json?: unknown },
): Promise<PageFetchOutcome> {
  return page.evaluate(async ({ url, method, idToken, json }) => {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idToken === null ? {} : { Authorization: `Bearer ${idToken}` }),
        },
        body: json === undefined ? undefined : JSON.stringify(json),
        cache: 'no-store',
      });
      let refusal: string | null = null;
      try {
        const body = (await response.json()) as { detail?: { status?: unknown } };
        refusal = typeof body?.detail?.status === 'string' ? body.detail.status : null;
      } catch {
        // A reply without JSON, such as the bucket's XML refusal, has no service status.
      }
      return { status: response.status, refusal, error: null };
    } catch (error) {
      return { status: null, refusal: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, request);
}

/** The status the page received, or what the browser did instead, for an assertion message and comparison. */
function describeOutcome(outcome: PageFetchOutcome): string {
  return outcome.error === null ? `${outcome.status}` : `the browser blocked the request: ${outcome.error}`;
}

test.describe('FBT-041', () => {
  let factory: TestAccountFactory;
  let ejeCafeteroUser: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    factory = createTestAccountFactory();
    ejeCafeteroUser = await factory.create({
      status: 'active',
      role: 'sirap-user',
      allowedSirapIds: ['eje-cafetero'],
      authenticator: true,
      signInWithAuthenticator: false,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    "On the GTIC test site, a signed-out visitor and an Eje Cafetero user cannot load Orinoquia's private files.",
    async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      await narrateCatalogTest('FBT-041');
      const fileRequests = recordFileRequests(page, new URL(baseURL!).origin);
      const orinoquiaReadsReturned2xx = () =>
        fileRequests
          .filter(
            ({ objectKey, failure, status }) =>
              /orinoqu/i.test(objectKey) &&
              !objectKey.endsWith('/manifest.json') &&
              failure === null &&
              status !== null &&
              status >= 200 &&
              status < 300,
          )
          .map(({ route, status, address }) => `${route} ${status} ${address}`);

      await test.step('A signed-out visitor is refused by the signing service with 401', async () => {
        await openSameOriginDocument(page, baseURL!);
        const outcome = await fetchFromPage(page, {
          url: signerAddress,
          method: 'POST',
          idToken: null,
          json: { object_name: orinoquiaObject },
        });
        expect(describeOutcome(outcome), 'signing service reply to a request with no token').toBe('401');
      });

      await test.step("A signed-out visitor's request for the plain bucket address of an Orinoquia object gets 403", async () => {
        const outcome = await fetchFromPage(page, { url: plainOrinoquiaAddress, method: 'GET', idToken: null });
        expect(describeOutcome(outcome), 'bucket reply to a request with no signature').toBe('403');
      });

      let idToken: string;
      await test.step('An Eje Cafetero user, signed in outside the browser, is shown signed in by the app', async () => {
        ({ idToken } = await signInDeployedSite(page, baseURL!, ejeCafeteroUser));
      });

      await test.step('The signing service refuses the Eje Cafetero user a link to an Orinoquia object with 403 layer_forbidden', async () => {
        const outcome = await fetchFromPage(page, {
          url: signerAddress,
          method: 'POST',
          idToken: idToken!,
          json: { object_name: orinoquiaObject },
        });
        expect(describeOutcome(outcome), 'signing service reply to the Eje Cafetero user').toBe('403');
        expect(outcome.refusal, 'signing service refusal status').toBe('layer_forbidden');
      });

      await test.step('No Orinoquia file was returned to the page with a 2xx response', async () => {
        const plainRead = await fetchFromPage(page, { url: plainOrinoquiaAddress, method: 'GET', idToken: null });
        expect(describeOutcome(plainRead), 'bucket reply to the signed-in user without a signature').toBe('403');
        expect(orinoquiaReadsReturned2xx(), 'successful reads of the Orinoquia object').toEqual([]);
      });
    },
  );
});
