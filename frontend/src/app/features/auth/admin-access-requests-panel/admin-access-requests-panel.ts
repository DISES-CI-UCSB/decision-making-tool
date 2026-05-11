import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  OnInit,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { UserTier } from '@core/models';
import {
  AdminAccessRequestsService,
  type AccessRequestRecord,
  type AdminManagedUserRecord,
  type UserAccessGrant,
} from '../services/admin-access-requests.service';

@Component({
  selector: 'app-admin-access-requests-panel',
  standalone: true,
  imports: [],
  templateUrl: './admin-access-requests-panel.html',
  styleUrl: './admin-access-requests-panel.scss',
})
export class AdminAccessRequestsPanelComponent implements OnInit {
  private readonly adminRequests = inject(AdminAccessRequestsService);
  protected readonly UserTier = UserTier;

  @Output() readonly closeRequested = new EventEmitter<void>();

  @ViewChild('panelCard', { static: false })
  private readonly panelCardRef?: ElementRef<HTMLElement>;

  protected readonly pendingRequests = signal<AccessRequestRecord[]>([]);
  protected readonly activeUsers = signal<AdminManagedUserRecord[]>([]);
  protected readonly requestGrants = signal<Record<string, UserAccessGrant>>({});
  protected readonly userGrants = signal<Record<string, UserAccessGrant>>({});
  protected readonly userSearchQuery = signal('');
  protected readonly isLoading = signal(true);
  protected readonly loadingError = signal<string | null>(null);
  protected readonly approvingUid = signal<string | null>(null);
  protected readonly updatingUserUid = signal<string | null>(null);
  protected readonly filteredUsers = computed(() => {
    const query = this.userSearchQuery().trim().toLowerCase();
    const users = this.activeUsers();
    if (!query) {
      return users;
    }
    return users.filter((user) =>
      [user.displayName, user.email, user.role, `${user.tier}`, user.uid]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  });

  async ngOnInit(): Promise<void> {
    await this.loadRequests();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.hasPendingWrite()) {
      this.closeRequested.emit();
    }
  }

  protected onScrimClick(event: MouseEvent): void {
    const card = this.panelCardRef?.nativeElement;
    if (card && event.target instanceof Node && card.contains(event.target)) {
      return;
    }
    if (!this.hasPendingWrite()) {
      this.closeRequested.emit();
    }
  }

  protected requestClose(): void {
    if (!this.hasPendingWrite()) {
      this.closeRequested.emit();
    }
  }

  protected async refreshRequests(): Promise<void> {
    await this.loadRequests();
  }

  protected onRequestTierChange(request: AccessRequestRecord, event: Event): void {
    this.updateRequestGrant(request.uid, {
      tier: this.readTierFromSelect(event),
    });
  }

  protected onRequestAdminChange(request: AccessRequestRecord, event: Event): void {
    this.updateRequestGrant(request.uid, {
      isAdmin: this.readChecked(event),
    });
  }

  protected async approveRequest(request: AccessRequestRecord): Promise<void> {
    if (this.approvingUid()) {
      return;
    }

    this.loadingError.set(null);
    this.approvingUid.set(request.uid);
    try {
      await this.adminRequests.approveRequest(request, this.requestGrantFor(request));
      this.pendingRequests.update((requests) =>
        requests.filter((candidate) => candidate.uid !== request.uid),
      );
      this.requestGrants.update((grants) => this.withoutGrant(grants, request.uid));
      await this.loadUsers();
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.approvingUid.set(null);
    }
  }

  protected onUserSearchChange(event: Event): void {
    this.userSearchQuery.set((event.target as HTMLInputElement).value);
  }

  protected onUserTierChange(user: AdminManagedUserRecord, event: Event): void {
    this.updateUserGrant(user.uid, {
      tier: this.readTierFromSelect(event),
    });
  }

  protected onUserAdminChange(user: AdminManagedUserRecord, event: Event): void {
    this.updateUserGrant(user.uid, {
      isAdmin: this.readChecked(event),
    });
  }

  protected async saveUserAccess(user: AdminManagedUserRecord): Promise<void> {
    if (this.updatingUserUid()) {
      return;
    }

    this.loadingError.set(null);
    this.updatingUserUid.set(user.uid);
    try {
      const grant = this.userGrantFor(user);
      await this.adminRequests.updateUserAccess(user.uid, grant);
      this.activeUsers.update((users) =>
        users.map((candidate) =>
          candidate.uid === user.uid
            ? {
                ...candidate,
                ...grant,
                role: this.roleLabelForTier(grant.tier),
                updatedAt: new Date(),
              }
            : candidate,
        ),
      );
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.updatingUserUid.set(null);
    }
  }

  protected requestGrantFor(request: AccessRequestRecord): UserAccessGrant {
    return this.requestGrants()[request.uid] ?? this.defaultGrant();
  }

  protected userGrantFor(user: AdminManagedUserRecord): UserAccessGrant {
    return this.userGrants()[user.uid] ?? { tier: user.tier, isAdmin: user.isAdmin };
  }

  protected hasUserChanges(user: AdminManagedUserRecord): boolean {
    const grant = this.userGrantFor(user);
    return grant.tier !== user.tier || grant.isAdmin !== user.isAdmin;
  }

  protected tierLabel(tier: UserTier): string {
    return tier >= UserTier.Manager ? 'Tier 3 - Publisher / scientist' : 'Tier 2 - Approved user';
  }

  protected adminLabel(isAdmin: boolean): string {
    return isAdmin ? 'Admin' : 'Not admin';
  }

  protected formatRequestedAt(request: AccessRequestRecord): string {
    const date =
      request.requestedAt ?? (request.submittedAt ? new Date(request.submittedAt) : null);
    if (!date) {
      return 'Not recorded';
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  protected formatOptional(value: string | null): string {
    return value || 'Not provided';
  }

  private async loadRequests(): Promise<void> {
    this.isLoading.set(true);
    this.loadingError.set(null);
    try {
      const [pendingRequests] = await Promise.all([this.adminRequests.listPendingRequests()]);
      this.pendingRequests.set(pendingRequests);
      this.requestGrants.set(
        Object.fromEntries(pendingRequests.map((request) => [request.uid, this.defaultGrant()])),
      );
      await this.loadUsers();
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
      this.pendingRequests.set([]);
      this.activeUsers.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadUsers(): Promise<void> {
    const users = await this.adminRequests.listActiveUsers();
    this.activeUsers.set(users);
    this.userGrants.set(
      Object.fromEntries(
        users.map((user) => [user.uid, { tier: user.tier, isAdmin: user.isAdmin }]),
      ),
    );
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Access request review failed.';
  }

  private defaultGrant(): UserAccessGrant {
    return { tier: UserTier.DecisionMaker, isAdmin: false };
  }

  private updateRequestGrant(uid: string, patch: Partial<UserAccessGrant>): void {
    this.requestGrants.update((grants) => ({
      ...grants,
      [uid]: {
        ...(grants[uid] ?? this.defaultGrant()),
        ...patch,
      },
    }));
  }

  private updateUserGrant(uid: string, patch: Partial<UserAccessGrant>): void {
    this.userGrants.update((grants) => ({
      ...grants,
      [uid]: {
        ...(grants[uid] ?? this.defaultGrant()),
        ...patch,
      },
    }));
  }

  private withoutGrant(
    grants: Record<string, UserAccessGrant>,
    uid: string,
  ): Record<string, UserAccessGrant> {
    const remaining = { ...grants };
    delete remaining[uid];
    return remaining;
  }

  private readTierFromSelect(event: Event): UserAccessGrant['tier'] {
    const value = Number((event.target as HTMLSelectElement).value);
    return value === UserTier.Manager ? UserTier.Manager : UserTier.DecisionMaker;
  }

  private readChecked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  private hasPendingWrite(): boolean {
    return !!this.approvingUid() || !!this.updatingUserUid();
  }

  private roleLabelForTier(tier: UserAccessGrant['tier']): string {
    return tier >= UserTier.Manager ? 'science_publisher' : 'authorized_viewer';
  }
}
