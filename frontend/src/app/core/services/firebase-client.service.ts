import { Injectable } from '@angular/core';
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type Unsubscribe,
  type User,
  type UserCredential,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  type DocumentData,
  getFirestore,
  onSnapshot,
  setDoc,
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

  async signInWithGooglePopup(): Promise<UserCredential> {
    return signInWithPopup(this.requireAuth(), new GoogleAuthProvider());
  }

  async signInWithEmail(email: string, password: string): Promise<User> {
    const auth = this.requireAuth();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  }

  async createEmailUser(email: string, password: string): Promise<User> {
    const auth = this.requireAuth();
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return credential.user;
  }

  async getUserDocument(uid: string): Promise<DocumentData | null> {
    return this.getDocument('users', uid);
  }

  async getAccessRequestDocument(uid: string): Promise<DocumentData | null> {
    return this.getDocument('accessRequests', uid);
  }

  async setAccessRequestDocument(uid: string, data: DocumentData): Promise<void> {
    const firestore = this.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured.');
    }
    await setDoc(doc(firestore, 'accessRequests', uid), data, { merge: true });
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

  private async getDocument(
    collectionName: 'users' | 'accessRequests',
    uid: string,
  ): Promise<DocumentData | null> {
    const firestore = this.firestore;
    if (!firestore) {
      return null;
    }

    const snapshot = await getDoc(doc(firestore, collectionName, uid));
    return snapshot.exists() ? snapshot.data() : null;
  }

  private requireAuth(): Auth {
    const auth = this.auth;
    if (!auth) {
      throw new Error('Firebase Auth is not configured.');
    }
    return auth;
  }

  private ensureApp(): FirebaseApp {
    if (!this.app) {
      this.app = initializeApp(environment.firebase.config as FirebaseOptions);
    }
    return this.app;
  }
}
