import type { RuntimeLayerManifestRenderingConfig } from '@core/models';
import type { MapSyncDescriptor } from './map-layers-panel-map-sync';
import { MASTER_LEGEND_EXCLUDED_ADMIN_BOUNDARY_LAYER_KEYS } from './map-layers-panel.config';

export type SelectedLayerDropPosition = 'before' | 'after';
export type ScenarioLayerStatus = 'considered' | 'reference';
export type SupportedLanguage = 'en' | 'es';
export type PlanningDomain = 'land' | 'marine';
export type LayerCatalogScope = PlanningDomain | 'both';
export type LayerPlanningDomain = PlanningDomain | 'shared' | 'context';

const MARINE_LAYER_ROW_IDS = new Set([
  'layer-hhm',
  'layer-marine_ecosystems',
  'layer-mangroves',
]);

interface SelectableRowDto {
  id: string;
  selected: boolean;
}

interface SelectableGroupDto {
  rows: SelectableRowDto[];
}

interface SelectableTaxonDto extends SelectableRowDto {
  species: SelectableRowDto[];
}

interface SearchableSpeciesDto {
  common: string;
  latin: string;
}

interface SearchableTaxonDto {
  name: string;
  species: SearchableSpeciesDto[];
}

interface ParentChildRow {
  id: string;
  parentId?: string;
}

export interface LegendLayerEntry {
  id: string;
  name: string;
  swatchType: 'fill' | 'line' | 'gradient';
  color: string;
  lineStyle: 'solid' | 'dashed';
  lineWidth: number;
  categories?: { id: string; label: string; color: string }[];
  denseCategorySummary?: {
    count: number;
    messageKey: string;
    sampleColors: string[];
  };
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientMinLabel?: string;
  gradientMaxLabel?: string;
}

interface LegendLayerInput {
  id: string;
  name: string;
  color: string;
  borderColor?: string;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted';
  borderWidth?: number;
  boundaryStyle?: { color: string; lineWidth: number };
  rendering?: RuntimeLayerManifestRenderingConfig;
  language?: SupportedLanguage;
  denseCategorySummary?: LegendLayerEntry['denseCategorySummary'];
}

export function computeSelectedLayerOrder(
  overlays: SelectableRowDto[],
  groups: SelectableGroupDto[],
  taxa: SelectableTaxonDto[],
): string[] {
  return [
    ...overlays.filter((row) => row.selected).map((row) => row.id),
    ...groups
      .flatMap((group) => group.rows)
      .filter((row) => row.selected)
      .map((row) => row.id),
    ...taxa.filter((taxon) => taxon.selected).map((taxon) => taxon.id),
    ...taxa
      .flatMap((taxon) => taxon.species)
      .filter((species) => species.selected)
      .map((species) => species.id),
  ];
}

export function normalizeSelectedLayerOrder(
  order: string[],
  priorityIds: readonly string[],
  prioritize: boolean,
): string[] {
  if (!prioritize) {
    return order;
  }

  const presentPriorityIds = priorityIds.filter((id) => order.includes(id));
  if (presentPriorityIds.length === 0) {
    return order;
  }

  const priorityIdSet = new Set(presentPriorityIds);
  return [...presentPriorityIds, ...order.filter((id) => !priorityIdSet.has(id))];
}

export function reorderRowsById(rows: string[], rowId: string, direction: 'up' | 'down'): string[] {
  const index = rows.indexOf(rowId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) {
    return rows;
  }

  const nextRows = [...rows];
  const [row] = nextRows.splice(index, 1);
  nextRows.splice(targetIndex, 0, row);
  return nextRows;
}

export function reorderRowsByDropTarget(
  rows: string[],
  draggedRowId: string,
  targetRowId: string,
  dropPosition: SelectedLayerDropPosition,
): string[] {
  const fromIndex = rows.indexOf(draggedRowId);
  const targetIndex = rows.indexOf(targetRowId);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
    return rows;
  }

  const nextRows = [...rows];
  const [movedRowId] = nextRows.splice(fromIndex, 1);
  const nextTargetIndex = nextRows.indexOf(targetRowId);
  const insertionIndex = dropPosition === 'before' ? nextTargetIndex : nextTargetIndex + 1;
  nextRows.splice(insertionIndex, 0, movedRowId);
  return nextRows;
}

export function groupParentChildRows<T extends ParentChildRow>(
  rows: readonly T[],
  parentRow: T,
  childRows: readonly T[],
): T[] {
  const groupedIds = new Set([parentRow.id, ...childRows.map((row) => row.id)]);
  const firstGroupedIndex = rows.findIndex((row) => groupedIds.has(row.id));
  if (firstGroupedIndex < 0 || childRows.length === 0) {
    return [...rows];
  }

  return [
    ...rows.slice(0, firstGroupedIndex).filter((row) => !groupedIds.has(row.id)),
    { ...parentRow, parentId: undefined },
    ...childRows.map((row) => ({ ...row, parentId: parentRow.id })),
    ...rows.slice(firstGroupedIndex + 1).filter((row) => !groupedIds.has(row.id)),
  ];
}

export function nameMatchesSearch(name: string, normalizedQuery: string): boolean {
  return name.toLowerCase().includes(normalizedQuery);
}

export function speciesMatchesSearch(
  species: SearchableSpeciesDto,
  normalizedQuery: string,
): boolean {
  return `${species.common} ${species.latin}`.toLowerCase().includes(normalizedQuery);
}

export function taxonMatchesSearch(taxon: SearchableTaxonDto, normalizedQuery: string): boolean {
  return (
    nameMatchesSearch(taxon.name, normalizedQuery) ||
    taxon.species.some((species) => speciesMatchesSearch(species, normalizedQuery))
  );
}

export function normalizeLayerIdAliases(id: string | null | undefined): string[] {
  if (!id) {
    return [];
  }

  const trimmed = id.trim().toLowerCase();
  const normalized = trimmed
    .replace(/^layer-/, '')
    .replace(/^overlay-/, '')
    .replace(/^species-/, '')
    .replace(/^(?:feat|incl|cost)_/, '')
    .replace(/-/g, '_');

  const singular = normalized === 'omecs' ? 'omec' : normalized;
  const plural = normalized === 'omec' ? 'omecs' : normalized;
  const costAliases = normalized === 'hf_2030' ? ['human_footprint_2030'] : [];
  return Array.from(
    new Set([normalized, singular, plural, trimmed, ...costAliases].filter(Boolean)),
  );
}

export function buildConsideredLayerIdSet(ids: (string | null | undefined)[]): Set<string> {
  return new Set(ids.flatMap((id) => normalizeLayerIdAliases(id)));
}

const SCENARIO_CONSIDERABLE_LAYER_IDS = buildConsideredLayerIdSet([
  'ecosistemas',
  'layer-ecosistemas',
  'paramos',
  'wetlands',
  'bosque_seco',
  'mangroves',
  'layer-paramos',
  'layer-wetlands',
  'layer-bosque_seco',
  'layer-mangroves',
  'layer-eco-paramos',
  'layer-eco-wetlands',
  'layer-eco-dry-forest',
  'layer-eco-mangroves',
  'overlay-runap',
  'overlay-runap-national-parks',
  'overlay-runap-protected-areas',
  'overlay-omecs',
  'runap',
  'runap_national_parks',
  'runap_protected_areas',
  'omec',
  'omecs',
  'layer-hhm',
  'hhm',
  'human_footprint',
  'human_footprint_2022',
  'human_footprint_2030',
  'layer-human_footprint',
  'layer-human_footprint_2022',
  'layer-human_footprint_2030',
  'layer-soc-human-footprint',
  'soc-human-footprint',
  'layer-species',
  'species',
]);

const AGGREGATE_SCENARIO_TARGET_IDS = new Set([
  'ecosistemas',
  'ecosystems',
  'strategic_ecosystems',
  'paramos',
  'wetlands',
  'bosque_seco',
  'mangroves',
  'species_richness',
  'marine_ecosystems',
  'marine_ecosystems_and_mangroves',
  'ecosystem_services',
  'esp_rn',
  'runap',
  'runap_national_parks',
  'omec',
  'omecs',
  'hhm',
  'human_footprint',
  'human_footprint_2022',
  'human_footprint_2030',
  'species',
]);

export interface IndividualSpeciesScenarioTargetInput {
  targetFeatureIds: readonly string[];
  structuredTargets?: {
    speciesRepresentation?: readonly { featureId: string }[];
    espRn?: readonly { featureId: string }[];
  };
}

export function hasIndividualSpeciesScenarioTargets(
  input: IndividualSpeciesScenarioTargetInput,
): boolean {
  if ((input.structuredTargets?.espRn?.length ?? 0) > 0) {
    return true;
  }

  const speciesRepresentation = input.structuredTargets?.speciesRepresentation ?? [];
  if (
    speciesRepresentation.some((target) => {
      const [primaryAlias] = normalizeLayerIdAliases(target.featureId);
      return primaryAlias !== 'species';
    })
  ) {
    return true;
  }

  return input.targetFeatureIds.some((rawId) => {
    const [primaryAlias] = normalizeLayerIdAliases(rawId);
    return !AGGREGATE_SCENARIO_TARGET_IDS.has(primaryAlias);
  });
}

export function individualSpeciesCollectionScenarioStatus(
  input: IndividualSpeciesScenarioTargetInput,
  hasStatus: boolean,
): ScenarioLayerStatus | null {
  if (!hasStatus) {
    return null;
  }

  return hasIndividualSpeciesScenarioTargets(input) ? 'considered' : 'reference';
}

export function isScenarioConsiderableLayer(
  rowId: string,
  manifestOverlayLayerId: string | undefined,
): boolean {
  const aliases = [
    ...normalizeLayerIdAliases(rowId),
    ...normalizeLayerIdAliases(manifestOverlayLayerId),
  ];
  return aliases.some((id) => SCENARIO_CONSIDERABLE_LAYER_IDS.has(id));
}

export function scenarioLayerStatus(
  rowId: string,
  manifestOverlayLayerId: string | undefined,
  consideredIds: ReadonlySet<string>,
  hasStatus: boolean,
): ScenarioLayerStatus | null {
  if (!hasStatus || !isScenarioConsiderableLayer(rowId, manifestOverlayLayerId)) {
    return null;
  }

  const aliases = [
    ...normalizeLayerIdAliases(rowId),
    ...normalizeLayerIdAliases(manifestOverlayLayerId),
  ];
  const isNationalNaturalParksRow = aliases.includes('runap_national_parks');
  if (isNationalNaturalParksRow && consideredIds.has('runap')) {
    return 'considered';
  }

  return aliases.some((id) => consideredIds.has(id)) ? 'considered' : 'reference';
}

export function layerPlanningDomain(rowId: string, groupId: string): LayerPlanningDomain {
  if (groupId === 'group-admin-boundaries') {
    return 'context';
  }
  return MARINE_LAYER_ROW_IDS.has(rowId) ? 'marine' : 'land';
}

export function isLayerAvailableForScope(
  rowId: string,
  groupId: string,
  scope: LayerCatalogScope,
): boolean {
  if (scope === 'both') {
    return true;
  }
  const layerDomain = layerPlanningDomain(rowId, groupId);
  return layerDomain === 'context' || layerDomain === 'shared' || layerDomain === scope;
}

export function shouldIncludeInMasterLegend(mapSync: MapSyncDescriptor | undefined): boolean {
  if (mapSync?.type !== 'admin-boundary') {
    return true;
  }
  return !MASTER_LEGEND_EXCLUDED_ADMIN_BOUNDARY_LAYER_KEYS.has(mapSync.boundaryLayerKey);
}

export function buildLegendLayerEntry(input: LegendLayerInput): LegendLayerEntry {
  if (input.boundaryStyle) {
    return {
      id: input.id,
      name: input.name,
      swatchType: 'line',
      color: input.borderColor ?? input.color ?? input.boundaryStyle.color,
      lineStyle: input.borderStyle === 'solid' ? 'solid' : 'dashed',
      lineWidth:
        input.borderStyle === 'none' ? 0 : (input.borderWidth ?? input.boundaryStyle.lineWidth),
    };
  }

  if (input.rendering?.valueType === 'continuous' && input.rendering.renderMode === 'gradient') {
    return {
      id: input.id,
      name: input.name,
      swatchType: 'gradient',
      color: input.color,
      lineStyle: 'solid',
      lineWidth: 1,
      gradientStartColor: input.rendering.startColor ?? '#dbeafe',
      gradientEndColor: input.rendering.endColor ?? input.color ?? '#7f1d1d',
      gradientMinLabel: formatLegendValue(input.rendering.minValue),
      gradientMaxLabel: formatLegendValue(input.rendering.maxValue),
    };
  }

  const categories =
    input.rendering?.renderMode === 'categorical'
      ? buildLegendCategories(input.id, input.rendering, input.language ?? 'en')
      : [];
  if (categories.length > 0) {
    return {
      id: input.id,
      name: input.name,
      swatchType: 'fill',
      color: categories[0]?.color ?? input.color ?? '#64748b',
      lineStyle: 'solid',
      lineWidth: 1,
      categories: input.denseCategorySummary ? undefined : categories,
      denseCategorySummary: input.denseCategorySummary,
    };
  }

  return {
    id: input.id,
    name: input.name,
    swatchType: 'fill',
    color: input.color || '#64748b',
    lineStyle: 'solid',
    lineWidth: 1,
  };
}

export function buildLegendCategories(
  rowId: string,
  rendering: RuntimeLayerManifestRenderingConfig,
  language: SupportedLanguage,
): NonNullable<LegendLayerEntry['categories']> {
  const categoryByLabel = new Map<string, { id: string; label: string; color: string }>();
  for (const entry of rendering.classColors ?? []) {
    const localizedLabel = language === 'es' ? entry.spanishLabel : entry.englishLabel;
    const label = localizedLabel?.trim() || entry.label?.trim() || `Category ${entry.value}`;
    if (!categoryByLabel.has(label)) {
      categoryByLabel.set(label, {
        id: `${rowId}-class-${toSlug(label)}`,
        label,
        color: entry.color,
      });
    }
  }
  return [...categoryByLabel.values()];
}

function formatLegendValue(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
