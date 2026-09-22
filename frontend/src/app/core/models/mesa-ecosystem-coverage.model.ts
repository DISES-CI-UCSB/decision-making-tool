import type { GeographyLevel } from './metric-value.model';

export const MESA_ECOSYSTEM_COVERAGE_COMPACT_FORMAT = 'mesa-ecosystem-coverage-compact-v1';

export interface MesaEcosystemCoverageCompactDocument {
  format: typeof MESA_ECOSYSTEM_COVERAGE_COMPACT_FORMAT;
  solutionId: string;
  geographyLevel: GeographyLevel;
  features: MesaEcosystemFeatureTuple[];
  geographies: MesaEcosystemGeographyTuple[];
  rowLayout: readonly string[];
  rows: MesaEcosystemSparseRow[];
}

export type MesaEcosystemFeatureTuple = [
  name: string,
  featureId: number,
  relativeTarget: number | null,
  evaluated: string | null,
];
export type MesaEcosystemGeographyTuple = [id: string, name: string];
export type MesaEcosystemSparseRow = [
  geographyIndex: number,
  featureIndex: number,
  totalAmount: number,
  absoluteHeld: number,
  relativeHeld: number | null,
];

export interface MesaEcosystemCoverageRow {
  feature: string;
  featureId: number;
  evaluated: string | null;
  relativeTarget: number | null;
  relativeHeld: number | null;
  met: boolean | null;
  totalAmount: number;
  absoluteHeld: number;
}

const GEOGRAPHY_LEVELS = new Set<GeographyLevel>([
  'national',
  'departments',
  'municipalities',
  'siraps',
  'runaps',
  'omecs',
]);

export function isMesaEcosystemCoverageCompactDocument(
  value: unknown,
): value is MesaEcosystemCoverageCompactDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const document = value as Record<string, unknown>;
  return (
    document['format'] === MESA_ECOSYSTEM_COVERAGE_COMPACT_FORMAT &&
    typeof document['solutionId'] === 'string' &&
    GEOGRAPHY_LEVELS.has(document['geographyLevel'] as GeographyLevel) &&
    Array.isArray(document['features']) &&
    Array.isArray(document['geographies']) &&
    Array.isArray(document['rows'])
  );
}

export function resolveMesaEcosystemGeographyIndex(
  document: MesaEcosystemCoverageCompactDocument,
  scopeId: string,
  scopeName?: string,
): number | null {
  const direct = document.geographies.findIndex(([id]) => id === scopeId);
  if (direct >= 0) {
    return direct;
  }
  const candidates = [scopeId, scopeName ?? '']
    .map(normalizeMesaScopeLabel)
    .filter((value) => value.length > 0);
  const matches = document.geographies
    .map(([id, name], index) => {
      const normalizedId = normalizeMesaScopeLabel(id);
      const normalizedName = normalizeMesaScopeLabel(name);
      return candidates.some(
        (candidate) =>
          normalizedId === candidate ||
          normalizedName === candidate ||
          normalizedId.includes(candidate) ||
          normalizedName.includes(candidate),
      )
        ? index
        : -1;
    })
    .filter((index) => index >= 0);
  return matches.length === 1 ? matches[0] : null;
}

export function hydrateMesaEcosystemCoverageRows(
  document: MesaEcosystemCoverageCompactDocument,
  scopeId: string,
  scopeName?: string,
): MesaEcosystemCoverageRow[] {
  const geographyIndex = resolveMesaEcosystemGeographyIndex(document, scopeId, scopeName);
  if (geographyIndex === null) {
    return [];
  }
  return document.rows
    .filter((row) => row[0] === geographyIndex)
    .map(([, featureIndex, totalAmount, absoluteHeld, relativeHeld]) => {
      const feature = document.features[featureIndex];
      const relativeTarget = feature?.[2] ?? null;
      return {
        feature: feature?.[0] ?? '',
        featureId: feature?.[1] ?? -1,
        evaluated: feature?.[3] ?? null,
        relativeTarget,
        relativeHeld,
        met:
          relativeTarget === null || relativeHeld === null
            ? null
            : relativeHeld + Number.EPSILON >= relativeTarget,
        totalAmount,
        absoluteHeld,
      };
    })
    .filter((row) => row.feature.length > 0);
}

export function normalizeMesaScopeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}
