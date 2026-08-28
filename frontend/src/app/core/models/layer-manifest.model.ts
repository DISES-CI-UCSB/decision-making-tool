export type LayerLocale = 'en' | 'es';
export const DEFAULT_LOCALE: LayerLocale = 'es';

/**
 * Resolves a display label for a layer or category using a consistent locale-aware policy:
 *   1. Primary locale label (if available and non-empty)
 *   2. Fallback locale label
 *   3. `spanishLabel` as last resort (it is always required in the schema)
 */
export function resolveLayerLabel(
  englishLabel: string | null | undefined,
  spanishLabel: string,
  locale: LayerLocale = DEFAULT_LOCALE,
): string {
  if (locale === 'es') {
    return spanishLabel || englishLabel || spanishLabel;
  }
  return englishLabel || spanishLabel;
}

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
  englishLabel?: string | null;
  spanishLabel?: string | null;
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

export interface RuntimeLayerManifestManualEdit {
  editorName: string;
  editedAt: string;
  source?: string | null;
}

export interface RuntimeLayerManifestSpeciesLookup {
  url?: string | null;
}

export interface RuntimeLayerManifestReferenceData {
  speciesLookup?: RuntimeLayerManifestSpeciesLookup;
}

export interface RuntimeLayerManifest {
  version: string;
  generatedAt: string;
  publicBlobHost: string;
  sourceCsv: string;
  releaseId?: string;
  catalogVersion?: string;
  solutionDataProfile?: 'runtime-compact-v1';
  manualEdit?: RuntimeLayerManifestManualEdit;
  referenceData?: RuntimeLayerManifestReferenceData;
  categories: RuntimeLayerManifestCategory[];
  layers: RuntimeLayerManifestLayer[];
  solutions: RuntimeSolutionManifestEntry[];
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
  requiredForSolution?: boolean;
  selectableInFinder?: boolean;
  visibleInMapLayers?: boolean;
  displayUrl?: string | null;
  /** Display-only COG. `displayUrl` remains the source/metrics URL. */
  displayCogUrl?: string | null;
  displayCollectionUrl?: string | null;
  speciesManifestUrl?: string | null;
  metadataUrl: string | null;
  compressedDataForLiveMetricsUrl: string | null;
  precomputedMetricUrls: Record<string, string>;
  rendering: RuntimeLayerManifestRenderingConfig;
  styleOverride?: boolean | null;
}

export interface RuntimeSolutionManifestInputLayerIds {
  features: string[];
  cost: string | null;
  includes: string[];
  excludes: string[];
}

export interface RuntimeSolutionManifestFinderInputs {
  domain?: 'land' | 'marine';
  scope: string;
  targetFeatureSet: string | null;
  targetFeatureIds: string[];
  targetPercent: number | null;
  structuredTargets?: RuntimeSolutionStructuredTargets;
  costLayerId: string | null;
  includeLayerIds: string[];
  excludeLayerIds: string[];
}

export interface RuntimeSolutionTargetEntry {
  featureId: string;
  targetPercent: number;
}

export interface RuntimeSolutionStructuredTargets {
  format: 'solution-target-metadata-v1';
  sourceEvaluation: 'prioritizr_model' | 'final_summary_csv' | 'legacy-single-ecosystem';
  ecosystems: RuntimeSolutionTargetEntry[];
  strategicEcosystems: RuntimeSolutionTargetEntry[];
  ecosystemServices: RuntimeSolutionTargetEntry[];
  speciesRepresentation: RuntimeSolutionTargetEntry[];
  espRn: RuntimeSolutionTargetEntry[];
}

export interface RuntimeSolutionManifestSummaryMetrics {
  nSelected: number | null;
  totalCost: number | null;
  pctTargetsMet: number | null;
  coverageRowCount: number;
}

/**
 * Optional, versioned UI contracts emitted per solution.
 * `aoiCoverageMetrics: 'v2'` enables the richer known-AOI ecosystem/species columns.
 */
export interface RuntimeSolutionCapabilities {
  aoiCoverageMetrics?: 'v2';
}

export interface RuntimeSolutionManifestCoverageRow {
  feature: string;
  met: boolean | null;
  relativeTarget: number | null;
  relativeHeld: number | null;
  relativeShortfall: number | null;
  type: string | null;
  evaluated: string | null;
  targetDimension: string | null;
}

export interface RuntimeSolutionMecGeographyUrls {
  national: string;
  departments: string;
  municipalities: string;
  siraps: string;
  runaps: string;
  omecs: string;
}

export interface RuntimeSolutionPrecomputedMetricUrls {
  compactCache?: string;
  compact?: string;
  cache?: string;
  goals?: string;
  /** Release-wide post-hoc raster outcomes for the four strategic ecosystems. */
  strategicOutcomes?: string;
  /** Legacy `mec-compact-v1` shards retained for older clients. */
  mecByGeography?: RuntimeSolutionMecGeographyUrls;
  /** Versioned `mec-compact-v2` shards used by current clients when published. */
  mecV2ByGeography?: RuntimeSolutionMecGeographyUrls;
  /** Shared immutable identity/taxonomy catalog for species coverage rows. */
  speciesGoalsCatalog?: string;
  /** Shared release-wide configured-species target maps keyed by solution. */
  speciesGoalsTargetOverlay?: string;
  /** Per-solution national/predefined-AOI species coverage shards. */
  speciesGoalsByGeography?: RuntimeSolutionMecGeographyUrls;
  [key: string]: string | RuntimeSolutionMecGeographyUrls | undefined;
}

export interface RuntimeSolutionManifestEntry {
  id: string;
  name: string;
  description: string;
  domain?: 'land' | 'marine';
  scope: string;
  sirapId?: string | null;
  displayUrl: string;
  displayCogUrl?: string | null;
  metadataUrl: string;
  rasterFile: string;
  metadataFile: string;
  blobPath: string;
  generatedAt: string | null;
  capabilities?: RuntimeSolutionCapabilities;
  precomputedMetricUrls?: RuntimeSolutionPrecomputedMetricUrls;
  finderInputs: RuntimeSolutionManifestFinderInputs;
  inputLayerIds: RuntimeSolutionManifestInputLayerIds;
  summaryMetrics: RuntimeSolutionManifestSummaryMetrics;
  /** Empty in runtime-compact-v1; full per-feature analysis remains in frozen source metadata. */
  coverage: RuntimeSolutionManifestCoverageRow[];
  rendering: RuntimeLayerManifestRenderingConfig;
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
  displayCogUrl?: string | null;
  displayCollectionUrl: string | null;
  speciesManifestUrl: string | null;
  metadataUrl: string | null;
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
  /** Display-only COG. Source-only records intentionally remain map-unavailable. */
  displayCogUrl?: string | null;
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
  locale: LayerLocale = DEFAULT_LOCALE,
): ManifestSidebarLayerRow {
  const { categoryId, subcategoryId } = parseCategoryPath(layer.category);
  return {
    id: layer.id,
    name: resolveLayerLabel(layer.englishLabel, layer.spanishLabel, locale),
    spanishLabel: layer.spanishLabel,
    englishLabel: layer.englishLabel,
    description: layer.description,
    tooltip: layer.tooltip,
    sidebarCategoryId: categoryId,
    sidebarSubcategoryId: subcategoryId,
    dataRole: layer.dataRole,
    roleInMetricCalculation: layer.roleInMetricCalculation,
    displayUrl: layer.displayUrl ?? null,
    displayCogUrl: layer.displayCogUrl ?? null,
    displayCollectionUrl: layer.displayCollectionUrl ?? null,
    speciesManifestUrl: layer.speciesManifestUrl ?? null,
    metadataUrl: layer.metadataUrl ?? null,
    rendering: layer.rendering,
    hasDisplayAsset: Boolean(layer.displayCogUrl ?? layer.displayUrl ?? layer.displayCollectionUrl),
    isSpeciesCollection: layer.dataRole === 'manifest_for_species_layers',
  };
}

export function groupManifestLayersBySidebarCategory(
  manifest: RuntimeLayerManifest,
  locale: LayerLocale = DEFAULT_LOCALE,
): ManifestSidebarLayersByCategory {
  return buildManifestSidebarLayerGroups(manifest, locale).reduce<ManifestSidebarLayersByCategory>(
    (groupsByCategory, group) => ({
      ...groupsByCategory,
      [group.sidebarCategoryId]: group.rows,
    }),
    {},
  );
}

export function buildManifestSidebarLayerGroups(
  manifest: RuntimeLayerManifest,
  locale: LayerLocale = DEFAULT_LOCALE,
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
    const rows = [...orderedCategoryLayers, ...remainingCategoryLayers].map((layer) =>
      mapManifestLayerToSidebarRow(layer, locale),
    );

    return {
      sidebarCategoryId: category.id,
      title: resolveLayerLabel(category.englishLabel, category.spanishLabel, locale),
      spanishLabel: category.spanishLabel,
      englishLabel: category.englishLabel ?? null,
      rows,
    };
  });
}
