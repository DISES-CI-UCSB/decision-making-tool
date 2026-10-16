import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectRefusedWithoutLink, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';

describe('FBT-002', () => {
  let factory: TestAccountFactory;
  let pendingUser: TestAccount;

  beforeAll(async () => {
    factory = createTestAccountFactory();
    pendingUser = await factory.create({
      status: 'pending',
      role: 'user',
      allowedSirapIds: [],
      authenticator: false,
    });
  }, 120_000);

  afterAll(async () => {
    await factory?.cleanUp();
  }, 60_000);

  it(
    'Requests without a valid sign-in, or from a pending account, get no download link.',
    async () => {
      const withoutToken = await requestSignedUrl(serviceConfig.objects.national);
      expectRefusedWithoutLink(withoutToken, 401);

      const withGarbageToken = await requestSignedUrl(serviceConfig.objects.national, 'not-a-firebase-id-token');
      expectRefusedWithoutLink(withGarbageToken, 401);

      const fromPendingAccount = await requestSignedUrl(serviceConfig.objects.national, pendingUser.idToken);
      expectRefusedWithoutLink(fromPendingAccount, 403, 'account_inactive');
    },
    30_000,
  );
});
