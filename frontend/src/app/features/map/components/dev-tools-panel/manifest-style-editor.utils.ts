import type {
  RuntimeLayerManifest,
  RuntimeLayerManifestDataRole,
  RuntimeLayerManifestLayer,
  RuntimeLayerManifestRenderingConfig,
} from '@core/models/layer-manifest.model';

export type LayerValidationResult = Record<string, string[]>;

export interface ManifestLayerDiff {
  layerId: string;
  changedFields: string[];
}

export interface ManifestDiffSummary {
  changedLayerCount: number;
  changedLayers: ManifestLayerDiff[];
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

export function buildManifestDiffSummary(
  loadedManifest: RuntimeLayerManifest,
  draftManifest: RuntimeLayerManifest,
): ManifestDiffSummary {
  const loadedById = new Map(loadedManifest.layers.map((layer) => [layer.id, layer]));
  const diffLayers: ManifestLayerDiff[] = [];

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
    if (changedFields.length > 0) {
      diffLayers.push({ layerId: draftLayer.id, changedFields });
    }
  }

  return {
    changedLayerCount: diffLayers.length,
    changedLayers: diffLayers,
  };
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
