import { hasSirapGrantOverlap, parseAdminManagedUserRecord } from './admin-access-requests.service';

describe('AdminAccessRequestsService user grants', () => {
  it('parses a direct grant without relying on SIRAP request history', () => {
    const user = parseAdminManagedUserRecord('direct-grant-user', {
      status: 'active',
      email: 'direct@example.com',
      displayName: 'Direct Grant',
      role: 'authorized_viewer',
      tier: 2,
      isAdmin: false,
      allowedSirapIds: ['amazonia'],
    });

    expect(user.allowedSirapIds).toEqual(['amazonia']);
  });

  it('only accepts users whose authoritative grants overlap the regional scope', () => {
    expect(hasSirapGrantOverlap(['caribe', 'amazonia'], ['caribe'])).toBe(true);
    expect(hasSirapGrantOverlap(['amazonia'], ['caribe', 'pacifico'])).toBe(false);
  });

  it('preserves an isSuperAdmin-only account as an admin when parsing edits', () => {
    const user = parseAdminManagedUserRecord('super-admin-user', {
      status: 'active',
      email: 'super@example.com',
      role: 'authorized_viewer',
      tier: 2,
      isAdmin: false,
      isSuperAdmin: true,
      allowedSirapIds: [],
      administeredSirapIds: [],
    });

    expect(user.isAdmin).toBe(true);
  });
});
