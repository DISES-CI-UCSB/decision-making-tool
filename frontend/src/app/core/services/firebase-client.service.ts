import { Injectable } from '@angular/core';
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
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

  private ensureApp(): FirebaseApp {
    if (!this.app) {
      this.app = initializeApp(environment.firebase.config as FirebaseOptions);
    }
    return this.app;
  }
}
