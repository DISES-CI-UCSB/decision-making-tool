import { test } from '@playwright/test';
import { expectRefusedWithoutLink, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-002', () => {
  let factory: TestAccountFactory;
  let pendingUser: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    pendingUser = await factory.create({
      status: 'pending',
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
    'Download links are refused when the sign-in is missing, fake, or from a pending account.',
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-002');
      await test.step(
        'A request with no sign-in is refused the national Ramsar wetlands file with 401 and gets no link',
        async () => {
          const withoutToken = await requestSignedUrl(request, serviceConfig.objects.national);
          expectRefusedWithoutLink(withoutToken, 401);
        },
      );

      await test.step(
        'A request with a made-up sign-in token is refused the Ramsar wetlands file with 401 and gets no link',
        async () => {
          const withGarbageToken = await requestSignedUrl(
            request,
            serviceConfig.objects.national,
            'not-a-firebase-id-token',
          );
          expectRefusedWithoutLink(withGarbageToken, 401);
        },
      );

      await test.step(
        'An account still pending approval is refused the Ramsar wetlands file with 403 account_inactive and gets no link',
        async () => {
          const fromPendingAccount = await requestSignedUrl(
            request,
            serviceConfig.objects.national,
            pendingUser.idToken,
          );
          expectRefusedWithoutLink(fromPendingAccount, 403, 'account_inactive');
        },
      );
    },
  );
});
