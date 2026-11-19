import { expect, test } from '@playwright/test';
import { expectLinkIssued, fetchFirstBytes, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  startLocalSigningService,
  type LocalSigningService,
} from '../../../../support/downloads/local-signing-service.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

/** The shortest link lifetime the backend accepts. */
const linkLifetimeSeconds = 60;
/** Waited past the reported expiry, so small clock differences with Google cannot keep the link alive. */
const graceAfterExpiryMs = 5_000;

test.describe('FBT-020', () => {
  let factory: TestAccountFactory;
  let activeUser: TestAccount;
  let localService: LocalSigningService | undefined;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    localService = await startLocalSigningService({ signedUrlTtlSeconds: linkLifetimeSeconds });
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
    await localService?.stop();
  });

  test('A download link stops working after it expires.', async ({ request }) => {
    test.setTimeout(150_000);
    await narrateCatalogTest('FBT-020');
    const { url, expiresAtMs } = await test.step(
      'The local Metrics API gives the signed-in active user a link to the national Ramsar wetlands file that expires in about 60 seconds',
      async () => {
        const reply = await requestSignedUrl(
          request,
          serviceConfig.objects.national,
          activeUser.idToken,
          localService?.url,
        );
        const url = expectLinkIssued(reply);
        const expiresAtMs = Date.parse(reply.body?.expires_at ?? '');
        const secondsUntilExpiry = (expiresAtMs - Date.now()) / 1000;
        expect(secondsUntilExpiry).toBeGreaterThan(linkLifetimeSeconds - 10);
        expect(secondsUntilExpiry).toBeLessThanOrEqual(linkLifetimeSeconds + 1);
        return { url, expiresAtMs };
      },
    );

    await test.step('Before it expires, the link downloads the first bytes of the Ramsar wetlands file', async () => {
      const download = await fetchFirstBytes(request, url);
      expect([200, 206]).toContain(download.status);
      expect(download.byteLength).toBeGreaterThan(0);
    });

    await test.step('Five seconds after its expiry time, the same link is refused as expired', async () => {
      await new Promise((resolve) => setTimeout(resolve, Math.max(expiresAtMs + graceAfterExpiryMs - Date.now(), 0)));
      const download = await fetchFirstBytes(request, url);
      const replyText = download.bytes.toString('utf8');
      expect([400, 401, 403]).toContain(download.status);
      expect(/expired/i.test(replyText), 'the storage error must say the link expired').toBe(true);
    });
  });
});
