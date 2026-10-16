import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectRefusedWithoutLink, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';

describe('FBT-005', () => {
  let factory: TestAccountFactory;
  let activeUser: TestAccount;

  beforeAll(async () => {
    factory = createTestAccountFactory();
    activeUser = await factory.create({
      status: 'active',
      role: 'user',
      allowedSirapIds: [],
      authenticator: false,
    });
  }, 120_000);

  afterAll(async () => {
    await factory?.cleanUp();
  }, 60_000);

  it(
    'Files missing from the download catalog cannot be requested, even when they exist in the bucket.',
    async () => {
      const unlistedReply = await requestSignedUrl(serviceConfig.objects.unlisted, activeUser.idToken);
      expectRefusedWithoutLink(unlistedReply, 404, 'object_not_in_catalog');

      const traversalReply = await requestSignedUrl(`../${serviceConfig.objects.national}`, activeUser.idToken);
      expectRefusedWithoutLink(traversalReply, 422);
    },
    30_000,
  );
});
