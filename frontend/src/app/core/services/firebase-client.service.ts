import { Injectable } from '@angular/core';
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type Unsubscribe,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { UserTier } from '@core/models';
import {
  doc,
  getDoc,
  type DocumentData,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { environment } from '../../../environments/environment';

export interface EnsuredSelfUserRecord {
  created: boolean;
  status: string;
}

/** Directory rows are only for people who are being created or are already active. */
export function shouldEnsureActiveDirectory(existingUserStatus: string | null): boolean {
  return existingUserStatus === null || existingUserStatus === 'active';
}

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

  async reauthenticateWithGooglePopup(user: User): Promise<UserCredential> {
    return reauthenticateWithPopup(user, new GoogleAuthProvider());
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
    return this.getDocument(uid);
  }

  /**
   * Creates this person's user row after Google sign-in.
   * An existing user document is never overwritten. A directory row is added
   * only when the account is active, in a follow-up write so rules can see it.
   */
  async ensureSelfUserRecord(user: User): Promise<EnsuredSelfUserRecord> {
    const firestore = this.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured.');
    }

    const email = user.email ?? '';
    const displayName = user.displayName || email || 'Google user';
    const userRef = doc(firestore, 'users', user.uid);
    const directoryRef = doc(firestore, 'userDirectory', user.uid);

    const ensured = await runTransaction(firestore, async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists()) {
        transaction.set(userRef, {
          uid: user.uid,
          email,
          displayName,
          status: 'active',
          role: 'user',
          tier: UserTier.DecisionMaker,
          allowedSirapIds: [],
          administeredSirapIds: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      const storedStatus = userSnapshot.exists() ? userSnapshot.data()['status'] : 'active';
      return {
        created: !userSnapshot.exists(),
        status: typeof storedStatus === 'string' ? storedStatus : 'active',
      };
    });

    if (shouldEnsureActiveDirectory(ensured.status)) {
      await runTransaction(firestore, async (transaction) => {
        const directorySnapshot = await transaction.get(directoryRef);
        if (!directorySnapshot.exists()) {
          transaction.set(directoryRef, {
            uid: user.uid,
            email,
            displayName,
            status: 'active',
            updatedAt: serverTimestamp(),
          });
        }
      });
    }

    return ensured;
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

  private async getDocument(uid: string): Promise<DocumentData | null> {
    const firestore = this.firestore;
    if (!firestore) {
      return null;
    }

    const snapshot = await getDoc(doc(firestore, 'users', uid));
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
