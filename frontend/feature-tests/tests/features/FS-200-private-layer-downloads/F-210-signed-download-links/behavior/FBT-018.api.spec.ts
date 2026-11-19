import { expect, test } from '@playwright/test';
import { expectLinkIssued, fetchFirstBytes, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

function bucketPath(objectName: string): string {
  return `/${serviceConfig.bucket}/${objectName.split('/').map(encodeURIComponent).join('/')}`;
}

test.describe('FBT-018', () => {
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

  test('Editing a download link to point at a different file does not open that file.', async ({ request }) => {
    test.setTimeout(30_000);
    await narrateCatalogTest('FBT-018');
    const url = await test.step(
      'The signed-in active user gets a temporary link to the national Ramsar wetlands file',
      async () => {
        const url = expectLinkIssued(
          await requestSignedUrl(request, serviceConfig.objects.national, activeUser.idToken),
        );
        expect(decodeURIComponent(new URL(url).pathname), 'the link must name the Ramsar file in its path').toBe(
          decodeURIComponent(bucketPath(serviceConfig.objects.national)),
        );
        return url;
      },
    );

    await test.step(
      'The same link, with its file path swapped to the restricted Orinoquia file and its signature kept, is refused with 403 and an error document',
      async () => {
        const edited = new URL(url);
        edited.pathname = bucketPath(serviceConfig.objects.orinoquia);
        const download = await fetchFirstBytes(request, edited.toString());
        const replyText = download.bytes.toString('utf8');
        expect(download.status).toBe(403);
        expect(replyText.includes('<Error>'), 'the reply must be a storage error document, not file contents').toBe(
          true,
        );
      },
    );

    await test.step('The unedited link still downloads the first bytes of the Ramsar wetlands file', async () => {
      const download = await fetchFirstBytes(request, url);
      expect([200, 206]).toContain(download.status);
      expect(download.byteLength).toBeGreaterThan(0);
    });
  });
});
