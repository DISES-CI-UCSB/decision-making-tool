import { Injectable, inject } from '@angular/core';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { type User, type UserCredential } from 'firebase/auth';
import { environment } from '../../../../environments/environment';
import {
  isMultiFactorAuthRequired,
  TotpMfaService,
  type TotpChallengeSession,
} from './totp-mfa.service';

/**
 * Google Identity Services wrapper.
 *
 * If `environment.googleClientId` is populated, the service lazy-loads the
 * Google Identity Services (GIS) script and requests an ID token via the
 * One Tap / popup credential flow.
 *
 * TODO: wire to backend. Once GIS returns a real credential.idToken, POST
 * it to the auth backend so the backend can verify via Google's tokeninfo
 * endpoint and mint our app session.
 */

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GIS_SCRIPT_ID = 'google-accounts-id';

export const GIS_SIGN_IN_CANCELLED_MESSAGE =
  'Google sign-in was cancelled or could not be displayed.';

export interface GoogleProfile {
  uid?: string;
  idToken: string;
  name: string;
  email: string;
  avatarInitials: string;
  isStub: boolean;
}

export interface GoogleSignInCompleted {
  readonly kind: 'completed';
  readonly profile: GoogleProfile;
}

export interface GoogleSignInTotpRequired {
  readonly kind: 'totp-assertion-required';
  readonly assertion: TotpChallengeSession;
}

export type GoogleSignInResult = GoogleSignInCompleted | GoogleSignInTotpRequired;

function completedSignIn(profile: GoogleProfile): GoogleSignInCompleted {
  return { kind: 'completed', profile };
}

interface GisCredentialResponse {
  credential: string;
}

interface GisPromptNotification {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
}

interface GisGlobal {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GisCredentialResponse) => void;
      }): void;
      prompt(listener?: (notification: GisPromptNotification) => void): void;
    };
  };
}

export function isAbandonedGisPrompt(notification: unknown): boolean {
  if (notification === null || typeof notification !== 'object') {
    return false;
  }
  const prompt = notification as GisPromptNotification;
  if (prompt.isNotDisplayed?.() === true || prompt.isSkippedMoment?.() === true) {
    return true;
  }
  if (prompt.isDismissedMoment?.() === true) {
    return prompt.getDismissedReason?.() !== 'credential_returned';
  }
  return false;
}

export function settleOnce<T>(
  resolve: (value: T) => void,
  reject: (reason: unknown) => void,
): { resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let settled = false;
  return {
    resolve: (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    },
    reject: (reason) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(reason);
    },
  };
}

interface GisWindow extends Window {
  google?: GisGlobal;
}

@Injectable({ providedIn: 'root' })
export class GoogleIdentityService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly totpMfa = inject(TotpMfaService);

  private scriptPromise: Promise<void> | null = null;

  /**
   * Opens the Google sign-in flow and resolves with a completed profile or a
   * TOTP assertion challenge. Non-MFA failures still throw.
   */
  async signIn(): Promise<GoogleSignInResult> {
    if (this.firebase.isEnabled) {
      return this.firebaseSignIn();
    }
    if (!environment.googleClientId) {
      throw new Error('Google sign-in is not configured.');
    }
    return completedSignIn(await this.realSignIn(environment.googleClientId));
  }

  private async firebaseSignIn(): Promise<GoogleSignInResult> {
    const auth = this.firebase.auth;
    if (!auth) {
      throw new Error('Firebase Auth is not configured.');
    }

    try {
      const credential = await this.firebase.signInWithGooglePopup();
      return completedSignIn(await this.profileFromUser(credential.user));
    } catch (error) {
      if (isMultiFactorAuthRequired(error)) {
        return {
          kind: 'totp-assertion-required',
          assertion: this.totpMfa.createAssertionSession(auth, error),
        };
      }
      throw error;
    }
  }

  async profileFromCredential(credential: Pick<UserCredential, 'user'>): Promise<GoogleProfile> {
    return this.profileFromUser(credential.user);
  }

  private async profileFromUser(user: User): Promise<GoogleProfile> {
    const email = user.email ?? '';
    const name = user.displayName ?? email;
    return {
      uid: user.uid,
      idToken: await user.getIdToken(),
      name,
      email,
      avatarInitials: this.toInitials(name || email),
      isStub: false,
    };
  }

  private async realSignIn(clientId: string): Promise<GoogleProfile> {
    await this.loadGisScript();
    const gis = (window as GisWindow).google;
    if (!gis) {
      throw new Error('Google Identity Services did not initialise.');
    }

    return new Promise<GoogleProfile>((resolve, reject) => {
      const finish = settleOnce(resolve, reject);
      try {
        gis.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const profile = this.decodeIdToken(response.credential);
            if (!profile) {
              finish.reject(new Error('Could not decode Google ID token.'));
              return;
            }
            finish.resolve(profile);
          },
        });
        gis.accounts.id.prompt((notification) => {
          if (isAbandonedGisPrompt(notification)) {
            finish.reject(new Error(GIS_SIGN_IN_CANCELLED_MESSAGE));
          }
        });
      } catch (error) {
        finish.reject(error);
      }
    });
  }

  private loadGisScript(): Promise<void> {
    if (this.scriptPromise) {
      return this.scriptPromise;
    }
    if (document.getElementById(GIS_SCRIPT_ID)) {
      this.scriptPromise = Promise.resolve();
      return this.scriptPromise;
    }
    this.scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = GIS_SCRIPT_ID;
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }

  private decodeIdToken(credential: string): GoogleProfile | null {
    try {
      const payloadSegment = credential.split('.')[1];
      const padded = payloadSegment.padEnd(
        payloadSegment.length + ((4 - (payloadSegment.length % 4)) % 4),
        '=',
      );
      const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
      const parsed = JSON.parse(decoded) as {
        name?: string;
        email?: string;
        given_name?: string;
        family_name?: string;
      };
      const name = parsed.name ?? `${parsed.given_name ?? ''} ${parsed.family_name ?? ''}`.trim();
      const email = parsed.email ?? '';
      return {
        idToken: credential,
        name: name || email,
        email,
        avatarInitials: this.toInitials(name || email),
        isStub: false,
      };
    } catch {
      return null;
    }
  }

  private toInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return '?';
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
}
