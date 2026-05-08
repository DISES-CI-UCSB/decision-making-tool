import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import type {
  RuntimeLayerManifest,
  RuntimeLayerManifestLayer,
  RuntimeLayerManifestRenderingConfig,
} from '@core/models/layer-manifest.model';
import { LayerManifestService } from '@core/services/layer-manifest.service';
import { firstValueFrom } from 'rxjs';
import {
  buildManifestDiffSummary,
  isEditableDataRole,
  isEditableRenderMode,
  normalizeManifestForEditor,
  parseOptionalNumber,
  validateRenderingConfig,
} from './manifest-style-editor.utils';

interface EditableManifestLayerSummary {
  id: string;
  title: string;
  dataRole: string;
  renderMode: string;
  valueType: string;
}

type EditableRenderingNumberField = 'selectedValue' | 'noDataValue' | 'minValue' | 'maxValue';
type EditableRenderingColorField = 'selectedColor' | 'startColor' | 'endColor';

@Component({
  selector: 'app-manifest-style-editor-overlay',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './manifest-style-editor-overlay.html',
  styleUrl: './manifest-style-editor-overlay.scss',
})
export class ManifestStyleEditorOverlayComponent {
  private readonly layerManifestService = inject(LayerManifestService);
  private readonly localStorageKey = 'eco-plan:manifest-style-editor:draft';

  protected readonly isOpen = signal(false);
  protected readonly isLoadingManifest = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loadedManifest = signal<RuntimeLayerManifest | null>(null);
  protected readonly draftManifest = signal<RuntimeLayerManifest | null>(null);
  protected readonly resolvedManifestUrl = signal('');
  protected readonly selectedLayerId = signal('');
  protected readonly searchQuery = signal('');
  protected readonly editorName = signal('');
  protected readonly confirmPublishOpen = signal(false);
  protected readonly publishState = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
  protected readonly publishMessage = signal<string | null>(null);
  protected readonly publishCommand = signal('');
  protected readonly publishTargetPath = signal('');
  protected readonly publishArchivePath = signal('');
  protected readonly localDraftMessage = signal<string | null>(null);

  protected readonly editableLayerSummaries = computed<EditableManifestLayerSummary[]>(() => {
    const manifest = this.draftManifest();
    if (!manifest) {
      return [];
    }
    return manifest.layers
      .filter(
        (layer) =>
          isEditableDataRole(layer.dataRole) &&
          layer.rendering &&
          isEditableRenderMode(layer.rendering.renderMode),
      )
      .map((layer) => ({
        id: layer.id,
        title: layer.englishLabel ?? layer.spanishLabel,
        dataRole: layer.dataRole,
        renderMode: layer.rendering.renderMode,
        valueType: layer.rendering.valueType,
      }));
  });

  protected readonly filteredLayerSummaries = computed(() => {
    const normalizedQuery = this.searchQuery().trim().toLowerCase();
    if (!normalizedQuery) {
      return this.editableLayerSummaries();
    }
    return this.editableLayerSummaries().filter((layer) =>
      `${layer.id} ${layer.title} ${layer.dataRole}`.toLowerCase().includes(normalizedQuery),
    );
  });

  protected readonly selectedLayer = computed<RuntimeLayerManifestLayer | null>(() => {
    const manifest = this.draftManifest();
    const selectedId = this.selectedLayerId();
    if (!manifest || !selectedId) {
      return null;
    }
    return manifest.layers.find((layer) => layer.id === selectedId) ?? null;
  });

  protected readonly selectedLayerValidation = computed(() => {
    const layer = this.selectedLayer();
    if (!layer) {
      return {};
    }
    return validateRenderingConfig(layer.rendering);
  });

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

  protected readonly hasInvalidFields = computed(() =>
    Array.from(this.validationByLayerId().values()).some(
      (validation) => Object.keys(validation).length > 0,
    ),
  );

  protected readonly diffSummary = computed(() => {
    const loaded = this.loadedManifest();
    const draft = this.draftManifest();
    if (!loaded || !draft) {
      return { changedLayerCount: 0, changedLayers: [] };
    }
    return buildManifestDiffSummary(loaded, draft);
  });

  protected readonly hasUnsavedChanges = computed(() => this.diffSummary().changedLayerCount > 0);

  protected async openEditor(): Promise<void> {
    this.isOpen.set(true);
    if (!this.draftManifest()) {
      await this.loadManifest();
      this.restoreDraftFromLocalStorage();
    }
  }

  protected closeEditor(): void {
    this.isOpen.set(false);
    this.confirmPublishOpen.set(false);
  }

  protected selectLayer(layerId: string): void {
    this.selectedLayerId.set(layerId);
  }

  protected onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected onEditorNameInput(event: Event): void {
    this.editorName.set((event.target as HTMLInputElement).value);
  }

  protected updateColorField(fieldName: EditableRenderingColorField, event: Event): void {
    const inputValue = (event.target as HTMLInputElement).value.trim();
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

    this.updateSelectedLayerRendering(() => structuredClone(sourceLayer.rendering));
    this.publishState.set('idle');
    this.publishMessage.set(null);
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

  protected saveDraftLocally(): void {
    const draftManifest = this.draftManifest();
    if (!draftManifest) {
      return;
    }

    try {
      const payload = {
        savedAt: new Date().toISOString(),
        editorName: this.editorName().trim(),
        sourceManifestUrl: this.resolvedManifestUrl(),
        manifest: draftManifest,
      };
      localStorage.setItem(this.localStorageKey, JSON.stringify(payload));
      this.localDraftMessage.set('Draft saved in localStorage for this browser.');
    } catch {
      this.localDraftMessage.set('Draft save failed. Browser storage may be unavailable.');
    }
  }

  protected requestPublish(): void {
    this.confirmPublishOpen.set(true);
  }

  protected cancelPublish(): void {
    this.confirmPublishOpen.set(false);
  }

  protected async confirmPublish(): Promise<void> {
    const draftManifest = this.draftManifest();
    if (!draftManifest || this.hasInvalidFields()) {
      return;
    }

    this.publishState.set('loading');
    this.publishMessage.set('Preparing publish files...');
    this.confirmPublishOpen.set(false);

    try {
      const timestamp = this.toSafeTimestamp(new Date().toISOString());
      const manifestFileName = `manifest.style-editor.${timestamp}.json`;
      const payloadFileName = `manifest.publish-request.${timestamp}.json`;
      const targetPath = 'manifest/manifest.json';
      const archivePath = `manifest/archive/manifest.${timestamp}.json`;
      const payload = {
        editorName: this.editorName().trim() || 'unknown-editor',
        generatedAt: new Date().toISOString(),
        publishTargetPath: targetPath,
        archivePrefix: 'manifest/archive/',
        expectedArchivePath: archivePath,
        diffSummary: this.diffSummary(),
        sourceManifestUrl: this.resolvedManifestUrl(),
      };

      this.downloadJsonFile(manifestFileName, draftManifest);
      this.downloadJsonFile(payloadFileName, payload);

      const command =
        `npm --prefix frontend run publish:layer-manifest -- ` +
        `--source "$HOME/Downloads/${manifestFileName}" ` +
        `--target ${targetPath} --archive-prefix manifest/archive/`;
      this.publishCommand.set(command);
      this.publishTargetPath.set(targetPath);
      this.publishArchivePath.set(archivePath);

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      }

      this.publishState.set('success');
      this.publishMessage.set(
        'Export complete. Command copied to clipboard. Run it locally to publish and archive.',
      );
    } catch {
      this.publishState.set('error');
      this.publishMessage.set(
        'Export failed. Retry publish export or manually copy the manifest JSON from browser devtools.',
      );
    }
  }

  protected hasLayerValidationErrors(layerId: string): boolean {
    const validation = this.validationByLayerId().get(layerId);
    return !!validation && Object.keys(validation).length > 0;
  }

  protected fieldErrors(fieldName: string): string[] {
    const validation = this.selectedLayerValidation();
    return validation[fieldName] ?? [];
  }

  protected renderPreviewStyle(layer: RuntimeLayerManifestLayer): string {
    const rendering = layer.rendering;
    if (!rendering) {
      return 'background:#e2e8f0';
    }
    if (rendering.renderMode === 'mask') {
      return `background:${rendering.selectedColor ?? '#ffffff'}`;
    }
    const startColor = rendering.startColor ?? '#d1fae5';
    const endColor = rendering.endColor ?? '#166534';
    return `background:linear-gradient(90deg, ${startColor} 0%, ${endColor} 100%)`;
  }

  protected trackLayer(_: number, layer: EditableManifestLayerSummary): string {
    return layer.id;
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
      this.loadedManifest.set(structuredClone(manifest));
      this.draftManifest.set(structuredClone(normalizedManifest));
      this.resolvedManifestUrl.set(manifestUrl);
      this.selectedLayerId.set(
        normalizedManifest.layers.find(
          (layer) =>
            isEditableDataRole(layer.dataRole) &&
            layer.rendering &&
            isEditableRenderMode(layer.rendering.renderMode),
        )?.id ?? '',
      );
    } catch (error) {
      this.loadError.set(
        (error instanceof Error && error.message) || 'Failed to load manifest for style editing.',
      );
    } finally {
      this.isLoadingManifest.set(false);
    }
  }

  private updateSelectedLayerRendering(
    updater: (
      rendering: RuntimeLayerManifestRenderingConfig,
    ) => RuntimeLayerManifestRenderingConfig,
  ): void {
    const selectedId = this.selectedLayerId();
    if (!selectedId) {
      return;
    }

    this.draftManifest.update((manifest) => {
      if (!manifest) {
        return manifest;
      }
      return {
        ...manifest,
        layers: manifest.layers.map((layer) =>
          layer.id === selectedId
            ? { ...layer, rendering: updater({ ...layer.rendering }) }
            : layer,
        ),
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
      };
      if (parsed.manifest) {
        this.draftManifest.set(parsed.manifest);
      }
      if (parsed.editorName) {
        this.editorName.set(parsed.editorName);
      }
    } catch {
      this.localDraftMessage.set('Saved draft was unreadable and was ignored.');
    }
  }

  private downloadJsonFile(fileName: string, payload: unknown): void {
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    const blob = new Blob([json], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  private toSafeTimestamp(isoDate: string): string {
    return isoDate.replaceAll(':', '-').replaceAll('.', '-');
  }
}
