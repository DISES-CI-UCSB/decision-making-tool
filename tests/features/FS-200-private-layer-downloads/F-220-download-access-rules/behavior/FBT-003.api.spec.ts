import { expect, test } from '@playwright/test';
import {
  expectLinkIssued,
  expectRefusedWithoutLink,
  fetchFirstBytes,
  requestSignedUrl,
} from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-003', () => {
  let factory: TestAccountFactory;
  let orinoquiaUserWithoutAuthenticator: TestAccount;
  let orinoquiaUserWithAuthenticator: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    orinoquiaUserWithoutAuthenticator = await factory.create({
      status: 'active',
      role: 'sirap-user',
      allowedSirapIds: ['orinoquia'],
      authenticator: false,
    });
    orinoquiaUserWithAuthenticator = await factory.create({
      status: 'active',
      role: 'sirap-user',
      allowedSirapIds: ['orinoquia'],
      authenticator: true,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    "A regional (SIRAP) layer download is refused without authenticator sign-in or without that region's grant.",
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-003');
      await test.step(
        'An Orinoquia-granted account that signed in with a password only is refused the Orinoquia savannas file with 403 mfa_required and gets no link',
        async () => {
          const withoutAuthenticator = await requestSignedUrl(
            request,
            serviceConfig.objects.orinoquia,
            orinoquiaUserWithoutAuthenticator.idToken,
          );
          expectRefusedWithoutLink(withoutAuthenticator, 403, 'mfa_required');
        },
      );

      await test.step(
        'An Orinoquia-granted account that signed in with an authenticator gets a link and downloads the first bytes of the Orinoquia savannas file',
        async () => {
          const withAuthenticator = await requestSignedUrl(
            request,
            serviceConfig.objects.orinoquia,
            orinoquiaUserWithAuthenticator.idToken,
          );
          const download = await fetchFirstBytes(request, expectLinkIssued(withAuthenticator));
          expect([200, 206]).toContain(download.status);
          expect(download.byteLength).toBeGreaterThan(0);
        },
      );

      await test.step(
        'The same authenticator account is refused the Eje Cafetero wetlands file, outside its region grant, with 403 layer_forbidden and gets no link',
        async () => {
          const otherRegion = await requestSignedUrl(
            request,
            serviceConfig.objects.ejeCafetero,
            orinoquiaUserWithAuthenticator.idToken,
          );
          expectRefusedWithoutLink(otherRegion, 403, 'layer_forbidden');
        },
      );
    },
  );
});
