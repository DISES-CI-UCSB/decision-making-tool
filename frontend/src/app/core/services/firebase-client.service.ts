import { Injectable } from '@angular/core';
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type Auth,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  type DocumentData,
  getFirestore,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FirebaseClientService {
  private app: FirebaseApp | null = null;

  get isEnabled(): boolean {
    return environment.firebase.enabled && Boolean(environment.firebase.config.projectId);
  }

  get auth(): Auth | null {
    if (!this.isEnabled) {
      return null;
    }
    return getAuth(this.ensureApp());
  }

  get firestore(): Firestore | null {
    if (!this.isEnabled) {
      return null;
    }
    return getFirestore(this.ensureApp());
  }

  get currentUser(): User | null {
    return this.auth?.currentUser ?? null;
  }

  subscribeToAuthState(callback: (user: User | null) => void): Unsubscribe | null {
    const auth = this.auth;
    if (!auth) {
      return null;
    }
    return onAuthStateChanged(auth, callback);
  }

  async signOut(): Promise<void> {
    const auth = this.auth;
    if (auth) {
      await firebaseSignOut(auth);
    }
  }

  async getUserDocument(uid: string): Promise<DocumentData | null> {
    const firestore = this.firestore;
    if (!firestore) {
      return null;
    }

    const snapshot = await getDoc(doc(firestore, 'users', uid));
    return snapshot.exists() ? snapshot.data() : null;
  }

  subscribeToUserDocument(
    uid: string,
    callback: (data: DocumentData | null) => void,
  ): Unsubscribe | null {
    const firestore = this.firestore;
    if (!firestore) {
      return null;
    }
    return onSnapshot(doc(firestore, 'users', uid), (snapshot) => {
      callback(snapshot.exists() ? snapshot.data() : null);
    });
  }

  private ensureApp(): FirebaseApp {
    if (!this.app) {
      this.app = initializeApp(environment.firebase.config as FirebaseOptions);
    }
    return this.app;
  }
}
