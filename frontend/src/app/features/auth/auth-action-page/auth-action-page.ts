import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FirebaseClientService } from '@core/services/firebase-client.service';

export type AuthActionMode =
  | 'revertSecondFactorAddition'
  | 'verifyEmail'
  | 'recoverEmail'
  | 'verifyAndChangeEmail'
  | 'resetPassword'
  | 'invalid';

export type AuthActionStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface AuthActionCopy {
  title: string;
  description: string;
  warning?: string;
  buttonLabel?: string;
  successMessage?: string;
}

export interface AuthActionError {
  message: string;
  retryable: boolean;
}

export const AUTH_ACTION_COPY: Record<AuthActionMode, AuthActionCopy> = {
  revertSecondFactorAddition: {
    title: 'Remove 2-step verification?',
    description:
      'This undoes an authenticator app that was recently added to your account and signs you out on every device.',
    warning:
      'Only continue if you did not add an authenticator yourself. If you just set one up, you can close this page.',
    buttonLabel: 'Remove 2-step verification',
    successMessage: 'Two-step verification was removed. Sign in again to set it up.',
  },
  verifyEmail: {
    title: 'Verify your email',
    description: 'Confirm that this email address belongs to you.',
    buttonLabel: 'Verify email',
    successMessage: 'Your email is verified. You can return to the app.',
  },
  recoverEmail: {
    title: 'Restore your email?',
    description:
      'The email address on your account was recently changed. Restore it if you did not make that change.',
    buttonLabel: 'Restore my email',
    successMessage: 'Your original email was restored. Sign in again to continue.',
  },
  verifyAndChangeEmail: {
    title: 'Confirm your new email',
    description: 'Confirm this address to make it the new email on your account.',
    buttonLabel: 'Confirm new email',
    successMessage: 'Your new email is confirmed. Sign in again with it to continue.',
  },
  resetPassword: {
    title: 'Password sign-in isn’t used',
    description:
      'This app signs you in with Google, so there is no password to reset. Use “Continue with Google” instead.',
  },
  invalid: {
    title: 'This link isn’t valid',
    description:
      'The link is incomplete or no longer supported. Request a new email and try again.',
  },
};

const ACTION_MODES = new Set<string>([
  'revertSecondFactorAddition',
  'verifyEmail',
  'recoverEmail',
  'verifyAndChangeEmail',
  'resetPassword',
]);

const CODELESS_MODES = new Set<AuthActionMode>(['resetPassword', 'invalid']);

export function resolveAuthActionMode(mode: string | null, oobCode: string | null): AuthActionMode {
  if (!mode || !ACTION_MODES.has(mode)) {
    return 'invalid';
  }
  if (mode !== 'resetPassword' && !oobCode) {
    return 'invalid';
  }
  return mode as AuthActionMode;
}

/** Only same-origin continue URLs are followed, so the link cannot redirect elsewhere. */
export function safeContinueHref(continueUrl: string | null, origin: string): string {
  if (!continueUrl) {
    return '/';
  }
  try {
    const url = new URL(continueUrl, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}

export function authActionErrorFor(error: unknown): AuthActionError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : null;
  switch (code) {
    case 'auth/invalid-action-code':
      return { message: 'This link is invalid or has already been used.', retryable: false };
    case 'auth/expired-action-code':
      return {
        message: 'This link has expired. Request a new email and try again.',
        retryable: false,
      };
    case 'auth/user-disabled':
      return {
        message: 'This account has been disabled. Contact your administrator.',
        retryable: false,
      };
    case 'auth/user-not-found':
      return { message: 'We couldn’t find the account for this link.', retryable: false };
    case 'auth/network-request-failed':
      return {
        message: 'We couldn’t reach the server. Check your connection and try again.',
        retryable: true,
      };
    default:
      return { message: 'Something went wrong. Please try again in a moment.', retryable: true };
  }
}

@Component({
  selector: 'app-auth-action-page',
  templateUrl: './auth-action-page.html',
})
export class AuthActionPageComponent {
  private readonly firebase = inject(FirebaseClientService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  private readonly oobCode = this.query.get('oobCode');
  protected readonly mode = resolveAuthActionMode(this.query.get('mode'), this.oobCode);
  protected readonly copy = AUTH_ACTION_COPY[this.mode];
  protected readonly continueHref = safeContinueHref(
    this.query.get('continueUrl'),
    window.location.origin,
  );

  protected readonly status = signal<AuthActionStatus>('idle');
  protected readonly error = signal<AuthActionError | null>(null);
  protected readonly isSubmitting = computed(() => this.status() === 'submitting');
  protected readonly showConfirmButton = computed(
    () =>
      !CODELESS_MODES.has(this.mode) &&
      (this.status() === 'idle' ||
        this.status() === 'submitting' ||
        (this.status() === 'error' && Boolean(this.error()?.retryable))),
  );

  protected async confirm(): Promise<void> {
    const oobCode = this.oobCode;
    if (!oobCode || this.isSubmitting() || !this.showConfirmButton()) {
      return;
    }

    this.status.set('submitting');
    this.error.set(null);
    try {
      if (this.mode === 'recoverEmail') {
        await this.firebase.checkActionCode(oobCode);
      }
      await this.firebase.applyActionCode(oobCode);
      this.status.set('success');
    } catch (error) {
      this.error.set(authActionErrorFor(error));
      this.status.set('error');
    }
  }
}
