import type {
  ManifestSidebarLayerGroup,
  ManifestSidebarLayerRow,
  RuntimeLayerManifestRenderingConfig,
} from '@core/models';
import type { AdminBoundaryLayerKey } from '@features/map/services/admin-boundary.service';
import {
  OMEC_OVERLAY_LAYER_ID,
  RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
  RUNAP_OVERLAY_LAYER_ID,
} from '@features/map/services/manifest-raster-layer.service';
import {
  BASELINE_SOLUTION_OVERLAY_ID,
  CANDIDATE_SOLUTION_OVERLAY_ID,
  DEFAULT_DATA_LAYER_OPACITY,
  MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE,
  MANIFEST_ADMIN_BOUNDARY_LAYER_TO_SYNC,
  MANIFEST_OVERLAY_ROW_BY_LAYER_ID,
  OVERLAP_SOLUTION_OVERLAY_ID,
  SIDEBAR_MANIFEST_CATEGORY_BINDINGS,
  SPECIES_RICHNESS_LAYER_IDS,
  SPECIES_RICHNESS_TAXON_LAYER_DEFINITIONS,
  SPECIES_RICHNESS_TOTAL_ROW_ID,
  STRATEGIC_ECOSYSTEM_GROUP_ROW_ID,
  STRATEGIC_ECOSYSTEM_ROW_IDS,
  type SelectedLayerBorderStyle,
  type SelectedLayerFillStyle,
  type SpeciesRichnessTaxonLayerDefinition,
} from './map-layers-panel.config';
import type { MapSyncDescriptor } from './map-layers-panel-map-sync';
import { groupParentChildRows } from './map-layers-panel.utils';

export interface LayerControlRow {
  id: string;
  name: string;
  countLabel?: string;
  parentId?: string;
  selected: boolean;
  visible: boolean;
  expanded: boolean;
  opacity: number;
  color: string;
  fillStyle?: SelectedLayerFillStyle;
  fillDensity?: number;
  borderColor?: string;
  borderStyle?: SelectedLayerBorderStyle;
  borderWidth?: number;
  canReorder: boolean;
  hasStyleControls: boolean;
  hasColorControl: boolean;
  disabled?: boolean;
  mapUnavailable?: boolean;
  hideAddButton?: boolean;
  metadataUrl?: string | null;
  mapSync?: MapSyncDescriptor;
}

export interface LayerGroup {
  id: string;
  title: string;
  countLabel?: string;
  collapsed: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
  note?: string;
  rows: LayerControlRow[];
}

export interface ManifestReconcilePorts {
  manifestRowName(row: ManifestSidebarLayerRow): string;
  manifestGroupTitle(group: ManifestSidebarLayerGroup): string;
  manifestCategoryTitle(categoryId: string): string | undefined;
  normalizeManifestRendering(row: ManifestSidebarLayerRow): RuntimeLayerManifestRenderingConfig;
  layerCountLabel(count: number): string;
  individualSpeciesName(): string;
  speciesRichnessTaxonName(definition: SpeciesRichnessTaxonLayerDefinition): string;
  strategicEcosystemGroupName(): string;
  ecosystemGroupNote(): string;
  managementFiguresTitle(): string;
}

export interface ManifestReconcileInput {
  manifestGroups: readonly ManifestSidebarLayerGroup[];
  groups: readonly LayerGroup[];
  overlays: readonly LayerControlRow[];
  ports: ManifestReconcilePorts;
}

export interface ManifestReconcileResult {
  groups: LayerGroup[];
  overlays: LayerControlRow[];
  managementFiguresTitle: string | null;
}

const BINDING_BY_GROUP_ID = new Map<string, (typeof SIDEBAR_MANIFEST_CATEGORY_BINDINGS)[number]>(
  SIDEBAR_MANIFEST_CATEGORY_BINDINGS.map((binding) => [binding.sidebarGroupId, binding]),
);
const BINDING_BY_MANIFEST_ID = new Map<string, (typeof SIDEBAR_MANIFEST_CATEGORY_BINDINGS)[number]>(
  SIDEBAR_MANIFEST_CATEGORY_BINDINGS.map((binding) => [binding.manifestCategoryId, binding]),
);

export function reconcileMapLayersManifest({
  manifestGroups,
  groups,
  overlays,
  ports,
}: ManifestReconcileInput): ManifestReconcileResult {
  const reconciledGroups = reconcileGenericGroups(manifestGroups, groups, ports);
  const adminResult = reconcileAdminBoundaries(manifestGroups, reconciledGroups, ports);
  const overlayResult = reconcileOverlays(manifestGroups, overlays);

  return {
    groups: adminResult,
    overlays: overlayResult.rows,
    managementFiguresTitle: overlayResult.hasManifestGroup ? ports.managementFiguresTitle() : null,
  };
}

function reconcileGenericGroups(
  manifestGroups: readonly ManifestSidebarLayerGroup[],
  groups: readonly LayerGroup[],
  ports: ManifestReconcilePorts,
): LayerGroup[] {
  const manifestGroupsById = new Map(
    manifestGroups.map((group) => [group.sidebarCategoryId, group]),
  );

  return groups.map((group) => {
    const binding = BINDING_BY_GROUP_ID.get(group.id);
    if (!binding || binding.rowSource !== 'generic-manifest') {
      return group;
    }

    const manifestGroup = manifestGroupsById.get(binding.manifestCategoryId);
    if (!manifestGroup) {
      return group;
    }

    const manifestRows = manifestGroup.rows.map((row, index) =>
      buildManifestRow(group.id, row, index, group.rows, ports),
    );
    const rows =
      group.id === 'group-species-biodiversity'
        ? groupSpeciesRichnessRows(manifestRows, group.rows, ports)
        : group.id === 'group-ecosystems'
          ? groupStrategicEcosystemRows(manifestRows, group.rows, ports)
          : manifestRows;

    return {
      ...group,
      title:
        ports.manifestCategoryTitle(binding.manifestCategoryId) ??
        ports.manifestGroupTitle(manifestGroup),
      countLabel: ports.layerCountLabel(rows.filter((row) => !row.hideAddButton).length),
      note: group.id === 'group-ecosystems' ? ports.ecosystemGroupNote() : group.note,
      rows,
    };
  });
}

function buildManifestRow(
  sidebarGroupId: string,
  manifestRow: ManifestSidebarLayerRow,
  index: number,
  existingRows: readonly LayerControlRow[],
  ports: ManifestReconcilePorts,
): LayerControlRow {
  const layerId = `layer-${manifestRow.id}`;
  const existingRow = existingRows.find((row) => row.id === layerId);

  if (sidebarGroupId === 'group-species-biodiversity' && manifestRow.isSpeciesCollection) {
    return {
      id: layerId,
      name: ports.individualSpeciesName(),
      selected: false,
      visible: false,
      expanded: existingRow?.expanded ?? false,
      opacity: DEFAULT_DATA_LAYER_OPACITY,
      color: '#854d0e',
      canReorder: false,
      hasStyleControls: false,
      hasColorControl: false,
      mapUnavailable: true,
      hideAddButton: true,
    };
  }

  const isLiveRenderable = isManifestRowLiveRenderable(manifestRow);
  const rendering = ports.normalizeManifestRendering(manifestRow);
  const existingSelected = existingRow?.selected ?? false;

  return {
    id: layerId,
    name: ports.manifestRowName(manifestRow),
    parentId: STRATEGIC_ECOSYSTEM_ROW_IDS.has(layerId)
      ? STRATEGIC_ECOSYSTEM_GROUP_ROW_ID
      : undefined,
    selected: existingSelected,
    visible: existingSelected && !isLiveRenderable ? false : (existingRow?.visible ?? false),
    expanded: existingRow?.expanded ?? false,
    opacity: existingRow?.opacity ?? DEFAULT_DATA_LAYER_OPACITY,
    color:
      colorFromManifestRendering(rendering) ??
      existingRow?.color ??
      manifestRowFallbackColor(sidebarGroupId, index),
    canReorder: true,
    hasStyleControls: true,
    hasColorControl: rendering.renderMode !== 'categorical',
    mapUnavailable: !isLiveRenderable,
    metadataUrl: manifestRow.metadataUrl,
    mapSync:
      isLiveRenderable && manifestRow.displayUrl
        ? {
            type: 'manifest-raster',
            layerId,
            displayUrl: manifestRow.displayUrl,
            rendering,
          }
        : undefined,
  };
}

function groupSpeciesRichnessRows(
  rows: LayerControlRow[],
  existingRows: readonly LayerControlRow[],
  ports: ManifestReconcilePorts,
): LayerControlRow[] {
  const totalRichnessRow = rows
    .filter((row) => SPECIES_RICHNESS_LAYER_IDS.has(row.id))
    .find((row) => row.id === SPECIES_RICHNESS_TOTAL_ROW_ID);
  if (!totalRichnessRow) {
    return rows;
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const taxonRows = SPECIES_RICHNESS_TAXON_LAYER_DEFINITIONS.map(
    (definition) =>
      rowsById.get(definition.rowId) ??
      buildSpeciesRichnessTaxonRow(definition, existingRows, ports),
  );
  if (taxonRows.length === 0) {
    return rows;
  }

  const existingParent = existingRows.find((row) => row.id === SPECIES_RICHNESS_TOTAL_ROW_ID);
  return groupParentChildRows(
    rows,
    {
      ...totalRichnessRow,
      parentId: undefined,
      expanded: existingParent?.expanded ?? true,
    },
    taxonRows,
  );
}

function buildSpeciesRichnessTaxonRow(
  definition: SpeciesRichnessTaxonLayerDefinition,
  existingRows: readonly LayerControlRow[],
  ports: ManifestReconcilePorts,
): LayerControlRow {
  const existingRow = existingRows.find((row) => row.id === definition.rowId);
  const selected = existingRow?.selected ?? false;
  return {
    id: definition.rowId,
    name: ports.speciesRichnessTaxonName(definition),
    selected,
    visible: selected ? true : (existingRow?.visible ?? false),
    expanded: existingRow?.expanded ?? false,
    opacity: existingRow?.opacity ?? DEFAULT_DATA_LAYER_OPACITY,
    color: existingRow?.color ?? colorFromManifestRendering(definition.rendering) ?? '#854d0e',
    canReorder: true,
    hasStyleControls: true,
    hasColorControl: true,
    mapUnavailable: false,
    mapSync: {
      type: 'manifest-raster',
      layerId: definition.rowId,
      displayUrl: definition.displayUrl,
      rendering: definition.rendering,
    },
  };
}

function groupStrategicEcosystemRows(
  rows: LayerControlRow[],
  existingRows: readonly LayerControlRow[],
  ports: ManifestReconcilePorts,
): LayerControlRow[] {
  const strategicRows = rows.filter((row) => STRATEGIC_ECOSYSTEM_ROW_IDS.has(row.id));
  if (strategicRows.length <= 1) {
    return rows;
  }

  const existingParent = existingRows.find((row) => row.id === STRATEGIC_ECOSYSTEM_GROUP_ROW_ID);
  return groupParentChildRows(
    rows,
    {
      id: STRATEGIC_ECOSYSTEM_GROUP_ROW_ID,
      name: ports.strategicEcosystemGroupName(),
      countLabel: ports.layerCountLabel(strategicRows.length),
      selected: false,
      visible: false,
      expanded: existingParent?.expanded ?? true,
      opacity: DEFAULT_DATA_LAYER_OPACITY,
      color: '#15803d',
      canReorder: false,
      hasStyleControls: false,
      hasColorControl: false,
      mapUnavailable: true,
      hideAddButton: true,
    },
    strategicRows,
  );
}

function reconcileOverlays(
  manifestGroups: readonly ManifestSidebarLayerGroup[],
  overlays: readonly LayerControlRow[],
): { rows: LayerControlRow[]; hasManifestGroup: boolean } {
  const managementGroup = manifestGroups.find(
    (group) => group.sidebarCategoryId === 'management_figures',
  );
  if (!managementGroup) {
    return { rows: [...overlays], hasManifestGroup: false };
  }

  const rowById = new Map(overlays.map((row) => [row.id, row]));
  const nationalParksRow = rowById.get(RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID);
  const manifestHasNationalParksRow = managementGroup.rows.some(
    (row) => MANIFEST_OVERLAY_ROW_BY_LAYER_ID[row.id] === RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
  );
  const reconciledManagementRows: LayerControlRow[] = [];

  for (const manifestRow of managementGroup.rows) {
    const overlayId = MANIFEST_OVERLAY_ROW_BY_LAYER_ID[manifestRow.id];
    const existingOverlay = overlayId ? rowById.get(overlayId) : undefined;
    if (!existingOverlay) {
      continue;
    }
    reconciledManagementRows.push(applyManifestToManagementOverlay(existingOverlay, manifestRow));
    if (overlayId === RUNAP_OVERLAY_LAYER_ID && nationalParksRow && !manifestHasNationalParksRow) {
      reconciledManagementRows.push(nationalParksRow);
    }
  }

  if (
    nationalParksRow &&
    !reconciledManagementRows.some((row) => row.id === RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID)
  ) {
    reconciledManagementRows.push(nationalParksRow);
  }

  const preservedIds = [
    BASELINE_SOLUTION_OVERLAY_ID,
    CANDIDATE_SOLUTION_OVERLAY_ID,
    OVERLAP_SOLUTION_OVERLAY_ID,
  ];
  return {
    rows: [
      ...preservedIds.flatMap((id) => {
        const row = rowById.get(id);
        return row ? [row] : [];
      }),
      ...reconciledManagementRows,
    ],
    hasManifestGroup: true,
  };
}

function applyManifestToManagementOverlay(
  existingOverlay: LayerControlRow,
  manifestRow: ManifestSidebarLayerRow,
): LayerControlRow {
  const isRenderable =
    isManifestRenderingSupported(manifestRow.rendering) &&
    typeof manifestRow.displayUrl === 'string' &&
    manifestRow.displayUrl.length > 0;
  if (!isRenderable || !manifestRow.displayUrl) {
    return {
      ...existingOverlay,
      name: manifestRow.name,
      mapUnavailable: true,
      mapSync: undefined,
    };
  }

  const rendering =
    manifestRow.rendering.renderMode === 'mask'
      ? { ...manifestRow.rendering, selectedValue: null }
      : manifestRow.rendering;
  const defaultAppearance = MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[existingOverlay.id];
  const manifestColor = colorFromManifestRendering(rendering);
  const color = defaultAppearance?.color ?? manifestColor ?? existingOverlay.color;
  const name =
    existingOverlay.id === OMEC_OVERLAY_LAYER_ID
      ? manifestRow.name.replace(/\s*\(raster\)\s*/i, '').trim() || 'OMECs'
      : manifestRow.name;

  return {
    ...existingOverlay,
    name,
    color,
    fillStyle: defaultAppearance?.fillStyle ?? existingOverlay.fillStyle,
    fillDensity: defaultAppearance?.fillDensity ?? existingOverlay.fillDensity,
    borderColor: defaultAppearance?.borderColor ?? existingOverlay.borderColor ?? color,
    borderWidth: defaultAppearance?.borderWidth ?? existingOverlay.borderWidth,
    expanded: false,
    hasStyleControls: true,
    mapUnavailable: false,
    metadataUrl: manifestRow.metadataUrl,
    mapSync: {
      type: 'manifest-raster',
      layerId: existingOverlay.id,
      displayUrl: manifestRow.displayUrl,
      rendering,
    },
  };
}

function reconcileAdminBoundaries(
  manifestGroups: readonly ManifestSidebarLayerGroup[],
  groups: readonly LayerGroup[],
  ports: ManifestReconcilePorts,
): LayerGroup[] {
  const binding = BINDING_BY_GROUP_ID.get('group-admin-boundaries');
  const adminGroup = binding
    ? manifestGroups.find((group) => group.sidebarCategoryId === binding.manifestCategoryId)
    : undefined;
  if (!adminGroup) {
    return [...groups];
  }

  return groups.map((group) => {
    if (group.id !== 'group-admin-boundaries') {
      return group;
    }

    const existingRowsByBoundaryKey = new Map<AdminBoundaryLayerKey, LayerControlRow>();
    for (const row of group.rows) {
      if (row.mapSync?.type === 'admin-boundary') {
        existingRowsByBoundaryKey.set(row.mapSync.boundaryLayerKey, row);
      }
    }

    const rows = adminGroup.rows.flatMap((manifestRow) => {
      const boundarySync = MANIFEST_ADMIN_BOUNDARY_LAYER_TO_SYNC[manifestRow.id];
      const existingRow = boundarySync
        ? existingRowsByBoundaryKey.get(boundarySync.boundaryLayerKey)
        : undefined;
      return existingRow
        ? [
            {
              ...existingRow,
              name: ports.manifestRowName(manifestRow),
              color: colorFromManifestRendering(manifestRow.rendering) ?? existingRow.color,
            },
          ]
        : [];
    });
    const manifestBoundaryKeys = new Set(
      rows.flatMap((row) =>
        row.mapSync?.type === 'admin-boundary' ? [row.mapSync.boundaryLayerKey] : [],
      ),
    );
    const preservedRows = group.rows.filter(
      (row) =>
        row.mapSync?.type === 'admin-boundary' &&
        row.mapSync.boundaryLayerKey === 'admin_country_outline' &&
        !manifestBoundaryKeys.has(row.mapSync.boundaryLayerKey),
    );
    const reconciledRows = [...preservedRows, ...rows];
    return reconciledRows.length === 0
      ? group
      : {
          ...group,
          title: adminGroup.title,
          countLabel: ports.layerCountLabel(reconciledRows.length),
          rows: reconciledRows,
        };
  });
}

function manifestRowFallbackColor(sidebarGroupId: string, index: number): string {
  const palette = BINDING_BY_GROUP_ID.get(sidebarGroupId)?.palette;
  if (!palette || palette.colors.length === 0) {
    return palette?.fallbackColor ?? '#475569';
  }
  return palette.colors[index % palette.colors.length] ?? palette.fallbackColor;
}

function isManifestRowLiveRenderable(row: ManifestSidebarLayerRow): boolean {
  return (
    !row.isSpeciesCollection &&
    BINDING_BY_MANIFEST_ID.get(row.sidebarCategoryId)?.supportsLiveRendering === true &&
    isManifestRenderingSupported(row.rendering) &&
    typeof row.displayUrl === 'string' &&
    row.displayUrl.length > 0
  );
}

export function isManifestRenderingSupported(
  rendering: RuntimeLayerManifestRenderingConfig | null | undefined,
): boolean {
  if (!rendering) {
    return false;
  }
  return rendering.renderMode === 'categorical'
    ? Array.isArray(rendering.classColors) && rendering.classColors.length > 0
    : rendering.renderMode === 'mask' || rendering.renderMode === 'gradient';
}

export function colorFromManifestRendering(
  rendering: RuntimeLayerManifestRenderingConfig,
): string | null {
  if (rendering.renderMode === 'mask') {
    return rendering.selectedColor ?? null;
  }
  if (rendering.renderMode === 'gradient') {
    return rendering.endColor ?? rendering.startColor ?? null;
  }
  return rendering.classColors?.[0]?.color ?? null;
}
