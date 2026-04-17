import { Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';

/**
 * Google Identity Services wrapper.
 *
 * If `environment.googleClientId` is populated, the service lazy-loads the
 * Google Identity Services (GIS) script and requests an ID token via the
 * One Tap / popup credential flow. If the client ID is empty (MVP default)
 * the service resolves a fake María Gómez profile after 300 ms so the
 * Login / Request Access modal can demo end-to-end with no external
 * dependencies.
 *
 * TODO: wire to backend. Once GIS returns a real credential.idToken, POST
 * it to the auth backend so the backend can verify via Google's tokeninfo
 * endpoint and mint our app session.
 */

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GIS_SCRIPT_ID = 'google-accounts-id';
const STUB_LATENCY_MS = 300;

export interface GoogleProfile {
  idToken: string;
  name: string;
  email: string;
  avatarInitials: string;
  isStub: boolean;
}

interface GisCredentialResponse {
  credential: string;
}

interface GisGlobal {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GisCredentialResponse) => void;
      }): void;
      prompt(listener?: (notification: unknown) => void): void;
    };
  };
}

interface GisWindow extends Window {
  google?: GisGlobal;
}

const STUB_PROFILE: Omit<GoogleProfile, 'idToken' | 'isStub'> = {
  name: 'María Gómez',
  email: 'maria.gomez@sirap-caribe.gov.co',
  avatarInitials: 'MG',
};

@Injectable({ providedIn: 'root' })
export class GoogleIdentityService {
  private scriptPromise: Promise<void> | null = null;

  /**
   * Opens the Google sign-in flow and resolves with the signed-in profile.
   * In stub mode (no client ID) the returned profile's `isStub` is `true`.
   */
  async signIn(): Promise<GoogleProfile> {
    if (!environment.googleClientId) {
      return this.stubSignIn();
    }
    try {
      return await this.realSignIn(environment.googleClientId);
    } catch (error) {
      console.warn('[GoogleIdentityService] real sign-in failed, falling back to stub', error);
      return this.stubSignIn();
    }
  }

  private stubSignIn(): Promise<GoogleProfile> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ...STUB_PROFILE,
          idToken: `stub.${Date.now()}`,
          isStub: true,
        });
      }, STUB_LATENCY_MS);
    });
  }

  private async realSignIn(clientId: string): Promise<GoogleProfile> {
    await this.loadGisScript();
    const gis = (window as GisWindow).google;
    if (!gis) {
      throw new Error('Google Identity Services did not initialise.');
    }

    return new Promise<GoogleProfile>((resolve, reject) => {
      try {
        gis.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const profile = this.decodeIdToken(response.credential);
            if (!profile) {
              reject(new Error('Could not decode Google ID token.'));
              return;
            }
            resolve(profile);
          },
        });
        gis.accounts.id.prompt();
      } catch (error) {
        reject(error);
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
