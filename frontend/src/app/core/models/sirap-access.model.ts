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

export type SirapAccessRequestStatus = 'pending' | 'approved' | 'denied';

export function isSirapRegionId(value: unknown): value is SirapRegionId {
  return typeof value === 'string' && SIRAP_REGION_IDS.includes(value as SirapRegionId);
}

export function readSirapRegionIds(value: unknown): SirapRegionId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter(isSirapRegionId))];
}

export function sirapRegionLabel(id: SirapRegionId): string {
  return SIRAP_REGIONS.find((region) => region.id === id)?.label ?? id;
}
