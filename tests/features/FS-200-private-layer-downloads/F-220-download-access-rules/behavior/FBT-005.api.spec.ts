import { test } from '@playwright/test';
import { expectRefusedWithoutLink, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-005', () => {
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
    'A file in the bucket but missing from the download catalog is refused, including ../ path tricks.',
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-005');
      await test.step(
        'The signed-in active user is refused a release manifest that is in the bucket but not in the download catalog, with 404 object_not_in_catalog and no link',
        async () => {
          const unlistedReply = await requestSignedUrl(request, serviceConfig.objects.unlisted, activeUser.idToken);
          expectRefusedWithoutLink(unlistedReply, 404, 'object_not_in_catalog');
        },
      );

      await test.step(
        "The same user is refused a key made of '../' plus the national Ramsar wetlands file path, with 422 and no link",
        async () => {
          const traversalReply = await requestSignedUrl(
            request,
            `../${serviceConfig.objects.national}`,
            activeUser.idToken,
          );
          expectRefusedWithoutLink(traversalReply, 422);
        },
      );
    },
  );
});
