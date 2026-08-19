import { TestBed } from '@angular/core/testing';
import { UserTier } from '@core/models';
import {
  AdminAccessRequestsService,
  type AccessRequestRecord,
  type AdminManagedUserRecord,
} from '../services/admin-access-requests.service';
import {
  SirapAccessService,
  type SirapAccessRequestRecord,
} from '../services/sirap-access.service';
import { AdminAccessRequestsPanelComponent } from './admin-access-requests-panel';

const pendingAccount: AccessRequestRecord = {
  uid: 'pending-user',
  email: 'pending@example.com',
  displayName: 'Pending User',
  organization: 'Test organization',
  reason: 'Needs regional data',
  provider: 'google',
  status: 'pending',
  requestedAt: new Date('2026-08-18T12:00:00Z'),
  submittedAt: null,
};

const activeUser: AdminManagedUserRecord = {
  uid: 'legacy-user',
  email: 'legacy@example.com',
  displayName: 'Legacy Direct Grant',
  status: 'active',
  role: 'authorized_viewer',
  tier: UserTier.DecisionMaker,
  isAdmin: false,
  administeredSirapIds: [],
  allowedSirapIds: ['amazonia'],
  updatedAt: null,
};

const sirapRequests: SirapAccessRequestRecord[] = [
  {
    id: 'pending-user_caribe',
    uid: 'pending-user',
    email: 'pending@example.com',
    displayName: 'Pending User',
    sirapId: 'caribe',
    status: 'pending',
    reason: null,
    requestedAt: new Date('2026-08-18T12:00:00Z'),
    decidedAt: null,
    decidedBy: null,
  },
  {
    id: 'active-request_pacifico',
    uid: 'active-request',
    email: 'active@example.com',
    displayName: 'Active Requester',
    sirapId: 'pacifico',
    status: 'pending',
    reason: null,
    requestedAt: new Date('2026-08-18T13:00:00Z'),
    decidedAt: null,
    decidedBy: null,
  },
];

describe('AdminAccessRequestsPanelComponent', () => {
  let adminRequests: {
    listPendingRequests: ReturnType<typeof vi.fn>;
    listActiveUsers: ReturnType<typeof vi.fn>;
    approveRequest: ReturnType<typeof vi.fn>;
    updateUserAccess: ReturnType<typeof vi.fn>;
  };
  let sirapAccess: {
    getCurrentAdministrator: ReturnType<typeof vi.fn>;
    listRequestsForAdministrator: ReturnType<typeof vi.fn>;
    decideRequest: ReturnType<typeof vi.fn>;
    revokeUserAccess: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    adminRequests = {
      listPendingRequests: vi.fn().mockResolvedValue([pendingAccount]),
      listActiveUsers: vi.fn().mockResolvedValue([activeUser]),
      approveRequest: vi.fn().mockResolvedValue(undefined),
      updateUserAccess: vi.fn().mockResolvedValue(undefined),
    };
    sirapAccess = {
      getCurrentAdministrator: vi.fn().mockResolvedValue({
        uid: 'admin-user',
        isSuperAdmin: true,
        administeredSirapIds: [],
      }),
      listRequestsForAdministrator: vi.fn().mockResolvedValue(sirapRequests),
      decideRequest: vi.fn().mockResolvedValue(undefined),
      revokeUserAccess: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [AdminAccessRequestsPanelComponent],
      providers: [
        { provide: AdminAccessRequestsService, useValue: adminRequests },
        { provide: SirapAccessService, useValue: sirapAccess },
      ],
    }).compileComponents();
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(AdminAccessRequestsPanelComponent);
    fixture.detectChanges();
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders sections in the account-review workflow order', async () => {
    const element = await render();
    const sectionIds = [
      'admin-access-panel-pending-section',
      'admin-access-panel-sirap-requests-section',
      'admin-access-panel-approved-sirap-section',
      'admin-access-panel-users-section',
    ];
    const positions = sectionIds.map((id) => {
      const section = element.querySelector(`#${id}`);
      expect(section).not.toBeNull();
      return [...element.querySelectorAll('section')].indexOf(section as HTMLElement);
    });

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('separates requested SIRAP evidence from editable grants', async () => {
    const element = await render();
    const evidence = element.querySelector(
      '#admin-access-panel-request-evidence-chip-pending-user_caribe',
    );
    const requestedGrant = element.querySelector(
      '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-caribe',
    ) as HTMLInputElement;
    const unrequestedGrant = element.querySelector(
      '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-amazonia',
    ) as HTMLInputElement;
    const footer = element.querySelector('#admin-access-panel-request-footer-pending-user');
    const approveButton = element.querySelector('#admin-access-panel-approve-button-pending-user');

    expect(evidence?.textContent).toContain('SIRAP Caribe');
    expect(requestedGrant.checked).toBe(true);
    expect(unrequestedGrant.checked).toBe(false);
    expect(footer?.contains(approveButton)).toBe(true);
  });

  it('keeps pending-account SIRAP requests out of the active-account queue', async () => {
    const element = await render();
    const queue = element.querySelector('#admin-access-panel-sirap-request-groups');

    expect(queue?.querySelector('#admin-access-panel-sirap-user-card-pending-user')).toBeNull();
    expect(
      queue?.querySelector('#admin-access-panel-sirap-user-card-active-request'),
    ).not.toBeNull();
  });

  it('renders current access from active user grants without an approved request', async () => {
    const element = await render();

    expect(
      element.querySelector('#admin-access-panel-current-sirap-user-legacy-user'),
    ).not.toBeNull();
    expect(
      element.querySelector('#admin-access-panel-current-sirap-region-legacy-user-amazonia')
        ?.textContent,
    ).toContain('SIRAP Amazonía');
  });

  it('revokes a direct grant through the authoritative user-access path', async () => {
    const fixture = TestBed.createComponent(AdminAccessRequestsPanelComponent);
    fixture.detectChanges();
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const revokeButton = fixture.nativeElement.querySelector(
      '#admin-access-panel-current-sirap-revoke-legacy-user-amazonia',
    ) as HTMLButtonElement;

    revokeButton.click();
    await fixture.whenStable();

    expect(sirapAccess.revokeUserAccess).toHaveBeenCalledWith('legacy-user', 'amazonia');
  });

  it('limits regional admins to overlapping data grants and assignments', async () => {
    sirapAccess.getCurrentAdministrator.mockResolvedValue({
      uid: 'regional-admin',
      isSuperAdmin: false,
      administeredSirapIds: ['caribe'],
    });
    adminRequests.listPendingRequests.mockResolvedValue([]);
    adminRequests.listActiveUsers.mockResolvedValue([
      {
        ...activeUser,
        administeredSirapIds: ['caribe', 'amazonia'],
        allowedSirapIds: ['caribe', 'amazonia'],
      },
    ]);
    const element = await render();

    expect(
      element.querySelector('#admin-access-panel-current-sirap-region-legacy-user-caribe'),
    ).not.toBeNull();
    expect(
      element.querySelector('#admin-access-panel-current-sirap-region-legacy-user-amazonia'),
    ).toBeNull();
    expect(
      element.querySelector('#admin-access-panel-current-sirap-admin-region-legacy-user-caribe'),
    ).not.toBeNull();
    expect(
      element.querySelector('#admin-access-panel-current-sirap-admin-region-legacy-user-amazonia'),
    ).toBeNull();
  });
});
