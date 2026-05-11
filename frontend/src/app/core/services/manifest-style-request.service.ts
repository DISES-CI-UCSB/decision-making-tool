import { Injectable, inject } from '@angular/core';
import {
  MANIFEST_STYLE_REQUESTS_COLLECTION,
  type ManifestStyleRequestAuthor,
  type ManifestStyleRequestDraft,
} from '@core/models/manifest-style-request.model';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { FirebaseClientService } from './firebase-client.service';

export interface ManifestStyleRequestPublishResult {
  requestId: string;
  targetPath?: string;
  archivePath?: string;
  archiveUrl?: string;
  manifestUrl?: string;
  publishedAt?: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ManifestStyleRequestService {
  private readonly firebase = inject(FirebaseClientService);

  async saveStyleRequest(draft: ManifestStyleRequestDraft): Promise<string> {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured for manifest style requests.');
    }

    const author = this.getCurrentAuthor();
    const docRef = await addDoc(collection(firestore, MANIFEST_STYLE_REQUESTS_COLLECTION), {
      ...draft,
      ...author,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return docRef.id;
  }

  async publishSavedStyleRequest(requestId: string): Promise<ManifestStyleRequestPublishResult> {
    const user = this.firebase.currentUser;
    if (!user) {
      throw new Error('Sign in before publishing a manifest style request.');
    }

    const idToken = await user.getIdToken();
    const response = await fetch('/api/dev/manifest-style-publish', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requestId }),
    });

    const payload = (await response.json().catch(() => null)) as
      | ManifestStyleRequestPublishResult
      | { message?: string }
      | null;

    if (!response.ok) {
      throw new Error(payload?.message ?? `Publish failed with HTTP ${response.status}`);
    }

    return {
      requestId,
      ...(payload ?? {}),
    };
  }

  private getCurrentAuthor(): ManifestStyleRequestAuthor {
    const user = this.firebase.currentUser;
    if (!user) {
      throw new Error('Sign in before saving a manifest style request for review.');
    }
    if (!user.email) {
      throw new Error('Your signed-in account needs an email before saving a style request.');
    }

    return {
      createdByUid: user.uid,
      createdByEmail: user.email,
      createdByDisplayName: user.displayName ?? null,
    };
  }
}
