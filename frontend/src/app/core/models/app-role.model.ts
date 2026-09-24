import { isSirapAccessRegionId, type SirapRegionId } from './sirap-access.model';
import { UserTier } from './user-tier.model';

export type AppRole = 'user' | 'sirap-user' | 'sirap-admin' | 'super-admin';

export const APP_ROLES: readonly AppRole[] = [
  'user',
  'sirap-user',
  'sirap-admin',
  'super-admin',
];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.includes(value as AppRole);
}

export function readAppRole(
  value: unknown,
  allowedSirapIds: readonly string[] = [],
  administeredSirapIds: readonly string[] = [],
  legacyIsAdmin = false,
): AppRole {
  if (isAppRole(value)) {
    return value;
  }
  if (value === 'admin' || legacyIsAdmin) {
    return 'super-admin';
  }
  if (administeredSirapIds.length > 0) {
    return 'sirap-admin';
  }
  return allowedSirapIds.length > 0 ? 'sirap-user' : 'user';
}

export function grantAfterAdministeredToggle(
  role: AppRole,
  allowedSirapIds: readonly string[],
  administeredSirapIds: readonly string[],
  sirapId: SirapRegionId,
): { role: AppRole; allowedSirapIds: SirapRegionId[]; administeredSirapIds: SirapRegionId[] } {
  const administered = administeredSirapIds.includes(sirapId)
    ? administeredSirapIds.filter((id) => id !== sirapId)
    : [...administeredSirapIds, sirapId];
  const allowed = administered.includes(sirapId)
    ? [...new Set([...allowedSirapIds, sirapId])]
    : allowedSirapIds;
  if (role === 'super-admin') {
    return normalizeGrantScopes('super-admin', allowed, administered);
  }
  return normalizeGrantScopes(roleForScopes(allowed, administered), allowed, administered);
}

export function grantAfterAllowedToggle(
  role: AppRole,
  allowedSirapIds: readonly string[],
  administeredSirapIds: readonly string[],
  sirapId: SirapRegionId,
): { role: AppRole; allowedSirapIds: SirapRegionId[]; administeredSirapIds: SirapRegionId[] } {
  const allowed = allowedSirapIds.includes(sirapId)
    ? allowedSirapIds.filter((id) => id !== sirapId)
    : [...allowedSirapIds, sirapId];
  if (role === 'super-admin') {
    return normalizeGrantScopes('super-admin', allowed, administeredSirapIds);
  }
  return normalizeGrantScopes(roleForScopes(allowed, administeredSirapIds), allowed, administeredSirapIds);
}

export function roleToUserTier(role: AppRole): UserTier.DecisionMaker | UserTier.Manager {
  return role === 'super-admin' ? UserTier.Manager : UserTier.DecisionMaker;
}

export function currentSirapIds(value: readonly string[]): SirapRegionId[] {
  return [...new Set(value.filter(isSirapAccessRegionId))];
}

/** Role implied by current-region scopes. Super-admin is preserved only when requested. */
export function roleForScopes(
  allowedSirapIds: readonly string[],
  administeredSirapIds: readonly string[],
  preservedSuperAdmin = false,
): AppRole {
  if (preservedSuperAdmin) {
    return 'super-admin';
  }
  const administered = currentSirapIds(administeredSirapIds);
  if (administered.length > 0) {
    return 'sirap-admin';
  }
  return currentSirapIds(allowedSirapIds).length > 0 ? 'sirap-user' : 'user';
}

export function roleAfterAccessChange(
  currentRole: AppRole,
  allowedSirapIds: readonly string[],
  administeredSirapIds: readonly string[],
): AppRole {
  return roleForScopes(
    allowedSirapIds,
    administeredSirapIds,
    currentRole === 'super-admin',
  );
}

export function scopesMatchRole(
  role: AppRole,
  allowedSirapIds: readonly string[],
  administeredSirapIds: readonly string[],
): boolean {
  const allowed = currentSirapIds(allowedSirapIds);
  const administered = currentSirapIds(administeredSirapIds);
  if (role === 'super-admin') {
    return true;
  }
  if (role === 'user') {
    return allowed.length === 0 && administered.length === 0;
  }
  if (role === 'sirap-user') {
    return allowed.length > 0 && administered.length === 0;
  }
  return administered.length > 0 && administered.every((id) => allowed.includes(id));
}

/** Keeps a chosen role and its SIRAP lists in the shape Firestore will accept. */
export function normalizeGrantScopes(
  role: AppRole,
  allowedSirapIds: readonly string[],
  administeredSirapIds: readonly string[],
): { role: AppRole; allowedSirapIds: SirapRegionId[]; administeredSirapIds: SirapRegionId[] } {
  if (role === 'super-admin') {
    return {
      role,
      allowedSirapIds: currentSirapIds(allowedSirapIds),
      administeredSirapIds: currentSirapIds(administeredSirapIds),
    };
  }
  if (role === 'sirap-admin') {
    const administered = currentSirapIds(administeredSirapIds);
    const allowed = [...new Set([...currentSirapIds(allowedSirapIds), ...administered])];
    return { role, allowedSirapIds: allowed, administeredSirapIds: administered };
  }
  if (role === 'sirap-user') {
    return {
      role,
      allowedSirapIds: currentSirapIds(allowedSirapIds),
      administeredSirapIds: [],
    };
  }
  return { role: 'user', allowedSirapIds: [], administeredSirapIds: [] };
}
