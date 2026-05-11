import { Injectable, inject } from '@angular/core';
import {
  MANIFEST_STYLE_REQUESTS_COLLECTION,
  type ManifestStyleRequestAuthor,
  type ManifestStyleRequestDraft,
} from '@core/models/manifest-style-request.model';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { FirebaseClientService } from './firebase-client.service';

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
