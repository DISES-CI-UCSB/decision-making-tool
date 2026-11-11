import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  expectLinkIssued,
  expectRefusedWithoutLink,
  fetchFirstBytes,
  requestSignedUrl,
  type SignedUrlReply,
} from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

/** The promise is 2 minutes; the extra 10 seconds absorbs the last retry's round trip. */
const REFUSAL_DEADLINE_MS = 130_000;
const RETRY_INTERVAL_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Watched {
  account: TestAccount;
  objectName: string;
  refusal: SignedUrlReply | null;
  refusedAfterMs: number | null;
}

/**
 * Asks for each account's file every 15 seconds until each is refused or the deadline passes.
 * A watched account stops being asked once any reply other than a link comes back.
 */
async function waitForRefusals(request: APIRequestContext, watched: Watched[], changedAtMs: number): Promise<void> {
  while (Date.now() - changedAtMs < REFUSAL_DEADLINE_MS) {
    await delay(Math.min(RETRY_INTERVAL_MS, REFUSAL_DEADLINE_MS - (Date.now() - changedAtMs)));
    for (const entry of watched.filter(({ refusal }) => refusal === null)) {
      const reply = await requestSignedUrl(request, entry.objectName, entry.account.idToken);
      if (reply.status !== 200) {
        entry.refusal = reply;
        entry.refusedAfterMs = Date.now() - changedAtMs;
      }
    }
    if (watched.every(({ refusal }) => refusal !== null)) return;
  }
}

function seconds(ms: number | null): string {
  return ms === null ? 'not refused' : `${(ms / 1000).toFixed(1)} s`;
}

test.describe('FBT-023', () => {
  let factory: TestAccountFactory;
  let userLosingRegion: TestAccount;
  let userBeingDeactivated: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    factory = createTestAccountFactory();
    [userLosingRegion, userBeingDeactivated] = await Promise.all([
      factory.create({
        status: 'active',
        role: 'sirap-user',
        allowedSirapIds: ['orinoquia'],
        authenticator: true,
      }),
      factory.create({
        status: 'active',
        role: 'sirap-user',
        allowedSirapIds: ['eje-cafetero'],
        authenticator: true,
      }),
    ]);
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    "Removing someone's regional access, or deactivating their account, stops new download links within 2 minutes.",
    async ({ request }) => {
      test.setTimeout(200_000);
      await narrateCatalogTest('FBT-023');
      const regionRemoval: Watched = {
        account: userLosingRegion,
        objectName: serviceConfig.objects.orinoquia,
        refusal: null,
        refusedAfterMs: null,
      };
      const deactivation: Watched = {
        account: userBeingDeactivated,
        objectName: serviceConfig.objects.ejeCafetero,
        refusal: null,
        refusedAfterMs: null,
      };

      await test.step(
        'Before any change, an Orinoquia-granted account and an Eje Cafetero-granted account, both signed in with an authenticator, each get a working link to their region file',
        async () => {
          for (const entry of [regionRemoval, deactivation]) {
            const url = expectLinkIssued(await requestSignedUrl(request, entry.objectName, entry.account.idToken));
            const download = await fetchFirstBytes(request, url);
            expect([200, 206]).toContain(download.status);
            expect(download.byteLength).toBeGreaterThan(0);
          }
        },
      );

      await test.step(
        "An administrator empties the first account's region list and sets the second account's status to denied; within 2 minutes, retrying every 15 seconds, the first is refused with 403 layer_forbidden and the second with 403 account_inactive, both with no link",
        async () => {
          await Promise.all([
            factory.updateAccessRecord(userLosingRegion.uid, { allowedSirapIds: [] }),
            factory.updateAccessRecord(userBeingDeactivated.uid, { status: 'denied' }),
          ]);
          const changedAtMs = Date.now();
          await waitForRefusals(request, [regionRemoval, deactivation], changedAtMs);
          test.info().annotations.push({
            type: 'Measured delay',
            description: `Region removal refused after ${seconds(regionRemoval.refusedAfterMs)}; deactivation refused after ${seconds(deactivation.refusedAfterMs)} (retry interval 15 s).`,
          });

          const deadline = seconds(REFUSAL_DEADLINE_MS);
          expect(regionRemoval.refusal, `region removal was still issuing links after ${deadline}`).not.toBeNull();
          expect(deactivation.refusal, `deactivation was still issuing links after ${deadline}`).not.toBeNull();
          expectRefusedWithoutLink(regionRemoval.refusal as SignedUrlReply, 403, 'layer_forbidden');
          expectRefusedWithoutLink(deactivation.refusal as SignedUrlReply, 403, 'account_inactive');
        },
      );
    },
  );
});
