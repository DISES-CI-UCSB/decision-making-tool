import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import type {
  ManifestStyleRequestChanges,
  ManifestStyleRequestDiffSummary,
} from '@core/models/manifest-style-request.model';
import type {
  RuntimeLayerManifest,
  RuntimeLayerManifestCategory,
  RuntimeLayerManifestColorDefaults,
  RuntimeLayerManifestLayer,
  RuntimeLayerManifestManualEdit,
  RuntimeLayerManifestRenderingConfig,
  RuntimeLayerManifestSubcategory,
} from '@core/models/layer-manifest.model';
import { parseCategoryPath } from '@core/models/layer-manifest.model';
import { LayerManifestService } from '@core/services/layer-manifest.service';
import { ManifestStyleRequestService } from '@core/services/manifest-style-request.service';
import { environment } from '../../../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import {
  applyCategoryColorDefaults,
  applyColorDefaultsToRendering,
  buildManifestDiffSummary,
  clearLayerStyleOverride,
  getCategoryColorDefaults,
  getLayerCategoryId,
  getSubcategoryColorDefaults,
  isEditableDataRole,
  isEditableRenderMode,
  normalizeManifestForEditor,
  parseOptionalNumber,
  setSubcategoryColorDefaults,
  validateColorDefaults,
  validateRenderingConfig,
} from './manifest-style-editor.utils';

interface EditableManifestLayerSummary {
  id: string;
  title: string;
  dataRole: string;
  renderMode: string;
  valueType: string;
  isEditable: boolean;
  styleOverride: boolean;
  hasValidationErrors: boolean;
  swatchStyle: string;
  usesCategoricalSwatch: boolean;
}

interface EditableManifestCategorySummary {
  id: string;
  title: string;
  layerCount: number;
  editableLayerCount: number;
  overrideCount: number;
  hasValidationErrors: boolean;
  swatchStyle: string;
  subcategories: EditableManifestSubcategorySummary[];
  /** Kept for template back-compat with the species taxa block; mirrors `subcategories`. */
  speciesTaxa: EditableManifestSubcategorySummary[];
  layers: EditableManifestLayerSummary[];
}

interface EditableManifestSubcategorySummary {
  id: string;
  categoryId: string;
  title: string;
  layerCount: number;
  swatchStyle: string;
}

type ManifestStyleEditorScope =
  | { type: 'category'; id: string }
  | { type: 'subcategory'; categoryId: string; id: string }
  | { type: 'layer'; id: string };
type EditableRenderingNumberField = 'selectedValue' | 'noDataValue' | 'minValue' | 'maxValue';
type EditableRenderingColorField = 'selectedColor' | 'startColor' | 'endColor';
type EditableDefaultColorField = 'selectedColor' | 'startColor' | 'endColor';

interface BrowserSaveFilePicker {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: {
      description: string;
      accept: Record<string, string[]>;
    }[];
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

const SIDEBAR_CATEGORY_ORDER = [
  'administrative_boundaries',
  'species_and_biodiversity',
  'ecosystems',
  'environmental_services',
  'management_figures',
  'cultural_and_ethnic_territories',
  'socioeconomic',
  'conflict_and_security',
  'territorial_planning',
  'prospective_models',
  'solutions',
] as const;

@Component({
  selector: 'app-manifest-style-editor-overlay',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './manifest-style-editor-overlay.html',
  styleUrl: './manifest-style-editor-overlay.scss',
})
export class ManifestStyleEditorOverlayComponent {
  private readonly layerManifestService = inject(LayerManifestService);
  private readonly styleRequestService = inject(ManifestStyleRequestService);
  private readonly localStorageKey = 'eco-plan:manifest-style-editor:draft';

  protected readonly isOpen = signal(false);
  protected readonly isLoadingManifest = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loadedManifest = signal<RuntimeLayerManifest | null>(null);
  protected readonly draftManifest = signal<RuntimeLayerManifest | null>(null);
  protected readonly resolvedManifestUrl = signal('');
  protected readonly selectedScope = signal<ManifestStyleEditorScope | null>(null);
  protected readonly expandedCategoryIds = signal<Set<string>>(new Set());
  protected readonly searchQuery = signal('');
  protected readonly editorName = signal('');
  protected readonly publishState = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
  protected readonly publishMessage = signal<string | null>(null);
  protected readonly publishTargetPath = signal('');
  protected readonly publishArchivePath = signal('');
  protected readonly publishedManifestUrl = signal('');
  protected readonly localDraftMessage = signal<string | null>(null);
  protected readonly lastDownloadedStyledManifestFilename = signal<string | null>(null);

  protected readonly validationByLayerId = computed(() => {
    const manifest = this.draftManifest();
    if (!manifest) {
      return new Map<string, Record<string, string[]>>();
    }

    return new Map(
      manifest.layers
        .filter(
          (layer) =>
            isEditableDataRole(layer.dataRole) &&
            layer.rendering &&
            isEditableRenderMode(layer.rendering.renderMode),
        )
        .map((layer) => [layer.id, validateRenderingConfig(layer.rendering)]),
    );
  });

  protected readonly validationByCategoryId = computed(() => {
    const manifest = this.draftManifest();
    if (!manifest) {
      return new Map<string, Record<string, string[]>>();
    }

    return new Map(
      manifest.categories.map((category) => [
        category.id,
        validateColorDefaults(getCategoryColorDefaults(manifest, category.id)),
      ]),
    );
  });

  protected readonly editableCategorySummaries = computed<EditableManifestCategorySummary[]>(() => {
    const manifest = this.draftManifest();
    if (!manifest) {
      return [];
    }

    const orderByCategoryId = new Map<string, number>(
      SIDEBAR_CATEGORY_ORDER.map((id, index) => [id, index]),
    );
    const summaries = manifest.categories.map((category) =>
      this.toCategorySummary(manifest, category),
    );
    return summaries.sort((a, b) => {
      const aOrder = orderByCategoryId.get(a.id);
      const bOrder = orderByCategoryId.get(b.id);
      if (aOrder === undefined && bOrder === undefined) {
        return a.title.localeCompare(b.title);
      }
      if (aOrder === undefined) {
        return 1;
      }
      if (bOrder === undefined) {
        return -1;
      }
      return aOrder - bOrder;
    });
  });

  protected readonly filteredCategorySummaries = computed(() => {
    const normalizedQuery = this.searchQuery().trim().toLowerCase();
    if (!normalizedQuery) {
      return this.editableCategorySummaries();
    }

    return this.editableCategorySummaries()
      .map((category) => {
        const categoryMatches = `${category.id} ${category.title}`
          .toLowerCase()
          .includes(normalizedQuery);
        if (categoryMatches) {
          return category;
        }

        const matchingSubcategories = category.subcategories.filter((subcategory) =>
          `${subcategory.id} ${subcategory.title}`.toLowerCase().includes(normalizedQuery),
        );
        const matchingLayers = category.layers.filter((layer) =>
          `${layer.id} ${layer.title} ${layer.dataRole}`.toLowerCase().includes(normalizedQuery),
        );
        return matchingLayers.length > 0 || matchingSubcategories.length > 0
          ? {
              ...category,
              subcategories: matchingSubcategories,
              speciesTaxa: matchingSubcategories,
              layers: matchingLayers,
            }
          : null;
      })
      .filter((category): category is EditableManifestCategorySummary => category !== null);
  });

  protected readonly selectedCategory = computed<EditableManifestCategorySummary | null>(() => {
    const scope = this.selectedScope();
    if (!scope || scope.type !== 'category') {
      return null;
    }

    return this.editableCategorySummaries().find((category) => category.id === scope.id) ?? null;
  });

  protected readonly selectedLayer = computed<RuntimeLayerManifestLayer | null>(() => {
    const manifest = this.draftManifest();
    const scope = this.selectedScope();
    if (!manifest || !scope || scope.type !== 'layer') {
      return null;
    }

    return manifest.layers.find((layer) => layer.id === scope.id) ?? null;
  });

  protected readonly selectedSubcategory = computed<EditableManifestSubcategorySummary | null>(
    () => {
      const scope = this.selectedScope();
      if (!scope || scope.type !== 'subcategory') {
        return null;
      }
      const category = this.editableCategorySummaries().find(
        (entry) => entry.id === scope.categoryId,
      );
      return category?.subcategories.find((subcategory) => subcategory.id === scope.id) ?? null;
    },
  );

  /** @deprecated Template alias for `selectedSubcategory`; remove after template refresh. */
  protected readonly selectedSpeciesTaxon = this.selectedSubcategory;

  protected readonly selectedCategoryDefaults = computed<RuntimeLayerManifestColorDefaults>(() => {
    const manifest = this.draftManifest();
    const category = this.selectedCategory();
    if (!manifest || !category) {
      return {};
    }

    return getCategoryColorDefaults(manifest, category.id);
  });

  protected readonly selectedSubcategoryDefaults = computed<RuntimeLayerManifestColorDefaults>(
    () => {
      const manifest = this.draftManifest();
      const subcategory = this.selectedSubcategory();
      if (!manifest || !subcategory) {
        return {};
      }

      return getSubcategoryColorDefaults(manifest, subcategory.categoryId, subcategory.id);
    },
  );

  /** @deprecated Template alias; remove after template refresh. */
  protected readonly selectedSpeciesTaxonDefaults = this.selectedSubcategoryDefaults;

  protected readonly selectedLayerValidation = computed(() => {
    const layer = this.selectedLayer();
    return layer?.rendering ? validateRenderingConfig(layer.rendering) : {};
  });

  protected readonly selectedLayerIsEditable = computed(() => {
    const layer = this.selectedLayer();
    if (!layer || !layer.rendering) {
      return false;
    }
    return isEditableDataRole(layer.dataRole) && isEditableRenderMode(layer.rendering.renderMode);
  });

  protected readonly selectedCategoryValidation = computed(() =>
    validateColorDefaults(this.selectedCategoryDefaults()),
  );

  protected readonly selectedSubcategoryValidation = computed(() =>
    validateColorDefaults(this.selectedSubcategoryDefaults()),
  );

  protected readonly hasInvalidFields = computed(() =>
    [
      ...this.validationByLayerId().values(),
      ...this.validationByCategoryId().values(),
      this.selectedSubcategoryValidation(),
    ].some((validation) => Object.keys(validation).length > 0),
  );

  protected readonly diffSummary = computed(() => {
    const loaded = this.loadedManifest();
    const draft = this.draftManifest();
    if (!loaded || !draft) {
      return {
        changedLayerCount: 0,
        changedLayers: [],
        changedDefaultCount: 0,
        changedDefaults: [],
        changedOverrideCount: 0,
        changedOverrideLayers: [],
      };
    }

    return buildManifestDiffSummary(loaded, draft);
  });

  protected readonly hasUnsavedChanges = computed(() => {
    const diff = this.diffSummary();
    return (
      diff.changedLayerCount > 0 || diff.changedDefaultCount > 0 || diff.changedOverrideCount > 0
    );
  });

  protected readonly canPublish = computed(
    () =>
      !this.hasInvalidFields() &&
      this.hasUnsavedChanges() &&
      !!this.editorName().trim() &&
      this.publishState() !== 'loading',
  );

  protected readonly publishDisabledReason = computed<string | null>(() => {
    if (this.publishState() === 'loading') {
      return 'Publishing in progress...';
    }
    if (!this.hasUnsavedChanges()) {
      return 'Make a style change to enable Save review request.';
    }
    if (!this.editorName().trim()) {
      return 'Enter editorName to enable Save review request.';
    }
    if (this.hasInvalidFields()) {
      return 'Fix validation errors before publishing.';
    }
    return null;
  });

  protected readonly isLocalDevHost = computed(() => this.isRunningOnLocalhost());
  protected readonly usesLocalStyleRequestWorkflow = environment.bypassLoginForDevelopment;
  protected readonly localStyleRequestFileLocation = computed(
    () => `~/Downloads/${this.lastDownloadedStyledManifestFilename() ?? 'DOWNLOADED_FILE.json'}`,
  );
  protected readonly localStyleRequestPublishCommand = computed(
    () =>
      `npm run publish:styled-manifest -- --source ${this.localStyleRequestFileLocation()} --publish`,
  );

  protected readonly lastManualEdit = computed<RuntimeLayerManifestManualEdit | null>(() => {
    const draftManifest = this.draftManifest();
    return draftManifest?.manualEdit ?? null;
  });

  protected readonly lastManualEditLabel = computed(() => {
    const manualEdit = this.lastManualEdit();
    if (!manualEdit) {
      return null;
    }

    const editedAt = new Date(manualEdit.editedAt);
    const editedAtLabel = Number.isNaN(editedAt.getTime())
      ? manualEdit.editedAt
      : editedAt.toLocaleString();
    const sourceLabel = manualEdit.source ? ` (${manualEdit.source})` : '';
    return `${manualEdit.editorName} at ${editedAtLabel}${sourceLabel}`;
  });

  constructor() {
    effect(() => {
      this.layerManifestService.setStylePreviewManifest(this.draftManifest());
    });
  }

  protected async openEditor(): Promise<void> {
    this.isOpen.set(true);
    if (!this.draftManifest()) {
      await this.loadManifest();
      this.restoreDraftFromLocalStorage();
    }
  }

  protected closeEditor(): void {
    this.isOpen.set(false);
  }

  protected selectCategory(categoryId: string): void {
    const wasSelected = this.isSelectedCategory(categoryId);
    this.selectedScope.set({ type: 'category', id: categoryId });
    if (wasSelected) {
      this.toggleCategory(categoryId);
    } else {
      this.expandCategory(categoryId);
    }
  }

  protected selectSubcategory(categoryId: string, subcategoryId: string): void {
    this.selectedScope.set({ type: 'subcategory', categoryId, id: subcategoryId });
    this.expandCategory(categoryId);
  }

  /** @deprecated Kept for template compatibility; routes to `selectSubcategory`. */
  protected selectSpeciesTaxon(taxonId: string): void {
    this.selectSubcategory('species_and_biodiversity', taxonId);
  }

  protected selectLayer(layerId: string): void {
    this.selectedScope.set({ type: 'layer', id: layerId });
  }

  protected onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected onEditorNameInput(event: Event): void {
    this.editorName.set((event.target as HTMLInputElement).value);
  }

  protected updateCategoryColorField(fieldName: EditableDefaultColorField, event: Event): void {
    this.updateCategoryColorValue(fieldName, (event.target as HTMLInputElement).value);
  }

  protected updateCategoryColorFieldOnBlur(
    fieldName: EditableDefaultColorField,
    event: Event,
  ): void {
    const input = event.target as HTMLInputElement;
    const normalized = this.normalizeHexInput(input.value);
    input.value = normalized;
    this.updateCategoryColorValue(fieldName, normalized);
  }

  protected updateSpeciesTaxonColorField(fieldName: EditableDefaultColorField, event: Event): void {
    this.updateSubcategoryColorValue(fieldName, (event.target as HTMLInputElement).value);
  }

  protected updateSpeciesTaxonColorFieldOnBlur(
    fieldName: EditableDefaultColorField,
    event: Event,
  ): void {
    const input = event.target as HTMLInputElement;
    const normalized = this.normalizeHexInput(input.value);
    input.value = normalized;
    this.updateSubcategoryColorValue(fieldName, normalized);
  }

  protected updateColorField(fieldName: EditableRenderingColorField, event: Event): void {
    this.updateLayerColorValue(fieldName, (event.target as HTMLInputElement).value);
  }

  protected updateColorFieldOnBlur(fieldName: EditableRenderingColorField, event: Event): void {
    const input = event.target as HTMLInputElement;
    const normalized = this.normalizeHexInput(input.value);
    input.value = normalized;
    this.updateLayerColorValue(fieldName, normalized);
  }

  protected colorPickerValue(value: string | null | undefined, fallback: string): string {
    const normalized = this.normalizeHexInput(value ?? '');
    return normalized || fallback;
  }

  private updateCategoryColorValue(fieldName: EditableDefaultColorField, rawValue: string): void {
    const category = this.selectedCategory();
    if (!category) {
      return;
    }

    const defaults = {
      ...this.selectedCategoryDefaults(),
      [fieldName]: rawValue.trim(),
    };
    this.applyCategoryDefaults(category.id, defaults, false);
  }

  private updateSubcategoryColorValue(
    fieldName: EditableDefaultColorField,
    rawValue: string,
  ): void {
    const subcategory = this.selectedSubcategory();
    if (!subcategory) {
      return;
    }

    const defaults = {
      ...this.selectedSubcategoryDefaults(),
      [fieldName]: rawValue.trim(),
    };
    this.applySubcategoryDefaults(subcategory.categoryId, subcategory.id, defaults);
  }

  protected applySelectedCategoryDefaults(replaceOverrides: boolean): void {
    const category = this.selectedCategory();
    if (!category) {
      return;
    }

    this.applyCategoryDefaults(category.id, this.selectedCategoryDefaults(), replaceOverrides);
  }

  private updateLayerColorValue(fieldName: EditableRenderingColorField, rawValue: string): void {
    const inputValue = rawValue.trim();
    this.updateSelectedLayerRendering((rendering) => ({ ...rendering, [fieldName]: inputValue }));
    this.publishState.set('idle');
    this.publishMessage.set(null);
  }

  protected updateNumberField(fieldName: EditableRenderingNumberField, event: Event): void {
    const inputValue = (event.target as HTMLInputElement).value;
    const parsedValue = parseOptionalNumber(inputValue);
    this.updateSelectedLayerRendering((rendering) => ({
      ...rendering,
      [fieldName]: parsedValue,
    }));
    this.publishState.set('idle');
    this.publishMessage.set(null);
  }

  protected resetSelectedLayer(): void {
    const loaded = this.loadedManifest();
    const selected = this.selectedLayer();
    if (!loaded || !selected) {
      return;
    }

    const sourceLayer = loaded.layers.find((layer) => layer.id === selected.id);
    if (!sourceLayer) {
      return;
    }

    this.updateSelectedLayer((layer) => ({
      ...layer,
      rendering: structuredClone(sourceLayer.rendering),
      styleOverride: sourceLayer.styleOverride ?? null,
    }));
    this.publishState.set('idle');
    this.publishMessage.set(null);
  }

  protected clearSelectedLayerOverride(): void {
    const selected = this.selectedLayer();
    if (!selected) {
      return;
    }

    this.draftManifest.update((manifest) =>
      manifest ? clearLayerStyleOverride(manifest, selected.id) : manifest,
    );
    this.publishState.set('idle');
    this.publishMessage.set(null);
  }

  protected enableSelectedLayerOverride(): void {
    const manifest = this.draftManifest();
    const selected = this.selectedLayer();
    if (!manifest || !selected?.rendering) {
      return;
    }

    const inheritedDefaults = getCategoryColorDefaults(manifest, getLayerCategoryId(selected));
    this.updateSelectedLayer((layer) => ({
      ...layer,
      rendering: layer.rendering
        ? applyColorDefaultsToRendering(layer.rendering, inheritedDefaults)
        : layer.rendering,
      styleOverride: true,
    }));
    this.publishState.set('idle');
    this.publishMessage.set(null);
  }

  protected toggleSelectedLayerOverride(): void {
    const layer = this.selectedLayer();
    if (!layer) {
      return;
    }

    if (layer.styleOverride) {
      this.clearSelectedLayerOverride();
      return;
    }

    this.enableSelectedLayerOverride();
  }

  protected resetAllLayers(): void {
    const loaded = this.loadedManifest();
    if (!loaded) {
      return;
    }

    this.draftManifest.set(structuredClone(loaded));
    this.publishState.set('idle');
    this.publishMessage.set(null);
  }

  protected async saveStyleRequest(): Promise<void> {
    const loadedManifest = this.loadedManifest();
    const draftManifest = this.draftManifest();
    const editorName = this.editorName().trim();
    if (!loadedManifest || !draftManifest) {
      return;
    }
    if (!editorName) {
      this.localDraftMessage.set('Enter editorName before saving a style request.');
      return;
    }
    if (this.hasInvalidFields()) {
      this.localDraftMessage.set('Fix validation errors before saving a style request.');
      return;
    }
    if (!this.hasUnsavedChanges()) {
      this.localDraftMessage.set('Make a style change before saving a style request.');
      return;
    }

    if (environment.bypassLoginForDevelopment) {
      this.saveDraftToLocalStorage(draftManifest, editorName);
      const filename = this.downloadManifestFile(
        draftManifest,
        editorName,
        'manifest-style-editor-local-dev-request',
      );
      this.lastDownloadedStyledManifestFilename.set(filename);
      this.localDraftMessage.set(
        `Login bypass is enabled, so Firestore was skipped. Exported legacy local JSON ${filename}.`,
      );
      return;
    }

    let requestId: string | null = null;
    try {
      this.publishState.set('loading');
      this.publishMessage.set('Saving style request to Firestore...');
      this.saveDraftToLocalStorage(draftManifest, editorName);
      requestId = await this.styleRequestService.saveStyleRequest({
        editorName,
        status: 'pending',
        sourceManifestUrl: this.resolvedManifestUrl(),
        baseManifestVersion: loadedManifest.version ?? null,
        baseManifestGeneratedAt: loadedManifest.generatedAt ?? null,
        diffSummary: this.diffSummary() as ManifestStyleRequestDiffSummary,
        styleChanges: this.buildStyleChanges(loadedManifest, draftManifest),
      });
      this.publishState.set('loading');
      this.publishMessage.set(
        `Saved style request ${requestId}. Applying through trusted API route...`,
      );
      const publishResult = await this.styleRequestService.publishSavedStyleRequest(requestId);
      this.completePublishSuccess(draftManifest, publishResult);
      this.localDraftMessage.set(
        `Saved style request ${requestId} and published the updated manifest.`,
      );
    } catch (error) {
      if (requestId) {
        this.publishState.set('error');
        const errorMessage = this.describeSavedRequestPublishError(error);
        this.publishMessage.set(
          errorMessage || 'Automatic publish failed after the style request was saved.',
        );
        this.localDraftMessage.set(
          `Saved style request ${requestId}, but automatic publish failed. ${errorMessage}`,
        );
        return;
      }

      this.publishState.set('error');
      this.localDraftMessage.set(
        (error instanceof Error && error.message) ||
          'Style request save failed. Check Firebase configuration and Firestore permissions.',
      );
    }
  }

  protected downloadStyledManifest(): void {
    const draftManifest = this.draftManifest();
    const editorName = this.editorName().trim();
    if (!draftManifest) {
      return;
    }
    if (!editorName) {
      this.localDraftMessage.set('Enter editorName before downloading a styled manifest JSON.');
      return;
    }

    const filename = this.downloadManifestFile(
      draftManifest,
      editorName,
      'manifest-style-editor-download',
    );
    this.lastDownloadedStyledManifestFilename.set(filename);

    this.draftManifest.update((manifest) =>
      manifest
        ? {
            ...manifest,
            manualEdit: {
              editorName,
              editedAt: new Date().toISOString(),
              source: 'manifest-style-editor-download',
            },
          }
        : manifest,
    );
    this.localDraftMessage.set(
      `Downloaded legacy styled JSON ${filename}. Prefer Save review request for normal review.`,
    );
  }

  protected hasLayerValidationErrors(layerId: string): boolean {
    const validation = this.validationByLayerId().get(layerId);
    return !!validation && Object.keys(validation).length > 0;
  }

  protected fieldErrors(fieldName: string): string[] {
    const layerValidation = this.selectedLayerValidation();
    const categoryValidation = this.selectedCategoryValidation();
    const subcategoryValidation = this.selectedSubcategoryValidation();
    return (
      layerValidation[fieldName] ??
      categoryValidation[fieldName] ??
      subcategoryValidation[fieldName] ??
      []
    );
  }

  protected renderLayerPreviewStyle(layer: RuntimeLayerManifestLayer): string {
    const rendering = this.effectiveLayerRendering(layer);
    if (!rendering) {
      return 'background:#e2e8f0';
    }
    return this.renderPreviewStyle(rendering);
  }

  protected renderCategoryPreviewStyle(defaults: RuntimeLayerManifestColorDefaults): string {
    return this.renderDefaultSwatchStyle(defaults);
  }

  protected renderMaskDefaultPreviewStyle(defaults: RuntimeLayerManifestColorDefaults): string {
    return `background:${defaults.selectedColor ?? '#22c55e'}`;
  }

  protected renderGradientDefaultPreviewStyle(defaults: RuntimeLayerManifestColorDefaults): string {
    const startColor = defaults.startColor ?? '#d1fae5';
    const endColor = defaults.endColor ?? '#166534';
    return `background:linear-gradient(90deg, ${startColor} 0%, ${endColor} 100%)`;
  }

  protected isCategoryExpanded(categoryId: string): boolean {
    return this.expandedCategoryIds().has(categoryId);
  }

  protected isSelectedCategory(categoryId: string): boolean {
    const scope = this.selectedScope();
    return scope?.type === 'category' && scope.id === categoryId;
  }

  protected isSelectedSubcategory(categoryId: string, subcategoryId: string): boolean {
    const scope = this.selectedScope();
    return (
      scope?.type === 'subcategory' && scope.categoryId === categoryId && scope.id === subcategoryId
    );
  }

  /** @deprecated Kept for template compatibility. */
  protected isSelectedSpeciesTaxon(taxonId: string): boolean {
    return this.isSelectedSubcategory('species_and_biodiversity', taxonId);
  }

  protected isSelectedLayer(layerId: string): boolean {
    const scope = this.selectedScope();
    return scope?.type === 'layer' && scope.id === layerId;
  }

  protected layerRenderModeLabel(layer: RuntimeLayerManifestLayer): string {
    const rendering = (layer as { rendering?: RuntimeLayerManifestRenderingConfig | null })
      .rendering;
    return rendering?.renderMode ?? 'unconfigured';
  }

  protected layerValueTypeLabel(layer: RuntimeLayerManifestLayer): string {
    const rendering = (layer as { rendering?: RuntimeLayerManifestRenderingConfig | null })
      .rendering;
    return rendering?.valueType ?? 'unconfigured';
  }

  protected isLayerRenderMode(
    layer: RuntimeLayerManifestLayer,
    mode: 'mask' | 'gradient',
  ): boolean {
    const rendering = (layer as { rendering?: RuntimeLayerManifestRenderingConfig | null })
      .rendering;
    return rendering?.renderMode === mode;
  }

  protected layerUsesOverride(layer: RuntimeLayerManifestLayer): boolean {
    return Boolean(layer.styleOverride);
  }

  protected trackCategory(_: number, category: EditableManifestCategorySummary): string {
    return category.id;
  }

  protected trackLayer(_: number, layer: EditableManifestLayerSummary): string {
    return layer.id;
  }

  protected trackSpeciesTaxon(_: number, subcategory: EditableManifestSubcategorySummary): string {
    return subcategory.id;
  }

  protected trackSubcategory(_: number, subcategory: EditableManifestSubcategorySummary): string {
    return subcategory.id;
  }

  private completePublishSuccess(
    draftManifest: RuntimeLayerManifest,
    payload: { targetPath?: string; archivePath?: string; manifestUrl?: string } | null,
  ): void {
    this.publishTargetPath.set(payload?.targetPath ?? 'manifest/manifest.json');
    this.publishArchivePath.set(payload?.archivePath ?? '');
    this.publishedManifestUrl.set(payload?.manifestUrl ?? '');
    this.publishState.set('success');
    this.publishMessage.set('Published and archived the previous manifest.');
    this.loadedManifest.set(structuredClone(draftManifest));
  }

  private describeSavedRequestPublishError(error: unknown): string {
    if (this.isLocalDevApiRouteMissing(error)) {
      return 'Angular ng serve does not host Vercel API routes, so /api/dev/manifest-style-publish returns 404 on localhost. To apply this saved request locally, run the legacy fallback command from frontend; otherwise test the automatic route in Vercel.';
    }

    return (
      (error instanceof Error && error.message) ||
      'Use the legacy fallback only if the trusted API route cannot be fixed quickly.'
    );
  }

  private isLocalDevApiRouteMissing(error: unknown): boolean {
    return (
      error instanceof Error && error.message.includes('HTTP 404') && this.isRunningOnLocalhost()
    );
  }

  private isRunningOnLocalhost(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const hostname = window.location.hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }

  private downloadManifestFile(
    draftManifest: RuntimeLayerManifest,
    editorName: string,
    source: string,
  ): string {
    const { filename, manifest } = this.buildStyledManifestFile(draftManifest, editorName, source);
    this.downloadManifestBlob(manifest, filename);
    return filename;
  }

  private buildStyledManifestFile(
    draftManifest: RuntimeLayerManifest,
    editorName: string,
    source: string,
  ): { filename: string; manifest: RuntimeLayerManifest } {
    const exportedAt = new Date().toISOString();
    const manualEdit: RuntimeLayerManifestManualEdit = {
      editorName,
      editedAt: exportedAt,
      source,
    };
    const manifestToDownload: RuntimeLayerManifest = {
      ...draftManifest,
      manualEdit,
    };

    const fileSafeEditor = editorName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const timestamp = exportedAt.replace(/[:.]/g, '-');
    const filename = `manifest.styled.${fileSafeEditor || 'unknown-editor'}.${timestamp}.json`;
    return { filename, manifest: manifestToDownload };
  }

  private buildStyleChanges(
    loadedManifest: RuntimeLayerManifest,
    draftManifest: RuntimeLayerManifest,
  ): ManifestStyleRequestChanges {
    const categoryDefaults = [];
    const subcategoryDefaults = [];
    const loadedCategoriesById = new Map(
      loadedManifest.categories.map((category) => [category.id, category]),
    );

    for (const draftCategory of draftManifest.categories) {
      const loadedCategory = loadedCategoriesById.get(draftCategory.id);
      if (
        loadedCategory &&
        !this.jsonEqual(loadedCategory.styleDefaults ?? null, draftCategory.styleDefaults ?? null)
      ) {
        categoryDefaults.push({
          categoryId: draftCategory.id,
          styleDefaults: structuredClone(draftCategory.styleDefaults ?? {}),
        });
      }

      const loadedSubcategoriesById = new Map(
        (loadedCategory?.subcategories ?? []).map((subcategory) => [subcategory.id, subcategory]),
      );
      for (const draftSubcategory of draftCategory.subcategories ?? []) {
        const loadedSubcategory = loadedSubcategoriesById.get(draftSubcategory.id);
        if (
          loadedSubcategory &&
          !this.jsonEqual(
            loadedSubcategory.styleDefaults ?? null,
            draftSubcategory.styleDefaults ?? null,
          )
        ) {
          subcategoryDefaults.push({
            categoryId: draftCategory.id,
            subcategoryId: draftSubcategory.id,
            styleDefaults: structuredClone(draftSubcategory.styleDefaults ?? {}),
          });
        }
      }
    }

    const loadedLayersById = new Map(loadedManifest.layers.map((layer) => [layer.id, layer]));
    const layerStyles = draftManifest.layers
      .map((draftLayer) => {
        const loadedLayer = loadedLayersById.get(draftLayer.id);
        if (
          !loadedLayer ||
          (!draftLayer.rendering && !loadedLayer.rendering) ||
          (this.jsonEqual(loadedLayer.rendering ?? null, draftLayer.rendering ?? null) &&
            (loadedLayer.styleOverride ?? null) === (draftLayer.styleOverride ?? null))
        ) {
          return null;
        }

        return draftLayer.rendering
          ? {
              layerId: draftLayer.id,
              rendering: structuredClone(draftLayer.rendering),
              styleOverride: draftLayer.styleOverride ?? null,
            }
          : null;
      })
      .filter((change): change is ManifestStyleRequestChanges['layerStyles'][number] => !!change);

    return { categoryDefaults, subcategoryDefaults, layerStyles };
  }

  private jsonEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  private downloadManifestBlob(manifest: RuntimeLayerManifest, filename: string): void {
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: 'application/json',
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  private async saveManifestWithPicker(
    manifest: RuntimeLayerManifest,
    filename: string,
  ): Promise<void> {
    const pickerGlobal = globalThis as typeof globalThis & BrowserSaveFilePicker;
    if (!pickerGlobal.showSaveFilePicker) {
      throw new Error('Browser file picker is unavailable.');
    }

    const fileHandle = await pickerGlobal.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: 'Styled layer manifest JSON',
          accept: { 'application/json': ['.json'] },
        },
      ],
    });
    const writable = await fileHandle.createWritable();
    await writable.write(
      new Blob([JSON.stringify(manifest, null, 2)], {
        type: 'application/json',
      }),
    );
    await writable.close();
  }

  private canSaveToLocalFile(): boolean {
    return (
      typeof (globalThis as typeof globalThis & BrowserSaveFilePicker).showSaveFilePicker ===
      'function'
    );
  }

  private saveDraftToLocalStorage(manifest: RuntimeLayerManifest, editorName: string): void {
    try {
      const payload = {
        savedAt: new Date().toISOString(),
        editorName,
        sourceManifestUrl: this.resolvedManifestUrl(),
        manifest,
      };
      localStorage.setItem(this.localStorageKey, JSON.stringify(payload));
    } catch {
      // Firestore is the publish source of truth; browser storage is only a restore aid.
    }
  }

  private async loadManifest(): Promise<void> {
    this.isLoadingManifest.set(true);
    this.loadError.set(null);
    try {
      const [manifest, manifestUrl] = await Promise.all([
        firstValueFrom(this.layerManifestService.getManifest()),
        firstValueFrom(this.layerManifestService.getResolvedManifestUrl()),
      ]);
      const normalizedManifest = normalizeManifestForEditor(manifest);
      this.assertManifestLayerCategories(normalizedManifest);
      this.assertManifestSolutions(normalizedManifest);
      this.loadedManifest.set(structuredClone(normalizedManifest));
      this.draftManifest.set(structuredClone(normalizedManifest));
      this.resolvedManifestUrl.set(manifestUrl);
      this.selectedScope.set(this.initialScopeForManifest(normalizedManifest));
      this.expandInitialScope();
    } catch (error) {
      this.loadError.set(
        (error instanceof Error && error.message) || 'Failed to load manifest for style editing.',
      );
    } finally {
      this.isLoadingManifest.set(false);
    }
  }

  private applyCategoryDefaults(
    categoryId: string,
    defaults: RuntimeLayerManifestColorDefaults,
    replaceOverrides: boolean,
  ): void {
    this.draftManifest.update((manifest) =>
      manifest
        ? applyCategoryColorDefaults(manifest, categoryId, defaults, { replaceOverrides })
        : manifest,
    );
    this.publishState.set('idle');
    this.publishMessage.set(null);
  }

  private applySubcategoryDefaults(
    categoryId: string,
    subcategoryId: string,
    defaults: RuntimeLayerManifestColorDefaults,
  ): void {
    this.draftManifest.update((manifest) =>
      manifest
        ? setSubcategoryColorDefaults(manifest, categoryId, subcategoryId, defaults)
        : manifest,
    );
    this.publishState.set('idle');
    this.publishMessage.set(null);
  }

  private updateSelectedLayerRendering(
    updater: (
      rendering: RuntimeLayerManifestRenderingConfig,
    ) => RuntimeLayerManifestRenderingConfig,
  ): void {
    const selected = this.selectedLayer();
    if (!selected?.rendering) {
      return;
    }

    this.updateSelectedLayer((layer) => ({
      ...layer,
      rendering: updater({ ...layer.rendering! }),
      styleOverride: true,
    }));
  }

  private updateSelectedLayer(
    updater: (layer: RuntimeLayerManifestLayer) => RuntimeLayerManifestLayer,
  ): void {
    const selected = this.selectedLayer();
    if (!selected) {
      return;
    }

    this.draftManifest.update((manifest) => {
      if (!manifest) {
        return manifest;
      }

      return {
        ...manifest,
        layers: manifest.layers.map((layer) => (layer.id === selected.id ? updater(layer) : layer)),
      };
    });
  }

  private restoreDraftFromLocalStorage(): void {
    try {
      const rawValue = localStorage.getItem(this.localStorageKey);
      if (!rawValue) {
        return;
      }
      const parsed = JSON.parse(rawValue) as {
        manifest?: RuntimeLayerManifest;
        editorName?: string;
        sourceManifestUrl?: string;
        savedAt?: string;
      };
      if (parsed.manifest) {
        const loadedManifest = this.loadedManifest();
        const currentManifestUrl = this.resolvedManifestUrl();
        const sourceMatchesCurrent =
          !parsed.sourceManifestUrl || parsed.sourceManifestUrl === currentManifestUrl;

        if (!sourceMatchesCurrent) {
          localStorage.removeItem(this.localStorageKey);
          this.localDraftMessage.set(
            'Saved local draft came from a different manifest source and was dropped.',
          );
          return;
        }

        const normalizedManifest = normalizeManifestForEditor(parsed.manifest);
        try {
          this.assertManifestLayerCategories(normalizedManifest);
          this.assertManifestSolutions(normalizedManifest);
        } catch {
          localStorage.removeItem(this.localStorageKey);
          this.localDraftMessage.set(
            'Saved local draft had invalid layer categories or missing solutions and was dropped.',
          );
          return;
        }

        const draftVersion = parsed.manifest.version ?? null;
        const loadedVersion = loadedManifest?.version ?? null;
        const isVersionMismatch =
          !!loadedManifest && !!draftVersion && !!loadedVersion && draftVersion !== loadedVersion;

        if (isVersionMismatch) {
          localStorage.removeItem(this.localStorageKey);
          this.localDraftMessage.set(
            `Saved local draft targets manifest v${draftVersion}; current manifest is v${loadedVersion}. Draft dropped.`,
          );
          return;
        }

        const draftGeneratedAt = parsed.manifest.generatedAt ?? null;
        const loadedGeneratedAt = loadedManifest?.generatedAt ?? null;
        const draftEditFingerprint = this.manifestEditFingerprint(parsed.manifest);
        const loadedEditFingerprint = loadedManifest
          ? this.manifestEditFingerprint(loadedManifest)
          : null;
        const draftSavedAtMs = parsed.savedAt ? Date.parse(parsed.savedAt) : Number.NaN;
        const loadedEditedAtMs = loadedManifest?.manualEdit?.editedAt
          ? Date.parse(loadedManifest.manualEdit.editedAt)
          : Number.NaN;
        const draftPredatesLoadedEdit =
          Number.isFinite(draftSavedAtMs) &&
          Number.isFinite(loadedEditedAtMs) &&
          draftSavedAtMs < loadedEditedAtMs;
        const isStaleAgainstLoaded =
          !!loadedManifest &&
          sourceMatchesCurrent &&
          ((!!draftGeneratedAt && !!loadedGeneratedAt && draftGeneratedAt !== loadedGeneratedAt) ||
            (!!draftEditFingerprint &&
              !!loadedEditFingerprint &&
              draftEditFingerprint !== loadedEditFingerprint) ||
            (!draftEditFingerprint && !!loadedEditFingerprint) ||
            draftPredatesLoadedEdit);

        if (isStaleAgainstLoaded) {
          localStorage.removeItem(this.localStorageKey);
          this.localDraftMessage.set(
            'Saved local draft targets an older manifest snapshot and was dropped.',
          );
        } else {
          const initialScope = this.initialScopeForManifest(normalizedManifest);
          this.draftManifest.set(normalizedManifest);
          this.selectedScope.set(initialScope);
          this.expandInitialScope();
        }
      }
      if (parsed.editorName) {
        this.editorName.set(parsed.editorName);
      }
    } catch {
      this.localDraftMessage.set('Saved draft was unreadable and was ignored.');
      localStorage.removeItem(this.localStorageKey);
    }
  }

  private assertManifestLayerCategories(manifest: RuntimeLayerManifest): void {
    const categoryIds = new Set(manifest.categories.map((category) => category.id));
    const subcategoryIdsByCategory = new Map(
      manifest.categories.map((category) => [
        category.id,
        new Set((category.subcategories ?? []).map((subcategory) => subcategory.id)),
      ]),
    );

    for (const layer of manifest.layers) {
      const { categoryId, subcategoryId } = parseCategoryPath(layer.category);
      if (!categoryIds.has(categoryId)) {
        throw new Error(`Layer "${layer.id}" references missing category "${categoryId}".`);
      }
      if (subcategoryId && !subcategoryIdsByCategory.get(categoryId)?.has(subcategoryId)) {
        throw new Error(
          `Layer "${layer.id}" references missing subcategory "${categoryId}.${subcategoryId}".`,
        );
      }
    }
  }

  private manifestEditFingerprint(manifest: RuntimeLayerManifest): string | null {
    const manualEdit = manifest.manualEdit;
    if (!manualEdit?.editedAt) {
      return null;
    }
    return [manualEdit.editedAt, manualEdit.editorName, manualEdit.source ?? ''].join('|');
  }

  private assertManifestSolutions(manifest: RuntimeLayerManifest): void {
    if (!Array.isArray(manifest.solutions)) {
      throw new Error('Manifest solutions must be an array.');
    }
  }

  private initialScopeForManifest(manifest: RuntimeLayerManifest): ManifestStyleEditorScope | null {
    const firstEditableCategory = manifest.categories.find((category) =>
      manifest.layers.some(
        (layer) =>
          getLayerCategoryId(layer) === category.id &&
          isEditableDataRole(layer.dataRole) &&
          layer.rendering &&
          isEditableRenderMode(layer.rendering.renderMode),
      ),
    );

    return firstEditableCategory ? { type: 'category', id: firstEditableCategory.id } : null;
  }

  private expandInitialScope(): void {
    const scope = this.selectedScope();
    if (scope?.type === 'category') {
      this.expandCategory(scope.id);
    }
  }

  private expandCategory(categoryId: string): void {
    const expanded = new Set(this.expandedCategoryIds());
    expanded.add(categoryId);
    this.expandedCategoryIds.set(expanded);
  }

  private toggleCategory(categoryId: string): void {
    const expanded = new Set(this.expandedCategoryIds());
    if (expanded.has(categoryId)) {
      expanded.delete(categoryId);
    } else {
      expanded.add(categoryId);
    }
    this.expandedCategoryIds.set(expanded);
  }

  private toCategorySummary(
    manifest: RuntimeLayerManifest,
    category: RuntimeLayerManifestCategory,
  ): EditableManifestCategorySummary {
    const layersById = new Map(manifest.layers.map((layer) => [layer.id, layer]));
    const orderedLayers = [
      ...category.layerIds
        .map((layerId) => layersById.get(layerId))
        .filter(
          (layer): layer is RuntimeLayerManifestLayer =>
            !!layer && getLayerCategoryId(layer) === category.id,
        ),
      ...manifest.layers.filter(
        (layer) =>
          getLayerCategoryId(layer) === category.id && !category.layerIds.includes(layer.id),
      ),
    ];
    const editableLayers = orderedLayers.filter(
      (layer) =>
        isEditableDataRole(layer.dataRole) &&
        layer.rendering &&
        isEditableRenderMode(layer.rendering.renderMode),
    );
    const categoryValidation = this.validationByCategoryId().get(category.id);

    const subcategorySummaries = (category.subcategories ?? []).map((subcategory) =>
      this.toSubcategorySummary(manifest, category, subcategory),
    );

    return {
      id: category.id,
      title: category.englishLabel ?? category.spanishLabel,
      layerCount: orderedLayers.length,
      editableLayerCount: editableLayers.length,
      overrideCount: editableLayers.filter((layer) => layer.styleOverride).length,
      hasValidationErrors: !!categoryValidation && Object.keys(categoryValidation).length > 0,
      swatchStyle: this.renderDefaultSwatchStyle(getCategoryColorDefaults(manifest, category.id)),
      subcategories: subcategorySummaries,
      speciesTaxa: subcategorySummaries,
      layers: orderedLayers.map((layer) => {
        const rendering = layer.rendering;
        const isEditable =
          isEditableDataRole(layer.dataRole) &&
          !!rendering &&
          isEditableRenderMode(rendering.renderMode);
        const layerValidation = this.validationByLayerId().get(layer.id);
        return {
          id: layer.id,
          title: layer.englishLabel ?? layer.spanishLabel,
          dataRole: layer.dataRole,
          renderMode: rendering?.renderMode ?? 'unconfigured',
          valueType: rendering?.valueType ?? 'unconfigured',
          isEditable,
          styleOverride: Boolean(layer.styleOverride),
          hasValidationErrors:
            isEditable && !!layerValidation && Object.keys(layerValidation).length > 0,
          swatchStyle: this.renderLayerPreviewStyle(layer),
          usesCategoricalSwatch: this.usesCategoricalSwatch(layer),
        };
      }),
    };
  }

  private toSubcategorySummary(
    manifest: RuntimeLayerManifest,
    category: RuntimeLayerManifestCategory,
    subcategory: RuntimeLayerManifestSubcategory,
  ): EditableManifestSubcategorySummary {
    return {
      id: subcategory.id,
      categoryId: category.id,
      title: subcategory.englishLabel ?? subcategory.spanishLabel ?? subcategory.id,
      layerCount: subcategory.layerIds?.length ?? 0,
      swatchStyle: this.renderDefaultSwatchStyle(
        getSubcategoryColorDefaults(manifest, category.id, subcategory.id),
      ),
    };
  }

  private normalizeHexInput(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    return /^#[\da-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : trimmed;
  }

  private renderPreviewStyle(rendering: RuntimeLayerManifestRenderingConfig): string {
    if (rendering.renderMode === 'mask') {
      return `background:${rendering.selectedColor ?? '#ffffff'}`;
    }

    const startColor = rendering.startColor ?? '#d1fae5';
    const endColor = rendering.endColor ?? '#166534';
    return `background:linear-gradient(90deg, ${startColor} 0%, ${endColor} 100%)`;
  }

  private renderDefaultSwatchStyle(defaults: RuntimeLayerManifestColorDefaults): string {
    const selectedColor = defaults.selectedColor;
    const startColor = defaults.startColor;
    const endColor = defaults.endColor;

    if (selectedColor && startColor && endColor) {
      return `background:linear-gradient(90deg, ${selectedColor} 0%, ${selectedColor} 42%, ${startColor} 52%, ${endColor} 100%)`;
    }

    if (startColor || endColor) {
      return this.renderGradientDefaultPreviewStyle(defaults);
    }

    return this.renderMaskDefaultPreviewStyle(defaults);
  }

  private effectiveLayerRendering(
    layer: RuntimeLayerManifestLayer,
  ): RuntimeLayerManifestRenderingConfig | null {
    if (!layer.rendering) {
      return null;
    }

    if (layer.styleOverride) {
      return layer.rendering;
    }

    const manifest = this.draftManifest();
    if (!manifest) {
      return layer.rendering;
    }

    const defaults = getCategoryColorDefaults(manifest, getLayerCategoryId(layer));
    return applyColorDefaultsToRendering(layer.rendering, defaults);
  }

  private usesCategoricalSwatch(layer: RuntimeLayerManifestLayer): boolean {
    return (
      layer.rendering?.renderMode === 'categorical' ||
      layer.id === 'siraps' ||
      layer.id === 'admin_municipalities' ||
      layer.id === 'admin_departments'
    );
  }
}
