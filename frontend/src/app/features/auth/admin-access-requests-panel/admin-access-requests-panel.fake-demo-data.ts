import { SIRAP_REGION_IDS, UserTier, type SirapRegionId } from '@core/models';
import type {
  AccessRequestRecord,
  AdminManagedUserRecord,
} from '../services/admin-access-requests.service';
import type { SirapAccessRequestRecord } from '../services/sirap-access.service';

export const FAKE_DEMO_RECORD_COUNT = 100;
export const FAKE_PENDING_ACCOUNT_COUNT = FAKE_DEMO_RECORD_COUNT;
export const FAKE_PENDING_UID_PREFIX = 'fake-pending-';
export const FAKE_SIRAP_REQUESTER_UID_PREFIX = 'fake-sirap-requester-';
export const FAKE_ACTIVE_USER_UID_PREFIX = 'fake-active-user-';

const FAKE_ORGANIZATIONS = [
  'Instituto de Investigación de Recursos Biológicos Alexander von Humboldt',
  'Universidad Nacional de Colombia',
  'Parques Nacionales Naturales de Colombia',
  'Ministerio de Ambiente y Desarrollo Sostenible',
  'Corporación Autónoma Regional de Cundinamarca',
  'World Wildlife Fund Colombia',
  'Conservation International Andes',
  'Fundación Natura Colombia',
] as const;

const FAKE_REQUEST_BASE_MS = Date.UTC(2026, 0, 15, 14, 30, 0);

let forceAppendFakeDemoDataForTests: boolean | null = null;

export function setForceAppendFakeDemoDataForTests(value: boolean | null): void {
  forceAppendFakeDemoDataForTests = value;
}

/** @deprecated Use setForceAppendFakeDemoDataForTests */
export function setForceAppendFakePendingAccountsForTests(value: boolean | null): void {
  setForceAppendFakeDemoDataForTests(value);
}

export function shouldAppendFakeDemoData(isProduction: boolean): boolean {
  if (forceAppendFakeDemoDataForTests !== null) {
    return forceAppendFakeDemoDataForTests;
  }
  return !isProduction;
}

/** @deprecated Use shouldAppendFakeDemoData */
export function shouldAppendFakePendingAccounts(isProduction: boolean): boolean {
  return shouldAppendFakeDemoData(isProduction);
}

export function isFakePendingAccount(uid: string): boolean {
  return uid.startsWith(FAKE_PENDING_UID_PREFIX);
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

function fakePendingIndex(uid: string): number | null {
  if (!isFakePendingAccount(uid)) {
    return null;
  }
  const match = /^fake-pending-(\d{3})$/.exec(uid);
  return match ? Number(match[1]) : null;
}

export function fakePendingSirapRequestCount(index: number): number {
  return index % 4;
}

export function fakePendingSirapIds(index: number): SirapRegionId[] {
  const count = fakePendingSirapRequestCount(index);
  return Array.from(
    { length: count },
    (_, offset) => SIRAP_REGION_IDS[(index + offset) % SIRAP_REGION_IDS.length],
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

export function buildFakePendingAccounts(count = FAKE_DEMO_RECORD_COUNT): AccessRequestRecord[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const uid = `${FAKE_PENDING_UID_PREFIX}${String(index).padStart(3, '0')}`;
    return {
      uid,
      email: `fake.user.${String(index).padStart(3, '0')}@example.test`,
      displayName: `Fake User ${index}`,
      organization: FAKE_ORGANIZATIONS[offset % FAKE_ORGANIZATIONS.length],
      reason: `Demo access request ${index}`,
      provider: 'google',
      status: 'pending',
      requestedAt: new Date(FAKE_REQUEST_BASE_MS + index * 3_600_000),
      submittedAt: null,
    };
  });
}

export function buildFakeSirapRequestsForAccounts(
  accounts: readonly AccessRequestRecord[],
): SirapAccessRequestRecord[] {
  const requests: SirapAccessRequestRecord[] = [];
  for (const account of accounts) {
    const index = fakePendingIndex(account.uid);
    if (index === null) {
      continue;
    }
    for (const sirapId of fakePendingSirapIds(index)) {
      requests.push({
        id: `${account.uid}_${sirapId}`,
        uid: account.uid,
        email: account.email,
        displayName: account.displayName,
        sirapId,
        status: 'pending',
        reason: null,
        requestedAt: account.requestedAt,
        decidedAt: null,
        decidedBy: null,
      });
    }
  }
  return requests;
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
    const tier = index % 10 === 0 ? UserTier.Manager : UserTier.DecisionMaker;
    const isAdmin = index % 25 === 0;
    return {
      uid,
      email: `fake.active.user.${String(index).padStart(3, '0')}@example.test`,
      displayName: `Fake Active User ${index}`,
      status: 'active',
      role: tier >= UserTier.Manager ? 'science_publisher' : 'authorized_viewer',
      tier,
      isAdmin,
      administeredSirapIds: fakeActiveUserAdministeredSirapIds(index),
      allowedSirapIds: fakeActiveUserAllowedSirapIds(index),
      updatedAt: new Date(FAKE_REQUEST_BASE_MS + index * 1_800_000),
    };
  });
}

export function appendDevelopmentFakeDemoData(
  realPendingRequests: readonly AccessRequestRecord[],
  realSirapRequests: readonly SirapAccessRequestRecord[],
  realActiveUsers: readonly AdminManagedUserRecord[],
  includeFakeDemoData: boolean,
): {
  pendingRequests: AccessRequestRecord[];
  sirapRequests: SirapAccessRequestRecord[];
  activeUsers: AdminManagedUserRecord[];
} {
  if (!includeFakeDemoData) {
    return {
      pendingRequests: [...realPendingRequests],
      sirapRequests: [...realSirapRequests],
      activeUsers: [...realActiveUsers],
    };
  }

  const fakePendingRequests = buildFakePendingAccounts();
  const fakeSirapRequests = [
    ...buildFakeSirapRequestsForAccounts(fakePendingRequests),
    ...buildFakeStandaloneSirapRequests(),
  ];
  return {
    pendingRequests: [...realPendingRequests, ...fakePendingRequests],
    sirapRequests: [...realSirapRequests, ...fakeSirapRequests],
    activeUsers: [...realActiveUsers, ...buildFakeActiveUsers()],
  };
}

/** @deprecated Use appendDevelopmentFakeDemoData */
export function appendDevelopmentFakePendingData(
  realPendingRequests: readonly AccessRequestRecord[],
  realSirapRequests: readonly SirapAccessRequestRecord[],
  includeFakePendingAccounts: boolean,
): {
  pendingRequests: AccessRequestRecord[];
  sirapRequests: SirapAccessRequestRecord[];
} {
  const merged = appendDevelopmentFakeDemoData(
    realPendingRequests,
    realSirapRequests,
    [],
    includeFakePendingAccounts,
  );
  return {
    pendingRequests: merged.pendingRequests,
    sirapRequests: merged.sirapRequests,
  };
}
