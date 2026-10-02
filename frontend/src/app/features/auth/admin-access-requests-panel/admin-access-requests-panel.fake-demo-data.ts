import { roleForScopes, roleToUserTier, SIRAP_REGION_IDS, type SirapRegionId } from '@core/models';
import type { AdminManagedUserRecord } from '../services/admin-access-requests.service';
import type { SirapAccessRequestRecord } from '../services/sirap-access.service';

export const FAKE_DEMO_RECORD_COUNT = 100;
export const FAKE_SIRAP_REQUESTER_UID_PREFIX = 'fake-sirap-requester-';
export const FAKE_ACTIVE_USER_UID_PREFIX = 'fake-active-user-';

const FAKE_REQUEST_BASE_MS = Date.UTC(2026, 0, 15, 14, 30, 0);

let forceAppendFakeDemoDataForTests: boolean | null = null;

export function setForceAppendFakeDemoDataForTests(value: boolean | null): void {
  forceAppendFakeDemoDataForTests = value;
}

/** Fake records stay off in every environment. Tests opt in with the setter above. */
export function shouldAppendFakeDemoData(): boolean {
  if (forceAppendFakeDemoDataForTests !== null) {
    return forceAppendFakeDemoDataForTests;
  }
  return false;
}

export function isFakeSirapRequester(uid: string): boolean {
  return uid.startsWith(FAKE_SIRAP_REQUESTER_UID_PREFIX);
}

export function isFakeActiveUser(uid: string): boolean {
  return uid.startsWith(FAKE_ACTIVE_USER_UID_PREFIX);
}

export function isFakeSirapRequest(request: Pick<SirapAccessRequestRecord, 'uid' | 'id'>): boolean {
  return (
    isFakeSirapRequester(request.uid) || request.id.startsWith(FAKE_SIRAP_REQUESTER_UID_PREFIX)
  );
}

export function fakeStandaloneSirapRequestCount(index: number): number {
  return (index % 3) + 1;
}

export function fakeStandaloneSirapIds(index: number): SirapRegionId[] {
  const count = fakeStandaloneSirapRequestCount(index);
  return Array.from(
    { length: count },
    (_, offset) => SIRAP_REGION_IDS[(index + offset) % SIRAP_REGION_IDS.length],
  );
}

export function fakeActiveUserAllowedSirapCount(index: number): number {
  return (index % 4) + 1;
}

export function fakeActiveUserAdministeredSirapCount(index: number): number {
  return index % 3;
}

export function fakeActiveUserAllowedSirapIds(index: number): SirapRegionId[] {
  const count = fakeActiveUserAllowedSirapCount(index);
  return Array.from(
    { length: count },
    (_, offset) => SIRAP_REGION_IDS[(index + offset) % SIRAP_REGION_IDS.length],
  );
}

export function fakeActiveUserAdministeredSirapIds(index: number): SirapRegionId[] {
  const count = fakeActiveUserAdministeredSirapCount(index);
  return Array.from(
    { length: count },
    (_, offset) => SIRAP_REGION_IDS[(index + offset + 2) % SIRAP_REGION_IDS.length],
  );
}

export function buildFakeStandaloneSirapRequests(
  count = FAKE_DEMO_RECORD_COUNT,
): SirapAccessRequestRecord[] {
  const requests: SirapAccessRequestRecord[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const index = offset + 1;
    const uid = `${FAKE_SIRAP_REQUESTER_UID_PREFIX}${String(index).padStart(3, '0')}`;
    const email = `fake.sirap.requester.${String(index).padStart(3, '0')}@example.test`;
    const displayName = `Fake SIRAP Requester ${index}`;
    for (const [offsetWithinGroup, sirapId] of fakeStandaloneSirapIds(index).entries()) {
      requests.push({
        id: `${uid}_${sirapId}`,
        uid,
        email,
        displayName,
        sirapId,
        status: 'pending',
        reason: `Demo standalone SIRAP request ${index}`,
        requestedAt: new Date(
          FAKE_REQUEST_BASE_MS + index * 3_600_000 + offsetWithinGroup * 1_800_000,
        ),
        decidedAt: null,
        decidedBy: null,
      });
    }
  }
  return requests;
}

export function buildFakeActiveUsers(count = FAKE_DEMO_RECORD_COUNT): AdminManagedUserRecord[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const uid = `${FAKE_ACTIVE_USER_UID_PREFIX}${String(index).padStart(3, '0')}`;
    const allowedSirapIds = fakeActiveUserAllowedSirapIds(index);
    const administeredSirapIds = fakeActiveUserAdministeredSirapIds(index);
    const role = roleForScopes(allowedSirapIds, administeredSirapIds, index % 25 === 0);
    return {
      uid,
      email: `fake.active.user.${String(index).padStart(3, '0')}@example.test`,
      displayName: `Fake Active User ${index}`,
      status: 'active',
      role,
      tier: roleToUserTier(role),
      isAdmin: role === 'super-admin',
      administeredSirapIds,
      allowedSirapIds,
      updatedAt: new Date(FAKE_REQUEST_BASE_MS + index * 1_800_000),
    };
  });
}

export function appendDevelopmentFakeDemoData(
  realSirapRequests: readonly SirapAccessRequestRecord[],
  realActiveUsers: readonly AdminManagedUserRecord[],
  includeFakeDemoData: boolean,
): {
  sirapRequests: SirapAccessRequestRecord[];
  activeUsers: AdminManagedUserRecord[];
} {
  if (!includeFakeDemoData) {
    return {
      sirapRequests: [...realSirapRequests],
      activeUsers: [...realActiveUsers],
    };
  }

  return {
    sirapRequests: [...realSirapRequests, ...buildFakeStandaloneSirapRequests()],
    activeUsers: [...realActiveUsers, ...buildFakeActiveUsers()],
  };
}
