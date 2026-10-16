import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('FBT-001', () => {
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
    'A signed-in user with an active account can download a national layer file with the returned link, and opening the plain bucket address for that file is refused.',
    async () => {
      const reply = await requestSignedUrl(serviceConfig.objects.national, activeUser.idToken);
      const url = expectLinkIssued(reply);

      const minutesUntilExpiry = (Date.parse(reply.body?.expires_at ?? '') - Date.now()) / 60_000;
      expect(minutesUntilExpiry).toBeGreaterThan(14);
      expect(minutesUntilExpiry).toBeLessThan(16);

      const download = await fetchFirstBytes(url);
      expect([200, 206]).toContain(download.status);
      expect(download.byteLength).toBeGreaterThan(0);

      const plainAddressStatus = await fetchPlainBucketAddress(serviceConfig.objects.national);
      expect([401, 403]).toContain(plainAddressStatus);
    },
    30_000,
  );
});
