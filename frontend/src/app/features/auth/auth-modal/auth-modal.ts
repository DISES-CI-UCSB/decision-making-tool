import { A11yModule } from '@angular/cdk/a11y';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Injector,
  OnDestroy,
  Output,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { type User } from 'firebase/auth';
import { GoogleIdentityService, type GoogleProfile } from '../services/google-identity.service';
import {
  AUTH_ERROR_CODE_EXPIRED,
  AUTH_ERROR_INVALID_OTP,
  AUTH_ERROR_REQUIRES_RECENT_LOGIN,
  AUTH_ERROR_USER_TOKEN_EXPIRED,
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
  hasTotpSecondFactorClaim,
  isTotpMfaError,
  totpSupportCode,
  toTotpMfaError,
  type TotpChallengeSession,
  type TotpEnrollmentSession,
  type TotpErrorKind,
  type TotpMfaError,
} from '../services/totp-mfa.service';

export const ACCOUNT_NOT_ACTIVE_MESSAGE =
  'This Google account is not active. Contact an administrator for help.';

export type AuthModalState = 'entry' | 'mfaEnroll' | 'mfaChallenge';
export type GoogleSignInContinuation = 'first-factor' | 'challenge';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [A11yModule],
  templateUrl: './auth-modal.html',
  styleUrl: './auth-modal.scss',
})
export class AuthModalComponent implements OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly firebase = inject(FirebaseClientService);
  private readonly googleIdentity = inject(GoogleIdentityService);
  private readonly totpMfa = inject(TotpMfaService);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly backgroundInertElements: HTMLElement[] = [];
  private openerElement: HTMLElement | null = null;

  @Output() readonly closeRequested = new EventEmitter<void>();

  @ViewChild('modalCard', { static: false })
  private readonly modalCardRef?: ElementRef<HTMLElement>;

  @ViewChild('totpCodeInput')
  private readonly totpCodeInputRef?: ElementRef<HTMLInputElement>;

  protected readonly state = signal<AuthModalState>('entry');
  protected readonly isSubmitting = signal(false);
  protected readonly loginError = signal<string | null>(null);
  protected readonly loginStatus = signal<string | null>(null);
  protected readonly totpIssuer = TOTP_ISSUER;
  protected readonly enrollmentReplaceWarning = TOTP_ENROLLMENT_REPLACE_WARNING;
  protected readonly totpCode = signal('');
  protected readonly totpError = signal<string | null>(null);
  protected readonly totpErrorKind = signal<TotpErrorKind | null>(null);
  protected readonly enrollmentSupportCode = signal<string | null>(null);
  protected readonly mfaEnrollment = signal<TotpEnrollmentSession | null>(null);
  protected readonly totpChallenge = signal<TotpChallengeSession | null>(null);

  protected readonly modalTitleId = computed(() => {
    switch (this.state()) {
      case 'mfaEnroll':
        return 'auth-modal-mfa-enroll-title';
      case 'mfaChallenge':
        return 'auth-modal-mfa-challenge-title';
      default:
        return 'auth-modal-title';
    }
  });

  protected readonly canSubmitTotp = computed(() => /^\d{6}$/.test(this.totpCode()));

  constructor() {
    this.rememberOpener();
    afterNextRender(() => this.prepareOpenDialog(), { injector: this.injector });
    if (this.authService.mfaEnrollmentRequired$() && this.firebase.currentUser) {
      void this.resumeRequiredEnrollment();
    }
  }

  ngOnDestroy(): void {
    this.restoreBackgroundAccess();
    const opener = this.openerElement;
    this.openerElement = null;
    if (opener?.isConnected) {
      opener.focus();
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
    if (this.state() === 'mfaEnroll') {
      this.preserveAccountAndClose();
      return;
    }
    if (this.state() === 'mfaChallenge') {
      void this.abortMfaAndClose();
      return;
    }
    this.closeRequested.emit();
  }

  protected async chooseGoogleFromEntry(): Promise<void> {
    await this.beginGoogleSignIn();
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
      await this.finishVerifiedEnrollment(true);
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
      await this.continueAfterGoogleSignIn(profile, 'challenge');
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
    const preserveIdentity = this.state() === 'mfaEnroll' && this.mfaEnrollment() === null;
    if (preserveIdentity) {
      this.clearMfaSessions();
    } else {
      await this.abortMfaSessions();
    }
    this.resetForms();
    this.loginError.set(message);
    this.state.set('entry');
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async beginGoogleSignIn(): Promise<void> {
    if (this.isSubmitting()) {
      return;
    }
    this.isSubmitting.set(true);
    this.loginError.set(null);
    this.loginStatus.set(null);
    try {
      const result = await this.googleIdentity.signIn();
      if (result.kind === 'totp-assertion-required') {
        this.enterMfaChallenge(result.assertion);
        return;
      }
      if (result.kind === 'completed') {
        await this.continueAfterGoogleSignIn(result.profile, 'first-factor');
      }
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

  private async continueAfterGoogleSignIn(
    profile: GoogleProfile,
    continuation: GoogleSignInContinuation,
  ): Promise<void> {
    if (continuation === 'challenge') {
      await this.finishMfaVerifiedSignIn();
      return;
    }

    const user = this.firebase.currentUser;
    if (!user) {
      this.loginError.set('Google sign-in did not finish. Please try again.');
      this.state.set('entry');
      return;
    }

    // A durable MFA account raises auth/multi-factor-auth-required. A
    // first-factor popup is first-time setup. Do not force-refresh factors
    // here. The cached TOTP claim is the only first-factor path that may
    // finish as a returning MFA session.
    if (await hasTotpSecondFactorClaim(user)) {
      await this.finishMfaVerifiedSignIn();
      return;
    }

    this.totpMfa.markEnrollmentInProgress(user.uid);

    const ensured = await this.firebase.ensureSelfUserRecord(user);
    if (ensured.status === 'denied') {
      this.totpMfa.clearEnrollmentInProgress(user.uid);
      await this.authService.logout();
      this.loginError.set(ACCOUNT_NOT_ACTIVE_MESSAGE);
      this.state.set('entry');
      return;
    }

    await this.enterEnrollment(user, user.email || profile.email || profile.name, {
      skipFactorCheck: true,
    });
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

  private async enterEnrollment(
    user: User,
    accountName: string,
    options?: { skipFactorCheck?: boolean },
  ): Promise<void> {
    this.totpMfa.markEnrollmentInProgress(user.uid);
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
    if (!options?.skipFactorCheck) {
      try {
        if (await this.totpMfa.userHasEnrolledTotp(user)) {
          await this.finishVerifiedEnrollment();
          return;
        }
      } catch (error) {
        if (isTotpMfaError(error) && error.code === TOTP_ALREADY_ENROLLED_CODE) {
          await this.finishVerifiedEnrollment();
          return;
        }
        this.holdIdentityAfterResumeFailure(error);
        return;
      }
    }
    try {
      const enrollment = await this.totpMfa.beginEnrollment(user, accountName, {
        skipEnrolledCheck: true,
      });
      this.mfaEnrollment.set(enrollment);
      this.isSubmitting.set(false);
    } catch (error) {
      if (isTotpMfaError(error) && error.code === TOTP_ALREADY_ENROLLED_CODE) {
        await this.finishVerifiedEnrollment();
        return;
      }
      this.holdIdentityAfterResumeFailure(error);
    }
  }

  private isMfaState(): boolean {
    const state = this.state();
    return state === 'mfaEnroll' || state === 'mfaChallenge';
  }

  private preserveAccountAndClose(): void {
    this.resetForms();
    this.state.set('entry');
    this.closeRequested.emit();
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
    if (error.code === AUTH_ERROR_USER_TOKEN_EXPIRED) {
      this.restartExpiredEnrollmentSession(error);
      return;
    }
    const message =
      error.kind === 'recover' || error.code === TOTP_ENROLLMENT_UNCONFIRMED_CODE
        ? error.message
        : TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE;
    this.holdEnrollmentForRecovery(message, error.code);
  }

  private restartExpiredEnrollmentSession(error: TotpMfaError): void {
    this.totpMfa.forgetOpenEnrollment(this.firebase.currentUser?.uid);
    this.applyRestartError(error.message);
    this.enrollmentSupportCode.set(totpSupportCode(error.code));
  }

  private isRetryableEnrollmentCode(error: TotpMfaError): boolean {
    return (
      error.code === AUTH_ERROR_INVALID_OTP ||
      error.code === AUTH_ERROR_CODE_EXPIRED ||
      error.code === TOTP_INVALID_FORMAT_CODE
    );
  }

  private holdIdentityAfterResumeFailure(error: unknown): void {
    const mapped = isTotpMfaError(error) ? error : toTotpMfaError(error);
    this.mfaEnrollment.set(null);
    this.totpErrorKind.set('restart');
    this.totpError.set(mapped.message);
    this.enrollmentSupportCode.set(totpSupportCode(mapped.code));
    this.totpCode.set('');
    this.isSubmitting.set(false);
    this.requestTotpFocus();
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
    afterNextRender(
      () => {
        this.totpCodeInputRef?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  private rememberOpener(): void {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !this.host.nativeElement.contains(active)
    ) {
      this.openerElement = active;
    }
  }

  private prepareOpenDialog(): void {
    this.focusPreferredControl();
    this.hideBackgroundFromAssistiveTech();
  }

  private focusPreferredControl(): void {
    const preferredId =
      this.state() === 'mfaEnroll'
        ? this.totpErrorKind() === 'restart'
          ? 'auth-modal-mfa-enroll-restart-btn'
          : 'auth-modal-mfa-enroll-code-input'
        : this.state() === 'mfaChallenge'
          ? 'auth-modal-mfa-challenge-code-input'
          : 'auth-modal-entry-google-btn';
    if (this.focusControl(preferredId)) {
      return;
    }
    this.focusControl('auth-modal-close-button');
  }

  private focusControl(id: string): boolean {
    const target = this.host.nativeElement.querySelector(`#${id}`);
    if (!(target instanceof HTMLElement) || target.hasAttribute('disabled')) {
      return false;
    }
    target.focus();
    return document.activeElement === target;
  }

  // Marks siblings of the dialog and of each ancestor. Ancestors stay active so the dialog is not hidden.
  private hideBackgroundFromAssistiveTech(): void {
    const dialogNode = this.host.nativeElement.querySelector('#auth-modal-overlay');
    if (!(dialogNode instanceof HTMLElement)) {
      return;
    }
    let current: HTMLElement | null = dialogNode;
    while (current && current !== document.body) {
      const parent: HTMLElement | null =
        current.parentElement instanceof HTMLElement ? current.parentElement : null;
      if (!parent) {
        break;
      }
      for (const sibling of Array.from(parent.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === current) {
          continue;
        }
        if (sibling.classList.contains('cdk-focus-trap-anchor') || sibling.hasAttribute('inert')) {
          continue;
        }
        sibling.setAttribute('inert', '');
        sibling.setAttribute('data-auth-modal-background-inert', '');
        this.backgroundInertElements.push(sibling);
      }
      current = parent;
    }
  }

  private restoreBackgroundAccess(): void {
    for (const element of this.backgroundInertElements) {
      element.removeAttribute('inert');
      element.removeAttribute('data-auth-modal-background-inert');
    }
    this.backgroundInertElements.length = 0;
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

  private async finishMfaVerifiedSignIn(): Promise<void> {
    const user = this.firebase.currentUser;
    if (!user) {
      this.loginError.set('Google sign-in did not finish. Please try again.');
      this.state.set('entry');
      return;
    }

    const ensured = await this.firebase.ensureSelfUserRecord(user);
    if (ensured.status === 'denied') {
      this.totpMfa.clearEnrollmentInProgress(user.uid);
      await this.authService.logout();
      this.loginError.set(ACCOUNT_NOT_ACTIVE_MESSAGE);
      this.state.set('entry');
      return;
    }

    // resolveSignIn already proved the TOTP factor. Skip enrollment and
    // the competing factor probe.
    await this.finishVerifiedEnrollment(true);
  }

  private async finishVerifiedEnrollment(totpEnrollmentConfirmed = false): Promise<void> {
    try {
      await this.authService.refreshCurrentUserTier(
        totpEnrollmentConfirmed ? { totpEnrollmentConfirmed: true } : undefined,
      );
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

  private googleErrorMessage(error: unknown): string {
    return error instanceof Error && error.message
      ? error.message
      : 'Google sign-in failed. Please try again.';
  }

  private resetForms(): void {
    this.loginError.set(null);
    this.loginStatus.set(null);
    this.clearMfaSessions();
  }
}
