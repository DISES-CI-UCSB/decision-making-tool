import { SIRAP_REGION_IDS, UserTier } from '@core/models';
import type { AdminManagedUserRecord } from '../services/admin-access-requests.service';
import {
  FAKE_ACTIVE_USER_UID_PREFIX,
  FAKE_DEMO_RECORD_COUNT,
  FAKE_SIRAP_REQUESTER_UID_PREFIX,
  appendDevelopmentFakeDemoData,
  buildFakeActiveUsers,
  buildFakeStandaloneSirapRequests,
  fakeActiveUserAdministeredSirapCount,
  fakeActiveUserAllowedSirapCount,
  fakeStandaloneSirapIds,
  fakeStandaloneSirapRequestCount,
  isFakeActiveUser,
  isFakeSirapRequest,
  isFakeSirapRequester,
  setForceAppendFakeDemoDataForTests,
  shouldAppendFakeDemoData,
} from './admin-access-requests-panel.fake-demo-data';

const realActiveUser: AdminManagedUserRecord = {
  uid: 'real-active-user',
  email: 'real@example.com',
  displayName: 'Real Active User',
  status: 'active',
  role: 'user',
  tier: UserTier.DecisionMaker,
  isAdmin: false,
  administeredSirapIds: [],
  allowedSirapIds: ['amazonia'],
  updatedAt: null,
};

describe('admin-access-requests-panel.fake-demo-data', () => {
  afterEach(() => setForceAppendFakeDemoDataForTests(null));

  it('keeps fake demo data off unless a test forces it on', () => {
    expect(shouldAppendFakeDemoData()).toBe(false);
    setForceAppendFakeDemoDataForTests(true);
    expect(shouldAppendFakeDemoData()).toBe(true);
  });

  it('builds standalone fake SIRAP requesters with non-colliding uids', () => {
    const requests = buildFakeStandaloneSirapRequests();

    expect(requests[0].uid).toBe(`${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`);
    expect(requests[0].displayName).toBe('Fake SIRAP Requester 1');
    expect(isFakeSirapRequester(requests[0].uid)).toBe(true);
    expect(isFakeSirapRequest(requests[0])).toBe(true);
    expect(isFakeSirapRequester('user-1')).toBe(false);
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
    expect(users[9].role).toBe('sirap-admin');
    expect(users[9].tier).toBe(UserTier.DecisionMaker);
    expect(users[24].role).toBe('super-admin');
    expect(users[24].isAdmin).toBe(true);
  });

  it('appends fake SIRAP requests and users after real records', () => {
    const fakeSirapRequests = buildFakeStandaloneSirapRequests();
    const fakeActiveUsers = buildFakeActiveUsers();
    const merged = appendDevelopmentFakeDemoData([], [realActiveUser], true);

    expect(merged.sirapRequests).toEqual(fakeSirapRequests);
    expect(merged.activeUsers).toHaveLength(1 + FAKE_DEMO_RECORD_COUNT);
    expect(merged.activeUsers[0]).toEqual(realActiveUser);
    expect(merged.activeUsers[1]).toEqual(fakeActiveUsers[0]);
  });

  it('returns only real records when fake demo data is disabled', () => {
    const merged = appendDevelopmentFakeDemoData([], [realActiveUser], false);

    expect(merged.sirapRequests).toEqual([]);
    expect(merged.activeUsers).toEqual([realActiveUser]);
  });
});
