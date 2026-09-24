import { UserTier } from './user-tier.model';
import {
  grantAfterAdministeredToggle,
  grantAfterAllowedToggle,
  normalizeGrantScopes,
  readAppRole,
  roleAfterAccessChange,
  roleToUserTier,
  scopesMatchRole,
} from './app-role.model';

describe('app role', () => {
  it('reads explicit roles and legacy admin markers', () => {
    expect(readAppRole('sirap-user', ['orinoquia'], [])).toBe('sirap-user');
    expect(readAppRole('admin', [], [])).toBe('super-admin');
    expect(readAppRole('authorized_viewer', [], [], true)).toBe('super-admin');
    expect(readAppRole('authorized_viewer', ['orinoquia'], ['orinoquia'])).toBe('sirap-admin');
    expect(readAppRole('science_publisher', ['eje-cafetero'], [])).toBe('sirap-user');
    expect(readAppRole('authorized_viewer')).toBe('user');
  });

  it('keeps scopes aligned with the stored role', () => {
    expect(roleAfterAccessChange('user', ['orinoquia'], [])).toBe('sirap-user');
    expect(roleAfterAccessChange('sirap-user', [], [])).toBe('user');
    expect(roleAfterAccessChange('super-admin', [], [])).toBe('super-admin');
    expect(scopesMatchRole('sirap-admin', ['orinoquia'], ['orinoquia'])).toBe(true);
    expect(scopesMatchRole('sirap-admin', ['eje-cafetero'], ['orinoquia'])).toBe(false);
    expect(normalizeGrantScopes('user', ['orinoquia'], ['orinoquia'])).toEqual({
      role: 'user',
      allowedSirapIds: [],
      administeredSirapIds: [],
    });
    expect(normalizeGrantScopes('sirap-admin', [], ['orinoquia']).allowedSirapIds).toEqual([
      'orinoquia',
    ]);
  });

  it('maps only super-admin to the manager tier', () => {
    expect(roleToUserTier('super-admin')).toBe(UserTier.Manager);
    expect(roleToUserTier('sirap-admin')).toBe(UserTier.DecisionMaker);
    expect(roleToUserTier('user')).toBe(UserTier.DecisionMaker);
  });

  it('normalizes administered edits without demoting a super admin', () => {
    expect(grantAfterAdministeredToggle('user', ['orinoquia'], [], 'orinoquia')).toEqual({
      role: 'sirap-admin',
      allowedSirapIds: ['orinoquia'],
      administeredSirapIds: ['orinoquia'],
    });
    expect(
      grantAfterAdministeredToggle('sirap-admin', ['orinoquia', 'eje-cafetero'], ['orinoquia'], 'orinoquia'),
    ).toEqual({
      role: 'sirap-user',
      allowedSirapIds: ['orinoquia', 'eje-cafetero'],
      administeredSirapIds: [],
    });
    expect(grantAfterAdministeredToggle('sirap-user', [], [], 'eje-cafetero').role).toBe('sirap-admin');
    expect(grantAfterAdministeredToggle('user', [], ['orinoquia'], 'orinoquia')).toMatchObject({
      role: 'user',
      allowedSirapIds: [],
      administeredSirapIds: [],
    });
    expect(grantAfterAdministeredToggle('super-admin', [], [], 'orinoquia').role).toBe('super-admin');
  });

  it('recomputes role when data access is toggled', () => {
    expect(grantAfterAllowedToggle('user', [], [], 'orinoquia')).toEqual({
      role: 'sirap-user',
      allowedSirapIds: ['orinoquia'],
      administeredSirapIds: [],
    });
    expect(grantAfterAllowedToggle('sirap-user', ['orinoquia'], [], 'orinoquia')).toEqual({
      role: 'user',
      allowedSirapIds: [],
      administeredSirapIds: [],
    });
    expect(
      grantAfterAllowedToggle('sirap-admin', ['orinoquia', 'eje-cafetero'], ['orinoquia'], 'eje-cafetero'),
    ).toMatchObject({
      role: 'sirap-admin',
      administeredSirapIds: ['orinoquia'],
    });
    expect(grantAfterAllowedToggle('super-admin', ['orinoquia'], [], 'orinoquia').role).toBe(
      'super-admin',
    );
  });
});
