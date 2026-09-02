import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { UserTier } from '@core/models';
import { AdminAccessRequestsService } from '../services/admin-access-requests.service';
import { SirapAccessService } from '../services/sirap-access.service';
import { AdminAccessRequestsPanelComponent } from './admin-access-requests-panel';
import { setForceAppendFakeDemoDataForTests } from './admin-access-requests-panel.fake-demo-data';

describe('AdminAccessRequestsPanelComponent', () => {
  let fixture: ComponentFixture<AdminAccessRequestsPanelComponent>;
  const activeUser = {
    uid: 'user-1',
    email: 'user@example.com',
    displayName: 'User One',
    status: 'active' as const,
    role: 'authorized_viewer',
    tier: UserTier.DecisionMaker,
    isAdmin: false,
    administeredSirapIds: [],
    allowedSirapIds: [],
    updatedAt: null,
  };
  const adminRequests = {
    listPendingRequests: vi.fn().mockResolvedValue([]),
    listActiveUsers: vi.fn().mockResolvedValue([activeUser]),
    approveRequest: vi.fn(),
    updateUserAccess: vi.fn(),
    updateRegionalUserAccess: vi.fn(),
  };
  const sirapAccess = {
    getCurrentAdministrator: vi.fn().mockResolvedValue({
      uid: 'admin-1',
      isSuperAdmin: true,
      administeredSirapIds: [],
    }),
    listRequestsForAdministrator: vi.fn().mockResolvedValue([]),
    decideRequest: vi.fn(),
    revokeUserAccess: vi.fn(),
  };

  beforeEach(async () => {
    setForceAppendFakeDemoDataForTests(false);
    await TestBed.configureTestingModule({
      imports: [AdminAccessRequestsPanelComponent],
      providers: [
        { provide: AdminAccessRequestsService, useValue: adminRequests },
        { provide: SirapAccessService, useValue: sirapAccess },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminAccessRequestsPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  });

  afterEach(() => setForceAppendFakeDemoDataForTests(null));

  it('shows the three access-management tabs and starts on requests', () => {
    expect(fixture.nativeElement.querySelector('#admin-access-panel-requests-tab')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-access-tab')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-users-tab')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-sirap-requests-section')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-pending-section')).toBeNull();
  });

  it('switches to the active-user directory', () => {
    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#admin-access-panel-users-section')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('User One');
  });

  it('shows only the supported SIRAP access options', () => {
    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#admin-access-panel-user-toggle-user-1').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('SIRAP Orinoquía');
    expect(fixture.nativeElement.textContent).toContain('SIRAP Eje Cafetero');
    expect(fixture.nativeElement.textContent).not.toContain('SIRAP Amazonía');
  });

  it('shows a regional admin active grants from approved SIRAP request history', async () => {
    sirapAccess.getCurrentAdministrator.mockResolvedValueOnce({
      uid: 'regional-admin-1',
      isSuperAdmin: false,
      administeredSirapIds: ['orinoquia'],
    });
    sirapAccess.listRequestsForAdministrator.mockResolvedValueOnce([
      {
        id: 'user-1_orinoquia',
        uid: 'user-1',
        email: 'user@example.com',
        displayName: 'User One',
        sirapId: 'orinoquia',
        status: 'approved',
        reason: null,
        requestedAt: null,
        decidedAt: null,
        decidedBy: 'regional-admin-1',
      },
    ]);

    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('#admin-access-panel-access-tab').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('User One');
    expect(
      fixture.nativeElement.querySelector(
        '#admin-access-panel-current-sirap-revoke-user-1-orinoquia',
      ),
    ).not.toBeNull();
  });
});
