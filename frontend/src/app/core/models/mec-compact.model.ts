import type { GeographyLevel } from './metric-value.model';

export const MEC_COMPACT_V1_FORMAT = 'mec-compact-v1' as const;
export const MEC_COMPACT_V2_FORMAT = 'mec-compact-v2' as const;
export const MEC_V1_ROW_LAYOUT = [
  'scopeIndex',
  'classIndex',
  'availableKm2',
  'existingKm2',
  'additionalKm2',
] as const;
export const MEC_V2_ROW_LAYOUT = [
  'scopeIndex',
  'classIndex',
  'ecosystemAreaKm2',
  'preExistingCoverageKm2',
  'newPrioritizrCoverageKm2',
] as const;
export const MEC_SCOPE_STATS_FIELDS = [
  'scopeAreaKm2',
  'classifiedKm2',
  'unclassifiedKm2',
  'boundaryProvenanceRef',
] as const;

/** @deprecated Use the explicitly versioned constants for new code. */
export const MEC_COMPACT_FORMAT = MEC_COMPACT_V1_FORMAT;
/** @deprecated Use the explicitly versioned constants for new code. */
export const MEC_ROW_LAYOUT = MEC_V1_ROW_LAYOUT;

export type MecCompactFormat = typeof MEC_COMPACT_V1_FORMAT | typeof MEC_COMPACT_V2_FORMAT;
export type MecSourceMode = 'composite' | 'iavh';
export type MecViewId =
  | 'biomeFamily'
  | 'broadBiomeContext'
  | 'biomeRegion'
  | 'broadEcosystem'
  | 'detailedEcosystem';
export type MecViewCatalogEntry = [viewId: MecViewId, label: string];
export type MecClassCatalogEntry = [viewIndex: number, classId: string, label: string];
export type MecScopeCatalogEntry = [scopeId: string, scopeName: string];
export type MecCompactV1Row = [
  scopeIndex: number,
  classIndex: number,
  availableKm2: number,
  existingKm2: number,
  additionalKm2: number,
];
export type MecCompactV2Row = [
  scopeIndex: number,
  classIndex: number,
  ecosystemAreaKm2: number,
  preExistingCoverageKm2: number,
  newPrioritizrCoverageKm2: number,
];
export type MecCompactRow = MecCompactV1Row | MecCompactV2Row;

export interface MecSupportedView {
  view: MecViewId;
  mapping: string;
  rule: string;
}

export interface MecUnsupportedView {
  view: MecViewId;
  reason: string;
}

export interface MecViewSupport {
  supported: MecSupportedView[];
  unsupported: MecUnsupportedView[];
}

export interface MecV1Semantics {
  availableKm2: string;
  existingKm2: string;
  additionalKm2: string;
  percentages: string;
  invariants: string;
}

export interface MecV2Semantics {
  ecosystemAreaKm2: string;
  preExistingCoverageKm2: string;
  newPrioritizrCoverageKm2: string;
  derivedValues: string;
  scopeStats: string;
  nationalBenchmark: string;
  invariants: string;
}

export interface MecScopeStats {
  scopeAreaKm2: number;
  classifiedKm2: number;
  unclassifiedKm2: number;
  boundaryProvenanceRef: string;
}

export interface MecNationalCoverageBenchmark {
  targetPercent: 17 | 30;
  applicability?: 'national-only';
  [key: string]: unknown;
}

export interface MecNationalClassBenchmark {
  targetPercent: 17 | 30;
  targetAreaKm2: number;
  totalCoveredKm2: number;
  coveragePercent: number | null;
  status: 'met' | 'not-met' | 'not-applicable';
  shortfallKm2: number;
}

interface MecCompactDocumentBase {
  solutionId: string;
  geographyLevel: GeographyLevel;
  generatedAt: string;
  sourceMode: MecSourceMode;
  units: 'km2';
  viewCatalog: MecViewCatalogEntry[];
  classCatalog: MecClassCatalogEntry[];
  scopeCatalog: MecScopeCatalogEntry[];
  viewSupport: MecViewSupport;
}

export interface MecCompactV1Document extends MecCompactDocumentBase {
  format: typeof MEC_COMPACT_V1_FORMAT;
  rowLayout: [...typeof MEC_V1_ROW_LAYOUT];
  rows: MecCompactV1Row[];
  semantics: MecV1Semantics;
}

export interface MecCompactV2Document extends MecCompactDocumentBase {
  format: typeof MEC_COMPACT_V2_FORMAT;
  rowLayout: [...typeof MEC_V2_ROW_LAYOUT];
  scopeStatsFields: [...typeof MEC_SCOPE_STATS_FIELDS];
  scopeStats: Record<string, MecScopeStats>;
  rows: MecCompactV2Row[];
  semantics: MecV2Semantics;
  nationalCoverageBenchmark?: MecNationalCoverageBenchmark;
}

export type MecCompactDocument = MecCompactV1Document | MecCompactV2Document;

const GEOGRAPHY_LEVELS = new Set<GeographyLevel>([
  'national',
  'departments',
  'municipalities',
  'siraps',
  'runaps',
  'omecs',
]);
const SOURCE_MODES = new Set<MecSourceMode>(['composite', 'iavh']);
const VIEW_IDS = new Set<MecViewId>([
  'biomeFamily',
  'broadBiomeContext',
  'biomeRegion',
  'broadEcosystem',
  'detailedEcosystem',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCatalogTuple(value: unknown, length: number): value is unknown[] {
  return Array.isArray(value) && value.length === length;
}

function isViewId(value: unknown): value is MecViewId {
  return typeof value === 'string' && VIEW_IDS.has(value as MecViewId);
}

function hasValidViewSupport(value: unknown): value is MecViewSupport {
  if (
    !isRecord(value) ||
    !Array.isArray(value['supported']) ||
    !Array.isArray(value['unsupported'])
  ) {
    return false;
  }

  return (
    value['supported'].every(
      (entry) =>
        isRecord(entry) &&
        isViewId(entry['view']) &&
        isNonEmptyString(entry['mapping']) &&
        isNonEmptyString(entry['rule']),
    ) &&
    value['unsupported'].every(
      (entry) => isRecord(entry) && isViewId(entry['view']) && isNonEmptyString(entry['reason']),
    )
  );
}

function hasValidV1Semantics(value: unknown): value is MecV1Semantics {
  return (
    isRecord(value) &&
    isNonEmptyString(value['availableKm2']) &&
    isNonEmptyString(value['existingKm2']) &&
    isNonEmptyString(value['additionalKm2']) &&
    isNonEmptyString(value['percentages']) &&
    isNonEmptyString(value['invariants'])
  );
}

function hasValidV2Semantics(value: unknown): value is MecV2Semantics {
  return (
    isRecord(value) &&
    isNonEmptyString(value['ecosystemAreaKm2']) &&
    isNonEmptyString(value['preExistingCoverageKm2']) &&
    isNonEmptyString(value['newPrioritizrCoverageKm2']) &&
    isNonEmptyString(value['derivedValues']) &&
    isNonEmptyString(value['scopeStats']) &&
    isNonEmptyString(value['nationalBenchmark']) &&
    isNonEmptyString(value['invariants'])
  );
}

function hasExpectedLayout(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((field, index) => field === expected[index])
  );
}

function hasValidBase(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value['solutionId']) &&
    isNonEmptyString(value['generatedAt']) &&
    GEOGRAPHY_LEVELS.has(value['geographyLevel'] as GeographyLevel) &&
    SOURCE_MODES.has(value['sourceMode'] as MecSourceMode) &&
    value['units'] === 'km2' &&
    Array.isArray(value['viewCatalog']) &&
    Array.isArray(value['classCatalog']) &&
    Array.isArray(value['scopeCatalog']) &&
    Array.isArray(value['rows']) &&
    hasValidViewSupport(value['viewSupport'])
  );
}

function hasValidCatalogs(value: Record<string, unknown>): boolean {
  const viewCatalog = value['viewCatalog'] as unknown[];
  const classCatalog = value['classCatalog'] as unknown[];
  const scopeCatalog = value['scopeCatalog'] as unknown[];
  return (
    viewCatalog.every(
      (entry) => isCatalogTuple(entry, 2) && isViewId(entry[0]) && isNonEmptyString(entry[1]),
    ) &&
    classCatalog.every(
      (entry) =>
        isCatalogTuple(entry, 3) &&
        Number.isInteger(entry[0]) &&
        (entry[0] as number) >= 0 &&
        (entry[0] as number) < viewCatalog.length &&
        isNonEmptyString(entry[1]) &&
        isNonEmptyString(entry[2]),
    ) &&
    scopeCatalog.every(
      (entry) =>
        isCatalogTuple(entry, 2) && isNonEmptyString(entry[0]) && isNonEmptyString(entry[1]),
    )
  );
}

function hasValidRows(value: Record<string, unknown>): boolean {
  const scopeCount = (value['scopeCatalog'] as unknown[]).length;
  const classCount = (value['classCatalog'] as unknown[]).length;
  return (value['rows'] as unknown[]).every((row) => {
    if (
      !isCatalogTuple(row, 5) ||
      !Number.isInteger(row[0]) ||
      (row[0] as number) < 0 ||
      (row[0] as number) >= scopeCount ||
      !Number.isInteger(row[1]) ||
      (row[1] as number) < 0 ||
      (row[1] as number) >= classCount ||
      !isNonNegativeFiniteNumber(row[2]) ||
      !isNonNegativeFiniteNumber(row[3]) ||
      !isNonNegativeFiniteNumber(row[4])
    ) {
      return false;
    }

    const [ecosystemAreaKm2, preExistingCoverageKm2, newPrioritizrCoverageKm2] = row.slice(2) as [
      number,
      number,
      number,
    ];
    return preExistingCoverageKm2 + newPrioritizrCoverageKm2 <= ecosystemAreaKm2 + 1e-6;
  });
}

function hasValidScopeStats(value: Record<string, unknown>): boolean {
  if (
    !hasExpectedLayout(value['scopeStatsFields'], MEC_SCOPE_STATS_FIELDS) ||
    !isRecord(value['scopeStats'])
  ) {
    return false;
  }

  const statsByScope = value['scopeStats'];
  const scopeCount = (value['scopeCatalog'] as unknown[]).length;
  const expectedKeys = Array.from({ length: scopeCount }, (_, index) => String(index));
  const actualKeys = Object.keys(statsByScope);
  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(statsByScope, key))
  ) {
    return false;
  }

  return expectedKeys.every((key) => {
    const stats = statsByScope[key];
    if (
      !isRecord(stats) ||
      !isNonNegativeFiniteNumber(stats['scopeAreaKm2']) ||
      !isNonNegativeFiniteNumber(stats['classifiedKm2']) ||
      !isNonNegativeFiniteNumber(stats['unclassifiedKm2']) ||
      !isNonEmptyString(stats['boundaryProvenanceRef'])
    ) {
      return false;
    }
    const tolerance = Math.max(1e-6, (stats['scopeAreaKm2'] as number) * 1e-9);
    return (
      Math.abs(
        (stats['classifiedKm2'] as number) +
          (stats['unclassifiedKm2'] as number) -
          (stats['scopeAreaKm2'] as number),
      ) <= tolerance
    );
  });
}

function hasValidNationalBenchmark(value: Record<string, unknown>): boolean {
  const benchmark = value['nationalCoverageBenchmark'];
  if (value['geographyLevel'] !== 'national') {
    return benchmark === undefined;
  }
  return (
    isRecord(benchmark) &&
    (benchmark['targetPercent'] === 17 || benchmark['targetPercent'] === 30) &&
    (benchmark['applicability'] === undefined || benchmark['applicability'] === 'national-only')
  );
}

/** Validates the complete consumer-facing v1 or v2 MEC compact contract. */
export function isMecCompactDocument(value: unknown): value is MecCompactDocument {
  if (
    !isRecord(value) ||
    !hasValidBase(value) ||
    !hasValidCatalogs(value) ||
    !hasValidRows(value)
  ) {
    return false;
  }

  if (value['format'] === MEC_COMPACT_V1_FORMAT) {
    return (
      hasExpectedLayout(value['rowLayout'], MEC_V1_ROW_LAYOUT) &&
      hasValidV1Semantics(value['semantics'])
    );
  }
  if (value['format'] === MEC_COMPACT_V2_FORMAT) {
    return (
      hasExpectedLayout(value['rowLayout'], MEC_V2_ROW_LAYOUT) &&
      hasValidV2Semantics(value['semantics']) &&
      hasValidScopeStats(value) &&
      hasValidNationalBenchmark(value)
    );
  }
  return false;
}

export function isMecCompactV2Document(value: MecCompactDocument): value is MecCompactV2Document {
  return value.format === MEC_COMPACT_V2_FORMAT;
}

export function deriveMecNationalClassBenchmark(
  document: MecCompactV2Document,
  row: MecCompactV2Row,
): MecNationalClassBenchmark | null {
  if (document.geographyLevel !== 'national' || !document.nationalCoverageBenchmark) {
    return null;
  }

  const [, , ecosystemAreaKm2, preExistingCoverageKm2, newPrioritizrCoverageKm2] = row;
  const targetPercent = document.nationalCoverageBenchmark.targetPercent;
  const totalCoveredKm2 = preExistingCoverageKm2 + newPrioritizrCoverageKm2;
  if (ecosystemAreaKm2 === 0) {
    return {
      targetPercent,
      targetAreaKm2: 0,
      totalCoveredKm2,
      coveragePercent: null,
      status: 'not-applicable',
      shortfallKm2: 0,
    };
  }

  const targetAreaKm2 = (ecosystemAreaKm2 * targetPercent) / 100;
  return {
    targetPercent,
    targetAreaKm2,
    totalCoveredKm2,
    coveragePercent: (totalCoveredKm2 / ecosystemAreaKm2) * 100,
    status: totalCoveredKm2 + 1e-6 >= targetAreaKm2 ? 'met' : 'not-met',
    shortfallKm2: Math.max(targetAreaKm2 - totalCoveredKm2, 0),
  };
}
