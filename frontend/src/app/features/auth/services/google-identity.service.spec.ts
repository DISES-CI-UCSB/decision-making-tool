import { TestBed } from '@angular/core/testing';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import {
  GIS_SIGN_IN_CANCELLED_MESSAGE,
  GoogleIdentityService,
  isAbandonedGisPrompt,
  settleOnce,
} from './google-identity.service';
import { AUTH_ERROR_MFA_REQUIRED, TotpMfaService } from './totp-mfa.service';

describe('GoogleIdentityService', () => {
  it('fails when Google sign-in is not configured instead of returning a fake profile', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: { isEnabled: false, auth: null },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    await expect(TestBed.inject(GoogleIdentityService).signIn()).rejects.toThrow(
      'Google sign-in is not configured.',
    );
  });

  it('fails when Firebase Auth is enabled but not configured', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: { isEnabled: true, auth: null },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    await expect(TestBed.inject(GoogleIdentityService).signIn()).rejects.toThrow(
      'Firebase Auth is not configured.',
    );
  });

  it('returns a completed profile after a Firebase Google popup', async () => {
    const firebase = {
      isEnabled: true,
      auth: {},
      signInWithGooglePopup: vi.fn().mockResolvedValue({
        user: {
          uid: 'user-1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          getIdToken: vi.fn().mockResolvedValue('id-token'),
        },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseClientService, useValue: firebase },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    const profile = {
      uid: 'user-1',
      idToken: 'id-token',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarInitials: 'AL',
      isStub: false,
    };
    await expect(TestBed.inject(GoogleIdentityService).signIn()).resolves.toEqual({
      kind: 'completed',
      profile,
    });
  });

  it('builds a Google profile from a completed UserCredential', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: { isEnabled: false, auth: null },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    await expect(
      TestBed.inject(GoogleIdentityService).profileFromCredential({
        user: {
          uid: 'user-1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          getIdToken: vi.fn().mockResolvedValue('id-token'),
        } as never,
      }),
    ).resolves.toEqual({
      uid: 'user-1',
      idToken: 'id-token',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarInitials: 'AL',
      isStub: false,
    });
  });

  it('returns a TOTP challenge and keeps the original MultiFactorError', async () => {
    const auth = { app: 'auth' };
    const mfaError = {
      code: AUTH_ERROR_MFA_REQUIRED,
      customData: { email: 'ada@example.com' },
    };
    const assertion = {
      email: 'ada@example.com',
      hint: { uid: 'totp-1', factorId: 'totp' },
    };
    const createAssertionSession = vi.fn().mockReturnValue(assertion);
    const firebase = {
      isEnabled: true,
      auth,
      signInWithGooglePopup: vi.fn().mockRejectedValue(mfaError),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseClientService, useValue: firebase },
        { provide: TotpMfaService, useValue: { createAssertionSession } },
      ],
    });

    await expect(TestBed.inject(GoogleIdentityService).signIn()).resolves.toEqual({
      kind: 'totp-assertion-required',
      assertion,
    });
    expect(createAssertionSession).toHaveBeenCalledWith(auth, mfaError);
  });

  it('rethrows non-MFA popup failures', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: {
            isEnabled: true,
            auth: {},
            signInWithGooglePopup: vi.fn().mockRejectedValue(new Error('popup-closed-by-user')),
          },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    await expect(TestBed.inject(GoogleIdentityService).signIn()).rejects.toThrow(
      'popup-closed-by-user',
    );
  });
});

describe('isAbandonedGisPrompt', () => {
  it('treats a not-displayed prompt as abandoned', () => {
    expect(
      isAbandonedGisPrompt({
        isNotDisplayed: () => true,
        isSkippedMoment: () => false,
        isDismissedMoment: () => false,
      }),
    ).toBe(true);
  });

  it('treats a skipped prompt as abandoned', () => {
    expect(
      isAbandonedGisPrompt({
        isNotDisplayed: () => false,
        isSkippedMoment: () => true,
        isDismissedMoment: () => false,
      }),
    ).toBe(true);
  });

  it('treats a dismissed prompt as abandoned unless a credential was returned', () => {
    expect(
      isAbandonedGisPrompt({
        isNotDisplayed: () => false,
        isSkippedMoment: () => false,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'cancel_called',
      }),
    ).toBe(true);
    expect(
      isAbandonedGisPrompt({
        isNotDisplayed: () => false,
        isSkippedMoment: () => false,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'credential_returned',
      }),
    ).toBe(false);
  });

  it('ignores unrelated prompt notifications', () => {
    expect(isAbandonedGisPrompt(null)).toBe(false);
    expect(isAbandonedGisPrompt({ isDisplayed: () => true })).toBe(false);
  });
});

describe('settleOnce', () => {
  it('resolves only once and ignores a later reject', () => {
    let resolved: string | undefined;
    let rejected: unknown;
    const finish = settleOnce<string>(
      (value) => {
        resolved = value;
      },
      (reason) => {
        rejected = reason;
      },
    );

    finish.resolve('ok');
    finish.reject(new Error(GIS_SIGN_IN_CANCELLED_MESSAGE));

    expect(resolved).toBe('ok');
    expect(rejected).toBeUndefined();
  });

  it('rejects only once and ignores a later resolve', () => {
    let resolved: string | undefined;
    let rejected: unknown;
    const finish = settleOnce<string>(
      (value) => {
        resolved = value;
      },
      (reason) => {
        rejected = reason;
      },
    );

    finish.reject(new Error(GIS_SIGN_IN_CANCELLED_MESSAGE));
    finish.resolve('ok');

    expect(resolved).toBeUndefined();
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe(GIS_SIGN_IN_CANCELLED_MESSAGE);
  });
});
