import { Injectable, inject } from '@angular/core';
import {
  isSirapRegionId,
  readSirapRegionIds,
  type SirapAccessRequestStatus,
  type SirapRegionId,
} from '@core/models';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
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
  administeredSirapIds: SirapRegionId[];
}

export function shouldDenyRequestHistoryOnRevoke(
  requestData: DocumentData | null | undefined,
): boolean {
  return requestData?.['status'] === 'approved';
}

@Injectable({ providedIn: 'root' })
export class SirapAccessService {
  private readonly firebase = inject(FirebaseClientService);

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
    const uniqueIds = [...new Set(sirapIds)].filter(isSirapRegionId);
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
    const isSuperAdmin =
      data?.['status'] === 'active' &&
      (data['isSuperAdmin'] === true || data['isAdmin'] === true || data['role'] === 'admin');
    const administeredSirapIds =
      data?.['status'] === 'active' ? readSirapRegionIds(data['administeredSirapIds']) : [];
    if (!isSuperAdmin && administeredSirapIds.length === 0) {
      throw new Error('You do not administer any SIRAPs.');
    }
    return { uid, isSuperAdmin, administeredSirapIds };
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
    const allowedByUid = new Map(
      await Promise.all(
        [...new Set(requests.map((request) => request.uid))].map(async (uid) => {
          const snapshot = await getDoc(doc(firestore, 'users', uid));
          return [
            uid,
            snapshot.exists() ? readSirapRegionIds(snapshot.data()['allowedSirapIds']) : [],
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

    const userSnapshot = await getDoc(doc(firestore, 'users', request.uid));
    if (!userSnapshot.exists() || userSnapshot.data()['status'] !== 'active') {
      throw new Error('A super admin must approve this Firebase account before SIRAP access.');
    }

    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'sirapAccessRequests', request.id), {
      status: decision,
      decidedAt: serverTimestamp(),
      decidedBy: administrator.uid,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(firestore, 'users', request.uid), {
      allowedSirapIds:
        decision === 'approved' ? arrayUnion(request.sirapId) : arrayRemove(request.sirapId),
      updatedAt: serverTimestamp(),
      updatedBy: administrator.uid,
    });
    await batch.commit();
  }

  async revokeUserAccess(uid: string, sirapId: SirapRegionId): Promise<void> {
    const firestore = this.requireFirestore();
    const administrator = await this.getCurrentAdministrator();
    if (!administrator.isSuperAdmin && !administrator.administeredSirapIds.includes(sirapId)) {
      throw new Error('You cannot administer this SIRAP.');
    }
    const requestRef = doc(firestore, 'sirapAccessRequests', this.requestId(uid, sirapId));
    const requestSnapshot = await getDoc(requestRef);
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'users', uid), {
      allowedSirapIds: arrayRemove(sirapId),
      updatedAt: serverTimestamp(),
      updatedBy: administrator.uid,
    });
    if (
      shouldDenyRequestHistoryOnRevoke(requestSnapshot.exists() ? requestSnapshot.data() : null)
    ) {
      batch.update(requestRef, {
        status: 'denied',
        decidedAt: serverTimestamp(),
        decidedBy: administrator.uid,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
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
    if (!isSirapRegionId(data['sirapId'])) {
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
