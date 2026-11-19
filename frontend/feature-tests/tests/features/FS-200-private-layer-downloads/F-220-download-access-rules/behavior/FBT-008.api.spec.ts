import { expect, test } from '@playwright/test';
import { expectLinkIssued, fetchFirstBytes, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-008', () => {
  let factory: TestAccountFactory;
  let ejeCafeteroUserWithAuthenticator: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    ejeCafeteroUserWithAuthenticator = await factory.create({
      status: 'active',
      role: 'sirap-user',
      allowedSirapIds: ['eje-cafetero'],
      authenticator: true,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    "A signed-in user with authenticator sign-in and a region grant can download that region's restricted file.",
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-008');
      const url = await test.step(
        'An Eje Cafetero-granted account that signed in with an authenticator gets a temporary link to the Eje Cafetero wetlands file that expires in 14 to 16 minutes',
        async () => {
          const reply = await requestSignedUrl(
            request,
            serviceConfig.objects.ejeCafetero,
            ejeCafeteroUserWithAuthenticator.idToken,
          );
          const url = expectLinkIssued(reply);

          const minutesUntilExpiry = (Date.parse(reply.body?.expires_at ?? '') - Date.now()) / 60_000;
          expect(minutesUntilExpiry).toBeGreaterThan(14);
          expect(minutesUntilExpiry).toBeLessThan(16);
          return url;
        },
      );

      await test.step('The temporary link downloads the first bytes of the Eje Cafetero wetlands file', async () => {
        const download = await fetchFirstBytes(request, url);
        expect([200, 206]).toContain(download.status);
        expect(download.byteLength).toBeGreaterThan(0);
      });
    },
  );
});
