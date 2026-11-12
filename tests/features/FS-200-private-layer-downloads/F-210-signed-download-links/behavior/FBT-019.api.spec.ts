import { expect, test } from '@playwright/test';
import {
  expectLinkIssued,
  fetchFirstBytes,
  requestSignedUrl,
  sendWriteToSignedLink,
} from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

/** Eight bytes, so a wrongly accepted upload could not replace the file with anything sizable. */
const tinyUploadBody = Buffer.from('dmt-test', 'utf8');

test.describe('FBT-019', () => {
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

  test('A download link cannot upload, replace, or delete the file.', async ({ request }) => {
    test.setTimeout(30_000);
    await narrateCatalogTest('FBT-019');
    const url = await test.step(
      'The signed-in active user gets a temporary link to the national Ramsar wetlands file',
      async () => expectLinkIssued(await requestSignedUrl(request, serviceConfig.objects.national, activeUser.idToken)),
    );

    const bytesBefore = await test.step('The link downloads the first bytes of the Ramsar wetlands file', async () => {
      const download = await fetchFirstBytes(request, url);
      expect([200, 206]).toContain(download.status);
      expect(download.byteLength).toBeGreaterThan(0);
      return download.bytes;
    });

    await test.step('A PUT of an eight-byte body through the link is refused with 403', async () => {
      const upload = await sendWriteToSignedLink(request, url, 'PUT', tinyUploadBody);
      expect(upload.status).toBe(403);
    });

    await test.step('A DELETE through the link is refused with 403', async () => {
      const removal = await sendWriteToSignedLink(request, url, 'DELETE');
      expect(removal.status).toBe(403);
    });

    await test.step('The link still downloads the same first bytes as before the PUT and DELETE', async () => {
      const download = await fetchFirstBytes(request, url);
      expect([200, 206]).toContain(download.status);
      expect(download.bytes.equals(bytesBefore), 'the first 1024 bytes must be unchanged').toBe(true);
    });
  });
});
