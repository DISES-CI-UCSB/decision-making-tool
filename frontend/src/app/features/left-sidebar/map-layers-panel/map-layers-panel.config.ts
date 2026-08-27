import type { AoiType, RuntimeLayerManifestRenderingConfig } from '@core/models';
import { FEATURE_FLAGS } from '@feature-flags';
import type { AdminBoundaryLayerKey } from '@features/map/services/admin-boundary.service';
import {
  OMEC_OVERLAY_LAYER_ID,
  RUNAP_OVERLAY_LAYER_ID,
  RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
} from '@features/map/services/manifest-raster-layer.service';
import {
  DEFAULT_COMPARISON_BASELINE_HEX,
  DEFAULT_COMPARISON_CANDIDATE_HEX,
  DEFAULT_COMPARISON_OVERLAP_HEX,
  DEFAULT_EXISTING_PROTECTED_HEX,
  DEFAULT_SOLUTION_LAYER_OPACITY,
  DEFAULT_SINGLE_SOLUTION_HEX,
} from '@features/map/utils/solution-rendering.utils';

export type SelectedLayerFillStyle = 'solid' | 'hatch' | 'mesh' | 'dots';
export type SelectedLayerBorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';

export interface SpeciesRichnessTaxonLayerDefinition {
  rowId: string;
  taxonId: string;
  englishLabel: string;
  displayUrl: string;
  rendering: RuntimeLayerManifestRenderingConfig;
}

export interface SidebarManifestCategoryBinding {
  sidebarGroupId: string;
  manifestCategoryId: string;
  rowSource: 'generic-manifest' | 'dedicated-service';
  supportsLiveRendering: boolean;
  defaultCollapsed: boolean;
  defaultComingSoon: boolean;
  palette: {
    colors: readonly string[];
    fallbackColor: string;
  };
}

interface ManagementOverlayAppearance {
  color?: string;
  fillStyle?: SelectedLayerFillStyle;
  fillDensity?: number;
  borderColor?: string;
  borderWidth?: number;
}

export const SPECIES_VISIBLE_LIMIT = 6;
export const DEFAULT_SELECTED_LAYER_FILL_STYLE: SelectedLayerFillStyle = 'solid';
export const DEFAULT_SELECTED_LAYER_FILL_DENSITY = 3;
export const DEFAULT_SELECTED_LAYER_BORDER_COLOR = '#0f172a';
export const DEFAULT_SELECTED_LAYER_BORDER_STYLE: SelectedLayerBorderStyle = 'solid';
export const DEFAULT_SELECTED_LAYER_BORDER_WIDTH = 1;

/** Mirrors `top-[5.25rem]` on the in-row appearance popover anchor. */
export const APPEARANCE_POPOVER_TOP_OFFSET_PX = 84;
/** Mirrors `left-25` horizontal offset from the selected-layer row's left edge. */
export const APPEARANCE_POPOVER_LEFT_OFFSET_PX = 100;
/** Mirrors `right-16` on the popover arrow element. */
export const APPEARANCE_POPOVER_ARROW_RIGHT_PX = 158;
export const APPEARANCE_POPOVER_MAX_WIDTH_PX = 336;

export const COLOR_PICKER_HEX_FORMAT = 0;
/** Formats exposed in the inlined dropdown; values match ngx-color-picker's `format` field. */
export const COLOR_PICKER_FORMAT_OPTIONS = [
  { format: 0, label: 'Hex' },
  { format: 1, label: 'RGB' },
  { format: 2, label: 'HSL' },
] as const;
/** Class names of the per-format input containers ngx-color-picker renders into the dialog. */
export const COLOR_PICKER_FORMAT_CONTAINER_CLASSES = [
  'hex-text',
  'rgba-text',
  'hsla-text',
] as const;

export const BASELINE_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution';
export const CANDIDATE_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution-candidate';
export const OVERLAP_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution-overlap';
export const DEFAULT_SPECIES_MANIFEST_URL = '/data/layer-manifest/species.manifest.json';
export const SPECIES_COLLECTION_ROW_ID = 'layer-species';
export const SPECIES_RICHNESS_TOTAL_ROW_ID = 'layer-species_richness';
export const STRATEGIC_ECOSYSTEM_GROUP_ROW_ID = 'layer-strategic-ecosystems';
export const MARINE_ECOSYSTEMS_GROUP_ID = 'group-marine-ecosystems';
export const MARINE_ECOSYSTEMS_LAYER_ID = 'layer-marine_ecosystems';
export const MARINE_HHM_LAYER_ID = 'layer-hhm';
export const STRATEGIC_ECOSYSTEM_ROW_IDS = new Set([
  'layer-paramos',
  'layer-wetlands',
  'layer-bosque_seco',
  'layer-mangroves',
  'layer-eco-paramos',
  'layer-eco-wetlands',
  'layer-eco-dry-forest',
  'layer-eco-mangroves',
]);
export const SPECIES_RICHNESS_LAYER_IDS = new Set([
  SPECIES_RICHNESS_TOTAL_ROW_ID,
  'layer-species_richness_mammals',
  'layer-species_richness_birds',
  'layer-species_richness_amphibians',
  'layer-species_richness_reptiles',
  'layer-species_richness_plants',
]);

export const SIDEBAR_MANIFEST_CATEGORY_BINDINGS = [
  {
    sidebarGroupId: 'group-admin-boundaries',
    manifestCategoryId: 'administrative_boundaries',
    rowSource: 'dedicated-service',
    supportsLiveRendering: false,
    defaultCollapsed: false,
    defaultComingSoon: false,
    palette: { colors: [], fallbackColor: '#475569' },
  },
  {
    sidebarGroupId: 'group-species-biodiversity',
    manifestCategoryId: 'species_and_biodiversity',
    rowSource: 'generic-manifest',
    supportsLiveRendering: true,
    defaultCollapsed: true,
    defaultComingSoon: false,
    palette: { colors: [], fallbackColor: '#475569' },
  },
  {
    sidebarGroupId: 'group-ecosystems',
    manifestCategoryId: 'ecosystems',
    rowSource: 'generic-manifest',
    supportsLiveRendering: true,
    defaultCollapsed: true,
    defaultComingSoon: false,
    palette: {
      colors: ['#0d9488', '#6d8e7e', '#0284c7', '#a16207', '#15803d'],
      fallbackColor: '#475569',
    },
  },
  {
    sidebarGroupId: 'group-cultural-ethnic',
    manifestCategoryId: 'cultural_and_ethnic_territories',
    rowSource: 'generic-manifest',
    supportsLiveRendering: true,
    defaultCollapsed: true,
    defaultComingSoon: false,
    palette: { colors: ['#6366f1', '#a855f7'], fallbackColor: '#475569' },
  },
  {
    sidebarGroupId: 'group-socio-economic',
    manifestCategoryId: 'socioeconomic',
    rowSource: 'generic-manifest',
    supportsLiveRendering: true,
    defaultCollapsed: true,
    defaultComingSoon: false,
    palette: { colors: ['#d97706', '#ea580c', '#78716c'], fallbackColor: '#475569' },
  },
] as const satisfies readonly SidebarManifestCategoryBinding[];

const SIDEBAR_CATEGORY_BY_GROUP_ID = new Map<string, SidebarManifestCategoryBinding>(
  SIDEBAR_MANIFEST_CATEGORY_BINDINGS.map((binding) => [binding.sidebarGroupId, binding]),
);
const SIDEBAR_CATEGORY_BY_MANIFEST_ID = new Map<string, SidebarManifestCategoryBinding>(
  SIDEBAR_MANIFEST_CATEGORY_BINDINGS.map((binding) => [binding.manifestCategoryId, binding]),
);

export function sidebarCategoryBindingForGroup(
  sidebarGroupId: string,
): SidebarManifestCategoryBinding | undefined {
  return SIDEBAR_CATEGORY_BY_GROUP_ID.get(sidebarGroupId);
}

export function sidebarCategoryBindingForManifest(
  manifestCategoryId: string,
): SidebarManifestCategoryBinding | undefined {
  return SIDEBAR_CATEGORY_BY_MANIFEST_ID.get(manifestCategoryId);
}

export const MANIFEST_CATEGORY_TITLE_OVERRIDES: Partial<
  Record<string, { en: string; es: string }>
> = {
  socioeconomic: { en: 'Costs', es: 'Costos' },
};
export const SPECIES_CLASS_TO_TAXON: Record<string, { taxonId: string; taxonLabel: string }> = {
  Mammalia: { taxonId: 'mammals', taxonLabel: 'Mammals' },
  Aves: { taxonId: 'birds', taxonLabel: 'Birds' },
  Amphibia: { taxonId: 'amphibians', taxonLabel: 'Amphibians' },
  Squamata: { taxonId: 'reptiles', taxonLabel: 'Reptiles' },
  Crocodylia: { taxonId: 'reptiles', taxonLabel: 'Reptiles' },
  Magnoliopsida: { taxonId: 'plants', taxonLabel: 'Plants' },
  Actinopteri: { taxonId: 'fish', taxonLabel: 'Fish' },
};
export const SPECIES_TAXON_SORT_ORDER = new Map<string, number>([
  ['taxon-mammals', 0],
  ['taxon-birds', 1],
  ['taxon-amphibians', 2],
  ['taxon-reptiles', 3],
  ['taxon-plants', 4],
  ['taxon-fish', 5],
]);
export const EXCLUDED_SPECIES_TAXON_IDS = new Set(['taxon-fish']);
export const FISH_TAXON_ROW_ID = 'taxon-fish';

export const MANIFEST_OVERLAY_ROW_BY_LAYER_ID: Record<string, string> = {
  runap: RUNAP_OVERLAY_LAYER_ID,
  runap_national_parks: RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
  omecs: OMEC_OVERLAY_LAYER_ID,
};
export const MANIFEST_LAYER_ID_BY_OVERLAY_ROW_ID = Object.fromEntries(
  Object.entries(MANIFEST_OVERLAY_ROW_BY_LAYER_ID).map(([layerId, rowId]) => [rowId, layerId]),
) as Record<string, string>;
export const MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE: Partial<
  Record<string, ManagementOverlayAppearance>
> = {
  [RUNAP_OVERLAY_LAYER_ID]: {
    color: '#f97316',
    fillStyle: 'solid',
    borderColor: '#c2410c',
    borderWidth: 1,
  },
  [RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID]: {
    color: '#dc2626',
    fillStyle: 'solid',
    borderColor: '#991b1b',
    borderWidth: 1,
  },
  [OMEC_OVERLAY_LAYER_ID]: {
    color: '#c026d3',
    fillStyle: 'hatch',
    fillDensity: 4,
    borderColor: '#86198f',
    borderWidth: 1,
  },
};

export const MANIFEST_ADMIN_BOUNDARY_LAYER_TO_SYNC: Record<
  string,
  { boundaryType: AoiType; boundaryLayerKey: AdminBoundaryLayerKey }
> = {
  siraps: { boundaryType: 'sirap', boundaryLayerKey: 'siraps' },
  siraps_territorial: { boundaryType: 'sirap', boundaryLayerKey: 'siraps_territorial' },
  siraps_territorial_updated: {
    boundaryType: 'sirap',
    boundaryLayerKey: 'siraps_territorial_updated',
  },
  siraps_thematic: { boundaryType: 'sirap', boundaryLayerKey: 'siraps_thematic' },
  admin_country_outline: {
    boundaryType: 'department',
    boundaryLayerKey: 'admin_country_outline',
  },
  admin_departments: { boundaryType: 'department', boundaryLayerKey: 'admin_departments' },
  admin_municipalities: { boundaryType: 'municipality', boundaryLayerKey: 'admin_municipalities' },
};

export function isAdminBoundaryLayerEnabled(layerKey: AdminBoundaryLayerKey): boolean {
  switch (layerKey) {
    case 'siraps':
      return FEATURE_FLAGS.sirapLayers.combined;
    case 'siraps_territorial':
      return FEATURE_FLAGS.sirapLayers.territorial;
    case 'siraps_territorial_updated':
      return FEATURE_FLAGS.sirapLayers.territorialUpdated;
    case 'siraps_thematic':
      return FEATURE_FLAGS.sirapLayers.thematic;
    default:
      return true;
  }
}

export type SirapBoundaryLayerKey =
  | 'siraps'
  | 'siraps_territorial'
  | 'siraps_territorial_updated'
  | 'siraps_thematic';

export function enabledSirapBoundaryLayerKeys(): SirapBoundaryLayerKey[] {
  return (
    ['siraps', 'siraps_territorial', 'siraps_territorial_updated', 'siraps_thematic'] as const
  ).filter(isAdminBoundaryLayerEnabled);
}

export const COMPARISON_PRIORITY_OVERLAY_IDS = [
  OVERLAP_SOLUTION_OVERLAY_ID,
  BASELINE_SOLUTION_OVERLAY_ID,
  CANDIDATE_SOLUTION_OVERLAY_ID,
] as const;

const SPECIES_RICHNESS_RENDER_RANGE = {
  minValue: 815,
  maxValue: 3562,
} as const;
export const SPECIES_RICHNESS_TAXON_LAYER_DEFINITIONS: SpeciesRichnessTaxonLayerDefinition[] = [
  {
    rowId: 'layer-species_richness_mammals',
    taxonId: 'mammals',
    englishLabel: 'Mammals',
    displayUrl:
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/species_richness/riqueza_especies_mammals.tif',
    rendering: {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: 65535,
      minValue: 1,
      maxValue: 142,
      startColor: '#f3e8ff',
      endColor: '#7e22ce',
    },
  },
  {
    rowId: 'layer-species_richness_birds',
    taxonId: 'birds',
    englishLabel: 'Birds',
    displayUrl:
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/species_richness/riqueza_especies_birds.tif',
    rendering: {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: 65535,
      minValue: 1,
      maxValue: 823,
      startColor: '#dbeafe',
      endColor: '#1d4ed8',
    },
  },
  {
    rowId: 'layer-species_richness_amphibians',
    taxonId: 'amphibians',
    englishLabel: 'Amphibians',
    displayUrl:
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/species_richness/riqueza_especies_amphibians.tif',
    rendering: {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: 65535,
      minValue: 1,
      maxValue: 56,
      startColor: '#dcfce7',
      endColor: '#15803d',
    },
  },
  {
    rowId: 'layer-species_richness_reptiles',
    taxonId: 'reptiles',
    englishLabel: 'Reptiles',
    displayUrl:
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/species_richness/riqueza_especies_reptiles.tif',
    rendering: {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: 65535,
      minValue: 1,
      maxValue: 68,
      startColor: '#ffedd5',
      endColor: '#c2410c',
    },
  },
  {
    rowId: 'layer-species_richness_plants',
    taxonId: 'plants',
    englishLabel: 'Plants',
    displayUrl:
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/species_richness/riqueza_especies_plants.tif',
    rendering: {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: 65535,
      minValue: 1,
      maxValue: 2884,
      startColor: '#ccfbf1',
      endColor: '#0f766e',
    },
  },
];
export const SPECIES_RICHNESS_LAYER_ID_BY_TAXON_ROW_ID = new Map(
  SPECIES_RICHNESS_TAXON_LAYER_DEFINITIONS.map((definition) => [
    `taxon-${definition.taxonId}`,
    definition.rowId,
  ]),
);

const HUMAN_FOOTPRINT_RENDER_RANGE = {
  minValue: 0,
  maxValue: 100,
} as const;
export const DEFAULT_DATA_LAYER_OPACITY = 80;
export const DEFAULT_SOLUTION_LAYER_OPACITY_PERCENT = Math.round(
  DEFAULT_SOLUTION_LAYER_OPACITY * 100,
);
export const KNOWN_CONTINUOUS_RENDER_RANGES_BY_LAYER_ID: Record<
  string,
  { minValue: number; maxValue: number }
> = {
  species_richness: SPECIES_RICHNESS_RENDER_RANGE,
  human_footprint_2022: HUMAN_FOOTPRINT_RENDER_RANGE,
};

// Canonical color defaults live in solution-layer.service.ts; re-aliased here for readability.
export const SINGLE_SOLUTION_COLOR = DEFAULT_SINGLE_SOLUTION_HEX;
export const EXISTING_PROTECTED_COLOR = DEFAULT_EXISTING_PROTECTED_HEX;
export const COMPARISON_BASELINE_COLOR = DEFAULT_COMPARISON_BASELINE_HEX;
export const COMPARISON_CANDIDATE_COLOR = DEFAULT_COMPARISON_CANDIDATE_HEX;
export const COMPARISON_OVERLAP_COLOR = DEFAULT_COMPARISON_OVERLAP_HEX;
export const LEGEND_BOUNDARY_STYLES: Record<
  AdminBoundaryLayerKey,
  { lineStyle: 'solid' | 'dashed'; lineWidth: number; color: string }
> = {
  siraps: { lineStyle: 'dashed', lineWidth: 1.25, color: '#111827' },
  siraps_territorial: { lineStyle: 'solid', lineWidth: 1.25, color: '#111827' },
  siraps_territorial_updated: { lineStyle: 'solid', lineWidth: 1.25, color: '#111827' },
  siraps_thematic: { lineStyle: 'dashed', lineWidth: 1.25, color: '#475569' },
  admin_country_outline: { lineStyle: 'solid', lineWidth: 1.6, color: '#111827' },
  admin_departments: { lineStyle: 'solid', lineWidth: 1, color: '#111827' },
  admin_municipalities: { lineStyle: 'solid', lineWidth: 1, color: '#111827' },
};

/** Context-only boundaries that stay on the map but are omitted from the master legend. */
export const MASTER_LEGEND_EXCLUDED_ADMIN_BOUNDARY_LAYER_KEYS = new Set<AdminBoundaryLayerKey>([
  'admin_country_outline',
]);
