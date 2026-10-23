import { expect, test } from '@playwright/test';
import {
  expectRefusedWithoutLink,
  fetchPlainBucketAddress,
  requestSignedUrl,
} from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-006', () => {
  test(
    'A visitor who is not signed in cannot download a restricted regional file.',
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-006');
      await test.step(
        'A visitor with no sign-in is refused the Orinoquia savannas file with 401 invalid_token and gets no link',
        async () => {
          const withoutToken = await requestSignedUrl(request, serviceConfig.objects.orinoquia);
          expectRefusedWithoutLink(withoutToken, 401, 'invalid_token');
        },
      );

      await test.step(
        'A visitor with a made-up sign-in token is refused the Orinoquia savannas file with 401 invalid_token and gets no link',
        async () => {
          const withMadeUpToken = await requestSignedUrl(
            request,
            serviceConfig.objects.orinoquia,
            'not-a-firebase-id-token',
          );
          expectRefusedWithoutLink(withMadeUpToken, 401, 'invalid_token');
        },
      );

      await test.step(
        "The Orinoquia savannas file's plain bucket address, opened with no sign-in, is refused with 401 or 403",
        async () => {
          const plainAddressStatus = await fetchPlainBucketAddress(request, serviceConfig.objects.orinoquia);
          expect([401, 403]).toContain(plainAddressStatus);
        },
      );
    },
  );
});
