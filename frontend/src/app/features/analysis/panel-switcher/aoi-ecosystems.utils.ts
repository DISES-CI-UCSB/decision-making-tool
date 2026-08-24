import {
  isMecCompactV2Document,
  type AOI,
  type CustomAoiAreaProfileResponse,
  type CustomAoiEcosystemRecord,
  type CustomAoiProfileSectionStatus,
  type MesaAoiCoverageRecord,
  type MecCompactDocument,
  type MecViewId,
} from '@core/models';
import type { EcosystemClassificationView } from '@features/left-sidebar/map-layers-panel/map-layers-panel-ecosystem.config';

import {
  extractRawAoiScopeId,
  isMetricCompatibleAoiSource,
  normalizeScopeLabel,
} from '../utils/aoi-cached-metrics.utils';

export type MecBreakdownId = 'family' | 'context' | 'broad' | 'detailed' | 'iavh';
export type MecSortId =
  | 'composition'
  | 'national'
  | 'coverage'
  | 'additional'
  | 'existing'
  | 'name';

export interface MecBreakdownConfig {
  id: MecBreakdownId;
  view: EcosystemClassificationView;
  count: number;
  labelKey: string;
  pluralLabelKey: string;
  mode: 'donut' | 'bars';
  dummyItems: readonly MecPreviewItem[];
}

export interface MecPreviewItem {
  label: string;
  percent: number | null;
  color?: string;
}

export interface MecCoverageRow {
  id: string;
  label: string;
  ecosystemAreaKm2: number | null;
  ecosystemSharePercent?: number | null;
  nationalClassPercent?: number | null;
  solutionCoverageKm2?: number | null;
  solutionCoveragePercent?: number | null;
  preExistingCoverageKm2: number | null;
  newPrioritizrCoverageKm2: number | null;
  preExistingPercent: number | null;
  newPrioritizrPercent: number | null;
  mesaTotalInAoi?: number | null;
  mesaHeldInAoi?: number | null;
  mesaNationalTotal?: number | null;
  mesaClassifiedTotalInAoi?: number | null;
  preExistingCellCountInAoi?: number | null;
  newPrioritizrCellCountInAoi?: number | null;
  contributionToNationalCoveragePercent?: number | null;
  preExistingContributionToNationalCoveragePercent?: number | null;
  newPrioritizrContributionToNationalCoveragePercent?: number | null;
  contributionToNationalTargetPercent?: number | null;
}

export interface CustomMecData {
  status: CustomAoiProfileSectionStatus;
  mode: 'composition' | 'mesa-solution';
  hasSolutionCoverage: boolean;
  rowsByView: ReadonlyMap<MecViewId, MecCoverageRow[]>;
  previewByView: ReadonlyMap<MecViewId, MecPreviewItem[]>;
  scopeSummary: MecScopeSummary | null;
}

export interface MecScopeSummary {
  scopeAreaKm2: number;
  classifiedKm2: number;
  unclassifiedKm2: number;
  classifiedPercent: number | null;
  unclassifiedPercent: number | null;
  boundaryProvenanceRef: string;
}

export interface StrategicEcosystemBar {
  id: string;
  labelKey: string;
  metricId: string;
  dummyPercent: number;
  color: string;
}

export const ECOSYSTEM_CLASSIFICATION_SUMMARY_URL =
  'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/ecosystems/ecosystem-classification-summary.json';

export const STRATEGIC_ECOSYSTEM_BARS: readonly StrategicEcosystemBar[] = [
  {
    id: 'paramos',
    labelKey: 'analysis.aoi.ecosystemLegend.paramo',
    metricId: 'ecosystem_coverage_paramo',
    dummyPercent: 14,
    color: '#0369a1',
  },
  {
    id: 'wetlands',
    labelKey: 'analysis.aoi.ecosystemLegend.wetlands',
    metricId: 'ecosystem_coverage_wetlands',
    dummyPercent: 31,
    color: '#0ea5e9',
  },
  {
    id: 'dry-forest',
    labelKey: 'analysis.aoi.ecosystemLegend.dryForest',
    metricId: 'ecosystem_coverage_dry_forest',
    dummyPercent: 8,
    color: '#f59e0b',
  },
  {
    id: 'mangroves',
    labelKey: 'analysis.aoi.ecosystemLegend.mangroves',
    metricId: 'mangrove_coverage',
    dummyPercent: 3,
    color: '#0d9488',
  },
];

/** The 430 authoritative raster biome IDs collapse to 429 unique conservation-feature labels. */
export const MEC_IAVH_FEATURE_COUNT = 429;
/** The V3 Mesa parity contract contains 417 ecosystem conservation features. */
export const MESA_IAVH_FEATURE_COUNT = 417;

export const MEC_BREAKDOWNS: readonly MecBreakdownConfig[] = [
  {
    id: 'family',
    view: 'biomeFamily',
    count: 8,
    labelKey: 'analysis.aoi.mec.levels.family',
    pluralLabelKey: 'analysis.aoi.mec.levels.familyPlural',
    mode: 'donut',
    dummyItems: [
      { label: 'Zonobioma', percent: 29, color: '#334155' },
      { label: 'Orobioma', percent: 24, color: '#475569' },
      { label: 'Helobioma', percent: 17, color: '#64748b' },
      { label: 'Peinobioma', percent: 12, color: '#94a3b8' },
      { label: 'Other / N.A.', percent: 18, color: '#cbd5e1' },
    ],
  },
  {
    id: 'context',
    view: 'broadBiomeContext',
    count: 7,
    labelKey: 'analysis.aoi.mec.levels.context',
    pluralLabelKey: 'analysis.aoi.mec.levels.contextPlural',
    mode: 'donut',
    dummyItems: [
      { label: 'Humid tropical zonobiome', percent: 31, color: '#334155' },
      { label: 'Humid tropical pedobiome', percent: 24, color: '#475569' },
      { label: 'Humid tropical orobiome', percent: 17, color: '#64748b' },
      { label: 'Alternohygic zonobiome', percent: 12, color: '#94a3b8' },
      { label: 'Other contexts', percent: 16, color: '#cbd5e1' },
    ],
  },
  {
    id: 'broad',
    view: 'broadEcosystem',
    count: 28,
    labelKey: 'analysis.aoi.mec.levels.broad',
    pluralLabelKey: 'analysis.aoi.mec.levels.broadPlural',
    mode: 'bars',
    dummyItems: [
      { label: 'Bosque', percent: 32 },
      { label: 'Agroecosistema', percent: 24 },
      { label: 'Sabana', percent: 18 },
      { label: 'Transicional Transformado', percent: 11 },
      { label: 'Vegetación Secundaria', percent: 8 },
    ],
  },
  {
    id: 'detailed',
    view: 'detailedEcosystem',
    count: 87,
    labelKey: 'analysis.aoi.mec.levels.detailed',
    pluralLabelKey: 'analysis.aoi.mec.levels.detailedPlural',
    mode: 'bars',
    dummyItems: [
      { label: 'Bosque Basal Humedo', percent: 21 },
      { label: 'Agroecosistema Ganadero', percent: 17 },
      { label: 'Bosque Inundable Basal', percent: 14 },
      { label: 'Sabana Estacional', percent: 11 },
      { label: 'Vegetación Secundaria', percent: 8 },
    ],
  },
  {
    id: 'iavh',
    view: 'biomeRegion',
    count: MEC_IAVH_FEATURE_COUNT,
    labelKey: 'analysis.aoi.mec.levels.iavh',
    pluralLabelKey: 'analysis.aoi.mec.levels.iavhPlural',
    mode: 'bars',
    dummyItems: [
      { label: 'Peinobioma Altillanura', percent: 13 },
      { label: 'Helobioma Casanare', percent: 10 },
      { label: 'Helobioma Altillanura', percent: 8 },
      { label: 'Zonobioma Humedo Tropical Altillanura', percent: 7 },
      { label: 'Zonobioma Humedo Tropical Guaviare - Guayabero', percent: 5 },
    ],
  },
];

export function calculateOverlapPercent(
  overlapKm2: number | null | undefined,
  candidateAreaKm2: number | null | undefined,
): number | null {
  if (
    overlapKm2 === null ||
    overlapKm2 === undefined ||
    candidateAreaKm2 === null ||
    candidateAreaKm2 === undefined ||
    !Number.isFinite(overlapKm2) ||
    !Number.isFinite(candidateAreaKm2) ||
    candidateAreaKm2 <= 0
  ) {
    return null;
  }

  return Math.max(0, Math.min(100, (overlapKm2 / candidateAreaKm2) * 100));
}

export function resolveMecScopeIndex(document: MecCompactDocument, aoi: AOI): number | null {
  const rawScopeId = extractRawAoiScopeId(aoi.id);
  const directIndex = document.scopeCatalog.findIndex(([scopeId]) => scopeId === rawScopeId);
  if (directIndex >= 0) {
    return directIndex;
  }

  // SIRAP cache resolution is ID-only. A name match could incorrectly attach a
  // clicked component polygon to metrics for the whole merged production SIRAP.
  if (aoi.type === 'sirap') {
    return null;
  }

  const normalizedName = normalizeScopeLabel(aoi.name);
  if (!normalizedName) {
    return null;
  }
  const nameIndex = document.scopeCatalog.findIndex(
    ([, scopeName]) => normalizeScopeLabel(scopeName) === normalizedName,
  );
  return nameIndex >= 0 ? nameIndex : null;
}

export function isMecViewAvailable(document: MecCompactDocument, view: MecViewId): boolean {
  if (document.viewSupport.unsupported.some((item) => item.view === view)) {
    return false;
  }
  return document.viewCatalog.some(([viewId]) => viewId === view);
}

export function buildMecCoverageRows(
  document: MecCompactDocument,
  scopeIndex: number,
  view: MecViewId,
  nationalDocument: MecCompactDocument | null = null,
): MecCoverageRow[] {
  return buildMecCoverageRowsByView(document, scopeIndex, nationalDocument).get(view) ?? [];
}

export function buildMecCoverageRowsByView(
  document: MecCompactDocument,
  scopeIndex: number,
  nationalDocument: MecCompactDocument | null = null,
): ReadonlyMap<MecViewId, MecCoverageRow[]> {
  const unsupportedViews = new Set(document.viewSupport.unsupported.map((item) => item.view));
  const scopeAreaKm2 = isMecCompactV2Document(document)
    ? (document.scopeStats[String(scopeIndex)]?.scopeAreaKm2 ?? null)
    : null;
  const nationalAreaByClassIndex =
    isMecCompactV2Document(document) &&
    nationalDocument &&
    isMecCompactV2Document(nationalDocument) &&
    nationalDocument.solutionId === document.solutionId
      ? new Map(nationalDocument.rows.map((row) => [row[1], row[2]] as const))
      : new Map<number, number>();
  const rowsByView = new Map<MecViewId, MecCoverageRow[]>();
  document.viewCatalog.forEach(([view]) => {
    if (!unsupportedViews.has(view)) {
      rowsByView.set(view, []);
    }
  });

  document.rows.forEach((row) => {
    const [
      rowScopeIndex,
      classIndex,
      ecosystemAreaKm2,
      preExistingCoverageKm2,
      newPrioritizrCoverageKm2,
    ] = row;
    const classification = document.classCatalog[classIndex];
    if (rowScopeIndex !== scopeIndex || !classification) {
      return;
    }

    const view = document.viewCatalog[classification[0]]?.[0];
    const viewRows = view ? rowsByView.get(view) : undefined;
    if (!viewRows) {
      return;
    }

    const [, classId, label] = classification;
    const solutionCoverageKm2 = preExistingCoverageKm2 + newPrioritizrCoverageKm2;
    const nationalAreaKm2 = nationalAreaByClassIndex.get(classIndex);
    viewRows.push({
      id: slugify(classId),
      label,
      ecosystemAreaKm2,
      ecosystemSharePercent:
        scopeAreaKm2 !== null && scopeAreaKm2 > 0 ? (ecosystemAreaKm2 / scopeAreaKm2) * 100 : null,
      nationalClassPercent:
        nationalAreaKm2 !== undefined && nationalAreaKm2 > 0
          ? (ecosystemAreaKm2 / nationalAreaKm2) * 100
          : null,
      solutionCoverageKm2,
      solutionCoveragePercent:
        ecosystemAreaKm2 > 0 ? (solutionCoverageKm2 / ecosystemAreaKm2) * 100 : null,
      preExistingCoverageKm2,
      newPrioritizrCoverageKm2,
      preExistingPercent:
        ecosystemAreaKm2 > 0 ? (preExistingCoverageKm2 / ecosystemAreaKm2) * 100 : null,
      newPrioritizrPercent:
        ecosystemAreaKm2 > 0 ? (newPrioritizrCoverageKm2 / ecosystemAreaKm2) * 100 : null,
    });
  });
  return rowsByView;
}

export function buildMecPreviewItems(
  document: MecCompactDocument,
  scopeIndex: number,
  rows: readonly MecCoverageRow[],
  legacyCandidateAreaKm2: number | null,
  colors: readonly string[] = [],
): MecPreviewItem[] {
  const scopeAreaKm2 = isMecCompactV2Document(document)
    ? (document.scopeStats[String(scopeIndex)]?.scopeAreaKm2 ?? null)
    : legacyCandidateAreaKm2;
  const hasDenominator = scopeAreaKm2 !== null && Number.isFinite(scopeAreaKm2) && scopeAreaKm2 > 0;
  const previewArea = (row: MecCoverageRow): number =>
    isMecCompactV2Document(document)
      ? (row.ecosystemAreaKm2 ?? 0)
      : (row.preExistingCoverageKm2 ?? 0) + (row.newPrioritizrCoverageKm2 ?? 0);

  return [...rows]
    .sort((a, b) => previewArea(b) - previewArea(a))
    .slice(0, 5)
    .map((row, index) => {
      return {
        label: row.label,
        percent: hasDenominator ? (previewArea(row) / scopeAreaKm2) * 100 : null,
        ...(colors[index] ? { color: colors[index] } : {}),
      };
    });
}

export function buildCustomMecData(
  response: CustomAoiAreaProfileResponse,
  expectedSolutionId: string | null = response.solution_id ?? null,
): CustomMecData {
  const section = response.sections.ecosystems;
  if (!section) {
    throw new Error('Missing custom AOI ecosystems section');
  }

  const hasActiveSolution = expectedSolutionId !== null;
  if (hasActiveSolution && response.solution_id !== expectedSolutionId) {
    throw new Error('Missing or mismatched solution id in custom AOI ecosystem response');
  }
  if (hasActiveSolution && !Array.isArray(section.solution_coverage)) {
    throw new Error('Missing Mesa solution coverage for active custom AOI solution');
  }

  const rowsByView = new Map<MecViewId, MecCoverageRow[]>();
  const previewByView = new Map<MecViewId, MecPreviewItem[]>();
  if (hasActiveSolution) {
    const rows = validateMesaSolutionCoverage(section.solution_coverage ?? []).map(
      buildMesaCustomMecCoverageRow,
    );
    // Mesa solution coverage is the 417-class IAvH biome-region inventory.
    // The section's canonical view describes the separate composition taxonomy.
    const mesaView: MecViewId = 'biomeRegion';
    rowsByView.set(mesaView, rows);
    previewByView.set(
      mesaView,
      [...rows]
        .sort((a, b) => (b.solutionCoveragePercent ?? -1) - (a.solutionCoveragePercent ?? -1))
        .slice(0, 5)
        .map((row) => ({
          label: row.label,
          percent: row.solutionCoveragePercent ?? null,
        })),
    );
  } else {
    section.views.forEach((view) => {
      const rows = view.records.map(buildCustomMecCompositionRow);
      rowsByView.set(view.id, rows);
      previewByView.set(
        view.id,
        [...view.records]
          .sort((a, b) => b.area_km2 - a.area_km2)
          .slice(0, 5)
          .map((record) => ({
            label: record.label,
            percent: record.share_of_total_aoi_pct ?? null,
          })),
      );
    });
  }

  return {
    status: section.status,
    mode: hasActiveSolution ? 'mesa-solution' : 'composition',
    hasSolutionCoverage: hasActiveSolution,
    rowsByView,
    previewByView,
    scopeSummary: buildCustomMecScopeSummary(
      response.selection.area_km2,
      section.classified_area_km2,
      response.selection.source,
    ),
  };
}

export function buildCustomMecCompositionRow(record: CustomAoiEcosystemRecord): MecCoverageRow {
  return {
    id: slugify(record.id),
    label: record.label,
    ecosystemAreaKm2: record.area_km2,
    ecosystemSharePercent: record.share_of_total_aoi_pct ?? null,
    nationalClassPercent: record.share_of_national_class_pct,
    solutionCoverageKm2: null,
    solutionCoveragePercent: null,
    preExistingCoverageKm2: null,
    newPrioritizrCoverageKm2: null,
    preExistingPercent: null,
    newPrioritizrPercent: null,
  };
}

export function buildMesaCustomMecCoverageRow(record: MesaAoiCoverageRecord): MecCoverageRow {
  return {
    id: slugify(record.feature),
    label: record.feature,
    ecosystemAreaKm2: null,
    ecosystemSharePercent: fractionToPercent(record.share_of_classified_aoi),
    nationalClassPercent: fractionToPercent(record.share_of_national_total),
    solutionCoverageKm2: null,
    solutionCoveragePercent: fractionToPercent(record.coverage_within_aoi),
    preExistingCoverageKm2: null,
    newPrioritizrCoverageKm2: null,
    preExistingPercent: fractionToPercent(record.pre_existing_coverage_within_aoi),
    newPrioritizrPercent: fractionToPercent(record.new_prioritizr_coverage_within_aoi),
    mesaTotalInAoi: record.total_in_aoi,
    mesaHeldInAoi: record.held_in_aoi,
    mesaNationalTotal: record.national_total,
    mesaClassifiedTotalInAoi: record.classified_total_in_aoi,
    preExistingCellCountInAoi: record.pre_existing_held_in_aoi,
    newPrioritizrCellCountInAoi: record.new_prioritizr_held_in_aoi,
    contributionToNationalCoveragePercent: fractionToPercent(
      record.contribution_to_national_coverage,
    ),
    preExistingContributionToNationalCoveragePercent: fractionToPercent(
      record.pre_existing_contribution_to_national_coverage,
    ),
    newPrioritizrContributionToNationalCoveragePercent: fractionToPercent(
      record.new_prioritizr_contribution_to_national_coverage,
    ),
    contributionToNationalTargetPercent: fractionToPercent(record.contribution_to_national_target),
  };
}

function validateMesaSolutionCoverage(records: readonly unknown[]): MesaAoiCoverageRecord[] {
  if (records.length !== MESA_IAVH_FEATURE_COUNT) {
    throw new Error(
      `Invalid Mesa solution coverage: expected ${MESA_IAVH_FEATURE_COUNT} rows, received ${records.length}`,
    );
  }

  const features = new Set<string>();
  return records.map((record, index) => {
    assertMesaSolutionCoverageRecord(record, index);
    const normalizedFeature = normalizeMesaFeatureIdentity(record.feature);
    if (features.has(normalizedFeature)) {
      throw new Error(
        `Invalid Mesa solution coverage: duplicate feature "${record.feature}" at row ${index + 1}`,
      );
    }
    features.add(normalizedFeature);
    return record;
  });
}

function assertMesaSolutionCoverageRecord(
  record: unknown,
  index: number,
): asserts record is MesaAoiCoverageRecord {
  const rowLabel = `row ${index + 1}`;
  if (record === null || typeof record !== 'object') {
    throw new Error(`Invalid Mesa solution coverage: ${rowLabel} must be an object`);
  }

  const candidate = record as Record<string, unknown>;
  if (typeof candidate['feature'] !== 'string' || candidate['feature'].trim().length === 0) {
    throw new Error(`Invalid Mesa solution coverage: ${rowLabel} has an empty feature`);
  }
  assertFiniteNonnegativeInteger(candidate['total_in_aoi'], rowLabel, 'total_in_aoi');
  assertFiniteNonnegativeInteger(candidate['national_total'], rowLabel, 'national_total');
  assertFiniteNonnegativeInteger(
    candidate['classified_total_in_aoi'],
    rowLabel,
    'classified_total_in_aoi',
  );
  assertNullableFraction(
    candidate['share_of_national_total'],
    rowLabel,
    'share_of_national_total',
    true,
  );
  assertNullableFraction(
    candidate['share_of_classified_aoi'],
    rowLabel,
    'share_of_classified_aoi',
    true,
  );
  assertFiniteNonnegativeInteger(candidate['held_in_aoi'], rowLabel, 'held_in_aoi');
  assertFiniteNonnegativeInteger(
    candidate['pre_existing_held_in_aoi'],
    rowLabel,
    'pre_existing_held_in_aoi',
  );
  assertFiniteNonnegativeInteger(
    candidate['new_prioritizr_held_in_aoi'],
    rowLabel,
    'new_prioritizr_held_in_aoi',
  );
  if ((candidate['held_in_aoi'] as number) > (candidate['total_in_aoi'] as number)) {
    throw new Error(
      `Invalid Mesa solution coverage: ${rowLabel} has held_in_aoi above total_in_aoi`,
    );
  }
  if ((candidate['total_in_aoi'] as number) > (candidate['national_total'] as number)) {
    throw new Error(
      `Invalid Mesa solution coverage: ${rowLabel} has total_in_aoi above national_total`,
    );
  }
  if ((candidate['total_in_aoi'] as number) > (candidate['classified_total_in_aoi'] as number)) {
    throw new Error(
      `Invalid Mesa solution coverage: ${rowLabel} has total_in_aoi above classified_total_in_aoi`,
    );
  }
  if (
    (candidate['held_in_aoi'] as number) !==
    (candidate['pre_existing_held_in_aoi'] as number) +
      (candidate['new_prioritizr_held_in_aoi'] as number)
  ) {
    throw new Error(
      `Invalid Mesa solution coverage: ${rowLabel} violates held = pre-existing + new`,
    );
  }
  assertNullableFraction(candidate['coverage_within_aoi'], rowLabel, 'coverage_within_aoi', true);
  assertNullableFraction(
    candidate['pre_existing_coverage_within_aoi'],
    rowLabel,
    'pre_existing_coverage_within_aoi',
    true,
  );
  assertNullableFraction(
    candidate['new_prioritizr_coverage_within_aoi'],
    rowLabel,
    'new_prioritizr_coverage_within_aoi',
    true,
  );
  assertNullableFraction(
    candidate['contribution_to_national_coverage'],
    rowLabel,
    'contribution_to_national_coverage',
  );
  assertNullableFraction(
    candidate['pre_existing_contribution_to_national_coverage'],
    rowLabel,
    'pre_existing_contribution_to_national_coverage',
    true,
  );
  assertNullableFraction(
    candidate['new_prioritizr_contribution_to_national_coverage'],
    rowLabel,
    'new_prioritizr_contribution_to_national_coverage',
    true,
  );
  assertNullableFraction(
    candidate['contribution_to_national_target'],
    rowLabel,
    'contribution_to_national_target',
  );
  assertExactRatio(
    candidate,
    rowLabel,
    'share_of_national_total',
    'total_in_aoi',
    'national_total',
  );
  assertExactRatio(
    candidate,
    rowLabel,
    'share_of_classified_aoi',
    'total_in_aoi',
    'classified_total_in_aoi',
  );
  assertExactRatio(candidate, rowLabel, 'coverage_within_aoi', 'held_in_aoi', 'total_in_aoi');
  assertExactRatio(
    candidate,
    rowLabel,
    'pre_existing_coverage_within_aoi',
    'pre_existing_held_in_aoi',
    'total_in_aoi',
  );
  assertExactRatio(
    candidate,
    rowLabel,
    'new_prioritizr_coverage_within_aoi',
    'new_prioritizr_held_in_aoi',
    'total_in_aoi',
  );
  assertExactRatio(
    candidate,
    rowLabel,
    'contribution_to_national_coverage',
    'held_in_aoi',
    'national_total',
  );
  assertExactRatio(
    candidate,
    rowLabel,
    'pre_existing_contribution_to_national_coverage',
    'pre_existing_held_in_aoi',
    'national_total',
  );
  assertExactRatio(
    candidate,
    rowLabel,
    'new_prioritizr_contribution_to_national_coverage',
    'new_prioritizr_held_in_aoi',
    'national_total',
  );
}

function assertExactRatio(
  candidate: Record<string, unknown>,
  rowLabel: string,
  ratioField: string,
  numeratorField: string,
  denominatorField: string,
): void {
  const value = candidate[ratioField] as number | null;
  const numerator = candidate[numeratorField] as number;
  const denominator = candidate[denominatorField] as number;
  if (denominator === 0) {
    if (value !== null) {
      throw new Error(
        `Invalid Mesa solution coverage: ${rowLabel} has non-null ${ratioField} with a zero denominator`,
      );
    }
    return;
  }
  if (value === null || Math.abs(value - numerator / denominator) > 1e-12) {
    throw new Error(
      `Invalid Mesa solution coverage: ${rowLabel} has ${ratioField} inconsistent with its denominator`,
    );
  }
}

function normalizeMesaFeatureIdentity(value: string): string {
  return value.replaceAll('_', ' ').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function assertFiniteNonnegativeInteger(value: unknown, rowLabel: string, field: string): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    throw new Error(
      `Invalid Mesa solution coverage: ${rowLabel} has invalid ${field}; expected a whole nonnegative planning-cell count`,
    );
  }
}

function assertNullableFraction(
  value: unknown,
  rowLabel: string,
  field: string,
  bounded = false,
): void {
  if (
    value !== null &&
    (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (bounded && value > 1))
  ) {
    const expectation = bounded ? 'a finite value from 0 to 1 or null' : 'a finite value or null';
    throw new Error(
      `Invalid Mesa solution coverage: ${rowLabel} has invalid ${field}; expected ${expectation}`,
    );
  }
}

function fractionToPercent(value: number | null): number | null {
  return value === null ? null : value * 100;
}

export function buildCustomMecScopeSummary(
  scopeAreaKm2: number | null,
  classifiedKm2: number,
  boundaryProvenanceRef: string,
): MecScopeSummary | null {
  if (scopeAreaKm2 === null || !Number.isFinite(scopeAreaKm2) || scopeAreaKm2 < 0) {
    return null;
  }
  const safeClassifiedKm2 = Math.max(0, Math.min(scopeAreaKm2, classifiedKm2));
  const unclassifiedKm2 = scopeAreaKm2 - safeClassifiedKm2;
  const hasArea = scopeAreaKm2 > 0;
  return {
    scopeAreaKm2,
    classifiedKm2: safeClassifiedKm2,
    unclassifiedKm2,
    classifiedPercent: hasArea ? (safeClassifiedKm2 / scopeAreaKm2) * 100 : null,
    unclassifiedPercent: hasArea ? (unclassifiedKm2 / scopeAreaKm2) * 100 : null,
    boundaryProvenanceRef,
  };
}

export function resolveMecScopeSummary(
  document: MecCompactDocument,
  scopeIndex: number,
): MecScopeSummary | null {
  if (!isMecCompactV2Document(document)) {
    return null;
  }
  const stats = document.scopeStats[String(scopeIndex)];
  if (!stats) {
    return null;
  }
  const hasArea = stats.scopeAreaKm2 > 0;
  return {
    ...stats,
    classifiedPercent: hasArea ? (stats.classifiedKm2 / stats.scopeAreaKm2) * 100 : null,
    unclassifiedPercent: hasArea ? (stats.unclassifiedKm2 / stats.scopeAreaKm2) * 100 : null,
  };
}

export function isWholeMetricCompatibleSirapAoi(aoi: AOI): boolean {
  return aoi.type === 'sirap' && isMetricCompatibleAoiSource(aoi);
}

export function buildDummyCoverageRows(
  labels: readonly string[],
  candidateAreaKm2: number,
): MecCoverageRow[] {
  const safeCandidateArea = Math.max(0, candidateAreaKm2);
  const weights = labels.map((_, index) => Math.exp(-index / Math.max(4, labels.length / 4)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  return labels.map((label, index) => {
    const ecosystemAreaKm2 = (safeCandidateArea * weights[index]) / weightTotal;
    const preExistingPercent = Math.max(3, 22 - index * 1.25);
    const newPrioritizrPercent = Math.max(4, 38 - index * 1.7);
    return {
      id: `${index}-${slugify(label)}`,
      label,
      ecosystemAreaKm2,
      preExistingCoverageKm2: (ecosystemAreaKm2 * preExistingPercent) / 100,
      newPrioritizrCoverageKm2: (ecosystemAreaKm2 * newPrioritizrPercent) / 100,
      preExistingPercent,
      newPrioritizrPercent,
    };
  });
}

export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'category'
  );
}
