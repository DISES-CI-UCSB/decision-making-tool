import { expect, test } from '@playwright/test';
import {
  expectLinkIssued,
  fetchFirstBytes,
  fetchPlainBucketAddress,
  requestSignedUrl,
} from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-001', () => {
  let factory: TestAccountFactory;
  let activeUser: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    activeUser = await factory.create({
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
    "Direct bucket address is refused, while a signed-in user's temporary link downloads the national layer file.",
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-001');
      const url = await test.step(
        'The signed-in active user with no region grant gets a temporary link to the national Ramsar wetlands file that expires in 14 to 16 minutes',
        async () => {
          const reply = await requestSignedUrl(request, serviceConfig.objects.national, activeUser.idToken);
          const url = expectLinkIssued(reply);

          const minutesUntilExpiry = (Date.parse(reply.body?.expires_at ?? '') - Date.now()) / 60_000;
          expect(minutesUntilExpiry).toBeGreaterThan(14);
          expect(minutesUntilExpiry).toBeLessThan(16);
          return url;
        },
      );

      await test.step('The temporary link downloads the first bytes of the Ramsar wetlands file', async () => {
        const download = await fetchFirstBytes(request, url);
        expect([200, 206]).toContain(download.status);
        expect(download.byteLength).toBeGreaterThan(0);
      });

      await test.step(
        "The Ramsar wetlands file's plain bucket address, opened with no sign-in, is refused with 401 or 403",
        async () => {
          const plainAddressStatus = await fetchPlainBucketAddress(request, serviceConfig.objects.national);
          expect([401, 403]).toContain(plainAddressStatus);
        },
      );
    },
  );
});
