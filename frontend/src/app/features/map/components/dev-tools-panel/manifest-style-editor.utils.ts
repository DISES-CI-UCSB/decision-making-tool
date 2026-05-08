import {
  parseCategoryPath,
  type RuntimeLayerManifest,
  type RuntimeLayerManifestColorDefaults,
  type RuntimeLayerManifestDataRole,
  type RuntimeLayerManifestLayer,
  type RuntimeLayerManifestRenderingConfig,
  type RuntimeLayerManifestSubcategory,
} from '@core/models/layer-manifest.model';

export type LayerValidationResult = Record<string, string[]>;
export type ManifestStyleScopeType = 'category' | 'subcategory';

export interface ManifestLayerDiff {
  layerId: string;
  changedFields: string[];
}

export interface ManifestStyleDefaultDiff {
  scopeType: ManifestStyleScopeType;
  /** Either a bare category id or `categoryId.subcategoryId`. */
  scopeId: string;
  changedFields: string[];
}

export interface ManifestDiffSummary {
  changedLayerCount: number;
  changedLayers: ManifestLayerDiff[];
  changedDefaultCount: number;
  changedDefaults: ManifestStyleDefaultDiff[];
  changedOverrideCount: number;
  changedOverrideLayers: string[];
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const MASK_DEFAULT_RENDERING: RuntimeLayerManifestRenderingConfig = {
  valueType: 'binary',
  renderMode: 'mask',
  selectedColor: '#22c55e',
  selectedValue: 1,
  noDataValue: -9999,
};

const GRADIENT_DEFAULT_RENDERING: RuntimeLayerManifestRenderingConfig = {
  valueType: 'continuous',
  renderMode: 'gradient',
  startColor: '#d1fae5',
  endColor: '#166534',
  minValue: null,
  maxValue: null,
  noDataValue: -9999,
};

const MASK_PREFERRED_DATA_ROLES: ReadonlySet<RuntimeLayerManifestDataRole> = new Set([
  'include_layer',
  'solution_layer',
  'administrative_boundary',
]);

const NON_EDITABLE_DATA_ROLES: ReadonlySet<RuntimeLayerManifestDataRole> = new Set([
  'manifest_for_species_layers',
]);

/**
 * Last-resort palette for categories that don't yet have inline `styleDefaults`
 * and have no editable layer renderings to derive colors from. Kept in sync with
 * the curated palette in `generate-manifest.mjs`.
 */
const CATEGORY_COLOR_FALLBACKS: Record<string, RuntimeLayerManifestColorDefaults> = {
  administrative_boundaries: {
    selectedColor: '#111827',
    startColor: '#e5e7eb',
    endColor: '#111827',
  },
  species_and_biodiversity: {
    selectedColor: '#854d0e',
    startColor: '#fef3c7',
    endColor: '#854d0e',
  },
  ecosystems: {
    selectedColor: '#166534',
    startColor: '#bbf7d0',
    endColor: '#166534',
  },
  environmental_services: {
    selectedColor: '#0f766e',
    startColor: '#ccfbf1',
    endColor: '#0f766e',
  },
  management_figures: {
    selectedColor: '#3730a3',
    startColor: '#e0e7ff',
    endColor: '#3730a3',
  },
  cultural_and_ethnic_territories: {
    selectedColor: '#1d4ed8',
    startColor: '#dbeafe',
    endColor: '#1d4ed8',
  },
  socioeconomic: {
    selectedColor: '#991b1b',
    startColor: '#fee2e2',
    endColor: '#991b1b',
  },
  conflict_and_security: {
    selectedColor: '#9f1239',
    startColor: '#ffe4e6',
    endColor: '#9f1239',
  },
  territorial_planning: {
    selectedColor: '#4d7c0f',
    startColor: '#ecfccb',
    endColor: '#4d7c0f',
  },
  prospective_models: {
    selectedColor: '#155e75',
    startColor: '#cffafe',
    endColor: '#155e75',
  },
  solutions: {
    selectedColor: '#9d174d',
    startColor: '#fce7f3',
    endColor: '#9d174d',
  },
};

export function isEditableRenderMode(renderMode: string): boolean {
  return renderMode === 'mask' || renderMode === 'gradient';
}

export function defaultRenderingForDataRole(
  dataRole: RuntimeLayerManifestDataRole,
): RuntimeLayerManifestRenderingConfig {
  if (MASK_PREFERRED_DATA_ROLES.has(dataRole)) {
    return structuredClone(MASK_DEFAULT_RENDERING);
  }
  return structuredClone(GRADIENT_DEFAULT_RENDERING);
}

export function isEditableDataRole(dataRole: RuntimeLayerManifestDataRole): boolean {
  return !NON_EDITABLE_DATA_ROLES.has(dataRole);
}

export function ensureLayerRendering(layer: RuntimeLayerManifestLayer): RuntimeLayerManifestLayer {
  const rendering = layer.rendering;
  if (rendering && isEditableRenderMode(rendering.renderMode)) {
    return layer;
  }
  return { ...layer, rendering: defaultRenderingForDataRole(layer.dataRole) };
}

export function normalizeManifestForEditor(manifest: RuntimeLayerManifest): RuntimeLayerManifest {
  return {
    ...manifest,
    layers: manifest.layers.map((layer) =>
      isEditableDataRole(layer.dataRole) ? ensureLayerRendering(layer) : layer,
    ),
  };
}

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value.trim());
}

export function parseOptionalNumber(inputValue: string): number | null {
  const normalized = inputValue.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function validateRenderingConfig(
  rendering: RuntimeLayerManifestRenderingConfig,
): LayerValidationResult {
  const errors: LayerValidationResult = {};

  if (rendering.renderMode === 'mask') {
    if (!isValidHexColor(rendering.selectedColor ?? '')) {
      errors['selectedColor'] = ['selectedColor must be a 6-digit hex value like #22c55e'];
    }

    const selectedValue = rendering.selectedValue;
    if (selectedValue != null && !Number.isFinite(selectedValue)) {
      errors['selectedValue'] = ['selectedValue must be a valid number when provided'];
    }
  }

  if (rendering.renderMode === 'gradient') {
    if (!isValidHexColor(rendering.startColor ?? '')) {
      errors['startColor'] = ['startColor must be a 6-digit hex value like #d1fae5'];
    }
    if (!isValidHexColor(rendering.endColor ?? '')) {
      errors['endColor'] = ['endColor must be a 6-digit hex value like #166534'];
    }

    const minValue = rendering.minValue;
    const maxValue = rendering.maxValue;
    if (minValue != null && !Number.isFinite(minValue)) {
      errors['minValue'] = ['minValue must be a valid number when provided'];
    }
    if (maxValue != null && !Number.isFinite(maxValue)) {
      errors['maxValue'] = ['maxValue must be a valid number when provided'];
    }
    if (
      minValue != null &&
      maxValue != null &&
      Number.isFinite(minValue) &&
      Number.isFinite(maxValue) &&
      minValue >= maxValue
    ) {
      errors['maxValue'] = [
        ...(errors['maxValue'] ?? []),
        'maxValue must be greater than minValue',
      ];
    }
  }

  if (rendering.noDataValue != null && !Number.isFinite(rendering.noDataValue)) {
    errors['noDataValue'] = ['noDataValue must be a valid number when provided'];
  }

  return errors;
}

export function validateColorDefaults(
  defaults: RuntimeLayerManifestColorDefaults,
): LayerValidationResult {
  const errors: LayerValidationResult = {};

  for (const fieldName of ['selectedColor', 'startColor', 'endColor'] as const) {
    const value = defaults[fieldName];
    if (value != null && value !== '' && !isValidHexColor(value)) {
      errors[fieldName] = [`${fieldName} must be a 6-digit hex value like #22c55e`];
    }
  }

  return errors;
}

export function extractColorDefaultsFromRendering(
  rendering: RuntimeLayerManifestRenderingConfig,
): RuntimeLayerManifestColorDefaults {
  if (rendering.renderMode === 'mask') {
    return { selectedColor: rendering.selectedColor ?? null };
  }

  if (rendering.renderMode === 'gradient') {
    return {
      startColor: rendering.startColor ?? null,
      endColor: rendering.endColor ?? null,
    };
  }

  return {};
}

export function getLayerCategoryId(layer: RuntimeLayerManifestLayer): string {
  return parseCategoryPath(layer.category).categoryId;
}

export function getCategoryColorDefaults(
  manifest: RuntimeLayerManifest,
  categoryId: string,
): RuntimeLayerManifestColorDefaults {
  const category = manifest.categories.find((entry) => entry.id === categoryId);
  if (category?.styleDefaults) {
    return alignMaskColorWithGradient(category.styleDefaults);
  }

  const editableRenderings = manifest.layers
    .filter(
      (layer) =>
        getLayerCategoryId(layer) === categoryId &&
        isEditableDataRole(layer.dataRole) &&
        layer.rendering &&
        isEditableRenderMode(layer.rendering.renderMode),
    )
    .map((layer) => layer.rendering);
  const firstGradientRendering = editableRenderings.find(
    (rendering) => rendering.renderMode === 'gradient',
  );
  if (firstGradientRendering) {
    return alignMaskColorWithGradient(extractColorDefaultsFromRendering(firstGradientRendering));
  }

  const firstMaskRendering = editableRenderings.find(
    (rendering) => rendering.renderMode === 'mask',
  );
  const fallbackDefaults =
    CATEGORY_COLOR_FALLBACKS[categoryId] ??
    (firstMaskRendering ? extractColorDefaultsFromRendering(firstMaskRendering) : {});
  return alignMaskColorWithGradient(fallbackDefaults);
}

function alignMaskColorWithGradient(
  defaults: RuntimeLayerManifestColorDefaults,
): RuntimeLayerManifestColorDefaults {
  const endColor = defaults.endColor ?? null;
  return {
    ...defaults,
    selectedColor: endColor ?? defaults.selectedColor ?? null,
  };
}

export function getAlignedCategoryColorDefaults(
  defaults: RuntimeLayerManifestColorDefaults,
): RuntimeLayerManifestColorDefaults {
  return alignMaskColorWithGradient(defaults);
}

export function getSubcategoryColorDefaults(
  manifest: RuntimeLayerManifest,
  categoryId: string,
  subcategoryId: string,
): RuntimeLayerManifestColorDefaults {
  const subcategory = findSubcategory(manifest, categoryId, subcategoryId);
  return { ...(subcategory?.styleDefaults ?? {}) };
}

function findSubcategory(
  manifest: RuntimeLayerManifest,
  categoryId: string,
  subcategoryId: string,
): RuntimeLayerManifestSubcategory | null {
  const category = manifest.categories.find((entry) => entry.id === categoryId);
  return category?.subcategories?.find((subcategory) => subcategory.id === subcategoryId) ?? null;
}

export function setSubcategoryColorDefaults(
  manifest: RuntimeLayerManifest,
  categoryId: string,
  subcategoryId: string,
  defaults: RuntimeLayerManifestColorDefaults,
): RuntimeLayerManifest {
  return {
    ...manifest,
    categories: manifest.categories.map((category) => {
      if (category.id !== categoryId) {
        return category;
      }
      return {
        ...category,
        subcategories: (category.subcategories ?? []).map((subcategory) =>
          subcategory.id === subcategoryId
            ? { ...subcategory, styleDefaults: pruneEmptyDefaults(defaults) }
            : subcategory,
        ),
      };
    }),
  };
}

export function applyColorDefaultsToRendering(
  rendering: RuntimeLayerManifestRenderingConfig,
  defaults: RuntimeLayerManifestColorDefaults,
): RuntimeLayerManifestRenderingConfig {
  if (rendering.renderMode === 'mask') {
    return {
      ...rendering,
      selectedColor: defaults.selectedColor ?? rendering.selectedColor ?? null,
    };
  }

  if (rendering.renderMode === 'gradient') {
    return {
      ...rendering,
      startColor: defaults.startColor ?? rendering.startColor ?? null,
      endColor: defaults.endColor ?? rendering.endColor ?? null,
    };
  }

  return rendering;
}

export function applyCategoryColorDefaults(
  manifest: RuntimeLayerManifest,
  categoryId: string,
  defaults: RuntimeLayerManifestColorDefaults,
  options: { replaceOverrides: boolean },
): RuntimeLayerManifest {
  const prunedDefaults = pruneEmptyDefaults(defaults);
  return {
    ...manifest,
    categories: manifest.categories.map((category) =>
      category.id === categoryId ? { ...category, styleDefaults: prunedDefaults } : category,
    ),
    layers: manifest.layers.map((layer) => {
      if (
        getLayerCategoryId(layer) !== categoryId ||
        !isEditableDataRole(layer.dataRole) ||
        !layer.rendering ||
        !isEditableRenderMode(layer.rendering.renderMode) ||
        (layer.styleOverride && !options.replaceOverrides)
      ) {
        return layer;
      }

      return {
        ...layer,
        rendering: applyColorDefaultsToRendering(layer.rendering, defaults),
        styleOverride: options.replaceOverrides ? null : layer.styleOverride,
      };
    }),
  };
}

export function clearLayerStyleOverride(
  manifest: RuntimeLayerManifest,
  layerId: string,
): RuntimeLayerManifest {
  const targetLayer = manifest.layers.find((layer) => layer.id === layerId);
  if (!targetLayer?.rendering) {
    return manifest;
  }

  const inheritedDefaults = getCategoryColorDefaults(manifest, getLayerCategoryId(targetLayer));
  return {
    ...manifest,
    layers: manifest.layers.map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            rendering: applyColorDefaultsToRendering(layer.rendering, inheritedDefaults),
            styleOverride: null,
          }
        : layer,
    ),
  };
}

export function buildManifestDiffSummary(
  loadedManifest: RuntimeLayerManifest,
  draftManifest: RuntimeLayerManifest,
): ManifestDiffSummary {
  const loadedById = new Map(loadedManifest.layers.map((layer) => [layer.id, layer]));
  const diffLayers: ManifestLayerDiff[] = [];
  const changedOverrideLayers: string[] = [];

  for (const draftLayer of draftManifest.layers) {
    const loadedLayer = loadedById.get(draftLayer.id);
    if (
      !loadedLayer ||
      !draftLayer.rendering ||
      !isEditableRenderMode(draftLayer.rendering.renderMode)
    ) {
      continue;
    }

    const changedFields = getChangedRenderingFields(loadedLayer, draftLayer);
    if ((loadedLayer.styleOverride ?? null) !== (draftLayer.styleOverride ?? null)) {
      changedOverrideLayers.push(draftLayer.id);
      changedFields.push('styleOverride');
    }
    if (changedFields.length > 0) {
      diffLayers.push({ layerId: draftLayer.id, changedFields });
    }
  }

  const changedDefaults = getChangedStyleDefaults(loadedManifest, draftManifest);

  return {
    changedLayerCount: diffLayers.length,
    changedLayers: diffLayers,
    changedDefaultCount: changedDefaults.length,
    changedDefaults,
    changedOverrideCount: changedOverrideLayers.length,
    changedOverrideLayers,
  };
}

function pruneEmptyDefaults(
  defaults: RuntimeLayerManifestColorDefaults,
): RuntimeLayerManifestColorDefaults {
  return Object.fromEntries(
    Object.entries(defaults).filter(([, value]) => value != null && value !== ''),
  ) as RuntimeLayerManifestColorDefaults;
}

function getChangedStyleDefaults(
  loadedManifest: RuntimeLayerManifest,
  draftManifest: RuntimeLayerManifest,
): ManifestStyleDefaultDiff[] {
  const loadedCategoriesById = new Map(
    loadedManifest.categories.map((category) => [category.id, category]),
  );
  const draftCategoriesById = new Map(
    draftManifest.categories.map((category) => [category.id, category]),
  );
  const allCategoryIds = new Set([...loadedCategoriesById.keys(), ...draftCategoriesById.keys()]);

  const diffs: ManifestStyleDefaultDiff[] = [];
  for (const categoryId of allCategoryIds) {
    const loadedCategory = loadedCategoriesById.get(categoryId);
    const draftCategory = draftCategoriesById.get(categoryId);
    const categoryDiffFields = getChangedColorDefaultFields(
      loadedCategory?.styleDefaults,
      draftCategory?.styleDefaults,
    );
    if (categoryDiffFields.length > 0) {
      diffs.push({ scopeType: 'category', scopeId: categoryId, changedFields: categoryDiffFields });
    }

    const loadedSubcategoriesById = new Map(
      (loadedCategory?.subcategories ?? []).map((subcategory) => [subcategory.id, subcategory]),
    );
    const draftSubcategoriesById = new Map(
      (draftCategory?.subcategories ?? []).map((subcategory) => [subcategory.id, subcategory]),
    );
    const allSubcategoryIds = new Set([
      ...loadedSubcategoriesById.keys(),
      ...draftSubcategoriesById.keys(),
    ]);
    for (const subcategoryId of allSubcategoryIds) {
      const subcategoryDiffFields = getChangedColorDefaultFields(
        loadedSubcategoriesById.get(subcategoryId)?.styleDefaults,
        draftSubcategoriesById.get(subcategoryId)?.styleDefaults,
      );
      if (subcategoryDiffFields.length > 0) {
        diffs.push({
          scopeType: 'subcategory',
          scopeId: `${categoryId}.${subcategoryId}`,
          changedFields: subcategoryDiffFields,
        });
      }
    }
  }

  return diffs;
}

function getChangedColorDefaultFields(
  loadedDefaults: RuntimeLayerManifestColorDefaults | undefined,
  draftDefaults: RuntimeLayerManifestColorDefaults | undefined,
): string[] {
  const changedFields: string[] = [];

  for (const fieldName of ['selectedColor', 'startColor', 'endColor'] as const) {
    if ((loadedDefaults?.[fieldName] ?? null) !== (draftDefaults?.[fieldName] ?? null)) {
      changedFields.push(fieldName);
    }
  }

  return changedFields;
}

function getChangedRenderingFields(
  loadedLayer: RuntimeLayerManifestLayer,
  draftLayer: RuntimeLayerManifestLayer,
): string[] {
  const changedFields: string[] = [];
  const loadedRendering = loadedLayer.rendering;
  const draftRendering = draftLayer.rendering;

  if (!loadedRendering) {
    if (draftRendering.renderMode === 'mask' && draftRendering.selectedColor) {
      return ['rendering (added mask)'];
    }
    if (draftRendering.renderMode === 'gradient' && draftRendering.startColor) {
      return ['rendering (added gradient)'];
    }
    return [];
  }

  if (loadedRendering.renderMode !== draftRendering.renderMode) {
    return ['renderMode'];
  }

  const comparableFields =
    draftRendering.renderMode === 'mask'
      ? (['selectedColor', 'selectedValue', 'noDataValue'] as const)
      : (['startColor', 'endColor', 'minValue', 'maxValue', 'noDataValue'] as const);

  for (const fieldName of comparableFields) {
    if ((loadedRendering[fieldName] ?? null) !== (draftRendering[fieldName] ?? null)) {
      changedFields.push(fieldName);
    }
  }

  return changedFields;
}
