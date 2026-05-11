import { Injectable, inject } from '@angular/core';
import {
  MANIFEST_STYLE_REQUESTS_COLLECTION,
  type ManifestStyleRequestDraft,
} from '@core/models/manifest-style-request.model';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { FirebaseClientService } from './firebase-client.service';

@Injectable({ providedIn: 'root' })
export class ManifestStyleRequestService {
  private readonly firebase = inject(FirebaseClientService);

  async saveStyleRequest(draft: ManifestStyleRequestDraft): Promise<string> {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured for manifest style requests.');
    }

    const docRef = await addDoc(collection(firestore, MANIFEST_STYLE_REQUESTS_COLLECTION), {
      ...draft,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    return docRef.id;
  }
}
