import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Injector,
  Output,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { SIRAP_ACCESS_REGIONS, type SirapRegionId } from '@core/models';
import { type User } from 'firebase/auth';
import {
  ACCESS_DENIED_MESSAGE,
  AuthRequestService,
  type EmailRequestPayload,
  type StoredPendingRequest,
} from '../services/auth-request.service';
import { GoogleIdentityService, type GoogleProfile } from '../services/google-identity.service';
import {
  AUTH_ERROR_CODE_EXPIRED,
  AUTH_ERROR_INVALID_OTP,
  AUTH_ERROR_REQUIRES_RECENT_LOGIN,
  TOTP_ALREADY_ENROLLED_CODE,
  TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
  TOTP_ENROLLMENT_REPLACE_WARNING,
  TOTP_ENROLLMENT_UNCONFIRMED_CODE,
  TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
  TOTP_INVALID_FORMAT_CODE,
  TOTP_ISSUER,
  TOTP_RECENT_LOGIN_FAILED_MESSAGE,
  TOTP_RECENT_LOGIN_MESSAGE,
  TOTP_RESTART_MESSAGE,
  TotpMfaService,
  isTotpMfaError,
  totpSupportCode,
  toTotpMfaError,
  type TotpChallengeSession,
  type TotpEnrollmentSession,
  type TotpErrorKind,
  type TotpMfaError,
} from '../services/totp-mfa.service';

export type AuthModalState =
  | 'entry'
  | 'emailLogin'
  | 'emailRequest'
  | 'pendingConfirm'
  | 'pendingReview'
  | 'postGoogle'
  | 'mfaEnroll'
  | 'mfaChallenge';

type GoogleIntent = 'login' | 'request';

interface EmailLoginForm {
  email: string;
  password: string;
}

interface EmailRequestForm {
  fullName: string;
  email: string;
  password: string;
  passwordConfirm: string;
  organization: string;
  reason: string;
}

interface PostGoogleForm {
  organization: string;
  reason: string;
  requestedSirapIds: SirapRegionId[];
}

const SUBMIT_MIN_DELAY_MS = 300;

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [],
  templateUrl: './auth-modal.html',
  styleUrl: './auth-modal.scss',
})
export class AuthModalComponent {
  private readonly authService = inject(AuthService);
  private readonly authRequest = inject(AuthRequestService);
  private readonly firebase = inject(FirebaseClientService);
  private readonly googleIdentity = inject(GoogleIdentityService);
  private readonly totpMfa = inject(TotpMfaService);
  private readonly injector = inject(Injector);

  @Output() readonly closeRequested = new EventEmitter<void>();

  @ViewChild('modalCard', { static: false })
  private readonly modalCardRef?: ElementRef<HTMLElement>;

  @ViewChild('totpCodeInput')
  private readonly totpCodeInputRef?: ElementRef<HTMLInputElement>;

  protected readonly state = signal<AuthModalState>('entry');
  protected readonly isSubmitting = signal(false);
  protected readonly loginError = signal<string | null>(null);
  protected readonly loginStatus = signal<string | null>(null);

  protected readonly emailLoginForm = signal<EmailLoginForm>({ email: '', password: '' });
  protected readonly emailRequestForm = signal<EmailRequestForm>({
    fullName: '',
    email: '',
    password: '',
    passwordConfirm: '',
    organization: '',
    reason: '',
  });
  protected readonly postGoogleForm = signal<PostGoogleForm>({
    organization: '',
    reason: '',
    requestedSirapIds: [],
  });
  protected readonly sirapRegions = SIRAP_ACCESS_REGIONS;
  protected readonly pendingGoogleProfile = signal<GoogleProfile | null>(null);
  protected readonly confirmedRequest = signal<StoredPendingRequest | null>(null);
  protected readonly googleIntent = signal<GoogleIntent>('login');
  protected readonly totpIssuer = TOTP_ISSUER;
  protected readonly enrollmentReplaceWarning = TOTP_ENROLLMENT_REPLACE_WARNING;
  protected readonly totpCode = signal('');
  protected readonly totpError = signal<string | null>(null);
  protected readonly totpErrorKind = signal<TotpErrorKind | null>(null);
  protected readonly enrollmentSupportCode = signal<string | null>(null);
  protected readonly mfaEnrollment = signal<TotpEnrollmentSession | null>(null);
  protected readonly totpChallenge = signal<TotpChallengeSession | null>(null);

  protected readonly reviewTick = signal(0);

  protected readonly pendingRequestForReview = computed(() => this.authRequest.pendingRequest$());

  protected readonly nudgeCooldownLabel = computed(() => {
    this.reviewTick();
    const remainingMs = this.authRequest.getNudgeCooldownRemainingMs();
    if (remainingMs === 0) {
      return 'Email admins for an update';
    }
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
    return `Email admins for an update · next nudge in ${remainingHours}h`;
  });

  protected readonly canNudge = computed(() => {
    this.reviewTick();
    return this.authRequest.canNudgeAdmins();
  });

  protected readonly modalTitleId = computed(() => {
    switch (this.state()) {
      case 'mfaEnroll':
        return 'auth-modal-mfa-enroll-title';
      case 'mfaChallenge':
        return 'auth-modal-mfa-challenge-title';
      case 'emailLogin':
        return 'auth-modal-email-login-title';
      case 'emailRequest':
        return 'auth-modal-email-request-title';
      case 'pendingConfirm':
        return 'auth-modal-pending-confirm-title';
      case 'pendingReview':
        return 'auth-modal-pending-review-title';
      case 'postGoogle':
        return 'auth-modal-post-google-title';
      default:
        return 'auth-modal-title';
    }
  });

  protected readonly canSubmitTotp = computed(() => /^\d{6}$/.test(this.totpCode()));

  constructor() {
    if (this.authService.mfaEnrollmentRequired$() && this.firebase.currentUser) {
      void this.resumeRequiredEnrollment();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    void this.requestClose();
  }

  protected onScrimClick(event: MouseEvent): void {
    const card = this.modalCardRef?.nativeElement;
    if (card && event.target instanceof Node && card.contains(event.target)) {
      return;
    }
    void this.requestClose();
  }

  protected requestClose(): void {
    if (this.isSubmitting()) {
      return;
    }
    if (this.isMfaState()) {
      void this.abortMfaAndClose();
      return;
    }
    this.closeRequested.emit();
  }

  // ------------------------------------------------------------------
  // State transitions (entry card)
  // ------------------------------------------------------------------

  protected chooseEmailLogin(): void {
    this.loginError.set(null);
    this.state.set('emailLogin');
  }

  protected chooseEmailRequest(): void {
    this.state.set('emailRequest');
  }

  protected async chooseGoogleFromEntry(): Promise<void> {
    await this.beginGoogleSignIn('login');
  }

  protected backToEntry(): void {
    this.loginError.set(null);
    this.state.set('entry');
  }

  // ------------------------------------------------------------------
  // Email login (v5-B)
  // ------------------------------------------------------------------

  protected updateEmailLoginField<K extends keyof EmailLoginForm>(
    field: K,
    value: EmailLoginForm[K],
  ): void {
    this.emailLoginForm.update((form) => ({ ...form, [field]: value }));
  }

  protected canSubmitEmailLogin = computed(() => {
    const form = this.emailLoginForm();
    return form.email.trim().length > 0 && form.password.length > 0;
  });

  protected async submitEmailLogin(): Promise<void> {
    if (!this.canSubmitEmailLogin() || this.isSubmitting()) {
      return;
    }
    this.isSubmitting.set(true);
    this.loginError.set(null);
    try {
      const form = this.emailLoginForm();
      const result = await this.authRequest.attemptLogin({
        email: form.email.trim(),
        password: form.password,
        provider: 'local',
      });
      if (result === 'active') {
        this.loginError.set('Email login is not connected to Firebase yet. Please use Google.');
        return;
      }
      if (result === 'pending') {
        this.ensurePendingRequest({
          name: form.email.split('@')[0] || form.email.trim(),
          email: form.email.trim(),
          avatarInitials: form.email.slice(0, 2).toUpperCase(),
          idToken: '',
          isStub: true,
        });
        this.state.set('pendingReview');
        return;
      }
      this.loginError.set("That email and password didn't match any account.");
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ------------------------------------------------------------------
  // Email Request Access (v5-C)
  // ------------------------------------------------------------------

  protected updateRequestField<K extends keyof EmailRequestForm>(
    field: K,
    value: EmailRequestForm[K],
  ): void {
    this.emailRequestForm.update((form) => ({ ...form, [field]: value }));
  }

  protected requestFormError = computed<string | null>(() => {
    const form = this.emailRequestForm();
    if (!form.fullName.trim() || !form.email.trim() || !form.password || !form.passwordConfirm) {
      return null;
    }
    if (form.password !== form.passwordConfirm) {
      return 'Passwords don\u2019t match.';
    }
    return null;
  });

  protected canSubmitRequest = computed(() => {
    const form = this.emailRequestForm();
    return (
      form.fullName.trim().length > 0 &&
      form.email.trim().length > 0 &&
      form.password.length >= 6 &&
      form.password === form.passwordConfirm
    );
  });

  protected async submitEmailRequest(): Promise<void> {
    if (!this.canSubmitRequest() || this.isSubmitting()) {
      return;
    }
    this.isSubmitting.set(true);
    try {
      const form = this.emailRequestForm();
      const payload: EmailRequestPayload = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        organization: form.organization.trim() || undefined,
        reason: form.reason.trim() || undefined,
        requestedSirapIds: [],
      };
      const startedAt = Date.now();
      const stored = await this.authRequest.submitEmailRequest(payload);
      await this.enforceMinDelay(startedAt);
      this.confirmedRequest.set(stored);
      this.state.set('pendingConfirm');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ------------------------------------------------------------------
  // Google Request Access (triggers v5-F)
  // ------------------------------------------------------------------

  protected async chooseGoogleFromRequest(): Promise<void> {
    await this.beginGoogleSignIn('request');
  }

  protected updatePostGoogleField<K extends keyof PostGoogleForm>(
    field: K,
    value: PostGoogleForm[K],
  ): void {
    this.postGoogleForm.update((form) => ({ ...form, [field]: value }));
  }

  protected togglePostGoogleSirap(sirapId: SirapRegionId): void {
    this.postGoogleForm.update((form) => ({
      ...form,
      requestedSirapIds: this.toggleSirapId(form.requestedSirapIds, sirapId),
    }));
  }

  protected async submitPostGoogle(): Promise<void> {
    if (this.isSubmitting()) {
      return;
    }
    const profile = this.pendingGoogleProfile();
    if (!profile || this.postGoogleForm().requestedSirapIds.length === 0) {
      return;
    }
    this.isSubmitting.set(true);
    this.loginError.set(null);
    try {
      const form = this.postGoogleForm();
      const startedAt = Date.now();
      const stored = await this.authRequest.submitGoogleRequest({
        uid: profile.uid,
        googleName: profile.name,
        googleEmail: profile.email,
        googleAvatarInitials: profile.avatarInitials,
        organization: form.organization.trim() || undefined,
        reason: form.reason.trim() || undefined,
        requestedSirapIds: form.requestedSirapIds,
      });
      await this.enforceMinDelay(startedAt);
      this.confirmedRequest.set(stored);
      await this.syncSessionAndClose();
    } catch (error) {
      const message = this.googleErrorMessage(error);
      if (message === ACCESS_DENIED_MESSAGE) {
        await this.authService.logout();
        this.resetForms();
        this.loginError.set(ACCESS_DENIED_MESSAGE);
        this.state.set('entry');
        return;
      }
      this.loginError.set(message);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // ------------------------------------------------------------------
  // Pending confirmation (v5-D)
  // ------------------------------------------------------------------

  protected dismissFromConfirm(): void {
    this.resetForms();
    this.state.set('entry');
    this.closeRequested.emit();
  }

  // ------------------------------------------------------------------
  // Pending review (v5-E)
  // ------------------------------------------------------------------

  protected dismissFromReview(): void {
    this.closeRequested.emit();
  }

  protected async nudgeAdmins(): Promise<void> {
    if (!this.canNudge() || this.isSubmitting()) {
      return;
    }
    this.isSubmitting.set(true);
    try {
      await this.authRequest.sendAdminNudge();
      this.reviewTick.update((value) => value + 1);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  protected formatSubmittedRelative(submittedAt: number): string {
    const diffMs = Date.now() - submittedAt;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) {
      return 'just now';
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }

  // ------------------------------------------------------------------
  // TOTP MFA
  // ------------------------------------------------------------------

  protected updateTotpCode(value: string): void {
    this.totpCode.set(value.replace(/\D/g, '').slice(0, 6));
    this.totpError.set(null);
    this.totpErrorKind.set(null);
    this.enrollmentSupportCode.set(null);
  }

  protected async submitTotpEnrollment(): Promise<void> {
    if (!this.canSubmitTotp() || this.isSubmitting() || this.totpErrorKind() === 'restart') {
      return;
    }
    const session = this.mfaEnrollment();
    const user = this.firebase.currentUser;
    if (!session || !user) {
      this.applyRestartError(TOTP_RESTART_MESSAGE);
      return;
    }
    this.isSubmitting.set(true);
    this.totpError.set(null);
    this.enrollmentSupportCode.set(null);
    try {
      await this.totpMfa.completeEnrollment(user, session, this.totpCode());
      await this.finishVerifiedEnrollment();
    } catch (error) {
      const mapped = isTotpMfaError(error) ? error : toTotpMfaError(error);
      if (mapped.code === AUTH_ERROR_REQUIRES_RECENT_LOGIN) {
        await this.reconfirmGoogleAndKeepQr(user);
        return;
      }
      this.applyTotpError(mapped);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  protected async submitTotpChallenge(): Promise<void> {
    if (!this.canSubmitTotp() || this.isSubmitting() || this.totpErrorKind() === 'restart') {
      return;
    }
    const session = this.totpChallenge();
    if (!session) {
      this.applyRestartError(TOTP_RESTART_MESSAGE);
      return;
    }
    this.isSubmitting.set(true);
    this.totpError.set(null);
    this.enrollmentSupportCode.set(null);
    try {
      const credential = await this.totpMfa.completeChallenge(session, this.totpCode());
      const profile = await this.googleIdentity.profileFromCredential(credential);
      await this.continueAfterGoogleProfile(profile, this.googleIntent());
    } catch (error) {
      this.applyTotpError(error);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  protected cancelMfa(): void {
    void this.requestClose();
  }

  protected async replaceUnconfirmedAuthenticator(): Promise<void> {
    if (this.isSubmitting() || this.totpErrorKind() !== 'recover') {
      return;
    }
    const user = this.firebase.currentUser;
    const previous = this.mfaEnrollment();
    if (!user || !previous) {
      this.applyRestartError(TOTP_RESTART_MESSAGE);
      return;
    }
    this.isSubmitting.set(true);
    this.totpMfa.forgetOpenEnrollment(user.uid);
    try {
      const enrollment = await this.totpMfa.beginEnrollment(
        user,
        user.email || user.displayName || '',
      );
      this.mfaEnrollment.set(enrollment);
      this.clearTotpFields();
    } catch (error) {
      this.mfaEnrollment.set(previous);
      this.totpMfa.rememberOpenEnrollment(user, previous);
      this.totpMfa.markEnrollmentUnconfirmed(user.uid);
      if (isTotpMfaError(error) && error.code === TOTP_ALREADY_ENROLLED_CODE) {
        await this.finishVerifiedEnrollment();
        return;
      }
      if (isTotpMfaError(error)) {
        this.applyTotpError(error);
        return;
      }
      this.holdEnrollmentForRecovery(
        TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
        TOTP_ENROLLMENT_UNCONFIRMED_CODE,
      );
    } finally {
      this.isSubmitting.set(false);
    }
  }

  protected async returnToGoogleSignIn(): Promise<void> {
    if (this.isSubmitting()) {
      return;
    }
    const message = this.totpError() ?? TOTP_RESTART_MESSAGE;
    await this.abortMfaSessions();
    this.resetForms();
    this.loginError.set(message);
    this.state.set('entry');
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async beginGoogleSignIn(intent: GoogleIntent): Promise<void> {
    if (this.isSubmitting()) {
      return;
    }
    this.isSubmitting.set(true);
    this.loginError.set(null);
    this.loginStatus.set(null);
    this.googleIntent.set(intent);
    try {
      const result = await this.googleIdentity.signIn();
      if (result.kind === 'totp-assertion-required') {
        this.enterMfaChallenge(result.assertion);
        return;
      }
      await this.continueAfterGoogleProfile(result.profile, intent);
    } catch (error) {
      this.loginError.set(this.googleErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
    if (this.isMfaState()) {
      this.requestTotpFocus();
    }
  }

  private enterMfaChallenge(session: TotpChallengeSession): void {
    this.clearTotpFields();
    this.totpChallenge.set(session);
    this.state.set('mfaChallenge');
  }

  private async continueAfterGoogleProfile(
    profile: GoogleProfile,
    intent: GoogleIntent,
  ): Promise<void> {
    const loginResult = await this.authRequest.attemptLogin({
      uid: profile.uid,
      email: profile.email,
      displayName: profile.name,
      provider: 'google',
    });

    if (loginResult === 'pending') {
      if (intent === 'request') {
        this.pendingGoogleProfile.set(profile);
        this.postGoogleForm.set({ organization: '', reason: '', requestedSirapIds: [] });
        this.state.set('postGoogle');
        return;
      }
      this.state.set('pendingReview');
      return;
    }

    if (loginResult !== 'active') {
      await this.authService.logout();
      this.loginError.set(ACCESS_DENIED_MESSAGE);
      this.state.set('entry');
      return;
    }

    const user = this.firebase.currentUser;
    if (user && !(await this.totpMfa.userHasEnrolledTotp(user))) {
      await this.enterEnrollment(user, user.email || profile.email || profile.name);
      return;
    }

    await this.finishVerifiedEnrollment();
  }

  private async resumeRequiredEnrollment(): Promise<void> {
    this.state.set('mfaEnroll');
    this.isSubmitting.set(true);
    try {
      const user = this.firebase.currentUser;
      if (!user) {
        this.applyRestartError(TOTP_RESTART_MESSAGE);
        return;
      }
      await this.enterEnrollment(user, user.email || user.displayName || '');
    } finally {
      this.isSubmitting.set(false);
    }
    this.requestTotpFocus();
  }

  private async enterEnrollment(user: User, accountName: string): Promise<void> {
    const existing = this.totpMfa.openEnrollmentFor(user);
    this.clearTotpFields();
    this.state.set('mfaEnroll');
    if (existing) {
      this.mfaEnrollment.set(existing);
      this.isSubmitting.set(false);
      if (this.totpMfa.enrollmentNeedsRecovery(user.uid)) {
        this.holdEnrollmentForRecovery(
          TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
          TOTP_ENROLLMENT_UNCONFIRMED_CODE,
        );
      }
      return;
    }
    this.mfaEnrollment.set(null);
    try {
      if (await this.totpMfa.userHasEnrolledTotp(user)) {
        await this.finishVerifiedEnrollment();
        return;
      }
      const enrollment = await this.totpMfa.beginEnrollment(user, accountName);
      this.mfaEnrollment.set(enrollment);
      this.isSubmitting.set(false);
    } catch (error) {
      if (isTotpMfaError(error) && error.code === TOTP_ALREADY_ENROLLED_CODE) {
        await this.finishVerifiedEnrollment();
        return;
      }
      if (isTotpMfaError(error)) {
        this.applyTotpError(error);
        return;
      }
      this.applyRestartError(TOTP_RESTART_MESSAGE);
    }
  }

  private isMfaState(): boolean {
    const state = this.state();
    return state === 'mfaEnroll' || state === 'mfaChallenge';
  }

  private async abortMfaAndClose(): Promise<void> {
    await this.abortMfaSessions();
    this.resetForms();
    this.state.set('entry');
    this.closeRequested.emit();
  }

  private async abortMfaSessions(): Promise<void> {
    this.clearMfaSessions();
    await this.authService.logout();
  }

  private applyTotpError(error: unknown): void {
    const mapped = isTotpMfaError(error) ? error : toTotpMfaError(error);
    if (this.mfaEnrollment()) {
      this.applyDisplayedEnrollmentError(mapped);
      return;
    }
    if (mapped.kind === 'recover' || mapped.code === TOTP_ENROLLMENT_UNCONFIRMED_CODE) {
      this.holdEnrollmentForRecovery(mapped.message, mapped.code);
      return;
    }
    this.totpErrorKind.set(mapped.kind);
    this.totpError.set(mapped.message);
    this.enrollmentSupportCode.set(
      this.state() === 'mfaEnroll' ? totpSupportCode(mapped.code) : null,
    );
    if (mapped.kind === 'retry') {
      this.totpCode.set('');
      this.requestTotpFocus();
      return;
    }
    this.signOutForRestart();
  }

  private applyDisplayedEnrollmentError(error: TotpMfaError): void {
    if (this.isRetryableEnrollmentCode(error)) {
      this.holdEnrollmentForRetry(error.message, error.code);
      return;
    }
    if (error.code === AUTH_ERROR_REQUIRES_RECENT_LOGIN) {
      this.holdEnrollmentForRetry(TOTP_RECENT_LOGIN_FAILED_MESSAGE, error.code);
      return;
    }
    const message =
      error.kind === 'recover' || error.code === TOTP_ENROLLMENT_UNCONFIRMED_CODE
        ? error.message
        : TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE;
    this.holdEnrollmentForRecovery(message, error.code);
  }

  private isRetryableEnrollmentCode(error: TotpMfaError): boolean {
    return (
      error.code === AUTH_ERROR_INVALID_OTP ||
      error.code === AUTH_ERROR_CODE_EXPIRED ||
      error.code === TOTP_INVALID_FORMAT_CODE
    );
  }

  private holdEnrollmentForRetry(message: string, code?: string): void {
    this.totpErrorKind.set('retry');
    this.totpError.set(message);
    this.enrollmentSupportCode.set(totpSupportCode(code));
    this.totpCode.set('');
    this.requestTotpFocus();
  }

  private holdEnrollmentForRecovery(message: string, code?: string): void {
    const uid = this.firebase.currentUser?.uid;
    if (uid) {
      this.totpMfa.markEnrollmentUnconfirmed(uid);
    }
    this.totpErrorKind.set('recover');
    this.totpError.set(message);
    this.enrollmentSupportCode.set(totpSupportCode(code));
    this.totpCode.set('');
    this.requestTotpFocus();
  }

  private async reconfirmGoogleAndKeepQr(user: User): Promise<void> {
    try {
      await this.firebase.reauthenticateWithGooglePopup(user);
      this.holdEnrollmentForRetry(TOTP_RECENT_LOGIN_MESSAGE);
    } catch {
      this.holdEnrollmentForRetry(
        TOTP_RECENT_LOGIN_FAILED_MESSAGE,
        AUTH_ERROR_REQUIRES_RECENT_LOGIN,
      );
    }
  }

  private requestTotpFocus(): void {
    afterNextRender(() => this.totpCodeInputRef?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  private applyRestartError(message: string): void {
    this.totpErrorKind.set('restart');
    this.totpError.set(message);
    this.enrollmentSupportCode.set(null);
    this.signOutForRestart();
  }

  private signOutForRestart(): void {
    this.mfaEnrollment.set(null);
    this.totpChallenge.set(null);
    void this.authService.logout();
  }

  private clearTotpFields(): void {
    this.totpCode.set('');
    this.totpError.set(null);
    this.totpErrorKind.set(null);
    this.enrollmentSupportCode.set(null);
  }

  private clearMfaSessions(): void {
    this.mfaEnrollment.set(null);
    this.totpChallenge.set(null);
    this.clearTotpFields();
  }

  private async finishVerifiedEnrollment(): Promise<void> {
    try {
      await this.authService.refreshCurrentUserTier();
    } catch {
      this.holdEnrollmentForRecovery(
        TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
        TOTP_ENROLLMENT_UNCONFIRMED_CODE,
      );
      return;
    }
    if (this.authService.mfaEnrollmentRequired$()) {
      this.holdEnrollmentForRecovery(
        TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
        TOTP_ENROLLMENT_UNCONFIRMED_CODE,
      );
      return;
    }
    this.totpMfa.forgetOpenEnrollment(this.firebase.currentUser?.uid);
    this.resetForms();
    this.state.set('entry');
    this.closeRequested.emit();
  }

  private async syncSessionAndClose(): Promise<void> {
    await this.authService.refreshCurrentUserTier();
    this.resetForms();
    this.state.set('entry');
    this.closeRequested.emit();
  }

  /**
   * Ensure there is a stored pending request so v5-E has metadata to
   * display. If the user hasn't submitted one, synthesize one from the
   * current login attempt — the mock always treats logins as pending
   * (see AuthRequestService.attemptLogin).
   */
  private ensurePendingRequest(profile: Partial<GoogleProfile>): void {
    if (this.authRequest.hasPendingRequest()) {
      return;
    }
    const email = profile.email ?? '';
    const name = profile.name ?? email.split('@')[0] ?? 'there';
    void this.authRequest.submitEmailRequest({
      fullName: name,
      email,
      password: 'unused-mock-pass',
      requestedSirapIds: [],
    });
  }

  private async enforceMinDelay(startedAt: number): Promise<void> {
    const elapsed = Date.now() - startedAt;
    const remaining = SUBMIT_MIN_DELAY_MS - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  private googleErrorMessage(error: unknown): string {
    return error instanceof Error && error.message
      ? error.message
      : 'Google sign-in failed. Please try again.';
  }

  private resetForms(): void {
    this.emailLoginForm.set({ email: '', password: '' });
    this.emailRequestForm.set({
      fullName: '',
      email: '',
      password: '',
      passwordConfirm: '',
      organization: '',
      reason: '',
    });
    this.postGoogleForm.set({ organization: '', reason: '', requestedSirapIds: [] });
    this.pendingGoogleProfile.set(null);
    this.loginError.set(null);
    this.loginStatus.set(null);
    this.clearMfaSessions();
  }

  private toggleSirapId(
    selectedIds: readonly SirapRegionId[],
    sirapId: SirapRegionId,
  ): SirapRegionId[] {
    return selectedIds.includes(sirapId)
      ? selectedIds.filter((id) => id !== sirapId)
      : [...selectedIds, sirapId];
  }
}
