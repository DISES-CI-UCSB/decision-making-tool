import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '@core/services/auth.service';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { ACCESS_DENIED_MESSAGE, AuthRequestService } from '../services/auth-request.service';
import { GoogleIdentityService } from '../services/google-identity.service';
import {
  TOTP_RESTART_MESSAGE,
  TOTP_RETRY_MESSAGE,
  TotpMfaError,
  TotpMfaService,
} from '../services/totp-mfa.service';
import { AuthModalComponent, TOTP_ENROLLMENT_COMPLETE_MESSAGE } from './auth-modal';

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
    qrCodeUrl: 'otpauth://totp/Decision%20Making%20Tool',
    accountName: 'google@example.com',
    issuer: 'Decision Making Tool',
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
  const totpMfa = {
    hasEnrolledTotp: vi.fn().mockReturnValue(false),
    beginEnrollment: vi.fn().mockResolvedValue(enrollment),
    completeEnrollment: vi.fn().mockResolvedValue(undefined),
    completeChallenge: vi.fn(),
  };
  const firebase = {
    currentUser: firebaseUser,
  };

  let fixture: ComponentFixture<AuthModalComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    firebase.currentUser = firebaseUser;
    googleIdentity.signIn.mockResolvedValue({ kind: 'completed', profile });
    googleIdentity.profileFromCredential.mockResolvedValue(profile);
    authRequest.attemptLogin.mockResolvedValue('pending');
    totpMfa.hasEnrolledTotp.mockReturnValue(false);
    totpMfa.beginEnrollment.mockResolvedValue(enrollment);
    totpMfa.completeEnrollment.mockResolvedValue(undefined);
    totpMfa.completeChallenge.mockResolvedValue({ user: firebaseUser });
    authService.refreshCurrentUserTier.mockResolvedValue(undefined);
    authService.logout.mockResolvedValue(undefined);
    authService.mfaEnrollmentRequired$.set(false);
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
      'Google Authenticator',
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

  it('signs out after successful enrollment and asks the user to sign in again', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    await typeCode('#auth-modal-mfa-enroll-code-input', '12-34-56');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(totpMfa.completeEnrollment).toHaveBeenCalledWith(firebaseUser, enrollment, '123456');
    expect(authService.logout).toHaveBeenCalledOnce();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-entry')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll')).toBeNull();
    expect(element().querySelector('#auth-modal-entry-status')?.textContent).toContain(
      TOTP_ENROLLMENT_COMPLETE_MESSAGE,
    );
    expect(element().querySelector('#auth-modal-entry-error')).toBeNull();
  });

  it('keeps an invalid enrollment code visible and retryable', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment
      .mockRejectedValueOnce(
        new TotpMfaError('retry', 'auth/invalid-verification-code', TOTP_RETRY_MESSAGE),
      )
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
    expect(
      element().querySelector<HTMLInputElement>('#auth-modal-mfa-enroll-code-input')?.value,
    ).toBe('');
    expect(authService.logout).not.toHaveBeenCalled();

    await typeCode('#auth-modal-mfa-enroll-code-input', '654321');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(totpMfa.completeEnrollment).toHaveBeenCalledTimes(2);
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
    expect(authService.logout).toHaveBeenCalledOnce();
    expect(element().querySelector('#auth-modal-entry-status')?.textContent).toContain(
      TOTP_ENROLLMENT_COMPLETE_MESSAGE,
    );
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
      'not a text message',
    );
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

  it('refreshes and closes only after a completed TOTP challenge on an active account', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active').mockResolvedValueOnce('active');
    googleIdentity.signIn
      .mockResolvedValueOnce({ kind: 'completed', profile })
      .mockResolvedValueOnce({
        kind: 'totp-assertion-required',
        assertion: challengeSession,
      });
    totpMfa.hasEnrolledTotp.mockReturnValueOnce(false).mockReturnValue(true);
    const closed = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);

    click('#auth-modal-entry-google-btn');
    await flush();
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(closed).not.toHaveBeenCalled();
    expect(authService.refreshCurrentUserTier).not.toHaveBeenCalled();
    expect(element().querySelector('#auth-modal-entry-status')).not.toBeNull();

    click('#auth-modal-entry-google-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-challenge')).not.toBeNull();
    await typeCode('#auth-modal-mfa-challenge-code-input', '654321');
    click('#auth-modal-mfa-challenge-submit-btn');
    await flush();

    expect(totpMfa.completeChallenge).toHaveBeenCalledWith(challengeSession, '654321');
    expect(authService.refreshCurrentUserTier).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(element().querySelector('#auth-modal-entry-status')).toBeNull();
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

  it('signs out promptly when enrollment returns a restart error', async () => {
    authRequest.attemptLogin.mockResolvedValueOnce('active');
    totpMfa.completeEnrollment.mockRejectedValueOnce(
      new TotpMfaError('restart', 'totp/enrollment-expired', TOTP_RESTART_MESSAGE),
    );

    click('#auth-modal-entry-google-btn');
    await flush();
    await typeCode('#auth-modal-mfa-enroll-code-input', '123456');
    click('#auth-modal-mfa-enroll-submit-btn');
    await flush();

    expect(element().querySelector('#auth-modal-mfa-enroll')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-restart-btn')).not.toBeNull();
    expect(element().querySelector('#auth-modal-mfa-enroll-error')?.textContent).toContain(
      TOTP_RESTART_MESSAGE,
    );
    expect(authService.logout).toHaveBeenCalled();
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
