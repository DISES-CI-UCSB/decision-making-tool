export type SirapRegionId =
  | 'caribe'
  | 'pacifico'
  | 'andes-occidentales'
  | 'eje-cafetero'
  | 'andes-nororientales'
  | 'orinoquia'
  | 'amazonia';

export interface SirapRegion {
  id: SirapRegionId;
  label: string;
}

export const SIRAP_REGIONS: readonly SirapRegion[] = [
  { id: 'caribe', label: 'SIRAP Caribe' },
  { id: 'pacifico', label: 'SIRAP Pacífico' },
  { id: 'andes-occidentales', label: 'SIRAP Andes Occidentales' },
  { id: 'eje-cafetero', label: 'SIRAP Eje Cafetero' },
  { id: 'andes-nororientales', label: 'SIRAP Andes Nororientales' },
  { id: 'orinoquia', label: 'SIRAP Orinoquía' },
  { id: 'amazonia', label: 'SIRAP Amazonía' },
];

export const SIRAP_REGION_IDS: readonly SirapRegionId[] = SIRAP_REGIONS.map((region) => region.id);

export const SIRAP_ACCESS_REGIONS: readonly SirapRegion[] = [
  { id: 'orinoquia', label: 'SIRAP Orinoquía' },
  { id: 'eje-cafetero', label: 'SIRAP Eje Cafetero' },
];

export const SIRAP_ACCESS_REGION_IDS: readonly SirapRegionId[] = SIRAP_ACCESS_REGIONS.map(
  (region) => region.id,
);

/** SIRAP regions with published scenarios and metrics in the current product release. */
export const AVAILABLE_SIRAP_REGION_IDS: readonly SirapRegionId[] = SIRAP_ACCESS_REGION_IDS;

export type SirapAccessRequestStatus = 'pending' | 'approved' | 'denied';

export function isSirapRegionId(value: unknown): value is SirapRegionId {
  return typeof value === 'string' && SIRAP_REGION_IDS.includes(value as SirapRegionId);
}

export function isSirapAccessRegionId(value: unknown): value is SirapRegionId {
  return typeof value === 'string' && SIRAP_ACCESS_REGION_IDS.includes(value as SirapRegionId);
}

export function readSirapRegionIds(value: unknown): SirapRegionId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter(isSirapRegionId))];
}

export function readSirapAccessRegionIds(value: unknown): SirapRegionId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter(isSirapAccessRegionId))];
}

export function sirapRegionLabel(id: SirapRegionId): string {
  return SIRAP_REGIONS.find((region) => region.id === id)?.label ?? id;
}

/** National/public resources have no SIRAP id and stay visible to everyone. */
export function canAccessSirapScopedResource(
  sirapId: string | null | undefined,
  accessibleSirapIds: readonly string[],
): boolean {
  if (!sirapId) {
    return true;
  }
  return isSirapAccessRegionId(sirapId) && accessibleSirapIds.includes(sirapId);
}

/**
 * Sidebar/map visibility for a SIRAP-tagged layer.
 * National layers stay visible. SIRAP layers need both a matching grant and
 * the loaded scenario to be on that same SIRAP.
 */
export function canShowSirapScopedLayer(
  sirapId: string | null | undefined,
  accessibleSirapIds: readonly string[],
  activeSirapId: string | null | undefined,
): boolean {
  if (!sirapId) {
    return true;
  }
  return canAccessSirapScopedResource(sirapId, accessibleSirapIds) && sirapId === activeSirapId;
}

/** Active SIRAP from a loaded scenario: metadata.scope === 'sirap' plus metadata.sirapId. */
export function readActiveSirapIdFromSolutionMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (metadata?.['scope'] !== 'sirap') {
    return null;
  }
  const sirapId = metadata['sirapId'];
  return typeof sirapId === 'string' && sirapId.length > 0 ? sirapId : null;
}
