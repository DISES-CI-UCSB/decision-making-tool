import { expect, test } from '@playwright/test';
import {
  expectRefusedWithoutLink,
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

test.describe('FBT-007', () => {
  let factory: TestAccountFactory;
  let userWithoutRegionGrant: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    userWithoutRegionGrant = await factory.create({
      status: 'active',
      role: 'user',
      allowedSirapIds: [],
      authenticator: true,
    });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    'A signed-in user with no regional (SIRAP) access cannot download a restricted regional file.',
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-007');
      await test.step(
        'An active user who signed in with an authenticator but has no region grant is refused the Orinoquia savannas file with 403 layer_forbidden and gets no link',
        async () => {
          const reply = await requestSignedUrl(request, serviceConfig.objects.orinoquia, userWithoutRegionGrant.idToken);
          expectRefusedWithoutLink(reply, 403, 'layer_forbidden');
        },
      );

      await test.step(
        "The Orinoquia savannas file's plain bucket address, opened with no sign-in, is refused with 401 or 403",
        async () => {
          const plainAddressStatus = await fetchPlainBucketAddress(request, serviceConfig.objects.orinoquia);
          expect([401, 403]).toContain(plainAddressStatus);
        },
      );
    },
  );
});
