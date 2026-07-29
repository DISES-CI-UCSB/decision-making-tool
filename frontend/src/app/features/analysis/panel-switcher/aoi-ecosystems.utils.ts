import {
  isMecCompactV2Document,
  METRIC_COMPATIBLE_SIRAP_BOUNDARY_SOURCES,
  PRODUCTION_SIRAP_BOUNDARY_SOURCE,
  type AOI,
  type MecCompactDocument,
  type MecViewId,
} from '@core/models';
import type { EcosystemClassificationView } from '@features/left-sidebar/map-layers-panel/map-layers-panel-ecosystem.config';

import { extractRawAoiScopeId, normalizeScopeLabel } from '../utils/aoi-cached-metrics.utils';

export type MecBreakdownId = 'family' | 'context' | 'broad' | 'detailed' | 'iavh';
export type MecSortId = 'coverage' | 'additional' | 'existing' | 'name';

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
  preExistingCoverageKm2: number | null;
  newPrioritizrCoverageKm2: number | null;
  preExistingPercent: number | null;
  newPrioritizrPercent: number | null;
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
    count: 430,
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
): MecCoverageRow[] {
  return buildMecCoverageRowsByView(document, scopeIndex).get(view) ?? [];
}

export function buildMecCoverageRowsByView(
  document: MecCompactDocument,
  scopeIndex: number,
): ReadonlyMap<MecViewId, MecCoverageRow[]> {
  const unsupportedViews = new Set(document.viewSupport.unsupported.map((item) => item.view));
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
    viewRows.push({
      id: slugify(classId),
      label,
      ecosystemAreaKm2,
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
  if (aoi.type !== 'sirap' || aoi.boundaryGeometrySelection !== 'whole-feature') {
    return false;
  }

  return (
    (aoi.boundarySourceLayerKey === PRODUCTION_SIRAP_BOUNDARY_SOURCE.layerKey &&
      aoi.boundarySourceId === PRODUCTION_SIRAP_BOUNDARY_SOURCE.sourceId) ||
    METRIC_COMPATIBLE_SIRAP_BOUNDARY_SOURCES.some(
      (source) =>
        source.layerKey === aoi.boundarySourceLayerKey && source.sourceId === aoi.boundarySourceId,
    )
  );
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
