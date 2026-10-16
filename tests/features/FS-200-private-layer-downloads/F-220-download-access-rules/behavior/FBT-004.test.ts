import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectLinkIssued, fetchFirstBytes, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';

describe('FBT-004', () => {
  let factory: TestAccountFactory;
  let superAdmin: TestAccount;

  beforeAll(async () => {
    factory = createTestAccountFactory();
    superAdmin = await factory.create({
      status: 'active',
      role: 'super-admin',
      allowedSirapIds: [],
      authenticator: true,
    });
  }, 120_000);

  afterAll(async () => {
    await factory?.cleanUp();
  }, 60_000);

  it(
    'A super-admin signed in with an authenticator can get links for both SIRAP regions.',
    async () => {
      const orinoquiaReply = await requestSignedUrl(serviceConfig.objects.orinoquia, superAdmin.idToken);
      const orinoquiaDownload = await fetchFirstBytes(expectLinkIssued(orinoquiaReply));
      expect([200, 206]).toContain(orinoquiaDownload.status);
      expect(orinoquiaDownload.byteLength).toBeGreaterThan(0);

      const ejeCafeteroReply = await requestSignedUrl(serviceConfig.objects.ejeCafetero, superAdmin.idToken);
      const ejeCafeteroDownload = await fetchFirstBytes(expectLinkIssued(ejeCafeteroReply));
      expect([200, 206]).toContain(ejeCafeteroDownload.status);
      expect(ejeCafeteroDownload.byteLength).toBeGreaterThan(0);
    },
    30_000,
  );
});
