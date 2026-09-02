export type SirapRegionId =
  | 'caribe'
  | 'pacifico'
  | 'andes-occidentales'
  | 'andes-nororientales'
  | 'orinoquia'
  | 'amazonia'
  | 'eje-cafetero';

export interface SirapRegion {
  id: SirapRegionId;
  label: string;
}

export const SIRAP_REGIONS: readonly SirapRegion[] = [
  { id: 'caribe', label: 'SIRAP Caribe' },
  { id: 'pacifico', label: 'SIRAP Pacífico' },
  { id: 'andes-occidentales', label: 'SIRAP Andes Occidentales' },
  { id: 'andes-nororientales', label: 'SIRAP Andes Nororientales' },
  { id: 'orinoquia', label: 'SIRAP Orinoquía' },
  { id: 'amazonia', label: 'SIRAP Amazonía' },
  { id: 'eje-cafetero', label: 'SIRAP Eje Cafetero' },
];

export const SIRAP_REGION_IDS: readonly SirapRegionId[] = SIRAP_REGIONS.map((region) => region.id);

export const SIRAP_ACCESS_REGIONS: readonly SirapRegion[] = [
  { id: 'orinoquia', label: 'SIRAP Orinoquía' },
  { id: 'eje-cafetero', label: 'SIRAP Eje Cafetero' },
];

export const SIRAP_ACCESS_REGION_IDS: readonly SirapRegionId[] = SIRAP_ACCESS_REGIONS.map(
  (region) => region.id,
);

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
