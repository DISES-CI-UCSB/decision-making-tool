import type { DetailedSpeciesCoverageRecord } from './custom-aoi-area-profile.model';
import type { GeographyLevel } from './metric-value.model';

export const SPECIES_GOALS_FLAGS = {
  unavailable: 1,
  noRange: 2,
  targetConfigured: 4,
  met17: 8,
  met30: 16,
  configuredTargetMet: 32,
} as const;

export type SpeciesGoalsCatalogRow = [
  speciesId: string,
  scientificName: string,
  group: string | null,
  iucnStatus: string | null,
  nationalRangeKm2: number | null,
  availability: 'available' | 'unavailable',
];

export interface SpeciesGoalsCatalog {
  format: 'species-goals-catalog-v1';
  generatedAt: string;
  catalogSha256: string;
  provenance: {
    releaseId: string;
    speciesCsvSha256: string;
    exceptionSourceSha256: string | null;
    exceptionPolicySha256: string | null;
    exceptionBindingSha256: string | null;
    inventory: {
      catalogTotal: number;
      unavailable: number;
      zeroRange: number;
    };
  };
  rowLayout: [
    'speciesId',
    'scientificName',
    'group',
    'iucnStatus',
    'nationalRangeKm2',
    'availability',
  ];
  rows: SpeciesGoalsCatalogRow[];
}

export type SpeciesTargetOverlayRow = [speciesIndex: number, targetPercent: number];

export interface SpeciesTargetOverlayMap {
  canonicalSha256: string;
  sourceTargetCount: number;
  applicableTargetCount: number;
  unavailableTargetCount: number;
  rows: SpeciesTargetOverlayRow[];
  unavailableRows: SpeciesTargetOverlayRow[];
}

export interface SpeciesTargetOverlaysDocument {
  format: 'species-target-overlays-v1';
  releaseId: string;
  catalogSha256: string;
  rowLayout: ['speciesIndex', 'targetPercent'];
  provenance: Record<string, unknown>;
  inventory: Record<string, unknown>;
  targetMaps: Record<string, SpeciesTargetOverlayMap>;
  solutions: Record<string, string | null>;
  legacyEmbeddedTargetRepairEvidence: Record<string, unknown> | null;
  completion: {
    format: 'species-target-overlays-completion-v1';
    status: 'complete';
    payloadSha256: string;
  };
}

export type SpeciesGoalsCompactRow = [
  scopeIndex: number,
  speciesIndex: number,
  rangeAreaKm2: number | null,
  solutionCoveredAreaKm2: number | null,
  preExistingCoveredAreaKm2: number | null,
  newPrioritizrCoveredAreaKm2: number | null,
  configuredTargetPercent: number | null,
  flags: number,
];

export interface SpeciesGoalsCompactDocument {
  format: 'species-goals-compact-v1';
  generatedAt: string;
  solutionId: string;
  catalogSha256: string;
  geographyLevel: GeographyLevel;
  encoding: 'dense' | 'sparse-no-range-omitted';
  provenance: {
    releaseId: string;
    speciesCsvSha256: string;
    exceptionSourceSha256: string | null;
    exceptionPolicySha256: string | null;
    exceptionBindingSha256: string | null;
    exactOverlapAlgorithmVersion: string;
    exactOverlapPolicySha256: string;
    targetGridSha256: string;
    speciesAlignmentInventorySha256: string;
    solutionRasterSha256: string;
    targetPolicySha256: string;
    boundaryProvenanceSha256: string;
    catalogSha256: string;
  };
  scopeCatalog: [scopeId: string, scopeName: string][];
  rowLayout: [
    'scopeIndex',
    'speciesIndex',
    'rangeAreaKm2',
    'solutionCoveredAreaKm2',
    'preExistingCoveredAreaKm2',
    'newPrioritizrCoveredAreaKm2',
    'configuredTargetPercent',
    'flags',
  ];
  rows: SpeciesGoalsCompactRow[];
  completion: {
    format: 'species-goals-completion-v1';
    status: 'complete';
    rowCount: number;
    payloadSha256: string;
  };
}

export interface HydratedSpeciesGoalsRecord extends DetailedSpeciesCoverageRecord {
  availability: 'available' | 'unavailable';
  no_range_in_scope: boolean;
  configured_target_percent: number | null;
  met_17_percent: boolean;
  met_30_percent: boolean;
  configured_target_met: boolean | null;
}

const CATALOG_LAYOUT = [
  'speciesId',
  'scientificName',
  'group',
  'iucnStatus',
  'nationalRangeKm2',
  'availability',
];
const COMPACT_LAYOUT = [
  'scopeIndex',
  'speciesIndex',
  'rangeAreaKm2',
  'solutionCoveredAreaKm2',
  'preExistingCoveredAreaKm2',
  'newPrioritizrCoveredAreaKm2',
  'configuredTargetPercent',
  'flags',
];
const TARGET_OVERLAY_LAYOUT = ['speciesIndex', 'targetPercent'];
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isSpeciesGoalsCatalog(value: unknown): value is SpeciesGoalsCatalog {
  if (!isRecord(value) || value['format'] !== 'species-goals-catalog-v1') return false;
  const provenance = value['provenance'];
  const inventory = isRecord(provenance) ? provenance['inventory'] : null;
  if (
    !SHA256_PATTERN.test(String(value['catalogSha256'])) ||
    !sameArray(value['rowLayout'], CATALOG_LAYOUT) ||
    !Array.isArray(value['rows']) ||
    !isRecord(provenance) ||
    !hasExactKeys(provenance, [
      'releaseId',
      'speciesCsvSha256',
      'exceptionSourceSha256',
      'exceptionPolicySha256',
      'exceptionBindingSha256',
      'inventory',
    ]) ||
    !isNonEmptyString(provenance['releaseId']) ||
    !isSha256(provenance['speciesCsvSha256']) ||
    !isNullableSha256(provenance['exceptionSourceSha256']) ||
    !isNullableSha256(provenance['exceptionPolicySha256']) ||
    !isNullableSha256(provenance['exceptionBindingSha256']) ||
    !isRecord(inventory) ||
    !['catalogTotal', 'unavailable', 'zeroRange'].every((key) =>
      isNonnegativeInteger(inventory[key]),
    )
  ) {
    return false;
  }
  const ids = new Set<string>();
  const validRows = value['rows'].every((row) => {
    if (!Array.isArray(row) || row.length !== 6) return false;
    const [id, name, group, status, range, availability] = row;
    if (
      typeof id !== 'string' ||
      !id ||
      ids.has(id) ||
      typeof name !== 'string' ||
      !name ||
      (group !== null && typeof group !== 'string') ||
      (status !== null && typeof status !== 'string') ||
      (range !== null && !isNonnegativeNumber(range)) ||
      (availability !== 'available' && availability !== 'unavailable')
    ) {
      return false;
    }
    ids.add(id);
    return true;
  });
  return (
    validRows &&
    inventory['catalogTotal'] === value['rows'].length &&
    inventory['unavailable'] ===
      value['rows'].filter((row) => Array.isArray(row) && row[5] === 'unavailable').length &&
    inventory['zeroRange'] ===
      value['rows'].filter((row) => Array.isArray(row) && row[5] === 'available' && row[4] === 0)
        .length
  );
}

export function isSpeciesGoalsCompactDocument(
  value: unknown,
): value is SpeciesGoalsCompactDocument {
  if (!isRecord(value) || value['format'] !== 'species-goals-compact-v1') return false;
  const scopes = value['scopeCatalog'];
  const rows = value['rows'];
  const completion = value['completion'];
  const provenance = value['provenance'];
  const level = value['geographyLevel'];
  const encoding = value['encoding'];
  if (
    !SHA256_PATTERN.test(String(value['catalogSha256'])) ||
    !sameArray(value['rowLayout'], COMPACT_LAYOUT) ||
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    !scopes.every(
      (scope) =>
        Array.isArray(scope) &&
        scope.length === 2 &&
        scope.every((entry) => typeof entry === 'string' && entry.length > 0),
    ) ||
    !Array.isArray(rows) ||
    !isRecord(completion) ||
    completion['format'] !== 'species-goals-completion-v1' ||
    completion['status'] !== 'complete' ||
    completion['rowCount'] !== rows.length ||
    !SHA256_PATTERN.test(String(completion['payloadSha256'])) ||
    !isRecord(provenance) ||
    !hasExactKeys(provenance, [
      'releaseId',
      'speciesCsvSha256',
      'exceptionSourceSha256',
      'exceptionPolicySha256',
      'exceptionBindingSha256',
      'exactOverlapAlgorithmVersion',
      'exactOverlapPolicySha256',
      'targetGridSha256',
      'speciesAlignmentInventorySha256',
      'solutionRasterSha256',
      'targetPolicySha256',
      'boundaryProvenanceSha256',
      'catalogSha256',
    ]) ||
    !isNonEmptyString(value['solutionId']) ||
    !isNonEmptyString(provenance['releaseId']) ||
    !isNonEmptyString(provenance['exactOverlapAlgorithmVersion']) ||
    !isNullableSha256(provenance['exceptionSourceSha256']) ||
    !isNullableSha256(provenance['exceptionPolicySha256']) ||
    !isNullableSha256(provenance['exceptionBindingSha256']) ||
    ![
      'speciesCsvSha256',
      'exactOverlapPolicySha256',
      'targetGridSha256',
      'speciesAlignmentInventorySha256',
      'solutionRasterSha256',
      'targetPolicySha256',
      'boundaryProvenanceSha256',
      'catalogSha256',
    ].every((key) => isSha256(provenance[key])) ||
    provenance['catalogSha256'] !== value['catalogSha256'] ||
    !['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'].includes(
      String(level),
    ) ||
    (level === 'national' ? encoding !== 'dense' : encoding !== 'sparse-no-range-omitted')
  ) {
    return false;
  }
  let previous: [number, number] | null = null;
  return rows.every((row, index) => {
    if (!isValidCompactRow(row, scopes.length, level === 'national')) return false;
    const key: [number, number] = [row[0], row[1]];
    if (previous && (key[0] < previous[0] || (key[0] === previous[0] && key[1] <= previous[1]))) {
      return false;
    }
    previous = key;
    return level !== 'national' || (row[0] === 0 && row[1] === index);
  });
}

export function isSpeciesTargetOverlaysDocument(
  value: unknown,
): value is SpeciesTargetOverlaysDocument {
  if (!isRecord(value) || value['format'] !== 'species-target-overlays-v1') return false;
  const targetMaps = value['targetMaps'];
  const solutions = value['solutions'];
  const completion = value['completion'];
  if (
    !isNonEmptyString(value['releaseId']) ||
    !isSha256(value['catalogSha256']) ||
    !sameArray(value['rowLayout'], TARGET_OVERLAY_LAYOUT) ||
    !isRecord(value['provenance']) ||
    !isRecord(value['inventory']) ||
    !isRecord(targetMaps) ||
    !isRecord(solutions) ||
    Object.keys(solutions).length !== 168 ||
    !isRecord(completion) ||
    completion['format'] !== 'species-target-overlays-completion-v1' ||
    completion['status'] !== 'complete' ||
    !isSha256(completion['payloadSha256'])
  ) {
    return false;
  }
  const mapIds = new Set(Object.keys(targetMaps));
  if (
    !Object.values(solutions).every(
      (mapId) => mapId === null || (typeof mapId === 'string' && mapIds.has(mapId)),
    )
  ) {
    return false;
  }
  return Object.values(targetMaps).every((targetMap) => isSpeciesTargetOverlayMap(targetMap));
}

export function selectSpeciesTargetOverlay(
  document: SpeciesTargetOverlaysDocument,
  solutionId: string,
): SpeciesTargetOverlayMap | null {
  if (!Object.prototype.hasOwnProperty.call(document.solutions, solutionId)) {
    throw new Error(`Species target overlay does not map solution ${solutionId}.`);
  }
  const targetMapId = document.solutions[solutionId];
  if (targetMapId === null) return null;
  const targetMap = document.targetMaps[targetMapId];
  if (!targetMap) {
    throw new Error(`Species target overlay map ${targetMapId} is unavailable.`);
  }
  return targetMap;
}

export function hydrateSpeciesGoals(
  catalog: SpeciesGoalsCatalog,
  compact: SpeciesGoalsCompactDocument,
  scopeId: string,
  targetOverlay: SpeciesTargetOverlayMap | null | undefined = undefined,
): HydratedSpeciesGoalsRecord[] {
  if (catalog.catalogSha256 !== compact.catalogSha256) {
    throw new Error('Species goals catalog provenance does not match the sidecar.');
  }
  if (
    catalog.provenance.releaseId !== compact.provenance.releaseId ||
    compact.provenance.catalogSha256 !== catalog.catalogSha256
  ) {
    throw new Error('Species goals release provenance is stale.');
  }
  const scopeIndex = compact.scopeCatalog.findIndex(([id]) => id === scopeId);
  if (scopeIndex < 0) {
    throw new Error(`Species goals scope ${scopeId} is unavailable.`);
  }
  const rowsBySpecies = new Map(
    compact.rows.filter((row) => row[0] === scopeIndex).map((row) => [row[1], row] as const),
  );
  if ([...rowsBySpecies].some(([index]) => index >= catalog.rows.length)) {
    throw new Error('Species goals row references an unknown catalog species.');
  }
  if (
    targetOverlay &&
    (targetOverlay.rows.some(
      ([index]) => index >= catalog.rows.length || catalog.rows[index]?.[5] !== 'available',
    ) ||
      targetOverlay.unavailableRows.some(
        ([index]) => index >= catalog.rows.length || catalog.rows[index]?.[5] !== 'unavailable',
      ))
  ) {
    throw new Error('Species target overlay references an invalid catalog species.');
  }
  const overlayTargets = targetOverlay === undefined ? null : new Map(targetOverlay?.rows ?? []);
  return catalog.rows.map((catalogRow, speciesIndex) => {
    const [id, scientificName, group, iucnStatus, nationalRangeKm2, availability] = catalogRow;
    const row = rowsBySpecies.get(speciesIndex);
    const flags =
      row?.[7] ??
      (availability === 'unavailable'
        ? SPECIES_GOALS_FLAGS.unavailable
        : SPECIES_GOALS_FLAGS.noRange);
    const range = row?.[2] ?? 0;
    const selected = row?.[3] ?? 0;
    const preExisting = row?.[4] ?? 0;
    const newPrioritizr = row?.[5] ?? 0;
    const configuredTarget =
      targetOverlay === undefined
        ? (row?.[6] ?? null)
        : availability === 'unavailable'
          ? null
          : (overlayTargets?.get(speciesIndex) ?? null);
    const configuredTargetMet =
      targetOverlay === undefined
        ? flags & SPECIES_GOALS_FLAGS.targetConfigured
          ? Boolean(flags & SPECIES_GOALS_FLAGS.configuredTargetMet)
          : null
        : configuredTarget === null
          ? null
          : range > 0 && percent(selected, range) + 1e-9 >= configuredTarget;
    return {
      id,
      scientific_name: scientificName,
      group: group ?? 'other',
      iucn_status: iucnStatus,
      range_area_km2: nationalRangeKm2 ?? 0,
      range_in_aoi_area_km2: range,
      range_in_aoi_pct: percent(range, nationalRangeKm2 ?? 0),
      solution_covered_in_aoi_area_km2: selected,
      solution_covered_in_aoi_pct: percent(selected, range),
      pre_existing_covered_in_aoi_area_km2: preExisting,
      pre_existing_covered_in_aoi_pct: percent(preExisting, range),
      new_covered_in_aoi_area_km2: newPrioritizr,
      new_covered_in_aoi_pct: percent(newPrioritizr, range),
      availability,
      no_range_in_scope: Boolean(flags & SPECIES_GOALS_FLAGS.noRange),
      configured_target_percent: configuredTarget,
      met_17_percent: Boolean(flags & SPECIES_GOALS_FLAGS.met17),
      met_30_percent: Boolean(flags & SPECIES_GOALS_FLAGS.met30),
      configured_target_met: configuredTargetMet,
    };
  });
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidCompactRow(
  value: unknown,
  scopeCount: number,
  national: boolean,
): value is SpeciesGoalsCompactRow {
  if (!Array.isArray(value) || value.length !== 8) return false;
  const [scopeIndex, speciesIndex, range, selected, preExisting, additional, target, flags] = value;
  if (
    !isNonnegativeInteger(scopeIndex) ||
    scopeIndex >= scopeCount ||
    !isNonnegativeInteger(speciesIndex) ||
    !isNonnegativeInteger(flags) ||
    flags >= 64
  ) {
    return false;
  }
  const unavailable = Boolean(flags & SPECIES_GOALS_FLAGS.unavailable);
  const noRange = Boolean(flags & SPECIES_GOALS_FLAGS.noRange);
  const targetConfigured = Boolean(flags & SPECIES_GOALS_FLAGS.targetConfigured);
  if (unavailable) {
    return (
      national &&
      flags === SPECIES_GOALS_FLAGS.unavailable &&
      [range, selected, preExisting, additional, target].every((entry) => entry === null)
    );
  }
  if (
    ![range, selected, preExisting, additional].every(isNonnegativeNumber) ||
    selected > range ||
    Math.abs(preExisting + additional - selected) > 1e-6 ||
    (target !== null && (!isNonnegativeNumber(target) || target > 100)) ||
    targetConfigured !== (target !== null) ||
    noRange !== (range === 0) ||
    (!national && noRange)
  ) {
    return false;
  }
  const coverage = range > 0 ? (selected / range) * 100 : 0;
  return (
    Boolean(flags & SPECIES_GOALS_FLAGS.met17) === (range > 0 && coverage >= 17) &&
    Boolean(flags & SPECIES_GOALS_FLAGS.met30) === (range > 0 && coverage >= 30) &&
    Boolean(flags & SPECIES_GOALS_FLAGS.configuredTargetMet) ===
      (range > 0 && target !== null && coverage >= target)
  );
}

function isSpeciesTargetOverlayMap(value: unknown): value is SpeciesTargetOverlayMap {
  if (!isRecord(value)) return false;
  const rows = value['rows'];
  const unavailableRows = value['unavailableRows'];
  return (
    hasExactKeys(value, [
      'canonicalSha256',
      'sourceTargetCount',
      'applicableTargetCount',
      'unavailableTargetCount',
      'rows',
      'unavailableRows',
    ]) &&
    isSha256(value['canonicalSha256']) &&
    isNonnegativeInteger(value['sourceTargetCount']) &&
    isNonnegativeInteger(value['applicableTargetCount']) &&
    isNonnegativeInteger(value['unavailableTargetCount']) &&
    isValidTargetOverlayRows(rows) &&
    isValidTargetOverlayRows(unavailableRows) &&
    value['applicableTargetCount'] === rows.length &&
    value['unavailableTargetCount'] === unavailableRows.length &&
    value['sourceTargetCount'] === rows.length + unavailableRows.length
  );
}

function isValidTargetOverlayRows(value: unknown): value is SpeciesTargetOverlayRow[] {
  if (!Array.isArray(value)) return false;
  let previousIndex = -1;
  return value.every((row) => {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      !isNonnegativeInteger(row[0]) ||
      row[0] <= previousIndex ||
      !isNonnegativeNumber(row[1]) ||
      row[1] > 100
    ) {
      return false;
    }
    previousIndex = row[0];
    return true;
  });
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null || isSha256(value);
}

function sameArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    [...expected].sort().every((key, index) => keys[index] === key)
  );
}
