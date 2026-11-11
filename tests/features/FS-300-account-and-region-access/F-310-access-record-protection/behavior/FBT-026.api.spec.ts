import { expect, test } from '@playwright/test';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { expectRefusedWithoutLink, requestSignedUrl } from '../../../../support/downloads/service-client.ts';
import { serviceConfig } from '../../../../support/downloads/service-config.ts';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { expectRulesRefusal } from '../../../../support/firestore/rules-outcome.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-026', () => {
  let factory: TestAccountFactory;
  let activeUser: TestAccount;
  let deniedUser: TestAccount;
  let activeRecordBefore: Record<string, unknown> | undefined;
  let deniedRecordBefore: Record<string, unknown> | undefined;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    [activeUser, deniedUser] = await Promise.all([
      factory.create({ status: 'active', role: 'user', allowedSirapIds: [], authenticator: true }),
      factory.create({ status: 'denied', role: 'user', allowedSirapIds: [], authenticator: true }),
    ]);
    activeRecordBefore = await factory.readAsAdmin(`users/${activeUser.uid}`);
    deniedRecordBefore = await factory.readAsAdmin(`users/${deniedUser.uid}`);
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test(
    'A signed-in user cannot give themselves regional access, a higher role, or reactivate a denied account by editing their own record.',
    async ({ request }) => {
      test.setTimeout(30_000);
      await narrateCatalogTest('FBT-026');
      const ownRecord = (account: TestAccount) => doc(account.firestore, 'users', account.uid);

      await test.step('An active user who signed in with an authenticator is refused when adding the Orinoquia region to their own record', async () => {
        await expectRulesRefusal(
          updateDoc(ownRecord(activeUser), {
            allowedSirapIds: ['orinoquia'],
            role: 'sirap-user',
            tier: 2,
            updatedAt: serverTimestamp(),
            updatedBy: activeUser.uid,
          }),
        );
      });

      await test.step('The same user is refused when raising their own role to super-admin or to Orinoquia regional admin', async () => {
        await expectRulesRefusal(
          updateDoc(ownRecord(activeUser), {
            role: 'super-admin',
            tier: 3,
            updatedAt: serverTimestamp(),
            updatedBy: activeUser.uid,
          }),
        );
        await expectRulesRefusal(
          updateDoc(ownRecord(activeUser), {
            role: 'sirap-admin',
            tier: 2,
            allowedSirapIds: ['orinoquia'],
            administeredSirapIds: ['orinoquia'],
            updatedAt: serverTimestamp(),
            updatedBy: activeUser.uid,
          }),
        );
      });

      await test.step('A denied user who signed in with an authenticator is refused when setting their own account to active', async () => {
        await expectRulesRefusal(
          updateDoc(ownRecord(deniedUser), {
            status: 'active',
            updatedAt: serverTimestamp(),
            updatedBy: deniedUser.uid,
          }),
        );
      });

      await test.step('An Admin SDK read shows both records exactly as they were before the attempts', async () => {
        expect(activeRecordBefore?.status).toBe('active');
        expect(deniedRecordBefore?.status).toBe('denied');
        expect(await factory.readAsAdmin(`users/${activeUser.uid}`)).toEqual(activeRecordBefore);
        expect(await factory.readAsAdmin(`users/${deniedUser.uid}`)).toEqual(deniedRecordBefore);
      });

      await test.step('The signing service still refuses the Orinoquia savannas file to both users and gives no link', async () => {
        const activeReply = await requestSignedUrl(request, serviceConfig.objects.orinoquia, activeUser.idToken);
        expectRefusedWithoutLink(activeReply, 403, 'layer_forbidden');
        const deniedReply = await requestSignedUrl(request, serviceConfig.objects.orinoquia, deniedUser.idToken);
        expectRefusedWithoutLink(deniedReply, 403, 'account_inactive');
      });
    },
  );
});
