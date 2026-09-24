import { Injectable, inject } from '@angular/core';
import {
  isSirapAccessRegionId,
  readAppRole,
  readSirapAccessRegionIds,
  roleAfterAccessChange,
  roleToUserTier,
  scopesMatchRole,
  type SirapAccessRequestStatus,
  type SirapRegionId,
} from '@core/models';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { TotpMfaService } from './totp-mfa.service';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';

export interface SirapAccessRequestRecord {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  sirapId: SirapRegionId;
  status: SirapAccessRequestStatus;
  reason: string | null;
  requestedAt: Date | null;
  decidedAt: Date | null;
  decidedBy: string | null;
}

export interface CurrentSirapAdministrator {
  uid: string;
  isSuperAdmin: boolean;
  allowedSirapIds: SirapRegionId[];
  administeredSirapIds: SirapRegionId[];
}

export function shouldDenyRequestHistoryOnRevoke(
  requestData: DocumentData | null | undefined,
): boolean {
  return requestData?.['status'] === 'approved';
}

/**
 * Current-region ids to store after a SIRAP decision.
 * Retired ids such as caribe and pacifico are dropped, because security rules
 * only accept orinoquia and eje-cafetero. arrayUnion and arrayRemove would keep
 * those retired ids and the whole decision batch would be denied.
 */
export function repairedAllowedSirapIds(
  currentAllowedSirapIds: unknown,
  sirapId: SirapRegionId,
  decision: 'approved' | 'denied',
): SirapRegionId[] {
  const current = readSirapAccessRegionIds(currentAllowedSirapIds);
  if (decision === 'denied' || !isSirapAccessRegionId(sirapId)) {
    return current.filter((id) => id !== sirapId);
  }
  return current.includes(sirapId) ? current : [...current, sirapId];
}

@Injectable({ providedIn: 'root' })
export class SirapAccessService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly totpMfa = inject(TotpMfaService);

  async listOwnRequests(): Promise<SirapAccessRequestRecord[]> {
    const firestore = this.requireFirestore();
    const uid = this.requireCurrentUid();
    const snapshot = await getDocs(
      query(collection(firestore, 'sirapAccessRequests'), where('uid', '==', uid)),
    );
    return this.parseRequests(
      snapshot.docs.map((requestDoc) => [requestDoc.id, requestDoc.data()]),
    );
  }

  async submitOwnRequests(sirapIds: readonly SirapRegionId[], reason?: string): Promise<void> {
    const currentUser = this.firebase.auth?.currentUser;
    if (!currentUser) {
      throw new Error('Sign in before requesting SIRAP access.');
    }
    if (!(await this.totpMfa.userHasEnrolledTotp(currentUser))) {
      throw new Error('Set up your authenticator before requesting SIRAP access.');
    }
    await this.submitRequestsForIdentity(
      currentUser.uid,
      currentUser.email ?? '',
      currentUser.displayName ?? currentUser.email ?? 'Firebase user',
      sirapIds,
      reason,
    );
  }

  async submitRequestsForIdentity(
    uid: string,
    email: string,
    displayName: string,
    sirapIds: readonly SirapRegionId[],
    reason?: string,
  ): Promise<void> {
    const firestore = this.requireFirestore();
    const uniqueIds = [...new Set(sirapIds)].filter(isSirapAccessRegionId);
    if (uniqueIds.length === 0) {
      throw new Error('Select at least one SIRAP.');
    }

    const batch = writeBatch(firestore);
    for (const sirapId of uniqueIds) {
      batch.set(
        doc(firestore, 'sirapAccessRequests', this.requestId(uid, sirapId)),
        {
          uid,
          email,
          displayName,
          sirapId,
          status: 'pending',
          reason: reason?.trim() || null,
          requestedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          decidedAt: deleteField(),
          decidedBy: deleteField(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  async getCurrentAdministrator(): Promise<CurrentSirapAdministrator> {
    const firestore = this.requireFirestore();
    const uid = this.requireCurrentUid();
    const snapshot = await getDoc(doc(firestore, 'users', uid));
    const data = snapshot.exists() ? snapshot.data() : null;
    const allowedSirapIds =
      data?.['status'] === 'active' ? readSirapAccessRegionIds(data['allowedSirapIds']) : [];
    const administeredSirapIds =
      data?.['status'] === 'active' ? readSirapAccessRegionIds(data['administeredSirapIds']) : [];
    const isSuperAdmin =
      data?.['status'] === 'active' &&
      readAppRole(
        data['role'],
        allowedSirapIds,
        administeredSirapIds,
        data['isAdmin'] === true || data['isSuperAdmin'] === true,
      ) === 'super-admin';
    if (!isSuperAdmin && administeredSirapIds.length === 0) {
      throw new Error('You do not administer any SIRAPs.');
    }
    return { uid, isSuperAdmin, allowedSirapIds, administeredSirapIds };
  }

  async listRequestsForAdministrator(): Promise<SirapAccessRequestRecord[]> {
    const firestore = this.requireFirestore();
    const administrator = await this.getCurrentAdministrator();
    const snapshots = administrator.isSuperAdmin
      ? [await getDocs(collection(firestore, 'sirapAccessRequests'))]
      : await Promise.all(
          administrator.administeredSirapIds.map((sirapId) =>
            getDocs(
              query(collection(firestore, 'sirapAccessRequests'), where('sirapId', '==', sirapId)),
            ),
          ),
        );

    const requests = this.parseRequests(
      snapshots.flatMap((snapshot) =>
        snapshot.docs.map((requestDoc) => [requestDoc.id, requestDoc.data()] as const),
      ),
    );
    if (!administrator.isSuperAdmin) {
      return requests.sort(
        (a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0),
      );
    }

    const allowedByUid = new Map(
      await Promise.all(
        [...new Set(requests.map((request) => request.uid))].map(async (uid) => {
          const snapshot = await getDoc(doc(firestore, 'users', uid));
          return [
            uid,
            snapshot.exists() ? readSirapAccessRegionIds(snapshot.data()['allowedSirapIds']) : [],
          ] as const;
        }),
      ),
    );
    return requests
      .map((request) =>
        request.status === 'approved' && !allowedByUid.get(request.uid)?.includes(request.sirapId)
          ? { ...request, status: 'denied' as const }
          : request,
      )
      .sort((a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0));
  }

  async decideRequest(
    request: SirapAccessRequestRecord,
    decision: 'approved' | 'denied',
  ): Promise<void> {
    const firestore = this.requireFirestore();
    const administrator = await this.getCurrentAdministrator();
    if (
      !administrator.isSuperAdmin &&
      !administrator.administeredSirapIds.includes(request.sirapId)
    ) {
      throw new Error('You cannot administer this SIRAP.');
    }

    const userRef = doc(firestore, 'users', request.uid);
    const requestRef = doc(firestore, 'sirapAccessRequests', request.id);
    await runTransaction(firestore, async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists() || userSnapshot.data()['status'] !== 'active') {
        throw new Error('That person does not have an active account.');
      }
      const userData = userSnapshot.data();
      const nextAllowedSirapIds = repairedAllowedSirapIds(
        userData['allowedSirapIds'],
        request.sirapId,
        decision,
      );
      const nextRole = this.roleForSirapWrite(userData, nextAllowedSirapIds);

      transaction.update(requestRef, {
        status: decision,
        decidedAt: serverTimestamp(),
        decidedBy: administrator.uid,
        updatedAt: serverTimestamp(),
      });
      transaction.update(userRef, {
        allowedSirapIds: nextAllowedSirapIds,
        role: nextRole,
        tier: roleToUserTier(nextRole),
        updatedAt: serverTimestamp(),
        updatedBy: administrator.uid,
      });
    });
  }

  async revokeUserAccess(uid: string, sirapId: SirapRegionId): Promise<void> {
    const firestore = this.requireFirestore();
    const administrator = await this.getCurrentAdministrator();
    if (!administrator.isSuperAdmin && !administrator.administeredSirapIds.includes(sirapId)) {
      throw new Error('You cannot administer this SIRAP.');
    }
    const userRef = doc(firestore, 'users', uid);
    const requestRef = doc(firestore, 'sirapAccessRequests', this.requestId(uid, sirapId));
    await runTransaction(firestore, async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      const requestSnapshot = await transaction.get(requestRef);
      const userData = userSnapshot.exists() ? userSnapshot.data() : {};
      const nextAllowedSirapIds = repairedAllowedSirapIds(
        userSnapshot.exists() ? userSnapshot.data()['allowedSirapIds'] : [],
        sirapId,
        'denied',
      );
      const nextRole = this.roleForSirapWrite(userData, nextAllowedSirapIds);
      transaction.update(userRef, {
        allowedSirapIds: nextAllowedSirapIds,
        role: nextRole,
        tier: roleToUserTier(nextRole),
        updatedAt: serverTimestamp(),
        updatedBy: administrator.uid,
      });
      if (
        shouldDenyRequestHistoryOnRevoke(requestSnapshot.exists() ? requestSnapshot.data() : null)
      ) {
        transaction.update(requestRef, {
          status: 'denied',
          decidedAt: serverTimestamp(),
          decidedBy: administrator.uid,
          updatedAt: serverTimestamp(),
        });
      }
    });
  }

  private roleForSirapWrite(userData: DocumentData, nextAllowedSirapIds: readonly SirapRegionId[]) {
    const administeredSirapIds = readSirapAccessRegionIds(userData['administeredSirapIds']);
    const currentRole = readAppRole(
      userData['role'],
      readSirapAccessRegionIds(userData['allowedSirapIds']),
      administeredSirapIds,
      userData['isAdmin'] === true || userData['isSuperAdmin'] === true,
    );
    const nextRole = roleAfterAccessChange(currentRole, nextAllowedSirapIds, administeredSirapIds);
    if (!scopesMatchRole(nextRole, nextAllowedSirapIds, administeredSirapIds)) {
      throw new Error(
        'SIRAP administrators keep read access to every SIRAP they administer. Change that role before removing it.',
      );
    }
    return nextRole;
  }

  private requireFirestore() {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured for this environment.');
    }
    return firestore;
  }

  private requireCurrentUid(): string {
    const uid = this.firebase.auth?.currentUser?.uid;
    if (!uid) {
      throw new Error('Sign in with Firebase first.');
    }
    return uid;
  }

  private requestId(uid: string, sirapId: SirapRegionId): string {
    return `${uid}_${sirapId}`;
  }

  private parseRequests(entries: readonly (readonly [string, DocumentData])[]) {
    return entries
      .map(([id, data]) => this.parseRequest(id, data))
      .filter((request): request is SirapAccessRequestRecord => request !== null);
  }

  private parseRequest(id: string, data: DocumentData): SirapAccessRequestRecord | null {
    if (!isSirapAccessRegionId(data['sirapId'])) {
      return null;
    }
    const status =
      data['status'] === 'approved' || data['status'] === 'denied' ? data['status'] : 'pending';
    return {
      id,
      uid: this.readString(data, 'uid'),
      email: this.readString(data, 'email'),
      displayName: this.readString(data, 'displayName') || this.readString(data, 'email'),
      sirapId: data['sirapId'],
      status,
      reason: this.readString(data, 'reason') || null,
      requestedAt: this.readDate(data, 'requestedAt'),
      decidedAt: this.readDate(data, 'decidedAt'),
      decidedBy: this.readString(data, 'decidedBy') || null,
    };
  }

  private readString(data: DocumentData, key: string): string {
    return typeof data[key] === 'string' ? data[key] : '';
  }

  private readDate(data: DocumentData, key: string): Date | null {
    const value = data[key] as unknown;
    return value && typeof value === 'object' && 'toDate' in value
      ? (value as { toDate: () => Date }).toDate()
      : null;
  }
}
