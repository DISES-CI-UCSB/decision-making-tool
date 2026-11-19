import { expect, test } from '@playwright/test';
import { expectLinkIssued, fetchFirstBytes, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-004', () => {
  let factory: TestAccountFactory;
  let superAdmin: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    superAdmin = await factory.create({
      status: 'active',
      role: 'super-admin',
      allowedSirapIds: [],
      authenticator: true,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    'A super-admin with authenticator sign-in can download both regional (SIRAP) layers without region grants.',
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-004');
      await test.step(
        'The super-admin with authenticator sign-in and no region grants gets a link and downloads the first bytes of the Orinoquia savannas file',
        async () => {
          const orinoquiaReply = await requestSignedUrl(request, serviceConfig.objects.orinoquia, superAdmin.idToken);
          const orinoquiaDownload = await fetchFirstBytes(request, expectLinkIssued(orinoquiaReply));
          expect([200, 206]).toContain(orinoquiaDownload.status);
          expect(orinoquiaDownload.byteLength).toBeGreaterThan(0);
        },
      );

      await test.step(
        'The same super-admin gets a link and downloads the first bytes of the Eje Cafetero wetlands file',
        async () => {
          const ejeCafeteroReply = await requestSignedUrl(request, serviceConfig.objects.ejeCafetero, superAdmin.idToken);
          const ejeCafeteroDownload = await fetchFirstBytes(request, expectLinkIssued(ejeCafeteroReply));
          expect([200, 206]).toContain(ejeCafeteroDownload.status);
          expect(ejeCafeteroDownload.byteLength).toBeGreaterThan(0);
        },
      );
    },
  );
});
