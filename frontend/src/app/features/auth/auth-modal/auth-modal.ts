import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import {
  AuthRequestService,
  type EmailRequestPayload,
  type StoredPendingRequest,
} from '../services/auth-request.service';
import { GoogleIdentityService, type GoogleProfile } from '../services/google-identity.service';

export type AuthModalState =
  | 'entry'
  | 'emailLogin'
  | 'emailRequest'
  | 'pendingConfirm'
  | 'pendingReview'
  | 'postGoogle';

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
  private readonly googleIdentity = inject(GoogleIdentityService);

  @Output() readonly closeRequested = new EventEmitter<void>();

  @ViewChild('modalCard', { static: false })
  private readonly modalCardRef?: ElementRef<HTMLElement>;

  protected readonly state = signal<AuthModalState>('entry');
  protected readonly isSubmitting = signal(false);
  protected readonly loginError = signal<string | null>(null);

  protected readonly emailLoginForm = signal<EmailLoginForm>({ email: '', password: '' });
  protected readonly emailRequestForm = signal<EmailRequestForm>({
    fullName: '',
    email: '',
    password: '',
    passwordConfirm: '',
    organization: '',
    reason: '',
  });
  protected readonly postGoogleForm = signal<PostGoogleForm>({ organization: '', reason: '' });
  protected readonly pendingGoogleProfile = signal<GoogleProfile | null>(null);
  protected readonly confirmedRequest = signal<StoredPendingRequest | null>(null);

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

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.isSubmitting()) {
      this.closeRequested.emit();
    }
  }

  protected onScrimClick(event: MouseEvent): void {
    const card = this.modalCardRef?.nativeElement;
    if (card && event.target instanceof Node && card.contains(event.target)) {
      return;
    }
    if (!this.isSubmitting()) {
      this.closeRequested.emit();
    }
  }

  protected requestClose(): void {
    if (this.isSubmitting()) {
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
    if (this.isSubmitting()) {
      return;
    }
    this.isSubmitting.set(true);
    try {
      const profile = await this.googleIdentity.signIn();
      const loginResult = await this.authRequest.attemptLogin({
        uid: profile.uid,
        email: profile.email,
        provider: 'google',
      });
      if (loginResult === 'active') {
        await this.syncSessionAndClose();
        return;
      }
      if (loginResult === 'pending') {
        this.ensurePendingRequest(profile);
        this.state.set('pendingReview');
        return;
      }
      // For the MVP mock we never hit 'invalid' here, but route gracefully:
      // treat the Google handshake as a new user and send them to the
      // post-Google completion form (the Request Access half of §5.2b).
      this.pendingGoogleProfile.set(profile);
      this.postGoogleForm.set({ organization: '', reason: '' });
      this.state.set('postGoogle');
    } finally {
      this.isSubmitting.set(false);
    }
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
    if (this.isSubmitting()) {
      return;
    }
    this.isSubmitting.set(true);
    try {
      const profile = await this.googleIdentity.signIn();
      this.pendingGoogleProfile.set(profile);
      this.postGoogleForm.set({ organization: '', reason: '' });
      this.state.set('postGoogle');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  protected updatePostGoogleField<K extends keyof PostGoogleForm>(
    field: K,
    value: PostGoogleForm[K],
  ): void {
    this.postGoogleForm.update((form) => ({ ...form, [field]: value }));
  }

  protected async submitPostGoogle(): Promise<void> {
    if (this.isSubmitting()) {
      return;
    }
    const profile = this.pendingGoogleProfile();
    if (!profile) {
      return;
    }
    this.isSubmitting.set(true);
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
      });
      await this.enforceMinDelay(startedAt);
      this.confirmedRequest.set(stored);
      this.state.set('pendingConfirm');
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
  // Helpers
  // ------------------------------------------------------------------

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
    });
  }

  private async enforceMinDelay(startedAt: number): Promise<void> {
    const elapsed = Date.now() - startedAt;
    const remaining = SUBMIT_MIN_DELAY_MS - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
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
    this.postGoogleForm.set({ organization: '', reason: '' });
    this.pendingGoogleProfile.set(null);
    this.loginError.set(null);
  }
}
