import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '@core/services/auth.service';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { ACCESS_DENIED_MESSAGE, AuthRequestService } from '../services/auth-request.service';
import { GoogleIdentityService } from '../services/google-identity.service';
import {
  AUTH_ERROR_CODE_EXPIRED,
  AUTH_ERROR_INVALID_VERIFICATION_ID,
  AUTH_ERROR_REQUIRES_RECENT_LOGIN,
  TOTP_ENROLLMENT_EXPIRED_CODE,
  TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
  TOTP_ENROLLMENT_UNCONFIRMED_CODE,
  TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
  TOTP_RECENT_LOGIN_FAILED_MESSAGE,
  TOTP_RECENT_LOGIN_MESSAGE,
  TOTP_RESTART_MESSAGE,
  TOTP_RETRY_MESSAGE,
  TotpMfaError,
  TotpMfaService,
} from '../services/totp-mfa.service';
import { AuthModalComponent } from './auth-modal';

describe('AuthModalComponent launch authentication', () => {
  const profile = {
    uid: 'google-user',
    idToken: 'token',
    name: 'Google User',
    email: 'google@example.com',
    avatarInitials: 'GU',
    isStub: false,
  };
  const enrollment = {
    qrCodeDataUrl: 'data:image/png;base64,qr',
    secretKey: 'MFASECRETKEY',
    qrCodeUrl: 'otpauth://totp/Eco%20Plan%20Tool',
    accountName: 'google@example.com',
    issuer: 'Eco Plan Tool',
    enrollmentCompletionDeadline: '',
    codeLength: 6,
    codeIntervalSeconds: 30,
    secret: {},
  };
  const challengeSession = {
    email: 'google@example.com',
    hint: { uid: 'totp-1', factorId: 'totp' },
    resolver: {},
  };
  const firebaseUser = {
    uid: 'google-user',
    email: 'google@example.com',
    displayName: 'Google User',
  };
  const authService = {
    refreshCurrentUserTier: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    mfaEnrollmentRequired$: signal(false),
  };
  const authRequest = {
    pendingRequest$: signal(null),
    attemptLogin: vi.fn().mockResolvedValue('pending'),
    submitEmailRequest: vi.fn(),
    submitGoogleRequest: vi.fn(),
    hasPendingRequest: vi.fn().mockReturnValue(false),
    getNudgeCooldownRemainingMs: vi.fn().mockReturnValue(0),
    canNudgeAdmins: vi.fn().mockReturnValue(true),
    sendAdminNudge: vi.fn(),
  };
  const googleIdentity = {
    signIn: vi.fn().mockResolvedValue({ kind: 'completed', profile }),
    profileFromCredential: vi.fn().mockResolvedValue(profile),
  };
  let unconfirmedEnrollmentUid: string | null = null;
  const totpMfa = {
    hasEnrolledTotp: vi.fn().mockReturnValue(false),
    userHasEnrolledTotp: vi.fn(async () => false),
    openEnrollmentFor: vi.fn().mockReturnValue(null),
    forgetOpenEnrollment: vi.fn(),
    rememberOpenEnrollment: vi.fn(),
    markEnrollmentUnconfirmed: vi.fn((uid: string) => {
      unconfirmedEnrollmentUid = uid;
    }),
    enrollmentNeedsRecovery: vi.fn((uid: string) => unconfirmedEnrollmentUid === uid),
    beginEnrollment: vi.fn().mockResolvedValue(enrollment),
    completeEnrollment: vi.fn().mockResolvedValue(undefined),
    completeChallenge: vi.fn(),
  };
  const firebase = {
    currentUser: firebaseUser,
    reauthenticateWithGooglePopup: vi.fn().mockResolvedValue({ user: firebaseUser }),
  };

  let fixture: ComponentFixture<AuthModalComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    firebase.currentUser = firebaseUser;
    googleIdentity.signIn.mockResolvedValue({ kind: 'completed', profile });
    googleIdentity.profileFromCredential.mockResolvedValue(profile);
    authRequest.attemptLogin.mockResolvedValue('pending');
    totpMfa.hasEnrolledTotp.mockReturnValue(false);
    totpMfa.userHasEnrolledTotp.mockImplementation(async () => totpMfa.hasEnrolledTotp());
    unconfirmedEnrollmentUid = null;
    totpMfa.openEnrollmentFor.mockReturnValue(null);
    totpMfa.forgetOpenEnrollment.mockReset();
    totpMfa.forgetOpenEnrollment.mockImplementation((uid?: string) => {
      if (!uid || unconfirmedEnrollmentUid === uid) {
        unconfirmedEnrollmentUid = null;
      }
    });
    totpMfa.beginEnrollment.mockResolvedValue(enrollment);
    totpMfa.completeEnrollment.mockResolvedValue(undefined);
    totpMfa.completeChallenge.mockResolvedValue({ user: firebaseUser });
    authService.refreshCurrentUserTier.mockResolvedValue(undefined);
    authService.logout.mockResolvedValue(undefined);
    authService.mfaEnrollmentRequired$.set(false);
    firebase.reauthenticateWithGooglePopup.mockResolvedValue({ user: firebaseUser });
    await TestBed.configureTestingModule({
      imports: [AuthModalComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuthRequestService, useValue: authRequest },
        { provide: GoogleIdentityService, useValue: googleIdentity },
        { provide: TotpMfaService, useValue: totpMfa },
        { provide: FirebaseClientService, useValue: firebase },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AuthModalComponent);
    fixture.detectChanges();
  });

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function click(id: string): void {
    element().querySelector<HTMLButtonElement>(id)?.click();
  }

  async function flush(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function typeCode(id: string, value: string): Promise<void> {
    const input = element().querySelector<HTMLInputElement>(id);
    expect(input).not.toBeNull();
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    await flush();
  }

  it('offers Google sign-in and Google-based access requests without email forms', () => {
    expect(element().querySelector('#auth-modal-entry-google-btn')).not.toBeNull();
    expect(element().querySelector('#auth-modal-entry-request-btn')).not.toBeNull();
    expect(element().querySelector('#auth-modal-entry-email-btn')).toBeNull();
    expect(element().querySelector('#auth-modal-email-login-form')).toBeNull();
    expect(element().querySelector('#auth-modal-email-request-form')).toBeNull();
    expect(element().querySelector('#auth-modal-entry-req-google')?.textContent).toContain(
      'A Google account is required',
    );
    expect(element().querySelector('#auth-modal-entry-req-authenticator')?.textContent).toContain(
      'authenticator app',
    );
    expect(element().querySelector('#auth-modal-entry-request-sub')?.textContent).toContain(
      'Uses Google',
    );
  });

  it('shows a visible error when Google sign-in fails', async () => {
    googleIdentity.signIn.mockRejectedValueOnce(new Error('Google sign-in failed.'));

    click('#auth-modal-entry-google-btn');
    await flush();

    expect(element().querySelector('#auth-modal-entry-error')?.textContent).toContain(
      'Google sign-in failed.',
    );
  });

  it('shows pending review after a pending Google login and never starts enrollment', async () => {
    click('#auth-modal-entry-google-btn');
    await flush();

    expect(element().querySelector('#auth-modal-pending-review')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll')).toBeNull();
    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
  });

  it('sends a pending Google request to the SIRAP form instead of pending review', async () => {
    click('#auth-modal-entry-request-btn');
    await flush();

    expect(authRequest.attemptLogin).toHaveBeenCalledOnce();
    expect(element().querySelector('#auth-modal-post-google')).not.toBeNull();
    expect(element().querySelector('#auth-modal-post-google-sirap-fieldset')).not.toBeNull();
    expect(element().querySelector('#auth-modal-pending-review')).toBeNull();
    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
  });

  it('starts required enrollment when a request-intent Google user is already active', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');

    click('#auth-modal-entry-request-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(element().querySelector('#auth-modal-post-google')).toBeNull();
    expect(totpMfa.beginEnrollment).toHaveBeenCalledWith(firebaseUser, 'google@example.com');
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
  });

  it('closes after a request-intent Google sign-in when the active user already has TOTP', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.hasEnrolledTotp.mockReturnValueOnce(true);
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-request-btn');
    await flush();

    expect(element().querySelector('#auth-modal-post-google')).toBeNull();
    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('signs out a denied Google request and returns to entry', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('invalid');

    click('#auth-modal-entry-request-btn');
    await flush();

    expect(authService.logout).toHaveBeenCalledOnce();
    expect(element().querySelector('#auth-modal-entry-error')?.textContent).toContain(
      ACCESS_DENIED_MESSAGE,
    );
    expect(element().querySelector('#auth-modal-post-google')).toBeNull();
    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
  });

  it('shows enrollment QR and manual key for an active user without TOTP', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');

    click('#auth-modal-entry-google-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(
      enrollment.qrCodeDataUrl,
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'MFASECRETKEY',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-apps')?.textContent).toContain(
      'Duo Mobile',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-duo-hint')?.textContent).toContain(
      'Third Party',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-issuer')?.textContent).toContain(
      'Eco Plan Tool',
    );
    expect(totpMfa.beginEnrollment).toHaveBeenCalledWith(firebaseUser, 'google@example.com');
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
  });

  it('closes immediately when an active user already has TOTP enrolled', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.hasEnrolledTotp.mockReturnValueOnce(true);
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();

    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('reaches a stable signed-in state after the authenticator code is confirmed', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    await typeCode('#auth-modal-mfa-enroll-code-input', '12-34-56');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(totpMfa.completeEnrollment).toHaveBeenCalledWith(firebaseUser, enrollment, '123456');
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(element().querySelector('#auth-modal-mfa-enroll')).toBeNull();
    expect(element().querySelector('#auth-modal-entry-status')).toBeNull();
  });

  it('keeps an invalid enrollment code visible and retryable', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment
      .mockRejectedValueOnce(
        new TotpMfaError('retry', 'auth/invalid-verification-code', TOTP_RETRY_MESSAGE),
      )
      .mockRejectedValueOnce({ code: AUTH_ERROR_CODE_EXPIRED })
      .mockResolvedValueOnce(undefined);

    click('#auth-modal-entry-google-btn');
    await flush();
    await typeCode('#auth-modal-mfa-enroll-code-input', '000000');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_RETRY_MESSAGE,
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-error-code')?.textContent).toContain(
      'auth/invalid-verification-code',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).not.toContain(
      'MFASECRETKEY',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-warning')).toBeNull();
    expect(
      element().querySelector<HTMLInputElement>('#auth-modal-mfa-enroll-code-input')?.value,
    ).toBe('');
    expect(authService.logout).not.toHaveBeenCalled();

    await typeCode('#auth-modal-mfa-enroll-code-input', '111111');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_RETRY_MESSAGE,
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).toBeNull();
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();

    await typeCode('#auth-modal-mfa-enroll-code-input', '654321');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(totpMfa.completeEnrollment).toHaveBeenCalledTimes(3);
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.refreshCurrentUserTier).toHaveBeenCalledOnce();
    expect(authService.logout).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll')).toBeNull();
  });

  it('shows a sanitized enrollment support code and hides secret-like codes', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment
      .mockRejectedValueOnce(
        new TotpMfaError('retry', 'auth/invalid-verification-code', TOTP_RETRY_MESSAGE),
      )
      .mockRejectedValueOnce(
        new TotpMfaError(
          'retry',
          'sessionInfo=abc secretKey=MFASECRETKEY otp=123456',
          TOTP_RETRY_MESSAGE,
        ),
      );

    click('#auth-modal-entry-google-btn');
    await flush();
    await typeCode('#auth-modal-mfa-enroll-code-input', '000000');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    const banner = element().querySelector('#auth-modal-mfa-enroll-error');
    expect(banner?.textContent).toContain(TOTP_RETRY_MESSAGE);
    expect(element().querySelector('#auth-modal-mfa-enroll-error-code')?.textContent).toContain(
      'Support code: auth/invalid-verification-code',
    );
    expect(banner?.textContent).not.toContain('sessionInfo');
    expect(banner?.textContent).not.toContain('secretKey');
    expect(banner?.textContent).not.toContain('otp=');

    await typeCode('#auth-modal-mfa-enroll-code-input', '111111');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    const hidden = element().querySelector('#auth-modal-mfa-enroll-error');
    expect(element().querySelector('#auth-modal-mfa-enroll-error-code')).toBeNull();
    expect(hidden?.textContent).not.toContain('sessionInfo');
    expect(hidden?.textContent).not.toContain('MFASECRETKEY');
    expect(hidden?.textContent).not.toContain('otp=123456');
    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('signs out a denied Google login and shows the existing denial', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('invalid');

    click('#auth-modal-entry-google-btn');
    await flush();

    expect(authService.logout).toHaveBeenCalledOnce();
    expect(element().querySelector('#auth-modal-entry-error')?.textContent).toContain(
      ACCESS_DENIED_MESSAGE,
    );
    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
  });

  it('shows a TOTP challenge, retries an invalid code, then resumes login', async () => {
    googleIdentity.signIn.mockResolvedValueOnce({
      kind: 'totp-assertion-required',
      assertion: challengeSession,
    });
    totpMfa.completeChallenge
      .mockRejectedValueOnce(
        new TotpMfaError('retry', 'auth/invalid-verification-code', TOTP_RETRY_MESSAGE),
      )
      .mockResolvedValueOnce({ user: firebaseUser });
    authRequest.attemptLogin.mockResolvedValueOnce('pending');

    click('#auth-modal-entry-google-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-challenge')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-challenge-apps')?.textContent).toContain(
      'Third Party',
    );
    expect(element().querySelector('#auth-modal-mfa-challenge-issuer')?.textContent).toContain(
      'Eco Plan Tool',
    );
    expect(element().querySelector('#auth-modal-mfa-challenge-lost')?.textContent).toContain(
      'Contact your administrator',
    );
    expect(element().querySelector('#auth-modal-mfa-challenge-it-email')).toBeNull();
    expect(element().querySelector('#auth-modal-mfa-challenge-replace-btn')).toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll')).toBeNull();
    expect(
      element().querySelector<HTMLButtonElement>('#auth-modal-mfa-challenge-submit-btn')?.disabled,
    ).toBe(true);

    await typeCode('#auth-modal-mfa-challenge-code-input', '111111');
    click('#auth-modal-mfa-challenge-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-challenge-error')?.textContent).toContain(
      TOTP_RETRY_MESSAGE,
    );
    expect(element().querySelector('#auth-modal-mfa-challenge')).not.toBeNull();

    await typeCode('#auth-modal-mfa-challenge-code-input', '222222');
    click('#auth-modal-mfa-challenge-submit-btn');
    await flush();

    expect(totpMfa.completeChallenge).toHaveBeenNthCalledWith(1, challengeSession, '111111');
    expect(totpMfa.completeChallenge).toHaveBeenNthCalledWith(2, challengeSession, '222222');
    expect(googleIdentity.profileFromCredential).toHaveBeenCalledWith({ user: firebaseUser });
    expect(element().querySelector('#auth-modal-pending-review')).not.toBeNull();
    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not open setup again when a challenge user looks unenrolled until factor refresh', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    googleIdentity.signIn.mockResolvedValueOnce({
      kind: 'totp-assertion-required',
      assertion: challengeSession,
    });
    totpMfa.hasEnrolledTotp.mockReturnValue(false);
    totpMfa.userHasEnrolledTotp.mockResolvedValue(true);
    totpMfa.completeChallenge.mockResolvedValue({ user: firebaseUser });
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    expect(element().querySelector('#auth-modal-mfa-challenge')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll')).toBeNull();

    await typeCode('#auth-modal-mfa-challenge-code-input', '654321');
    click('#auth-modal-mfa-challenge-submit-btn');
    await flush();

    expect(totpMfa.completeChallenge).toHaveBeenCalledWith(challengeSession, '654321');
    expect(totpMfa.userHasEnrolledTotp).toHaveBeenCalledWith(firebaseUser);
    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).toHaveBeenCalledOnce();
    expect(authService.logout).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('keeps the same QR when setup is still required after the code is accepted', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    authService.refreshCurrentUserTier.mockImplementation(async () => {
      authService.mfaEnrollmentRequired$.set(true);
    });
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    const qrSrc = element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src');
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(qrSrc).toBe(enrollment.qrCodeDataUrl);
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
    );
    expect(
      element().querySelector('#auth-modal-mfa-enroll-replace-warning')?.textContent,
    ).toContain('stops the Eco Plan Tool entry already in Duo Mobile from working');
    expect(totpMfa.forgetOpenEnrollment).not.toHaveBeenCalled();

    fixture.destroy();
    authService.mfaEnrollmentRequired$.set(true);
    totpMfa.openEnrollmentFor.mockReturnValue(enrollment);
    fixture = TestBed.createComponent(AuthModalComponent);
    fixture.detectChanges();
    await flush();

    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
  });

  it('reuses an expired enrollment after remount until a new QR is created', async () => {
    const expiredEnrollment = {
      ...enrollment,
      enrollmentCompletionDeadline: '2020-01-01T00:00:00.000Z',
    };
    const replacement = {
      ...expiredEnrollment,
      qrCodeDataUrl: 'data:image/png;base64,replacement',
      secretKey: 'REPLACEMENTSECRET',
    };
    totpMfa.beginEnrollment.mockResolvedValue(expiredEnrollment);
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment.mockRejectedValueOnce(
      new TotpMfaError(
        'recover',
        TOTP_ENROLLMENT_EXPIRED_CODE,
        TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
      ),
    );

    click('#auth-modal-entry-google-btn');
    await flush();
    const qrSrc = element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src');
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(qrSrc).toBe(expiredEnrollment.qrCodeDataUrl);
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(totpMfa.forgetOpenEnrollment).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();

    fixture.destroy();
    authService.mfaEnrollmentRequired$.set(true);
    totpMfa.openEnrollmentFor.mockReturnValue(expiredEnrollment);
    fixture = TestBed.createComponent(AuthModalComponent);
    fixture.detectChanges();
    await flush();

    expect(totpMfa.openEnrollmentFor).toHaveBeenCalledWith(firebaseUser);
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(totpMfa.forgetOpenEnrollment).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'MFASECRETKEY',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).not.toBeNull();

    totpMfa.beginEnrollment.mockResolvedValueOnce(replacement);
    click('#auth-modal-mfa-enroll-replace-btn');
    await flush();

    const forgetOrder = totpMfa.forgetOpenEnrollment.mock.invocationCallOrder[0];
    const replacementBeginOrder = totpMfa.beginEnrollment.mock.invocationCallOrder[1];
    expect(forgetOrder).toBeLessThan(replacementBeginOrder);
    expect(totpMfa.forgetOpenEnrollment).toHaveBeenCalledWith('google-user');
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(2);
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(
      replacement.qrCodeDataUrl,
    );
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('keeps the same enrollment session when the code is not confirmed', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment
      .mockRejectedValueOnce({ code: TOTP_ENROLLMENT_UNCONFIRMED_CODE })
      .mockResolvedValueOnce(undefined);

    click('#auth-modal-entry-google-btn');
    await flush();
    const qrSrc = element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src');
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-error-code')?.textContent).toContain(
      'totp/enrollment-unconfirmed',
    );
    expect(
      element().querySelector('#auth-modal-mfa-enroll-replace-warning')?.textContent,
    ).toContain('Duo Mobile');
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).not.toBeNull();
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(totpMfa.forgetOpenEnrollment).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();

    await typeCode('#auth-modal-mfa-enroll-code-input', '654321');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(totpMfa.completeEnrollment).toHaveBeenNthCalledWith(
      2,
      firebaseUser,
      enrollment,
      '654321',
    );
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll')).toBeNull();
  });

  it('creates a new QR only after the explicit replace action warns about Duo', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment.mockRejectedValueOnce({ code: TOTP_ENROLLMENT_UNCONFIRMED_CODE });
    const replacement = {
      ...enrollment,
      qrCodeDataUrl: 'data:image/png;base64,replacement',
      secretKey: 'REPLACEMENTSECRET',
    };

    click('#auth-modal-entry-google-btn');
    await flush();
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'MFASECRETKEY',
    );
    expect(
      element().querySelector('#auth-modal-mfa-enroll-replace-warning')?.textContent,
    ).toContain('stops the Eco Plan Tool entry already in Duo Mobile from working');

    totpMfa.beginEnrollment.mockResolvedValueOnce(replacement);
    click('#auth-modal-mfa-enroll-replace-btn');
    await flush();

    const forgetOrder = totpMfa.forgetOpenEnrollment.mock.invocationCallOrder[0];
    const replacementBeginOrder = totpMfa.beginEnrollment.mock.invocationCallOrder[1];
    expect(forgetOrder).toBeLessThan(replacementBeginOrder);
    expect(totpMfa.forgetOpenEnrollment).toHaveBeenCalledWith('google-user');
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(2);
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(
      replacement.qrCodeDataUrl,
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'REPLACEMENTSECRET',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).toBeNull();
    expect(authService.logout).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
  });

  it('keeps a dead enrollment on the same QR until the user creates a new one', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment
      .mockRejectedValueOnce({ code: AUTH_ERROR_INVALID_VERIFICATION_ID })
      .mockRejectedValueOnce(
        new TotpMfaError(
          'recover',
          TOTP_ENROLLMENT_EXPIRED_CODE,
          TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
        ),
      )
      .mockRejectedValueOnce(new Error('finalize-failed'));
    const replacement = {
      ...enrollment,
      qrCodeDataUrl: 'data:image/png;base64,replacement',
      secretKey: 'REPLACEMENTSECRET',
    };

    click('#auth-modal-entry-google-btn');
    await flush();
    const qrSrc = element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src');

    for (const code of ['111111', '222222', '333333']) {
      await typeCode('#auth-modal-mfa-enroll-code-input', code);
      click('#auth-modal-mfa-enroll-submit-btn');
      await flush();

      expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
      expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
      expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
        'MFASECRETKEY',
      );
      expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
        TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
      );
      expect(
        element().querySelector('#auth-modal-mfa-enroll-replace-warning')?.textContent,
      ).toContain('stops the Eco Plan Tool entry already in Duo Mobile from working');
      expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).not.toBeNull();
      expect(element().querySelector('#auth-modal-mfa-enroll-restart-btn')).toBeNull();
      expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
      expect(totpMfa.forgetOpenEnrollment).not.toHaveBeenCalled();
      expect(authService.logout).not.toHaveBeenCalled();
      expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
    }

    totpMfa.beginEnrollment.mockResolvedValueOnce(replacement);
    click('#auth-modal-mfa-enroll-replace-btn');
    await flush();

    expect(totpMfa.forgetOpenEnrollment).toHaveBeenCalledWith('google-user');
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(2);
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(
      replacement.qrCodeDataUrl,
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'REPLACEMENTSECRET',
    );
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('reauthenticates with Google and keeps the same QR when login is no longer recent', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment
      .mockRejectedValueOnce({ code: AUTH_ERROR_REQUIRES_RECENT_LOGIN })
      .mockResolvedValueOnce(undefined);

    click('#auth-modal-entry-google-btn');
    await flush();
    const qrSrc = element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src');
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(firebase.reauthenticateWithGooglePopup).toHaveBeenCalledWith(firebaseUser);
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_RECENT_LOGIN_MESSAGE,
    );
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();

    await typeCode('#auth-modal-mfa-enroll-code-input', '654321');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(totpMfa.completeEnrollment).toHaveBeenNthCalledWith(
      2,
      firebaseUser,
      enrollment,
      '654321',
    );
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(firebase.reauthenticateWithGooglePopup).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll')).toBeNull();
  });

  it('keeps the same QR when Google reauthentication is cancelled', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment.mockRejectedValueOnce({ code: AUTH_ERROR_REQUIRES_RECENT_LOGIN });
    firebase.reauthenticateWithGooglePopup.mockRejectedValueOnce(new Error('popup-closed'));

    click('#auth-modal-entry-google-btn');
    await flush();
    const qrSrc = element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src');
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_RECENT_LOGIN_FAILED_MESSAGE,
    );
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll-restart-btn')).toBeNull();
  });

  it('keeps the same QR and secret when enroll fails before it resolves', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment
      .mockRejectedValueOnce({ code: AUTH_ERROR_REQUIRES_RECENT_LOGIN })
      .mockRejectedValueOnce({ code: AUTH_ERROR_INVALID_VERIFICATION_ID })
      .mockResolvedValueOnce(undefined);

    click('#auth-modal-entry-google-btn');
    await flush();
    const qrSrc = element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src');

    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();
    fixture.detectChanges();

    expect(firebase.reauthenticateWithGooglePopup).toHaveBeenCalledTimes(1);
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(totpMfa.forgetOpenEnrollment).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'MFASECRETKEY',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-restart-btn')).toBeNull();

    await typeCode('#auth-modal-mfa-enroll-code-input', '000000');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();
    fixture.detectChanges();

    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'MFASECRETKEY',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
    );
    expect(
      element().querySelector('#auth-modal-mfa-enroll-replace-warning')?.textContent,
    ).toContain('stops the Eco Plan Tool entry already in Duo Mobile from working');
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-restart-btn')).toBeNull();

    fixture.destroy();
    authService.mfaEnrollmentRequired$.set(true);
    totpMfa.openEnrollmentFor.mockReturnValue(enrollment);
    fixture = TestBed.createComponent(AuthModalComponent);
    fixture.detectChanges();
    await flush();

    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'MFASECRETKEY',
    );

    authService.mfaEnrollmentRequired$.set(false);
    await typeCode('#auth-modal-mfa-enroll-code-input', '654321');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(totpMfa.completeEnrollment).toHaveBeenNthCalledWith(
      3,
      firebaseUser,
      enrollment,
      '654321',
    );
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('closes into the signed-in state when restored setup finds an authenticator after refresh', async () => {
    fixture.destroy();
    authService.mfaEnrollmentRequired$.set(true);
    totpMfa.hasEnrolledTotp.mockReturnValue(false);
    totpMfa.userHasEnrolledTotp.mockResolvedValue(true);
    authService.refreshCurrentUserTier.mockImplementation(async () => {
      authService.mfaEnrollmentRequired$.set(false);
    });
    const closed = vi.fn();
    fixture = TestBed.createComponent(AuthModalComponent);
    fixture.componentInstance.closeRequested.subscribe(closed);
    fixture.detectChanges();
    await flush();

    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it('resumes the SIRAP request form after a successful request-intent challenge', async () => {
    googleIdentity.signIn.mockResolvedValueOnce({
      kind: 'totp-assertion-required',
      assertion: challengeSession,
    });

    click('#auth-modal-entry-request-btn');
    await flush();
    await typeCode('#auth-modal-mfa-challenge-code-input', '333333');
    click('#auth-modal-mfa-challenge-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-post-google')).not.toBeNull();
    expect(authRequest.attemptLogin).toHaveBeenCalledOnce();
    expect(totpMfa.beginEnrollment).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
  });

  it('signs out and closes when enrollment is cancelled', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    click('#auth-modal-mfa-enroll-cancel-btn');
    await flush();

    expect(authService.logout).toHaveBeenCalledOnce();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('returns to Google sign-in after a restart error', async () => {
    googleIdentity.signIn.mockResolvedValueOnce({
      kind: 'totp-assertion-required',
      assertion: challengeSession,
    });
    totpMfa.completeChallenge.mockRejectedValueOnce(
      new TotpMfaError('restart', 'auth/invalid-multi-factor-session', TOTP_RESTART_MESSAGE),
    );

    click('#auth-modal-entry-google-btn');
    await flush();
    await typeCode('#auth-modal-mfa-challenge-code-input', '444444');
    click('#auth-modal-mfa-challenge-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-challenge-error')?.textContent).toContain(
      TOTP_RESTART_MESSAGE,
    );
    expect(authService.logout).toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-challenge')).not.toBeNull();
    click('#auth-modal-mfa-challenge-restart-btn');
    await flush();

    expect(element().querySelector('#auth-modal-entry')).not.toBeNull();
    expect(element().querySelector('#auth-modal-entry-error')?.textContent).toContain(
      TOTP_RESTART_MESSAGE,
    );
  });

  it('resumes a fresh enrollment when opened with enrollment already required', async () => {
    fixture.destroy();
    authService.mfaEnrollmentRequired$.set(true);
    fixture = TestBed.createComponent(AuthModalComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await flush();

    expect(authRequest.attemptLogin).not.toHaveBeenCalled();
    expect(totpMfa.beginEnrollment).toHaveBeenCalledWith(firebaseUser, 'google@example.com');
    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(
      enrollment.qrCodeDataUrl,
    );
    expect(
      element().querySelector<HTMLInputElement>('#auth-modal-mfa-enroll-code-input')?.disabled,
    ).toBe(false);
  });

  it('shows restart UI when restored enrollment cannot begin', async () => {
    fixture.destroy();
    authService.mfaEnrollmentRequired$.set(true);
    totpMfa.beginEnrollment.mockRejectedValueOnce(new Error('secret-failed'));
    fixture = TestBed.createComponent(AuthModalComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-restart-btn')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_RESTART_MESSAGE,
    );
    expect(authService.logout).toHaveBeenCalled();
    expect(authRequest.attemptLogin).not.toHaveBeenCalled();
  });

  it('keeps an expired displayed enrollment in the warned replacement state', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment.mockRejectedValueOnce(
      new TotpMfaError('restart', TOTP_ENROLLMENT_EXPIRED_CODE, TOTP_RESTART_MESSAGE),
    );

    click('#auth-modal-entry-google-btn');
    await flush();
    const qrSrc = element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src');
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(qrSrc);
    expect(element().querySelector('#auth-modal-mfa-enroll-secret-value')?.textContent).toContain(
      'MFASECRETKEY',
    );
    expect(element().querySelector('#auth-modal-mfa-enroll-restart-btn')).toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-replace-btn')).not.toBeNull();
    expect(
      element().querySelector('#auth-modal-mfa-enroll-replace-warning')?.textContent,
    ).toContain('stops the Eco Plan Tool entry already in Duo Mobile from working');
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
    );
    expect(totpMfa.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
  });

  it('signs out and closes when Escape is pressed during enrollment', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();

    expect(authService.logout).toHaveBeenCalledOnce();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('signs out and closes when the scrim is clicked during enrollment', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    element()
      .querySelector('#auth-modal-overlay')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await flush();

    expect(authService.logout).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('signs out and closes when a TOTP challenge is cancelled', async () => {
    googleIdentity.signIn.mockResolvedValueOnce({
      kind: 'totp-assertion-required',
      assertion: challengeSession,
    });
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    click('#auth-modal-mfa-challenge-cancel-btn');
    await flush();

    expect(authService.logout).toHaveBeenCalledOnce();
    expect(element().querySelector('#auth-modal-pending-review')).toBeNull();
    expect(element().querySelector('#auth-modal-post-google')).toBeNull();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('focuses the enrollment code field on enter and after a retryable error', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment.mockRejectedValueOnce(
      new TotpMfaError('retry', 'auth/invalid-verification-code', TOTP_RETRY_MESSAGE),
    );

    click('#auth-modal-entry-google-btn');
    await flush();

    expect(document.activeElement?.id).toBe('auth-modal-mfa-enroll-code-input');

    await typeCode('#auth-modal-mfa-enroll-code-input', '000000');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll-error')).not.toBeNull();
    expect(document.activeElement?.id).toBe('auth-modal-mfa-enroll-code-input');
  });

  it('shows enrollment loading immediately on restore and ignores Escape until setup finishes', async () => {
    let resolveEnrollment: (value: typeof enrollment) => void = () => undefined;
    totpMfa.beginEnrollment.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveEnrollment = resolve;
      }),
    );
    authService.mfaEnrollmentRequired$.set(true);
    fixture.destroy();
    const closed = vi.fn();
    fixture = TestBed.createComponent(AuthModalComponent);
    fixture.componentInstance.closeRequested.subscribe(closed);
    fixture.detectChanges();

    expect(authRequest.attemptLogin).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-qr-placeholder')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-submit-spinner')).not.toBeNull();
    expect(
      element().querySelector<HTMLButtonElement>('#auth-modal-mfa-enroll-cancel-btn')?.disabled,
    ).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(closed).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();

    resolveEnrollment(enrollment);
    await Promise.resolve();
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll-qr')?.getAttribute('src')).toBe(
      enrollment.qrCodeDataUrl,
    );
    expect(
      element().querySelector<HTMLButtonElement>('#auth-modal-mfa-enroll-cancel-btn')?.disabled,
    ).toBe(false);
  });

  it('logs out and returns to entry when a post-Google submit is denied', async () => {
    authRequest.submitGoogleRequest.mockRejectedValueOnce(new Error(ACCESS_DENIED_MESSAGE));

    click('#auth-modal-entry-request-btn');
    await flush();
    element()
      .querySelector<HTMLInputElement>('#auth-modal-post-google-sirap-checkbox-orinoquia')
      ?.dispatchEvent(new Event('change'));
    await flush();
    click('#auth-modal-post-google-submit-btn');
    await flush();

    expect(authService.logout).toHaveBeenCalledOnce();
    expect(element().querySelector('#auth-modal-entry')).not.toBeNull();
    expect(element().querySelector('#auth-modal-post-google')).toBeNull();
    expect(element().querySelector('#auth-modal-entry-error')?.textContent).toContain(
      ACCESS_DENIED_MESSAGE,
    );
  });
});
