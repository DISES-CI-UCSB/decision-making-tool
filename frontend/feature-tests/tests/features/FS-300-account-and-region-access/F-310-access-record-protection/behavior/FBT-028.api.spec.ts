import { expect, test } from '@playwright/test';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  createTestAccountFactory,
  type TestAccount,
  type TestAccountFactory,
} from '../../../../support/downloads/test-accounts.ts';
import { expectRulesAcceptance, expectRulesRefusal } from '../../../../support/firestore/rules-outcome.ts';
import { narrateCatalogTest } from '../../../../support/reporting/test-narration.ts';

test.describe('FBT-028', () => {
  let factory: TestAccountFactory;
  let requester: TestAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    factory = createTestAccountFactory();
    requester = await factory.create({ status: 'active', role: 'user', allowedSirapIds: [], authenticator: true });
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await factory?.cleanUp();
  });

  test('A person cannot approve their own regional access request.', async () => {
    test.setTimeout(30_000);
    await narrateCatalogTest('FBT-028');
    const requestPath = `sirapAccessRequests/${requester.uid}_orinoquia`;
    const ownRequest = doc(requester.firestore, requestPath);

    await test.step('A user who signed in with an authenticator creates their own pending Orinoquia access request', async () => {
      await expectRulesAcceptance(
        setDoc(ownRequest, {
          uid: requester.uid,
          email: requester.email,
          displayName: requester.displayName,
          sirapId: 'orinoquia',
          status: 'pending',
          reason: null,
          requestedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
      expect((await factory.readAsAdmin(requestPath))?.status).toBe('pending');
    });

    await test.step('The same user is refused when marking that request approved, and it stays pending with no decision recorded', async () => {
      await expectRulesRefusal(
        updateDoc(ownRequest, {
          status: 'approved',
          decidedAt: serverTimestamp(),
          decidedBy: requester.uid,
          updatedAt: serverTimestamp(),
        }),
      );
      const stored = await factory.readAsAdmin(requestPath);
      expect(stored?.status).toBe('pending');
      expect(stored?.decidedBy).toBeUndefined();
    });

    await test.step('The user record still holds no regional access', async () => {
      const record = await factory.readAsAdmin(`users/${requester.uid}`);
      expect(record?.allowedSirapIds).toEqual([]);
      expect(record?.role).toBe('user');
    });
  });
});
