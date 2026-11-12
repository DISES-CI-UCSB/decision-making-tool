import { test } from '@playwright/test';
import { expectRefusedWithoutLink, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

/** Firebase records when sessions end in whole seconds, so a token issued in the same second would still count as current. */
const SECONDS_BOUNDARY_MARGIN_MS = 1_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe('FBT-022', () => {
  let factory: TestAccountFactory;
  let userLosingAuthenticator: TestAccount;
  let userBeingDisabled: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    factory = createTestAccountFactory();
    [userLosingAuthenticator, userBeingDisabled] = await Promise.all([
      factory.create({
        status: 'active',
        role: 'sirap-user',
        allowedSirapIds: ['orinoquia'],
        authenticator: true,
      }),
      factory.create({
        status: 'active',
        role: 'sirap-user',
        allowedSirapIds: ['orinoquia'],
        authenticator: true,
      }),
    ]);
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    'A sign-in from before 2-step verification was removed, or before the account was disabled, cannot get download links.',
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-022');
      await delay(SECONDS_BOUNDARY_MARGIN_MS);

      await test.step(
        "After an administrator removes an Orinoquia-granted account's authenticator and ends its sessions, the sign-in it had before is refused the Orinoquia savannas file with 401 session_revoked and no link",
        async () => {
          await factory.removeAuthenticatorAndEndSessions(userLosingAuthenticator.uid);
          const reply = await requestSignedUrl(
            request,
            serviceConfig.objects.orinoquia,
            userLosingAuthenticator.idToken,
          );
          expectRefusedWithoutLink(reply, 401, 'session_revoked');
        },
      );

      await test.step(
        'After an administrator disables a second Orinoquia-granted account, the sign-in it had before is refused the same file with 401 account_disabled and no link',
        async () => {
          await factory.disableAccount(userBeingDisabled.uid);
          const reply = await requestSignedUrl(request, serviceConfig.objects.orinoquia, userBeingDisabled.idToken);
          expectRefusedWithoutLink(reply, 401, 'account_disabled');
        },
      );
    },
  );
});
