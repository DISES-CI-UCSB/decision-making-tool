import { SIRAP_REGION_IDS, UserTier } from '@core/models';
import type { AdminManagedUserRecord } from '../services/admin-access-requests.service';
import {
  FAKE_ACTIVE_USER_UID_PREFIX,
  FAKE_DEMO_RECORD_COUNT,
  FAKE_PENDING_UID_PREFIX,
  FAKE_SIRAP_REQUESTER_UID_PREFIX,
  appendDevelopmentFakeDemoData,
  appendDevelopmentFakePendingData,
  buildFakeActiveUsers,
  buildFakePendingAccounts,
  buildFakeSirapRequestsForAccounts,
  buildFakeStandaloneSirapRequests,
  fakeActiveUserAdministeredSirapCount,
  fakeActiveUserAllowedSirapCount,
  fakePendingSirapIds,
  fakePendingSirapRequestCount,
  fakeStandaloneSirapIds,
  fakeStandaloneSirapRequestCount,
  isFakeActiveUser,
  isFakePendingAccount,
  isFakeSirapRequest,
  isFakeSirapRequester,
  shouldAppendFakeDemoData,
  shouldAppendFakePendingAccounts,
} from './admin-access-requests-panel.fake-demo-data';

const realPendingAccount = {
  uid: 'real-pending-user',
  email: 'real@example.com',
  displayName: 'Real Pending User',
  organization: 'Real organization',
  reason: 'Needs access',
  provider: 'google',
  status: 'pending' as const,
  requestedAt: new Date('2026-08-18T12:00:00Z'),
  submittedAt: null,
};

const realActiveUser: AdminManagedUserRecord = {
  uid: 'real-active-user',
  email: 'real@example.com',
  displayName: 'Real Active User',
  status: 'active',
  role: 'authorized_viewer',
  tier: UserTier.DecisionMaker,
  isAdmin: false,
  administeredSirapIds: [],
  allowedSirapIds: ['amazonia'],
  updatedAt: null,
};

describe('admin-access-requests-panel.fake-demo-data', () => {
  it('gates fake demo data behind non-production builds', () => {
    expect(shouldAppendFakeDemoData(true)).toBe(false);
    expect(shouldAppendFakeDemoData(false)).toBe(true);
    expect(shouldAppendFakePendingAccounts(true)).toBe(false);
    expect(shouldAppendFakePendingAccounts(false)).toBe(true);
  });

  it('builds 100 deterministic fake pending accounts', () => {
    const accounts = buildFakePendingAccounts();

    expect(accounts).toHaveLength(FAKE_DEMO_RECORD_COUNT);
    expect(accounts[0]).toMatchObject({
      uid: `${FAKE_PENDING_UID_PREFIX}001`,
      email: 'fake.user.001@example.test',
      displayName: 'Fake User 1',
    });
    expect(isFakePendingAccount(accounts[0].uid)).toBe(true);
    expect(isFakePendingAccount('pending-user')).toBe(false);
  });

  it('builds standalone fake SIRAP requesters with non-colliding uids', () => {
    const requests = buildFakeStandaloneSirapRequests();

    expect(requests[0].uid).toBe(`${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`);
    expect(requests[0].displayName).toBe('Fake SIRAP Requester 1');
    expect(isFakeSirapRequester(requests[0].uid)).toBe(true);
    expect(isFakeSirapRequest(requests[0])).toBe(true);
    expect(isFakeSirapRequester(`${FAKE_PENDING_UID_PREFIX}001`)).toBe(false);
    expect(new Set(requests.map((request) => request.uid)).size).toBe(FAKE_DEMO_RECORD_COUNT);
  });

  it('varies standalone pending SIRAP counts from 1 through 3 deterministically', () => {
    expect(fakeStandaloneSirapRequestCount(1)).toBe(2);
    expect(fakeStandaloneSirapRequestCount(2)).toBe(3);
    expect(fakeStandaloneSirapRequestCount(3)).toBe(1);
    expect(fakeStandaloneSirapIds(5)).toEqual([
      SIRAP_REGION_IDS[5 % SIRAP_REGION_IDS.length],
      SIRAP_REGION_IDS[(5 + 1) % SIRAP_REGION_IDS.length],
      SIRAP_REGION_IDS[(5 + 2) % SIRAP_REGION_IDS.length],
    ]);
  });

  it('builds 100 deterministic fake active users with varied grants', () => {
    const users = buildFakeActiveUsers();

    expect(users).toHaveLength(FAKE_DEMO_RECORD_COUNT);
    expect(users[0]).toMatchObject({
      uid: `${FAKE_ACTIVE_USER_UID_PREFIX}001`,
      email: 'fake.active.user.001@example.test',
      displayName: 'Fake Active User 1',
    });
    expect(isFakeActiveUser(users[0].uid)).toBe(true);
    expect(fakeActiveUserAllowedSirapCount(1)).toBe(2);
    expect(fakeActiveUserAdministeredSirapCount(1)).toBe(1);
    expect(users[9].tier).toBe(UserTier.Manager);
    expect(users[24].isAdmin).toBe(true);
  });

  it('varies pending-account SIRAP counts from 0 through 3 deterministically', () => {
    expect(fakePendingSirapRequestCount(1)).toBe(1);
    expect(fakePendingSirapRequestCount(4)).toBe(0);
    expect(fakePendingSirapIds(7)).toEqual([
      SIRAP_REGION_IDS[1],
      SIRAP_REGION_IDS[2],
      SIRAP_REGION_IDS[3],
    ]);
  });

  it('appends fake records after real records in development', () => {
    const fakeAccounts = buildFakePendingAccounts();
    const fakeSirapRequests = [
      ...buildFakeSirapRequestsForAccounts(fakeAccounts),
      ...buildFakeStandaloneSirapRequests(),
    ];
    const fakeActiveUsers = buildFakeActiveUsers();
    const merged = appendDevelopmentFakeDemoData([realPendingAccount], [], [realActiveUser], true);

    expect(merged.pendingRequests).toHaveLength(1 + FAKE_DEMO_RECORD_COUNT);
    expect(merged.pendingRequests[0]).toEqual(realPendingAccount);
    expect(merged.pendingRequests[1]).toEqual(fakeAccounts[0]);
    expect(merged.sirapRequests).toEqual(fakeSirapRequests);
    expect(merged.activeUsers).toHaveLength(1 + FAKE_DEMO_RECORD_COUNT);
    expect(merged.activeUsers[0]).toEqual(realActiveUser);
    expect(merged.activeUsers[1]).toEqual(fakeActiveUsers[0]);
  });

  it('returns only real records when fake demo data is disabled', () => {
    const merged = appendDevelopmentFakeDemoData([realPendingAccount], [], [realActiveUser], false);

    expect(merged.pendingRequests).toEqual([realPendingAccount]);
    expect(merged.sirapRequests).toEqual([]);
    expect(merged.activeUsers).toEqual([realActiveUser]);
  });

  it('preserves legacy appendDevelopmentFakePendingData behavior', () => {
    const merged = appendDevelopmentFakePendingData([realPendingAccount], [], true);

    expect(merged.pendingRequests).toHaveLength(1 + FAKE_DEMO_RECORD_COUNT);
    expect(merged.sirapRequests.length).toBeGreaterThan(0);
  });
});
