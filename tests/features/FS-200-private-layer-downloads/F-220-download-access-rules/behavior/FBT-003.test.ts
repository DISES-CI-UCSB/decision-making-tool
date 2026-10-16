import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('FBT-003', () => {
  let factory: TestAccountFactory;
  let orinoquiaUserWithoutAuthenticator: TestAccount;
  let orinoquiaUserWithAuthenticator: TestAccount;

  beforeAll(async () => {
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
  }, 120_000);

  afterAll(async () => {
    await factory?.cleanUp();
  }, 60_000);

  it(
    'A SIRAP layer file needs authenticator sign-in and the matching region grant.',
    async () => {
      const withoutAuthenticator = await requestSignedUrl(
        serviceConfig.objects.orinoquia,
        orinoquiaUserWithoutAuthenticator.idToken,
      );
      expectRefusedWithoutLink(withoutAuthenticator, 403, 'mfa_required');

      const withAuthenticator = await requestSignedUrl(
        serviceConfig.objects.orinoquia,
        orinoquiaUserWithAuthenticator.idToken,
      );
      const download = await fetchFirstBytes(expectLinkIssued(withAuthenticator));
      expect([200, 206]).toContain(download.status);
      expect(download.byteLength).toBeGreaterThan(0);

      const otherRegion = await requestSignedUrl(
        serviceConfig.objects.ejeCafetero,
        orinoquiaUserWithAuthenticator.idToken,
      );
      expectRefusedWithoutLink(otherRegion, 403, 'layer_forbidden');
    },
    30_000,
  );
});
