import { expect, test } from '@playwright/test';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { expectRulesAcceptance, expectRulesRefusal } from '../../../../support/firestore/rules-outcome.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-027', () => {
  let factory: TestAccountFactory;
  let orinoquiaAdmin: TestAccount;
  let ordinaryUser: TestAccount;
  let superAdmin: TestAccount;
  let superAdminRecordBefore: Record<string, unknown> | undefined;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    [orinoquiaAdmin, ordinaryUser, superAdmin] = await Promise.all([
      factory.create({
        status: 'active',
        role: 'sirap-admin',
        allowedSirapIds: ['orinoquia'],
        administeredSirapIds: ['orinoquia'],
        authenticator: true,
      }),
      factory.create({ status: 'active', role: 'user', allowedSirapIds: [], authenticator: false }),
      factory.create({ status: 'active', role: 'super-admin', allowedSirapIds: [], authenticator: false }),
    ]);
    superAdminRecordBefore = await factory.readAsAdmin(`users/${superAdmin.uid}`);
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test('A regional admin can grant only the regions they administer.', async () => {
    test.setTimeout(30_000);
    await narrateCatalogTest('FBT-027');
    const grantAsOrinoquiaAdmin = (target: TestAccount, allowedSirapIds: string[]) =>
      updateDoc(doc(orinoquiaAdmin.firestore, 'users', target.uid), {
        allowedSirapIds,
        role: 'sirap-user',
        tier: 2,
        updatedAt: serverTimestamp(),
        updatedBy: orinoquiaAdmin.uid,
      });

    await test.step('The Orinoquia regional admin grants Orinoquia to an ordinary user, and the Admin SDK read shows the grant', async () => {
      await expectRulesAcceptance(grantAsOrinoquiaAdmin(ordinaryUser, ['orinoquia']));
      const record = await factory.readAsAdmin(`users/${ordinaryUser.uid}`);
      expect(record?.allowedSirapIds).toEqual(['orinoquia']);
      expect(record?.role).toBe('sirap-user');
    });

    await test.step('The same admin is refused when also granting Eje Cafetero, a region they do not administer, and the user keeps only Orinoquia', async () => {
      await expectRulesRefusal(grantAsOrinoquiaAdmin(ordinaryUser, ['orinoquia', 'eje-cafetero']));
      const record = await factory.readAsAdmin(`users/${ordinaryUser.uid}`);
      expect(record?.allowedSirapIds).toEqual(['orinoquia']);
    });

    await test.step("The same admin is refused when making the same Orinoquia grant on a super-admin's record, which stays unchanged", async () => {
      await expectRulesRefusal(grantAsOrinoquiaAdmin(superAdmin, ['orinoquia']));
      expect(superAdminRecordBefore?.role).toBe('super-admin');
      expect(await factory.readAsAdmin(`users/${superAdmin.uid}`)).toEqual(superAdminRecordBefore);
    });
  });
});
