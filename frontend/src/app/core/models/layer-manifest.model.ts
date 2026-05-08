export type RuntimeLayerManifestDataRole =
  | 'feature_layer'
  | 'manifest_for_species_layers'
  | 'species_layer'
  | 'cost_layer'
  | 'include_layer'
  | 'solution_layer'
  | 'administrative_boundary'
  | 'reference_layer';

export type RuntimeLayerManifestMetricRole =
  | 'none'
  | 'data_used_for_live_metric_calculation'
  | 'boundary_used_for_precomputed_metric_lookup'
  | 'data_used_for_live_metric_calculation_and_precomputed_metric_lookup';

export type RuntimeLayerManifestValueType = 'binary' | 'categorical' | 'continuous';
export type RuntimeLayerManifestRenderMode = 'mask' | 'gradient' | 'categorical';

export interface RuntimeLayerManifestClassColor {
  value: number;
  color: string;
  label?: string | null;
}

export interface RuntimeLayerManifestRenderingConfig {
  valueType: RuntimeLayerManifestValueType;
  renderMode: RuntimeLayerManifestRenderMode;
  noDataValue?: number | null;
  selectedValue?: number | null;
  selectedColor?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  startColor?: string | null;
  endColor?: string | null;
  classColors?: RuntimeLayerManifestClassColor[];
}

export interface RuntimeLayerManifestColorDefaults {
  selectedColor?: string | null;
  startColor?: string | null;
  endColor?: string | null;
}

export interface RuntimeLayerManifest {
  version: string;
  generatedAt: string;
  publicBlobHost: string;
  sourceCsv: string;
  categories: RuntimeLayerManifestCategory[];
  layers: RuntimeLayerManifestLayer[];
}

export interface RuntimeLayerManifestSubcategory {
  id: string;
  spanishLabel: string;
  englishLabel?: string | null;
  styleDefaults?: RuntimeLayerManifestColorDefaults;
  layerIds: string[];
}

export interface RuntimeLayerManifestCategory {
  id: string;
  spanishLabel: string;
  englishLabel?: string | null;
  styleDefaults?: RuntimeLayerManifestColorDefaults;
  subcategories?: RuntimeLayerManifestSubcategory[];
  layerIds: string[];
}

export interface RuntimeLayerManifestLayer {
  id: string;
  spanishLabel: string;
  englishLabel: string | null;
  description: string;
  tooltip: string | null;
  dataRole: RuntimeLayerManifestDataRole;
  /**
   * Dot-path category reference. Bare `categoryId` (e.g. `"ecosystems"`) for layers
   * that live directly under a category, or `"categoryId.subcategoryId"` (e.g.
   * `"species_and_biodiversity.felidae"`) for layers grouped under a subcategory.
   */
  category: string;
  roleInMetricCalculation: RuntimeLayerManifestMetricRole;
  displayUrl?: string | null;
  displayCollectionUrl?: string | null;
  speciesManifestUrl?: string | null;
  metadataUrl: string | null;
  compressedDataForLiveMetricsUrl: string | null;
  precomputedMetricUrls: Record<string, string>;
  rendering: RuntimeLayerManifestRenderingConfig;
  styleOverride?: boolean | null;
}

export interface ManifestSidebarLayerRow {
  id: string;
  name: string;
  spanishLabel: string;
  englishLabel: string | null;
  description: string;
  tooltip: string | null;
  /** Top-level category id parsed from `layer.category`. */
  sidebarCategoryId: string;
  /** Subcategory id parsed from `layer.category`, or null when none. */
  sidebarSubcategoryId: string | null;
  dataRole: RuntimeLayerManifestDataRole;
  roleInMetricCalculation: RuntimeLayerManifestMetricRole;
  displayUrl: string | null;
  displayCollectionUrl: string | null;
  speciesManifestUrl: string | null;
  rendering: RuntimeLayerManifestRenderingConfig;
  hasDisplayAsset: boolean;
  isSpeciesCollection: boolean;
}

export interface RuntimeSpeciesManifestLayer {
  id: string;
  taxonId: string | null;
  taxonLabel: string | null;
  commonName: string;
  scientificName: string;
  displayUrl: string | null;
  rendering: RuntimeLayerManifestRenderingConfig | null;
}

export interface RuntimeSpeciesManifest {
  version?: string;
  generatedAt?: string;
  layers: RuntimeSpeciesManifestLayer[];
}

export interface ManifestSidebarLayerGroup {
  sidebarCategoryId: string;
  title: string;
  spanishLabel: string;
  englishLabel: string | null;
  rows: ManifestSidebarLayerRow[];
}

export type ManifestSidebarLayersByCategory = Record<string, ManifestSidebarLayerRow[]>;

export interface ParsedCategoryPath {
  categoryId: string;
  subcategoryId: string | null;
}

const CATEGORY_PATH_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)?$/;

/**
 * Splits a manifest layer's `category` dot-path into its top-level category id and
 * (optional) subcategory id. Throws when the path is malformed.
 */
export function parseCategoryPath(category: string): ParsedCategoryPath {
  if (typeof category !== 'string' || !CATEGORY_PATH_PATTERN.test(category)) {
    throw new Error(`layer.category "${category}" must match ^[a-z0-9_]+(\\.[a-z0-9_]+)?$`);
  }
  const dotIndex = category.indexOf('.');
  if (dotIndex < 0) {
    return { categoryId: category, subcategoryId: null };
  }
  return {
    categoryId: category.slice(0, dotIndex),
    subcategoryId: category.slice(dotIndex + 1),
  };
}

export function mapManifestLayerToSidebarRow(
  layer: RuntimeLayerManifestLayer,
): ManifestSidebarLayerRow {
  const { categoryId, subcategoryId } = parseCategoryPath(layer.category);
  return {
    id: layer.id,
    name: layer.englishLabel ?? layer.spanishLabel,
    spanishLabel: layer.spanishLabel,
    englishLabel: layer.englishLabel,
    description: layer.description,
    tooltip: layer.tooltip,
    sidebarCategoryId: categoryId,
    sidebarSubcategoryId: subcategoryId,
    dataRole: layer.dataRole,
    roleInMetricCalculation: layer.roleInMetricCalculation,
    displayUrl: layer.displayUrl ?? null,
    displayCollectionUrl: layer.displayCollectionUrl ?? null,
    speciesManifestUrl: layer.speciesManifestUrl ?? null,
    rendering: layer.rendering,
    hasDisplayAsset: Boolean(layer.displayUrl ?? layer.displayCollectionUrl),
    isSpeciesCollection: layer.dataRole === 'manifest_for_species_layers',
  };
}

export function groupManifestLayersBySidebarCategory(
  manifest: RuntimeLayerManifest,
): ManifestSidebarLayersByCategory {
  return buildManifestSidebarLayerGroups(manifest).reduce<ManifestSidebarLayersByCategory>(
    (groupsByCategory, group) => ({
      ...groupsByCategory,
      [group.sidebarCategoryId]: group.rows,
    }),
    {},
  );
}

export function buildManifestSidebarLayerGroups(
  manifest: RuntimeLayerManifest,
): ManifestSidebarLayerGroup[] {
  const layersById = new Map(manifest.layers.map((layer) => [layer.id, layer]));
  const layerCategoryIdById = new Map(
    manifest.layers.map((layer) => [layer.id, parseCategoryPath(layer.category).categoryId]),
  );

  return manifest.categories.map((category) => {
    const orderedCategoryLayers = category.layerIds
      .map((layerId) => layersById.get(layerId))
      .filter(
        (layer): layer is RuntimeLayerManifestLayer =>
          layer !== undefined && layerCategoryIdById.get(layer.id) === category.id,
      );
    const orderedLayerIds = new Set(orderedCategoryLayers.map((layer) => layer.id));
    const remainingCategoryLayers = manifest.layers.filter(
      (layer) =>
        layerCategoryIdById.get(layer.id) === category.id && !orderedLayerIds.has(layer.id),
    );
    const rows = [...orderedCategoryLayers, ...remainingCategoryLayers].map(
      mapManifestLayerToSidebarRow,
    );

    return {
      sidebarCategoryId: category.id,
      title: category.englishLabel ?? category.spanishLabel,
      spanishLabel: category.spanishLabel,
      englishLabel: category.englishLabel ?? null,
      rows,
    };
  });
}
