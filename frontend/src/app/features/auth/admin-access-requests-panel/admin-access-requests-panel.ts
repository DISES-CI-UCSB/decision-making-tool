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
import { SIRAP_REGIONS, sirapRegionLabel, type SirapRegionId, UserTier } from '@core/models';
import {
  AdminAccessRequestsService,
  type AccessRequestRecord,
  type AdminManagedUserRecord,
  type UserAccessGrant,
} from '../services/admin-access-requests.service';
import {
  SirapAccessService,
  type CurrentSirapAdministrator,
  type SirapAccessRequestRecord,
} from '../services/sirap-access.service';

interface SirapRequestGroup {
  uid: string;
  displayName: string;
  email: string;
  requests: SirapAccessRequestRecord[];
}

interface CurrentSirapAccessGroup {
  user: AdminManagedUserRecord;
  allowedSirapIds: SirapRegionId[];
  administeredSirapIds: SirapRegionId[];
}

@Component({
  selector: 'app-admin-access-requests-panel',
  standalone: true,
  imports: [],
  templateUrl: './admin-access-requests-panel.html',
  styleUrl: './admin-access-requests-panel.scss',
})
export class AdminAccessRequestsPanelComponent implements OnInit {
  private readonly adminRequests = inject(AdminAccessRequestsService);
  private readonly sirapAccess = inject(SirapAccessService);
  protected readonly UserTier = UserTier;
  protected readonly sirapRegions = SIRAP_REGIONS;

  @Output() readonly closeRequested = new EventEmitter<void>();

  @ViewChild('panelCard', { static: false })
  private readonly panelCardRef?: ElementRef<HTMLElement>;

  protected readonly pendingRequests = signal<AccessRequestRecord[]>([]);
  protected readonly activeUsers = signal<AdminManagedUserRecord[]>([]);
  protected readonly sirapRequests = signal<SirapAccessRequestRecord[]>([]);
  protected readonly administrator = signal<CurrentSirapAdministrator | null>(null);
  protected readonly requestGrants = signal<Record<string, UserAccessGrant>>({});
  protected readonly userGrants = signal<Record<string, UserAccessGrant>>({});
  protected readonly userSearchQuery = signal('');
  protected readonly isLoading = signal(true);
  protected readonly loadingError = signal<string | null>(null);
  protected readonly approvingUid = signal<string | null>(null);
  protected readonly updatingUserUid = signal<string | null>(null);
  protected readonly decidingSirapRequestId = signal<string | null>(null);
  protected readonly sirapRequestGroups = computed<SirapRequestGroup[]>(() =>
    this.groupSirapRequests(
      'pending',
      new Set(this.pendingRequests().map((request) => request.uid)),
    ),
  );
  protected readonly currentSirapAccessGroups = computed<CurrentSirapAccessGroup[]>(() =>
    this.activeUsers()
      .map((user) => ({
        user,
        allowedSirapIds: this.visibleSirapIds(user.allowedSirapIds),
        administeredSirapIds: this.visibleSirapIds(user.administeredSirapIds),
      }))
      .filter((group) => group.allowedSirapIds.length > 0),
  );
  protected readonly isSuperAdmin = computed(() => this.administrator()?.isSuperAdmin === true);
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

  protected toggleRequestAdministeredSirap(
    request: AccessRequestRecord,
    sirapId: SirapRegionId,
  ): void {
    const grant = this.requestGrantFor(request);
    this.updateRequestGrant(request.uid, {
      administeredSirapIds: this.toggleSirapId(grant.administeredSirapIds, sirapId),
    });
  }

  protected toggleRequestAllowedSirap(request: AccessRequestRecord, sirapId: SirapRegionId): void {
    const grant = this.requestGrantFor(request);
    this.updateRequestGrant(request.uid, {
      allowedSirapIds: this.toggleSirapId(grant.allowedSirapIds, sirapId),
    });
  }

  protected async approveRequest(request: AccessRequestRecord): Promise<void> {
    if (this.approvingUid()) {
      return;
    }

    this.loadingError.set(null);
    this.approvingUid.set(request.uid);
    try {
      const accountSirapRequests = this.pendingSirapRequestsFor(request.uid);
      await this.adminRequests.approveRequest(
        request,
        this.requestGrantFor(request),
        accountSirapRequests,
      );
      this.pendingRequests.update((requests) =>
        requests.filter((candidate) => candidate.uid !== request.uid),
      );
      const grantedIds = this.requestGrantFor(request).allowedSirapIds;
      this.sirapRequests.update((requests) =>
        requests.map((candidate) =>
          candidate.uid === request.uid &&
          candidate.status === 'pending' &&
          grantedIds.includes(candidate.sirapId)
            ? { ...candidate, status: 'approved' }
            : candidate,
        ),
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

  protected toggleUserAdministeredSirap(
    user: AdminManagedUserRecord,
    sirapId: SirapRegionId,
  ): void {
    const grant = this.userGrantFor(user);
    this.updateUserGrant(user.uid, {
      administeredSirapIds: this.toggleSirapId(grant.administeredSirapIds, sirapId),
    });
  }

  protected toggleUserAllowedSirap(user: AdminManagedUserRecord, sirapId: SirapRegionId): void {
    const grant = this.userGrantFor(user);
    this.updateUserGrant(user.uid, {
      allowedSirapIds: this.toggleSirapId(grant.allowedSirapIds, sirapId),
    });
  }

  protected async decideSirapRequest(
    request: SirapAccessRequestRecord,
    decision: 'approved' | 'denied',
  ): Promise<void> {
    if (this.decidingSirapRequestId()) {
      return;
    }
    this.loadingError.set(null);
    this.decidingSirapRequestId.set(request.id);
    try {
      await this.sirapAccess.decideRequest(request, decision);
      this.sirapRequests.update((requests) =>
        decision === 'approved'
          ? requests.map((candidate) =>
              candidate.id === request.id ? { ...candidate, status: 'approved' } : candidate,
            )
          : requests.filter((candidate) => candidate.id !== request.id),
      );
      if (this.isSuperAdmin()) {
        await this.loadUsers();
      }
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.decidingSirapRequestId.set(null);
    }
  }

  protected async revokeCurrentAccess(
    user: AdminManagedUserRecord,
    sirapId: SirapRegionId,
  ): Promise<void> {
    const writeId = `${user.uid}:${sirapId}`;
    if (this.decidingSirapRequestId()) {
      return;
    }
    this.loadingError.set(null);
    this.decidingSirapRequestId.set(writeId);
    try {
      await this.sirapAccess.revokeUserAccess(user.uid, sirapId);
      this.activeUsers.update((users) =>
        users.map((candidate) =>
          candidate.uid === user.uid
            ? {
                ...candidate,
                allowedSirapIds: candidate.allowedSirapIds.filter((id) => id !== sirapId),
              }
            : candidate,
        ),
      );
      this.userGrants.update((grants) => {
        const grant = grants[user.uid];
        return grant
          ? {
              ...grants,
              [user.uid]: {
                ...grant,
                allowedSirapIds: grant.allowedSirapIds.filter((id) => id !== sirapId),
              },
            }
          : grants;
      });
      this.sirapRequests.update((requests) =>
        requests.map((request) =>
          request.uid === user.uid && request.sirapId === sirapId && request.status === 'approved'
            ? { ...request, status: 'denied' }
            : request,
        ),
      );
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.decidingSirapRequestId.set(null);
    }
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
    return (
      this.userGrants()[user.uid] ?? {
        tier: user.tier,
        isAdmin: user.isAdmin,
        administeredSirapIds: user.administeredSirapIds,
        allowedSirapIds: user.allowedSirapIds,
      }
    );
  }

  protected hasUserChanges(user: AdminManagedUserRecord): boolean {
    const grant = this.userGrantFor(user);
    return (
      grant.tier !== user.tier ||
      grant.isAdmin !== user.isAdmin ||
      !this.sameSirapIds(grant.administeredSirapIds, user.administeredSirapIds) ||
      !this.sameSirapIds(grant.allowedSirapIds, user.allowedSirapIds)
    );
  }

  protected tierLabel(tier: UserTier): string {
    return tier >= UserTier.Manager ? 'Tier 3 - Publisher / scientist' : 'Tier 2 - Approved user';
  }

  protected adminLabel(isAdmin: boolean): string {
    return isAdmin ? 'Super admin' : 'Not a super admin';
  }

  protected pendingSirapRequestsFor(uid: string): SirapAccessRequestRecord[] {
    return this.sirapRequests().filter(
      (request) => request.uid === uid && request.status === 'pending',
    );
  }

  protected grantSummary(request: AccessRequestRecord): string {
    const grant = this.requestGrantFor(request);
    const dataAccess =
      grant.allowedSirapIds.length === 0
        ? 'No SIRAP data access'
        : `${grant.allowedSirapIds.length} SIRAP data grant${grant.allowedSirapIds.length === 1 ? '' : 's'}`;
    const administratorAccess =
      grant.administeredSirapIds.length === 0
        ? 'no regional administrator permissions'
        : `${grant.administeredSirapIds.length} regional administrator assignment${grant.administeredSirapIds.length === 1 ? '' : 's'}`;
    return `${this.tierLabel(grant.tier)} · ${dataAccess} · ${administratorAccess}`;
  }

  protected sirapLabel(sirapId: SirapRegionId): string {
    return sirapRegionLabel(sirapId);
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

  protected formatSirapRequestedAt(request: SirapAccessRequestRecord): string {
    if (!request.requestedAt) {
      return 'Not recorded';
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(request.requestedAt);
  }

  protected formatOptional(value: string | null): string {
    return value || 'Not provided';
  }

  private async loadRequests(): Promise<void> {
    this.isLoading.set(true);
    this.loadingError.set(null);
    try {
      const [administrator, pendingRequests, sirapRequests] = await Promise.all([
        this.sirapAccess.getCurrentAdministrator(),
        this.adminRequests.listPendingRequests(),
        this.sirapAccess.listRequestsForAdministrator(),
      ]);
      this.administrator.set(administrator);
      this.pendingRequests.set(pendingRequests);
      this.sirapRequests.set(sirapRequests);
      this.requestGrants.set(
        Object.fromEntries(
          pendingRequests.map((request) => [
            request.uid,
            {
              ...this.defaultGrant(),
              allowedSirapIds: [
                ...new Set(
                  sirapRequests
                    .filter(
                      (sirapRequest) =>
                        sirapRequest.uid === request.uid && sirapRequest.status === 'pending',
                    )
                    .map((sirapRequest) => sirapRequest.sirapId),
                ),
              ],
            },
          ]),
        ),
      );
      await this.loadUsers();
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
      this.pendingRequests.set([]);
      this.sirapRequests.set([]);
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
        users.map((user) => [
          user.uid,
          {
            tier: user.tier,
            isAdmin: user.isAdmin,
            administeredSirapIds: user.administeredSirapIds,
            allowedSirapIds: user.allowedSirapIds,
          },
        ]),
      ),
    );
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Access request review failed.';
  }

  private defaultGrant(): UserAccessGrant {
    return {
      tier: UserTier.DecisionMaker,
      isAdmin: false,
      administeredSirapIds: [],
      allowedSirapIds: [],
    };
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
    return !!this.approvingUid() || !!this.updatingUserUid() || !!this.decidingSirapRequestId();
  }

  private roleLabelForTier(tier: UserAccessGrant['tier']): string {
    return tier >= UserTier.Manager ? 'science_publisher' : 'authorized_viewer';
  }

  private toggleSirapId(ids: readonly SirapRegionId[], sirapId: SirapRegionId): SirapRegionId[] {
    return ids.includes(sirapId) ? ids.filter((id) => id !== sirapId) : [...ids, sirapId];
  }

  private sameSirapIds(a: readonly SirapRegionId[], b: readonly SirapRegionId[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
  }

  private visibleSirapIds(ids: readonly SirapRegionId[]): SirapRegionId[] {
    const administrator = this.administrator();
    if (!administrator || administrator.isSuperAdmin) {
      return [...ids];
    }
    return ids.filter((id) => administrator.administeredSirapIds.includes(id));
  }

  private groupSirapRequests(
    status: SirapAccessRequestRecord['status'],
    excludedUids = new Set<string>(),
  ): SirapRequestGroup[] {
    const groups = new Map<string, SirapRequestGroup>();
    for (const request of this.sirapRequests().filter(
      (candidate) => candidate.status === status && !excludedUids.has(candidate.uid),
    )) {
      const group = groups.get(request.uid) ?? {
        uid: request.uid,
        displayName: request.displayName,
        email: request.email,
        requests: [],
      };
      group.requests.push(request);
      groups.set(request.uid, group);
    }
    return [...groups.values()].sort((a, b) =>
      (a.displayName || a.email).localeCompare(b.displayName || b.email),
    );
  }
}
