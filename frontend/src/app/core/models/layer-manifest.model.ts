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

export interface RuntimeLayerManifest {
  version: string;
  generatedAt: string;
  publicBlobHost: string;
  sourceCsv: string;
  categories: RuntimeLayerManifestCategory[];
  layers: RuntimeLayerManifestLayer[];
}

export interface RuntimeLayerManifestCategory {
  id: string;
  spanishLabel: string;
  englishLabel?: string | null;
  layerIds: string[];
}

export interface RuntimeLayerManifestLayer {
  id: string;
  spanishLabel: string;
  englishLabel: string | null;
  description: string;
  tooltip: string | null;
  dataRole: RuntimeLayerManifestDataRole;
  sidebarCategoryId: string;
  roleInMetricCalculation: RuntimeLayerManifestMetricRole;
  displayUrl?: string | null;
  displayCollectionUrl?: string | null;
  speciesManifestUrl?: string | null;
  metadataUrl: string | null;
  compressedDataForLiveMetricsUrl: string | null;
  precomputedMetricUrls: Record<string, string>;
  rendering: RuntimeLayerManifestRenderingConfig;
}

export interface ManifestSidebarLayerRow {
  id: string;
  name: string;
  spanishLabel: string;
  englishLabel: string | null;
  description: string;
  tooltip: string | null;
  sidebarCategoryId: string;
  dataRole: RuntimeLayerManifestDataRole;
  roleInMetricCalculation: RuntimeLayerManifestMetricRole;
  displayUrl: string | null;
  displayCollectionUrl: string | null;
  rendering: RuntimeLayerManifestRenderingConfig;
  hasDisplayAsset: boolean;
  isSpeciesCollection: boolean;
}

export interface ManifestSidebarLayerGroup {
  sidebarCategoryId: string;
  title: string;
  spanishLabel: string;
  englishLabel: string | null;
  rows: ManifestSidebarLayerRow[];
}

export type ManifestSidebarLayersByCategory = Record<string, ManifestSidebarLayerRow[]>;

export function mapManifestLayerToSidebarRow(
  layer: RuntimeLayerManifestLayer,
): ManifestSidebarLayerRow {
  return {
    id: layer.id,
    name: layer.englishLabel ?? layer.spanishLabel,
    spanishLabel: layer.spanishLabel,
    englishLabel: layer.englishLabel,
    description: layer.description,
    tooltip: layer.tooltip,
    sidebarCategoryId: layer.sidebarCategoryId,
    dataRole: layer.dataRole,
    roleInMetricCalculation: layer.roleInMetricCalculation,
    displayUrl: layer.displayUrl ?? null,
    displayCollectionUrl: layer.displayCollectionUrl ?? null,
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

  return manifest.categories.map((category) => {
    const orderedCategoryLayers = category.layerIds
      .map((layerId) => layersById.get(layerId))
      .filter(
        (layer): layer is RuntimeLayerManifestLayer =>
          layer !== undefined && layer.sidebarCategoryId === category.id,
      );
    const orderedLayerIds = new Set(orderedCategoryLayers.map((layer) => layer.id));
    const remainingCategoryLayers = manifest.layers.filter(
      (layer) => layer.sidebarCategoryId === category.id && !orderedLayerIds.has(layer.id),
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
