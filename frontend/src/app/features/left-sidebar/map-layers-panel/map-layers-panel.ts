import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule, DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ColorPickerComponent, ColorPickerDirective } from 'ngx-color-picker';

import {
  buildSolutionIdentitySummary,
  buildManifestSidebarLayerGroups,
  type AoiType,
  type ManifestSidebarLayerGroup,
  type ManifestSidebarLayerRow,
  type RuntimeLayerManifest,
  type RuntimeLayerManifestRenderingConfig,
  type RuntimeSpeciesManifest,
  type RuntimeSpeciesManifestLayer,
  type Solution,
  type SolutionIdentitySummary,
} from '@core/models';
import { AppLocaleService } from '@core/services/app-locale.service';
import { AppStateService, type MapLegendLayerEntry } from '@core/services/app-state.service';
import { SavedSolutionScenariosService } from '@core/services/saved-solution-scenarios.service';
import { LayerManifestService } from '@core/services/layer-manifest.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import {
  AdminBoundaryService,
  type AdminBoundaryLayerKey,
} from '@features/map/services/admin-boundary.service';
import {
  ManifestRasterLayerService,
  OMEC_OVERLAY_LAYER_ID,
  RUNAP_OVERLAY_LAYER_ID,
  RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
  VECTOR_OVERLAY_LAYER_IDS,
} from '@features/map/services/manifest-raster-layer.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { useOverlayScrollbar } from '@core/shared/overlay-scrollbar/use-overlay-scrollbar';
import { catchError, map, of, switchMap } from 'rxjs';
import {
  buildConsideredLayerIdSet,
  buildLegendCategories,
  buildLegendLayerEntry,
  shouldIncludeInMasterLegend,
  computeSelectedLayerOrder,
  isLayerAvailableForScope,
  nameMatchesSearch,
  normalizeSelectedLayerOrder,
  reorderRowsByDropTarget,
  reorderRowsById,
  individualSpeciesCollectionScenarioStatus,
  scenarioLayerStatus,
  speciesMatchesSearch,
  taxonMatchesSearch,
  type ScenarioLayerStatus,
  type SelectedLayerDropPosition,
  type PlanningDomain,
  type LayerCatalogScope,
  type SupportedLanguage,
} from './map-layers-panel.utils';
import {
  ECOSYSTEM_CLASSIFICATION_VALUE_PREVIEW_LIMIT,
  ECOSYSTEM_CLASSIFICATION_VIEW_OPTIONS,
  ECOSYSTEMS_COPY,
  IAVH_BIOME_REGION_LOOKUP_URL,
  IAVH_BIOME_REGION_SAMPLE_COLORS,
  IAVH_ECOSYSTEM_LAYER_ID,
  STRATEGIC_ECOSYSTEM_LAYER_IDS,
  type EcosystemClassificationView,
} from './map-layers-panel-ecosystem.config';
import {
  buildIavhEcosystemRendering,
  parseIavhBiomeRegionCsv,
  type IavhBiomeRegionClass,
} from './map-layers-panel-iavh-ecosystem.utils';
import {
  APPEARANCE_POPOVER_ARROW_RIGHT_PX,
  APPEARANCE_POPOVER_LEFT_OFFSET_PX,
  APPEARANCE_POPOVER_MAX_WIDTH_PX,
  APPEARANCE_POPOVER_TOP_OFFSET_PX,
  BASELINE_SOLUTION_OVERLAY_ID,
  CANDIDATE_SOLUTION_OVERLAY_ID,
  COLOR_PICKER_FORMAT_CONTAINER_CLASSES,
  COLOR_PICKER_FORMAT_OPTIONS,
  COLOR_PICKER_HEX_FORMAT,
  COMPARISON_BASELINE_COLOR,
  COMPARISON_CANDIDATE_COLOR,
  COMPARISON_OVERLAP_COLOR,
  COMPARISON_PRIORITY_OVERLAY_IDS,
  DEFAULT_DATA_LAYER_OPACITY,
  DEFAULT_SELECTED_LAYER_BORDER_COLOR,
  DEFAULT_SELECTED_LAYER_BORDER_STYLE,
  DEFAULT_SELECTED_LAYER_BORDER_WIDTH,
  DEFAULT_SELECTED_LAYER_FILL_DENSITY,
  DEFAULT_SELECTED_LAYER_FILL_STYLE,
  DEFAULT_SOLUTION_LAYER_OPACITY_PERCENT,
  DEFAULT_SPECIES_MANIFEST_URL,
  enabledSirapBoundaryLayerKeys,
  EXCLUDED_SPECIES_TAXON_IDS,
  EXISTING_PROTECTED_COLOR,
  FISH_TAXON_ROW_ID,
  KNOWN_CONTINUOUS_RENDER_RANGES_BY_LAYER_ID,
  LEGEND_BOUNDARY_STYLES,
  MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE,
  MANIFEST_CATEGORY_TITLE_OVERRIDES,
  MANIFEST_LAYER_ID_BY_OVERLAY_ROW_ID,
  MARINE_ECOSYSTEMS_GROUP_ID,
  OVERLAP_SOLUTION_OVERLAY_ID,
  SINGLE_SOLUTION_COLOR,
  sidebarCategoryBindingForGroup,
  SPECIES_CLASS_TO_TAXON,
  SPECIES_COLLECTION_ROW_ID,
  SPECIES_RICHNESS_LAYER_ID_BY_TAXON_ROW_ID,
  SPECIES_TAXON_SORT_ORDER,
  SPECIES_VISIBLE_LIMIT,
  STRATEGIC_ECOSYSTEM_GROUP_ROW_ID,
  STRATEGIC_ECOSYSTEM_ROW_IDS,
  type SelectedLayerBorderStyle,
  type SelectedLayerFillStyle,
} from './map-layers-panel.config';
import {
  isManifestRenderingSupported,
  reconcileMapLayersManifest,
  type LayerControlRow,
  type LayerGroup,
} from './map-layers-panel-manifest-reconcile';
import { MapLayersPanelMapSync } from './map-layers-panel-map-sync';

interface SpeciesSample {
  common: string;
  latin: string;
}

interface SpeciesRow extends LayerControlRow {
  common: string;
  latin: string;
  taxonId: string;
  slug: string;
}

interface TaxonRow extends LayerControlRow {
  speciesCount: number;
  searchQuery: string;
  showAll: boolean;
  species: SpeciesRow[];
}

interface LayerSearchGroupMatch {
  groupId: string;
  rowMatches: number;
  taxonMatches: number;
}

interface SelectedLayerRow {
  id: string;
  name: string;
  sourceLabel: string;
  sourceType: 'overlay' | 'group';
  mapUnavailable: boolean;
}

/**
 * ngx-color-picker remembers whichever input format (Hex / R G B / H S L) the
 * user last selected and does not reset it across reopens. The directive's
 * `dialog` field is the live `ColorPickerComponent` instance — declared
 * `private` for TS but reachable at runtime — and `format` on that component
 * is the numeric input mode (0 = HEX). We reset to 0 on every open below so
 * the popup always greets the user with the hex input.
 */
interface AppearancePopoverPosition {
  top: number;
  left: number;
  width: number;
  arrowRightPx: number;
}

interface LayerInfoPopoverPosition {
  top: number;
  left: number;
}

interface ColorPickerDirectiveWithPrivateDialog {
  dialog: ColorPickerComponent | null;
}
interface ColorPickerComponentWithPrivateDialogElement {
  dialogElement?: { nativeElement: HTMLElement | null } | null;
}
/**
 * `sliderDimMax` is captured by the library in `ngOnInit` from
 * `hueSlider.offsetWidth` and `alphaSlider.offsetWidth`, then used to compute
 * the hue cursor's visual `left.px` (cursor.left = hue * sliderDimMax.h - 8).
 * The library only re-measures in `ngAfterViewInit` when `cpWidth !== 230`, and
 * the popup is positioned in a `setTimeout(0)` *after* `ngOnInit` runs, so the
 * captured width can be stale by the time our CSS has actually laid out the
 * strip. Result: the strip is visually wide but the cursor "true range" is
 * narrow — drag math (which uses live `offsetWidth`) reaches max hue, but the
 * cursor renders well short of the visual right edge.
 *
 * We remeasure on every open through this private surface to fix that.
 */
interface ColorPickerComponentWithPrivateSliderDims {
  sliderDimMax?: { h: number; s: number; v: number; a: number } | null;
  updateColorPicker: (emit?: boolean, update?: boolean, cmykInput?: boolean) => void;
}
const SPECIES_TAXONOMY_CSV_URL =
  'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/species/biomod_spp_ranges_updatedIUCN.csv';

export function resolveSpeciesTaxonomyLookupUrl(
  manifest: RuntimeLayerManifest | null | undefined,
): string {
  return manifest?.referenceData?.speciesLookup?.url?.trim() || SPECIES_TAXONOMY_CSV_URL;
}

interface EcosystemClassificationSummaryValue {
  label: string;
  areaHectares: number;
  areaSquareKilometers: number;
  polygonCount: number;
}
interface EcosystemClassificationSummarySection {
  view: EcosystemClassificationView;
  label: string;
  sourceField: string;
  valueCount: number;
  values: EcosystemClassificationSummaryValue[];
}
interface EcosystemClassificationSummary {
  version: string;
  generatedAt: string;
  classifications: EcosystemClassificationSummarySection[];
}
interface EcosystemLayerMetadata {
  references?: {
    classificationSummaryUrl?: string | null;
  };
}

@Component({
  selector: 'app-map-layers-panel',
  standalone: true,
  imports: [CommonModule, TranslatePipe, ColorPickerDirective],
  templateUrl: './map-layers-panel.html',
  styleUrl: './map-layers-panel.scss',
  animations: [
    trigger('selectedLayerRow', [
      transition(':enter', [
        style({ height: 0, opacity: 0, overflow: 'hidden' }),
        animate('220ms ease-out', style({ height: '*', opacity: 1 })),
      ]),
      transition(':leave', [
        style({ overflow: 'hidden' }),
        animate('180ms ease-in', style({ height: 0, opacity: 0 })),
      ]),
    ]),
  ],
})
export class MapLayersPanelComponent implements OnDestroy {
  @Output() readonly solutionFinderRequested = new EventEmitter<void>();

  private readonly appState = inject(AppStateService);
  private readonly savedSolutionScenariosService = inject(SavedSolutionScenariosService);
  private readonly adminBoundaryService = inject(AdminBoundaryService);
  private readonly manifestRasterLayerService = inject(ManifestRasterLayerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly layerManifestService = inject(LayerManifestService);
  private readonly solutionCatalog = inject(SolutionCatalogService);
  private readonly solutionLayerService = inject(SolutionLayerService);
  private readonly ngZone = inject(NgZone);
  private readonly translate = inject(TranslateService);
  private readonly appLocaleService = inject(AppLocaleService);
  private readonly document = inject(DOCUMENT);
  private readonly mapSync = new MapLayersPanelMapSync({
    solutionLayers: this.solutionLayerService,
    adminBoundaries: this.adminBoundaryService,
    manifestRasters: this.manifestRasterLayerService,
    appStateLayers: {
      get: () => this.appState.visibleLayers$(),
      set: (layers) => this.appState.visibleLayers$.set(layers),
    },
  });
  protected readonly sidebarOverlayScrollbar = useOverlayScrollbar();
  protected sidebarScrollbarInteracting = false;
  private formatSelectIdSequence = 0;
  private loadedSpeciesManifestUrl: string | null = null;

  /**
   * Per-mode color memory for the baseline/single-solution overlay.
   * Allows the color picker choice to survive Overview↔AOI↔Comparison tab switches.
   *
   * Regression check: Change color → switch Overview/AOI → verify color remains changed.
   * Regression check: Change color → switch Overview→Comparison→Overview → verify color restores.
   */
  private lastIsComparing: boolean | null = null;
  private savedSingleSolutionColor: string | null = null;
  private savedBaselineColor: string | null = null;

  /** Stable bound reference so we can removeEventListener exactly. */
  private readonly rainforestProximityHandler = (e: PointerEvent): void =>
    this.onSidebarProximityMove(e);
  private iavhBiomeRegionClasses: IavhBiomeRegionClass[] | null = null;
  private iavhBiomeRegionLookupLoading = false;

  /** Preset swatches shown beneath the saturation/hue grid in the color picker popup. */
  protected readonly colorPresetHexValues: string[] = [
    '#16A34A',
    '#2563EB',
    '#7C3AED',
    '#EA580C',
    '#DC2626',
    '#0891B2',
    '#475569',
    '#111827',
    '#F59E0B',
  ];
  protected readonly selectedLayerFillStyleOptions: readonly {
    value: SelectedLayerFillStyle;
    labelKey: string;
  }[] = [
    { value: 'solid', labelKey: 'mapLayersPanel.appearanceFillStyleSolid' },
    { value: 'hatch', labelKey: 'mapLayersPanel.appearanceFillStyleHatch' },
    { value: 'mesh', labelKey: 'mapLayersPanel.appearanceFillStyleMesh' },
    { value: 'dots', labelKey: 'mapLayersPanel.appearanceFillStyleDots' },
  ];
  protected readonly selectedLayerBorderStyleOptions: readonly {
    value: SelectedLayerBorderStyle;
    labelKey: string;
  }[] = [
    { value: 'none', labelKey: 'mapLayersPanel.appearanceBorderStyleNone' },
    { value: 'solid', labelKey: 'mapLayersPanel.appearanceBorderStyleSolid' },
    { value: 'dashed', labelKey: 'mapLayersPanel.appearanceBorderStyleDashed' },
    { value: 'dotted', labelKey: 'mapLayersPanel.appearanceBorderStyleDotted' },
  ];

  protected readonly hasActiveSolution = computed(() => this.appState.hasActiveSolution());
  protected readonly activeSolutionDomain = computed<PlanningDomain | null>(() => {
    const activeSolution = this.appState.activeSolution$();
    if (!activeSolution) {
      return null;
    }
    return this.findActiveCatalogSolution(activeSolution)?.domain ?? 'land';
  });
  protected readonly layerCatalogScope = signal<LayerCatalogScope>('land');
  protected readonly layerCatalogScopeOptions: readonly {
    value: LayerCatalogScope;
    labelKey: string;
  }[] = [
    { value: 'land', labelKey: 'mapLayersPanel.layerScopeLand' },
    { value: 'marine', labelKey: 'mapLayersPanel.layerScopeMarine' },
    { value: 'both', labelKey: 'mapLayersPanel.layerScopeBoth' },
  ];
  protected readonly activeSolutionLabel = this.appState.activeSolutionLabel$;
  protected readonly userIsSignedIn = this.appState.userIsSignedIn$;
  protected readonly activeSolutionLabelDraft = signal('');
  protected readonly activeSolutionLabelEditorOpen = signal(false);
  protected readonly activeSolutionHeadingSize = computed(() => {
    const label = this.activeSolutionLabel()?.trim() ?? '';

    if (label.length > 46) {
      return 'text-base leading-5';
    }
    if (label.length > 28) {
      return 'text-lg leading-5';
    }
    return 'text-xl leading-6';
  });
  protected readonly activeSolutionIdentity = computed<SolutionIdentitySummary | null>(() => {
    const activeSolution = this.appState.activeSolution$();
    const catalogSolution = this.findActiveCatalogSolution(activeSolution);
    return buildSolutionIdentitySummary(activeSolution, catalogSolution);
  });
  private readonly activeSolutionConsideredLayerIds = computed<Set<string>>(() => {
    const activeSolution = this.appState.activeSolution$();
    const catalogSolution = this.findActiveCatalogSolution(activeSolution);
    if (!catalogSolution) {
      return new Set();
    }

    return this.buildConsideredLayerIdSet([
      ...catalogSolution.inputLayerIds.features,
      ...catalogSolution.inputLayerIds.includes,
      ...catalogSolution.inputLayerIds.excludes,
      catalogSolution.inputLayerIds.cost,
      ...catalogSolution.finderInputs.targetFeatureIds,
      ...catalogSolution.finderInputs.includeLayerIds,
      ...catalogSolution.finderInputs.excludeLayerIds,
      catalogSolution.finderInputs.targetFeatureSet,
      catalogSolution.finderInputs.costLayerId,
    ]);
  });
  protected readonly hasScenarioLayerStatus = computed(
    () => this.hasActiveSolution() && this.activeSolutionConsideredLayerIds().size > 0,
  );
  protected readonly showScenarioLayerStatusLabels = signal(true);
  protected readonly activeSolutionBreakdownOpen = signal(false);
  protected readonly overlays = signal<LayerControlRow[]>(this.createDefaultOverlays());
  protected readonly managementFiguresTitle = signal(
    this.localizedTextOrFallback(
      'mapLayersPanel.groupTitles.managementFigures',
      'Conservation Areas',
    ),
  );
  protected readonly availableOverlays = computed(() =>
    this.overlays().filter(
      (row) => row.id !== BASELINE_SOLUTION_OVERLAY_ID && row.id !== CANDIDATE_SOLUTION_OVERLAY_ID,
    ),
  );
  /** Conservation Areas card: expanded by default so RUNAP/OMEC are visible; category groups start collapsed (UCS-101). */
  protected readonly overlaysCollapsed = signal(false);
  protected readonly taxa = signal<TaxonRow[]>(this.createDefaultTaxa());
  private readonly activeLanguage = signal<SupportedLanguage>(this.resolveActiveLanguage());
  protected readonly groups = signal<LayerGroup[]>(this.createDefaultGroups());
  private readonly manifestSidebarLoadFailed = signal(false);
  /** Raw manifest stored so groups can be rebuilt reactively when the locale changes. */
  private readonly rawManifest = signal<RuntimeLayerManifest | null>(null);
  protected readonly manifestSidebarLayerGroups = signal<ManifestSidebarLayerGroup[]>([]);
  protected readonly speciesCollectionManifestUrl = signal<string>(DEFAULT_SPECIES_MANIFEST_URL);
  protected readonly adminBoundaryGroup = computed(
    () => this.groups().find((g) => g.id === 'group-admin-boundaries') ?? null,
  );
  protected readonly layerSearchQuery = signal('');
  protected readonly normalizedLayerSearchQuery = computed(() =>
    this.layerSearchQuery().trim().toLowerCase(),
  );
  protected readonly hasLayerSearchQuery = computed(
    () => this.normalizedLayerSearchQuery().length > 0,
  );
  protected readonly filteredAvailableOverlays = computed(() => {
    const overlays = this.availableOverlays();
    const query = this.normalizedLayerSearchQuery();
    if (query.length === 0) {
      return overlays;
    }
    return overlays.filter((row) => this.nameMatchesSearch(row.name, query));
  });
  protected readonly filteredTaxa = computed(() => {
    const taxa = this.shouldShowLandAnalysisLayers() ? this.taxa() : [];
    const query = this.normalizedLayerSearchQuery();
    if (query.length === 0) {
      return taxa;
    }
    return taxa.filter((taxon) => this.taxonMatchesSearch(taxon, query));
  });
  protected readonly searchMatchesByGroup = computed(() => {
    const groups = this.groups();
    const query = this.normalizedLayerSearchQuery();
    const taxa = this.filteredTaxa();
    const matches = new Map<string, LayerSearchGroupMatch>();
    for (const group of groups) {
      const availableRows = this.domainVisibleGroupRows(group);
      const rowMatches =
        query.length === 0
          ? availableRows.length
          : availableRows.filter((row) => this.nameMatchesSearch(row.name, query)).length;
      const taxonMatches = group.id === 'group-species-biodiversity' ? taxa.length : 0;
      matches.set(group.id, { groupId: group.id, rowMatches, taxonMatches });
    }
    return matches;
  });
  protected readonly hasAnyLayerSearchResults = computed(() => {
    const overlayMatches = this.filteredAvailableOverlays().length;
    const groupMatches = Array.from(this.searchMatchesByGroup().values()).reduce(
      (total, match) => total + match.rowMatches + match.taxonMatches,
      0,
    );
    return overlayMatches + groupMatches > 0;
  });
  protected readonly layerSearchResultCount = computed(() => {
    const overlayMatches = this.filteredAvailableOverlays().length;
    const groupMatches = Array.from(this.searchMatchesByGroup().values()).reduce(
      (total, match) => total + match.rowMatches + match.taxonMatches,
      0,
    );
    return overlayMatches + groupMatches;
  });
  protected readonly selectedLayerOrder = signal<string[]>([]);
  protected readonly selectedLayerDragId = signal<string | null>(null);
  protected readonly selectedLayerDropTargetId = signal<string | null>(null);
  protected readonly selectedLayerDropPosition = signal<SelectedLayerDropPosition>('before');
  protected readonly ecosystemClassificationViewOptions = ECOSYSTEM_CLASSIFICATION_VIEW_OPTIONS;
  protected readonly ecosystemClassificationView =
    signal<EcosystemClassificationView>('biomeFamily');
  protected readonly ecosystemInfoModalOpen = signal(false);
  protected readonly ecosystemClassificationSummary = signal<EcosystemClassificationSummary | null>(
    null,
  );
  protected readonly ecosystemClassificationSummaryLoading = signal(false);
  protected readonly ecosystemClassificationSummaryError = signal(false);
  protected readonly expandedEcosystemClassificationSummaryViews = signal<ReadonlySet<string>>(
    new Set(),
  );
  protected readonly ecosystemClassificationSummaryFilterQueries = signal<Record<string, string>>(
    {},
  );
  protected readonly ecosystemClassificationSummaryVisibleLimits = signal<Record<string, number>>(
    {},
  );
  protected readonly openLayerInfoPopoverId = signal<string | null>(null);
  protected readonly layerInfoPopoverPosition = signal<LayerInfoPopoverPosition | null>(null);
  protected readonly selectedLayerAppearancePopoverId = signal<string | null>(null);
  protected readonly appearancePopoverPosition = signal<AppearancePopoverPosition | null>(null);
  protected readonly selectedLayerAppearancePopoverRow = computed(() => {
    const rowId = this.selectedLayerAppearancePopoverId();
    if (!rowId || !this.selectedLayerHasAppearanceControls(rowId)) {
      return null;
    }
    return this.selectedLayers().find((row) => row.id === rowId) ?? null;
  });
  protected readonly selectedLayers = computed<SelectedLayerRow[]>(() =>
    this.buildSelectedLayers(),
  );
  @ViewChild('appearancePopoverPortalHost')
  private appearancePopoverPortalHost?: ElementRef<HTMLElement>;
  private appearancePopoverPortalHome: HTMLElement | null = null;
  private appearancePopoverRepositionFrame: number | null = null;
  private appearancePopoverRepositionListener: (() => void) | null = null;
  private appearancePopoverOutsidePointerListener: ((event: PointerEvent) => void) | null = null;
  private layerInfoOutsidePointerListener: ((event: PointerEvent) => void) | null = null;
  protected readonly selectSolutionHoverFx = this.appState.selectSolutionButtonHoverFx$;

  constructor() {
    this.translate.onLangChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.activeLanguage.set(this.resolveActiveLanguage()));

    this.syncInitialBoundaryState();
    this.loadManifestSidebarRows();
    this.selectedLayerOrder.set(
      this.normalizeSelectedLayerOrder(
        this.computeSelectedLayerOrder(this.overlays(), this.groups(), this.taxa()),
      ),
    );
    this.ensureIavhBiomeRegionLookupLoaded();

    effect(() => {
      const solution = this.appState.activeSolution$();
      const solutionLabel = this.appState.activeSolutionLabel$();
      const speciesManifestUrl = this.speciesCollectionManifestUrl();
      untracked(() => {
        this.activeSolutionLabelDraft.set(solutionLabel ?? '');
        if (!solution) {
          this.activeSolutionLabelEditorOpen.set(false);
        }
        if (solution && speciesManifestUrl) {
          this.layerManifestService.preloadSpeciesManifest(speciesManifestUrl);
        }
        this.syncPrimarySolutionOverlay(solution?.name ?? null);
      });
    });

    effect(() => {
      const domain = this.activeSolutionDomain();
      untracked(() => this.layerCatalogScope.set(domain ?? 'land'));
    });

    effect(() => {
      const comparisonSolution = this.appState.comparisonSolution$();
      const vizMode = this.appState.comparisonVisualizationMode$();
      const rightSidebarMode = this.appState.rightSidebarMode$();
      untracked(() => {
        const inComparisonPanel = rightSidebarMode === 'comparison';
        const isComparing = inComparisonPanel && !!comparisonSolution;
        this.syncBaselineOverlayColor(isComparing);

        if (!comparisonSolution) {
          // Comparison cleared entirely — destructively remove rows so a fresh
          // solution pick starts from defaults.
          this.syncComparisonSolutionOverlay(null);
          this.syncComparisonOverlapOverlay(null, false);
          return;
        }

        if (!inComparisonPanel) {
          // User navigated away (e.g. to an AOI or overview) but the comparison
          // pair is still set. Hide the candidate + overlap rows from Selected
          // Layers without destroying their customized colors so they restore
          // cleanly on return.
          this.hideComparisonOverlays();
          return;
        }

        this.syncComparisonSolutionOverlay(comparisonSolution.name);
        this.syncComparisonOverlapOverlay(comparisonSolution.name, vizMode === 'threeColorOverlay');
      });
    });

    effect(() => {
      const order = this.selectedLayerOrder();
      const overlays = this.overlays();
      const groups = this.groups();
      const taxa = this.taxa();
      this.manifestRasterLayerService.renderedLayerRevision$();
      untracked(() => {
        const prioritizedOrder = this.shouldPrioritizeComparisonLayers()
          ? this.normalizeSelectedLayerOrder(order)
          : undefined;
        this.ngZone.runOutsideAngular(() => {
          this.mapSync.scheduleStackingSync(order, overlays, groups, taxa, prioritizedOrder);
        });
      });
    });

    effect(() => {
      this.appState.rightSidebarMode$();
      this.appState.comparisonSolution$();
      this.overlays();
      untracked(() => {
        this.selectedLayerOrder.update((order) => {
          const normalizedOrder = this.normalizeSelectedLayerOrder(order);
          return this.areOrdersEqual(order, normalizedOrder) ? order : normalizedOrder;
        });
      });
    });

    effect(() => {
      this.activeLanguage();
      const entries = this.buildMasterLegendLayerEntries();
      untracked(() => this.appState.setSelectedLegendLayers(entries));
    });

    effect(() => {
      this.activeLanguage();
      const rawManifest = this.rawManifest();
      const previewManifest = this.layerManifestService.stylePreviewManifest$();
      const locale = this.appLocaleService.locale();
      const sourceGroups = rawManifest ? buildManifestSidebarLayerGroups(rawManifest, locale) : [];
      const manifestGroups = previewManifest
        ? buildManifestSidebarLayerGroups(previewManifest, locale)
        : sourceGroups;
      untracked(() => {
        this.syncLocaleSensitiveSidebarLabels();
        this.applyManifestSidebarGroups(manifestGroups);
      });
    });

    // Register / unregister a viewport-wide pointer listener for the rainforest reveal mode.
    effect(() => {
      if (this.selectSolutionHoverFx() === 'rainforestReveal') {
        document.addEventListener('pointermove', this.rainforestProximityHandler, {
          passive: true,
        });
      } else {
        document.removeEventListener('pointermove', this.rainforestProximityHandler);
        this.resetRainforestProximity();
      }
    });

    effect(() => {
      const rowId = this.selectedLayerAppearancePopoverId();
      untracked(() => {
        if (rowId) {
          this.bindAppearancePopoverRepositionListeners();
          this.bindAppearancePopoverOutsidePointerListener();
          this.scheduleAppearancePopoverReposition(rowId);
        } else {
          this.unbindAppearancePopoverRepositionListeners();
          this.unbindAppearancePopoverOutsidePointerListener();
          this.unmountAppearancePopoverPortal();
          this.appearancePopoverPosition.set(null);
        }
      });
    });

    effect(() => {
      const rowId = this.openLayerInfoPopoverId();
      untracked(() => {
        if (rowId) {
          this.bindLayerInfoOutsidePointerListener();
        } else {
          this.unbindLayerInfoOutsidePointerListener();
        }
      });
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('pointermove', this.rainforestProximityHandler);
    this.unbindLayerInfoOutsidePointerListener();
    this.unbindAppearancePopoverRepositionListeners();
    this.unbindAppearancePopoverOutsidePointerListener();
    this.unmountAppearancePopoverPortal();
    if (this.appearancePopoverRepositionFrame !== null) {
      cancelAnimationFrame(this.appearancePopoverRepositionFrame);
      this.appearancePopoverRepositionFrame = null;
    }
    this.mapSync.dispose();
  }

  @HostListener('document:keydown.escape')
  protected onDocumentEscape(): void {
    this.closeEcosystemInfoModal();
    this.closeActiveSolutionBreakdown();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.activeSolutionBreakdownOpen()) {
      return;
    }

    const target = event.target as Node | null;
    if (!target) {
      return;
    }

    const breakdownFlyout = this.document.getElementById(
      'map-layers-active-solution-breakdown-flyout',
    );
    const breakdownTrigger = this.document.getElementById(
      'map-layers-active-solution-breakdown-button',
    );

    if (breakdownFlyout?.contains(target) || breakdownTrigger?.contains(target)) {
      return;
    }

    this.closeActiveSolutionBreakdown();
  }

  protected requestSolutionFinder(): void {
    this.solutionFinderRequested.emit();
  }

  protected openActiveSolutionLabelEditor(): void {
    this.activeSolutionLabelDraft.set(this.activeSolutionLabel() ?? '');
    this.activeSolutionLabelEditorOpen.set(true);
  }

  protected updateActiveSolutionLabelDraft(label: string): void {
    this.activeSolutionLabelDraft.set(label);
  }

  protected commitActiveSolutionLabel(event?: Event): void {
    event?.preventDefault();

    const nextLabel = this.activeSolutionLabelDraft().trim();
    this.appState.labelActiveSolution(nextLabel.length > 0 ? nextLabel : null);
    if (nextLabel) {
      void this.persistActiveSolutionScenario(nextLabel);
    }
    this.activeSolutionLabelDraft.set(nextLabel);
    this.activeSolutionLabelEditorOpen.set(false);

    if (event instanceof KeyboardEvent) {
      (event.target as HTMLElement | null)?.blur();
    }
  }

  protected cancelActiveSolutionLabelEdit(event?: Event): void {
    event?.preventDefault();
    this.activeSolutionLabelDraft.set(this.activeSolutionLabel() ?? '');
    this.activeSolutionLabelEditorOpen.set(false);
  }

  protected clearActiveSolutionLabel(event?: Event): void {
    event?.preventDefault();
    this.appState.labelActiveSolution(null);
    this.activeSolutionLabelDraft.set('');
    this.activeSolutionLabelEditorOpen.set(false);
  }

  private async persistActiveSolutionScenario(label: string): Promise<void> {
    const activeSolution = this.appState.activeSolution$();
    const solutionId = this.appState.getActiveSolutionCatalogId();
    if (!activeSolution || !solutionId || !this.userIsSignedIn()) {
      return;
    }

    await this.savedSolutionScenariosService.saveScenario({
      solutionId,
      label,
      solutionName: activeSolution.name,
    });
  }

  protected toggleActiveSolutionBreakdown(): void {
    this.activeSolutionBreakdownOpen.update((open) => !open);
  }

  protected closeActiveSolutionBreakdown(): void {
    this.activeSolutionBreakdownOpen.set(false);
  }

  protected toggleScenarioLayerStatusLabels(): void {
    this.showScenarioLayerStatusLabels.update((visible) => !visible);
  }

  protected selectLayerCatalogScope(scope: LayerCatalogScope): void {
    this.layerCatalogScope.set(scope);
  }

  protected scenarioLayerStatus(row: LayerControlRow): ScenarioLayerStatus | null {
    if (row.id === SPECIES_COLLECTION_ROW_ID) {
      const catalogSolution = this.findActiveCatalogSolution(this.appState.activeSolution$());
      if (!catalogSolution) {
        return null;
      }

      return individualSpeciesCollectionScenarioStatus(
        {
          targetFeatureIds: catalogSolution.finderInputs.targetFeatureIds,
          structuredTargets: catalogSolution.finderInputs.structuredTargets,
        },
        this.hasScenarioLayerStatus(),
      );
    }

    return scenarioLayerStatus(
      row.id,
      MANIFEST_LAYER_ID_BY_OVERLAY_ROW_ID[row.id],
      this.activeSolutionConsideredLayerIds(),
      this.hasScenarioLayerStatus(),
    );
  }

  protected isScenarioConsideredLayer(row: LayerControlRow): boolean {
    return this.scenarioLayerStatus(row) === 'considered';
  }

  protected isEcosystemConsideredInRun(): boolean {
    const ecosystemRow =
      this.findLayerControlRowById(IAVH_ECOSYSTEM_LAYER_ID) ??
      this.findLayerControlRowById('layer-ecosistemas');
    return ecosystemRow ? this.isScenarioConsideredLayer(ecosystemRow) : false;
  }

  protected isScenarioReferenceLayer(row: LayerControlRow): boolean {
    return this.scenarioLayerStatus(row) === 'reference';
  }

  protected scenarioLayerStatusLabel(status: ScenarioLayerStatus): string {
    return this.localizedText(
      status === 'considered'
        ? 'mapLayersPanel.consideredInRun'
        : 'mapLayersPanel.notConsideredInRun',
    );
  }

  protected taxonScenarioLayerStatus(taxon: TaxonRow): ScenarioLayerStatus | null {
    const richnessLayerId = SPECIES_RICHNESS_LAYER_ID_BY_TAXON_ROW_ID.get(taxon.id);
    if (richnessLayerId) {
      return this.scenarioLayerStatus({ ...taxon, id: richnessLayerId });
    }

    return null;
  }

  private findActiveCatalogSolution(solution: Solution | null) {
    const metadataSolutionId = solution?.metadata?.['solutionId'];
    const solutionId = typeof metadataSolutionId === 'string' ? metadataSolutionId : solution?.id;
    return solutionId ? this.solutionCatalog.getById(solutionId) : null;
  }

  private buildConsideredLayerIdSet(ids: (string | null | undefined)[]): Set<string> {
    return buildConsideredLayerIdSet(ids);
  }

  private resolveActiveLanguage(): SupportedLanguage {
    return this.translate.getCurrentLang() === 'es' ? 'es' : 'en';
  }

  private ecosystemsCopy(): (typeof ECOSYSTEMS_COPY)[SupportedLanguage] {
    return ECOSYSTEMS_COPY[this.activeLanguage()];
  }

  /** Updates --select-solution-spotlight-* for cursor-follow green and rainforest mask. */
  protected onSelectSolutionSpotlightEnter(event: PointerEvent): void {
    if (!this.selectSolutionHoverUsesPointerTracking()) {
      return;
    }
    this.onSelectSolutionSpotlightMove(event);
  }

  protected onSelectSolutionSpotlightMove(event: PointerEvent): void {
    if (!this.selectSolutionHoverUsesPointerTracking()) {
      return;
    }
    const el = event.currentTarget;
    if (!(el instanceof HTMLButtonElement)) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = ((event.clientX - rect.left) / w) * 100;
    const y = ((event.clientY - rect.top) / h) * 100;
    el.style.setProperty('--select-solution-spotlight-x', `${x}%`);
    el.style.setProperty('--select-solution-spotlight-y', `${y}%`);
  }

  /** Called by the viewport-wide document listener; drives ::before opacity for rainforest mode. */
  private onSidebarProximityMove(event: PointerEvent): void {
    if (this.selectSolutionHoverFx() !== 'rainforestReveal') return;
    const btn = document.getElementById('map-layers-select-solution-button');
    if (!(btn instanceof HTMLButtonElement)) return;

    const rect = btn.getBoundingClientRect();
    // Distance from pointer to the nearest point ON the button rect.
    const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
    const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const THRESHOLD = 80; // matches mask radius
    const opacity = dist >= THRESHOLD ? 0 : 1 - dist / THRESHOLD;

    // Position relative to button dimensions (can go outside 0-100% when cursor is outside button).
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = ((event.clientX - rect.left) / w) * 100;
    const y = ((event.clientY - rect.top) / h) * 100;

    btn.style.setProperty('--select-solution-spotlight-x', `${x}%`);
    btn.style.setProperty('--select-solution-spotlight-y', `${y}%`);
    btn.style.setProperty('--select-solution-proximity-opacity', `${opacity}`);
  }

  private resetRainforestProximity(): void {
    const btn = document.getElementById('map-layers-select-solution-button');
    if (btn instanceof HTMLButtonElement) {
      btn.style.setProperty('--select-solution-proximity-opacity', '0');
    }
  }

  private loadManifestSidebarRows(): void {
    this.manifestSidebarLoadFailed.set(false);
    this.layerManifestService
      .getManifest()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => {
          this.manifestSidebarLoadFailed.set(true);
          return of<RuntimeLayerManifest | null>(null);
        }),
      )
      .subscribe((manifest) => {
        if (manifest) {
          this.rawManifest.set(manifest);
        }
      });
  }

  private applyManifestSidebarGroups(groups: ManifestSidebarLayerGroup[]): void {
    if (groups.length === 0) {
      return;
    }

    this.manifestSidebarLayerGroups.set(groups);
    this.syncSpeciesManifestPrefetch(groups);
    const speciesManifestUrl = this.speciesCollectionManifestUrl();
    if (speciesManifestUrl !== this.loadedSpeciesManifestUrl) {
      this.loadedSpeciesManifestUrl = speciesManifestUrl;
      this.loadSpeciesManifestRows(speciesManifestUrl);
    }
    this.reconcileManifestRows(groups);
    this.syncAllRowsToMap();
  }

  private syncSpeciesManifestPrefetch(manifestGroups: ManifestSidebarLayerGroup[]): void {
    const speciesCategory = manifestGroups.find(
      (group) => group.sidebarCategoryId === 'species_and_biodiversity',
    );
    const speciesCollectionRow =
      speciesCategory?.rows.find((row) => row.isSpeciesCollection) ?? null;
    this.speciesCollectionManifestUrl.set(
      speciesCollectionRow?.speciesManifestUrl ?? DEFAULT_SPECIES_MANIFEST_URL,
    );
  }

  private loadSpeciesManifestRows(speciesManifestUrl: string): void {
    this.layerManifestService
      .getSpeciesManifest(speciesManifestUrl)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((manifest) =>
          this.loadSpeciesTaxonomyLookup().pipe(
            map((taxonomyLookup) => this.withSpeciesTaxonomy(manifest, taxonomyLookup)),
            catchError(() => of(manifest)),
          ),
        ),
        catchError(() => of<RuntimeSpeciesManifest>({ layers: [] })),
      )
      .subscribe((manifest) => {
        if (manifest.layers.length === 0) {
          return;
        }
        this.reconcileTaxaWithSpeciesManifest(manifest.layers);
      });
  }

  private loadSpeciesTaxonomyLookup() {
    const lookupUrl = resolveSpeciesTaxonomyLookupUrl(this.rawManifest());
    return this.http.get(lookupUrl, { responseType: 'text' }).pipe(
      map((csvText) => this.parseSpeciesTaxonomyLookup(csvText)),
      catchError(() => of(new Map<string, { taxonId: string; taxonLabel: string }>())),
    );
  }

  private withSpeciesTaxonomy(
    manifest: RuntimeSpeciesManifest,
    taxonomyLookup: Map<string, { taxonId: string; taxonLabel: string }>,
  ): RuntimeSpeciesManifest {
    if (taxonomyLookup.size === 0) {
      return manifest;
    }
    return {
      ...manifest,
      layers: manifest.layers.map((layer) => {
        if (layer.taxonId?.trim() && layer.taxonLabel?.trim()) {
          return layer;
        }
        const taxonomy = taxonomyLookup.get(this.normalizeSpeciesLookupKey(layer.scientificName));
        if (!taxonomy) {
          return layer;
        }
        return {
          ...layer,
          taxonId: taxonomy.taxonId,
          taxonLabel: taxonomy.taxonLabel,
        };
      }),
    };
  }

  private reconcileManifestRows(manifestGroups: ManifestSidebarLayerGroup[]): void {
    const result = reconcileMapLayersManifest({
      manifestGroups,
      groups: this.groups(),
      overlays: this.overlays(),
      ports: {
        manifestRowName: (row) => this.manifestSidebarLayerName(row),
        manifestGroupTitle: (group) => this.manifestSidebarGroupTitle(group),
        manifestCategoryTitle: (categoryId) => this.manifestCategoryTitle(categoryId),
        normalizeManifestRendering: (row) => this.normalizeManifestRendering(row),
        layerCountLabel: (count) => this.toLayerCountLabel(count),
        individualSpeciesName: () =>
          this.localizedTextOrFallback(
            'mapLayersPanel.individualSpecies',
            'Individual species ranges',
          ),
        speciesRichnessTaxonName: (definition) =>
          this.localizedTextOrFallback(
            `mapLayersPanel.taxaNames.${definition.taxonId}`,
            definition.englishLabel,
          ),
        strategicEcosystemGroupName: () => this.ecosystemsCopy().strategicGroupName,
        ecosystemGroupNote: () => this.ecosystemsCopy().groupNote,
        managementFiguresTitle: () =>
          this.localizedTextOrFallback(
            'mapLayersPanel.groupTitles.managementFigures',
            'Conservation Areas',
          ),
      },
    });

    this.groups.set(result.groups);
    if (result.managementFiguresTitle) {
      this.overlays.set(result.overlays);
      this.managementFiguresTitle.set(result.managementFiguresTitle);
    }
    this.selectedLayerOrder.update((order) => this.normalizeSelectedLayerOrder(order));
  }

  private manifestSidebarLayerName(manifestRow: ManifestSidebarLayerRow): string {
    const sirapBoundaryNameKeys: Record<string, { key: string; fallback: string }> = {
      siraps: {
        key: 'mapLayersPanel.boundaryNames.combinedSirapReviewLayer',
        fallback: 'SIRAP',
      },
      siraps_territorial_updated: {
        key: 'mapLayersPanel.boundaryNames.territorialSirapsUpdated',
        fallback: 'Territorial SIRAPs',
      },
      siraps_thematic: {
        key: 'mapLayersPanel.boundaryNames.thematicSirapAdditions',
        fallback: 'Thematic SIRAPs',
      },
    };
    const sirapBoundaryName = sirapBoundaryNameKeys[manifestRow.id];
    if (sirapBoundaryName) {
      return this.localizedTextOrFallback(sirapBoundaryName.key, sirapBoundaryName.fallback);
    }
    if (manifestRow.id === 'zonas_reserva_campesina_constituida') {
      if (this.activeLanguage() === 'es') {
        return manifestRow.spanishLabel;
      }
      return this.localizedTextOrFallback(
        'mapLayersPanel.layerNames.campesinaReserveZones',
        'Campesina Reserve Zones',
      );
    }
    if (manifestRow.id === IAVH_ECOSYSTEM_LAYER_ID) {
      return this.localizedTextOrFallback(
        'mapLayersPanel.ecosystemsLayerName',
        this.ecosystemsCopy().iavhRowName,
      );
    }
    if (STRATEGIC_ECOSYSTEM_LAYER_IDS.has(manifestRow.id)) {
      return this.localizedManifestLayerName(manifestRow);
    }
    return this.localizedManifestLayerName(manifestRow);
  }

  private manifestSidebarGroupTitle(manifestGroup: ManifestSidebarLayerGroup): string {
    if (manifestGroup.sidebarCategoryId === 'ecosystems') {
      return this.ecosystemsCopy().groupTitle;
    }
    if (this.activeLanguage() === 'es') {
      return manifestGroup.spanishLabel;
    }
    return manifestGroup.englishLabel ?? manifestGroup.spanishLabel;
  }

  private localizedManifestLayerName(manifestRow: ManifestSidebarLayerRow): string {
    if (this.activeLanguage() === 'es') {
      return manifestRow.spanishLabel;
    }
    return manifestRow.englishLabel ?? manifestRow.spanishLabel;
  }

  private normalizeManifestRendering(
    manifestRow: ManifestSidebarLayerRow,
  ): RuntimeLayerManifestRenderingConfig {
    const fallbackRendering: RuntimeLayerManifestRenderingConfig = {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: 255,
      minValue: 0,
      maxValue: 1,
      startColor: '#e2e8f0',
      endColor: '#475569',
    };
    if (!manifestRow.rendering) {
      return fallbackRendering;
    }

    if (manifestRow.id === IAVH_ECOSYSTEM_LAYER_ID) {
      return this.iavhEcosystemRenderingForSelectedView();
    }

    const knownRange = KNOWN_CONTINUOUS_RENDER_RANGES_BY_LAYER_ID[manifestRow.id];
    if (!knownRange) {
      return manifestRow.rendering;
    }

    return {
      ...manifestRow.rendering,
      valueType: 'continuous',
      renderMode: 'gradient',
      minValue: knownRange.minValue,
      maxValue: knownRange.maxValue,
    };
  }

  private iavhEcosystemRenderingForSelectedView(): RuntimeLayerManifestRenderingConfig {
    return buildIavhEcosystemRendering(
      this.ecosystemClassificationView(),
      this.activeLanguage(),
      this.iavhBiomeRegionClasses,
    );
  }

  private ensureIavhBiomeRegionLookupLoaded(): void {
    if (this.iavhBiomeRegionClasses || this.iavhBiomeRegionLookupLoading) {
      return;
    }
    this.iavhBiomeRegionLookupLoading = true;
    this.http
      .get(IAVH_BIOME_REGION_LOOKUP_URL, { responseType: 'text' })
      .pipe(
        catchError(() => of('')),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((csvText) => {
        this.iavhBiomeRegionLookupLoading = false;
        const classes = parseIavhBiomeRegionCsv(csvText);
        if (classes.length === 0) {
          return;
        }
        this.iavhBiomeRegionClasses = classes;
        if (this.ecosystemClassificationView() === 'biomeRegion') {
          this.refreshIavhEcosystemRendering();
        }
      });
  }

  private toLayerCountLabel(layerCount: number): string {
    const noun =
      layerCount === 1
        ? this.localizedTextOrFallback('mapLayersPanel.layerSingular', 'layer')
        : this.localizedTextOrFallback('mapLayersPanel.layerPlural', 'layers');
    return `${layerCount} ${noun}`;
  }

  private manifestCategoryTitle(manifestCategoryId: string): string | undefined {
    const override = MANIFEST_CATEGORY_TITLE_OVERRIDES[manifestCategoryId];
    if (!override) {
      return undefined;
    }
    return this.appLocaleService.locale() === 'es' ? override.es : override.en;
  }

  private selectSolutionHoverUsesPointerTracking(): boolean {
    const m = this.selectSolutionHoverFx();
    return m === 'cursorFollowGreen' || m === 'rainforestReveal';
  }

  protected toggleGroup(groupId: string): void {
    this.groups.update((groups) =>
      groups.map((group) =>
        group.id === groupId && !group.disabled ? { ...group, collapsed: !group.collapsed } : group,
      ),
    );
  }

  protected toggleOverlayVisibility(rowId: string): void {
    let nextVisible = false;
    let nextSelected = false;
    this.overlays.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId || row.mapUnavailable) {
          return row;
        }
        nextVisible = !row.visible;
        nextSelected = row.selected || nextVisible;
        return {
          ...row,
          selected: nextSelected,
          expanded: nextSelected && this.overlayCanExpand(row) ? true : row.expanded,
          visible: nextVisible,
        };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.scheduleRowSyncAfterPaint(rowId);
  }

  protected toggleOverlaySelected(rowId: string): void {
    let nextSelected = false;
    this.overlays.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        nextSelected = !row.selected;
        // Manifest-raster overlays (e.g. conservation areas) auto-show on add to
        // mirror the behavior used by manifest-driven group rows in toggleLayerSelected.
        const shouldAutoShowWhenAdded = row.mapSync?.type === 'manifest-raster';
        return {
          ...row,
          selected: nextSelected,
          expanded: nextSelected && this.overlayCanExpand(row) ? true : row.expanded,
          visible: row.mapUnavailable
            ? false
            : nextSelected
              ? shouldAutoShowWhenAdded
                ? true
                : row.visible
              : false,
        };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.scheduleRowSyncAfterPaint(rowId);
  }

  protected toggleOverlaysCollapsed(): void {
    this.overlaysCollapsed.update((collapsed) => !collapsed);
  }

  protected overlayCanExpand(row: LayerControlRow): boolean {
    return row.hasStyleControls && !row.mapUnavailable;
  }

  protected toggleOverlayExpanded(rowId: string): void {
    this.overlays.update((rows) =>
      rows.map((row) =>
        row.id === rowId && this.overlayCanExpand(row) ? { ...row, expanded: !row.expanded } : row,
      ),
    );
  }

  protected hasBoundaryInfo(row: LayerControlRow): boolean {
    const key = row.mapSync?.type === 'admin-boundary' ? row.mapSync.boundaryLayerKey : null;
    return (
      key === 'siraps' ||
      key === 'siraps_territorial' ||
      key === 'siraps_territorial_updated' ||
      key === 'siraps_thematic'
    );
  }

  protected updateOverlayOpacity(rowId: string, opacityText: string): void {
    const opacity = this.parsePercent(opacityText);
    this.overlays.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, opacity } : row)),
    );
    this.scheduleOpacitySync(rowId);
  }

  protected updateOverlayColor(rowId: string, color: string): void {
    this.overlays.update((rows) => rows.map((row) => (row.id === rowId ? { ...row, color } : row)));
    this.scheduleColorSync(rowId);
  }

  protected moveOverlay(rowId: string, direction: 'up' | 'down'): void {
    this.overlays.update((rows) => this.reorderRows(rows, rowId, direction));
  }

  protected toggleLayerVisibility(groupId: string, rowId: string): void {
    let nextVisible = false;
    let nextSelected = false;
    let didToggle = false;
    this.groups.update((groups) =>
      groups.map((g) => {
        if (g.id !== groupId) {
          return g;
        }

        return {
          ...g,
          rows: g.rows.map((row) =>
            row.id === rowId
              ? (() => {
                  if (row.mapUnavailable) {
                    return row;
                  }
                  nextVisible = !row.visible;
                  nextSelected = row.selected || nextVisible;
                  didToggle = true;
                  return {
                    ...row,
                    selected: nextSelected,
                    expanded: nextSelected ? true : row.expanded,
                    visible: nextVisible,
                  };
                })()
              : row,
          ),
        };
      }),
    );
    if (!didToggle) {
      return;
    }
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.scheduleRowSyncAfterPaint(`${groupId}:${rowId}`);
  }

  protected toggleLayerSelected(groupId: string, rowId: string): void {
    let nextSelected = false;
    let didToggle = false;
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        return {
          ...group,
          rows: group.rows.map((row) => {
            if (row.id !== rowId) {
              return row;
            }
            nextSelected = !row.selected;
            didToggle = true;
            const shouldAutoShowWhenAdded =
              row.mapSync?.type === 'admin-boundary' || row.mapSync?.type === 'manifest-raster';
            return {
              ...row,
              selected: nextSelected,
              expanded: nextSelected ? true : row.expanded,
              // Removing a layer from selected should also remove it from the map.
              visible: row.mapUnavailable
                ? false
                : nextSelected
                  ? shouldAutoShowWhenAdded
                    ? true
                    : row.visible
                  : false,
            };
          }),
        };
      }),
    );
    if (!didToggle) {
      return;
    }
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.scheduleRowSyncAfterPaint(`${groupId}:${rowId}`);
  }

  protected toggleLayerExpanded(groupId: string, rowId: string): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: group.rows.map((row) =>
            row.id === rowId ? { ...row, expanded: !row.expanded } : row,
          ),
        };
      }),
    );
  }

  protected updateLayerOpacity(groupId: string, rowId: string, opacityText: string): void {
    const opacity = this.parsePercent(opacityText);
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: group.rows.map((row) => (row.id === rowId ? { ...row, opacity } : row)),
        };
      }),
    );
    this.scheduleOpacitySync(`${groupId}:${rowId}`);
  }

  protected updateLayerColor(groupId: string, rowId: string, color: string): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: group.rows.map((row) => (row.id === rowId ? { ...row, color } : row)),
        };
      }),
    );
    this.scheduleColorSync(`${groupId}:${rowId}`);
  }

  protected moveLayer(groupId: string, rowId: string, direction: 'up' | 'down'): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: this.reorderRows(group.rows, rowId, direction),
        };
      }),
    );
  }

  protected toggleTaxonVisibility(rowId: string): void {
    let nextVisible = false;
    let nextSelected = false;
    this.taxa.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId || row.mapUnavailable) {
          return row;
        }
        nextVisible = !row.visible;
        nextSelected = row.selected || nextVisible;
        return {
          ...row,
          selected: nextSelected,
          expanded: nextSelected ? true : row.expanded,
          visible: nextVisible,
        };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
  }

  protected toggleTaxonSelected(rowId: string): void {
    let nextSelected = false;
    this.taxa.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        nextSelected = !row.selected;
        return {
          ...row,
          selected: nextSelected,
          expanded: nextSelected ? true : row.expanded,
          // If a row cannot be visualized on the map, keep visibility off.
          visible: row.mapUnavailable ? false : nextSelected ? row.visible : false,
        };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
  }

  protected toggleTaxonExpanded(rowId: string): void {
    this.taxa.update((rows) =>
      rows.map((row) =>
        row.id === rowId && !row.disabled ? { ...row, expanded: !row.expanded } : row,
      ),
    );
  }

  protected updateTaxonSearch(rowId: string, query: string): void {
    this.taxa.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, searchQuery: query, showAll: false } : row)),
    );
  }

  protected showAllTaxonSpecies(rowId: string): void {
    this.taxa.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, showAll: true } : row)),
    );
  }

  protected toggleSpeciesVisibility(taxonId: string, speciesId: string): void {
    let nextVisible = false;
    let nextSelected = false;
    this.taxa.update((taxa) =>
      taxa.map((taxon) => {
        if (taxon.id !== taxonId) {
          return taxon;
        }
        return {
          ...taxon,
          species: taxon.species.map((species) =>
            species.id === speciesId
              ? (() => {
                  if (species.mapUnavailable) {
                    return species;
                  }
                  nextVisible = !species.visible;
                  nextSelected = species.selected || nextVisible;
                  return {
                    ...species,
                    selected: nextSelected,
                    expanded: nextSelected ? true : species.expanded,
                    visible: nextVisible,
                  };
                })()
              : species,
          ),
        };
      }),
    );
    this.updateSelectedLayerOrder(speciesId, nextSelected);
    this.scheduleRowSyncAfterPaint(`${taxonId}:${speciesId}`);
  }

  protected toggleSpeciesSelected(taxonId: string, speciesId: string): void {
    let nextSelected = false;
    this.taxa.update((taxa) =>
      taxa.map((taxon) => {
        if (taxon.id !== taxonId) {
          return taxon;
        }
        return {
          ...taxon,
          species: taxon.species.map((species) => {
            if (species.id !== speciesId) {
              return species;
            }
            nextSelected = !species.selected;
            const shouldAutoShowWhenAdded = species.mapSync?.type === 'manifest-raster';
            return {
              ...species,
              selected: nextSelected,
              expanded: nextSelected ? true : species.expanded,
              // Removing a layer from selected should also remove it from the map.
              visible: species.mapUnavailable
                ? false
                : nextSelected
                  ? shouldAutoShowWhenAdded
                    ? true
                    : species.visible
                  : false,
            };
          }),
        };
      }),
    );
    this.updateSelectedLayerOrder(speciesId, nextSelected);
    this.scheduleRowSyncAfterPaint(`${taxonId}:${speciesId}`);
  }

  protected toggleSpeciesExpanded(taxonId: string, speciesId: string): void {
    this.taxa.update((taxa) =>
      taxa.map((taxon) => {
        if (taxon.id !== taxonId) {
          return taxon;
        }
        return {
          ...taxon,
          species: taxon.species.map((species) =>
            species.id === speciesId ? { ...species, expanded: !species.expanded } : species,
          ),
        };
      }),
    );
  }

  protected updateSpeciesOpacity(taxonId: string, speciesId: string, opacityText: string): void {
    const opacity = this.parsePercent(opacityText);
    this.taxa.update((taxa) =>
      taxa.map((taxon) => {
        if (taxon.id !== taxonId) {
          return taxon;
        }
        return {
          ...taxon,
          species: taxon.species.map((species) =>
            species.id === speciesId ? { ...species, opacity } : species,
          ),
        };
      }),
    );
    this.scheduleOpacitySync(`${taxonId}:${speciesId}`);
  }

  protected filteredSpecies(taxon: TaxonRow): SpeciesRow[] {
    const query = taxon.searchQuery.trim().toLowerCase();
    const candidates = taxon.species.filter((species) => {
      const fullName = `${species.common} ${species.latin}`.toLowerCase();
      return fullName.includes(query);
    });

    if (query.length > 0 || taxon.showAll) {
      return candidates;
    }

    return candidates.slice(0, SPECIES_VISIBLE_LIMIT);
  }

  protected updateLayerSearchQuery(query: string): void {
    this.layerSearchQuery.set(query);
  }

  protected clearLayerSearchQuery(): void {
    this.layerSearchQuery.set('');
  }

  protected shouldShowGroupInAvailableLayers(group: LayerGroup): boolean {
    const hasVisibleRows = this.domainVisibleGroupRows(group).length > 0;
    const hasVisibleTaxa =
      group.id === 'group-species-biodiversity' &&
      this.shouldShowLandAnalysisLayers() &&
      this.taxa().length > 0;
    if (!hasVisibleRows && !hasVisibleTaxa) {
      return false;
    }
    if (!this.hasLayerSearchQuery()) {
      return true;
    }
    if (group.disabled) {
      return false;
    }
    const match = this.searchMatchesByGroup().get(group.id);
    return !!match && match.rowMatches + match.taxonMatches > 0;
  }

  protected visibleGroupRows(group: LayerGroup): LayerControlRow[] {
    const availableRows = this.domainVisibleGroupRows(group);
    if (!this.hasLayerSearchQuery()) {
      return availableRows;
    }
    const query = this.normalizedLayerSearchQuery();
    if (group.id !== 'group-species-biodiversity') {
      return availableRows.filter((row) => this.groupRowMatchesSearch(group, row, query));
    }
    return availableRows.filter((row) => this.speciesGroupRowMatchesSearch(group, row, query));
  }

  private domainVisibleGroupRows(group: LayerGroup): LayerControlRow[] {
    const allowedRows = group.rows.filter((row) =>
      isLayerAvailableForScope(row.id, group.id, this.layerCatalogScope()),
    );
    const requiredParentIds = new Set(
      allowedRows.flatMap((row) => (row.parentId ? [row.parentId] : [])),
    );
    return group.rows.filter((row) => allowedRows.includes(row) || requiredParentIds.has(row.id));
  }

  private shouldShowLandAnalysisLayers(): boolean {
    return this.layerCatalogScope() !== 'marine';
  }

  protected isNestedLayerRowCollapsed(group: LayerGroup, row: LayerControlRow): boolean {
    if (this.hasLayerSearchQuery() || !row.parentId) {
      return false;
    }
    const parentRow = group.rows.find((candidate) => candidate.id === row.parentId);
    return !(parentRow?.expanded ?? true);
  }

  protected rowHasNestedLayerRows(group: LayerGroup, row: LayerControlRow): boolean {
    return group.rows.some((candidate) => candidate.parentId === row.id);
  }

  protected isFirstVisibleNestedLayerRow(group: LayerGroup, row: LayerControlRow): boolean {
    if (!row.parentId) {
      return false;
    }

    return this.visibleNestedLayerRowsForParent(group, row.parentId)[0]?.id === row.id;
  }

  protected isLastVisibleNestedLayerRow(group: LayerGroup, row: LayerControlRow): boolean {
    if (!row.parentId) {
      return false;
    }

    const siblingRows = this.visibleNestedLayerRowsForParent(group, row.parentId);
    return siblingRows.at(-1)?.id === row.id;
  }

  private visibleNestedLayerRowsForParent(group: LayerGroup, parentId: string): LayerControlRow[] {
    return this.visibleGroupRows(group).filter((candidate) => candidate.parentId === parentId);
  }

  private groupRowMatchesSearch(group: LayerGroup, row: LayerControlRow, query: string): boolean {
    if (row.parentId) {
      const parentRow = group.rows.find((candidate) => candidate.id === row.parentId);
      return (
        this.nameMatchesSearch(row.name, query) ||
        (!!parentRow && this.nameMatchesSearch(parentRow.name, query))
      );
    }
    return (
      this.nameMatchesSearch(row.name, query) ||
      group.rows.some(
        (candidate) =>
          candidate.parentId === row.id && this.nameMatchesSearch(candidate.name, query),
      )
    );
  }

  private speciesGroupRowMatchesSearch(
    group: LayerGroup,
    row: LayerControlRow,
    query: string,
  ): boolean {
    if (this.isSpeciesCollectionRow(row)) {
      return true;
    }
    if (row.parentId) {
      const parentRow = group.rows.find((candidate) => candidate.id === row.parentId);
      return (
        this.nameMatchesSearch(row.name, query) ||
        (!!parentRow && this.nameMatchesSearch(parentRow.name, query))
      );
    }
    if (this.rowHasNestedLayerRows(group, row)) {
      return (
        this.nameMatchesSearch(row.name, query) ||
        group.rows.some(
          (candidate) =>
            candidate.parentId === row.id && this.nameMatchesSearch(candidate.name, query),
        )
      );
    }
    return this.nameMatchesSearch(row.name, query);
  }

  protected shouldShowSpeciesTaxa(group: LayerGroup): boolean {
    if (this.hasLayerSearchQuery()) {
      return true;
    }
    const speciesCollectionRow = group.rows.find((row) => this.isSpeciesCollectionRow(row));
    if (!speciesCollectionRow) {
      return true;
    }
    return speciesCollectionRow.expanded;
  }

  protected visibleSpeciesForTaxon(taxon: TaxonRow): SpeciesRow[] {
    const query = this.normalizedLayerSearchQuery();
    if (query.length === 0) {
      return this.filteredSpecies(taxon);
    }
    const speciesMatches = taxon.species.filter((species) =>
      this.speciesMatchesSearch(species, query),
    );
    if (speciesMatches.length > 0) {
      return speciesMatches;
    }
    if (this.nameMatchesSearch(taxon.name, query)) {
      return this.filteredSpecies(taxon);
    }
    return [];
  }

  protected visibleGroupCountLabel(group: LayerGroup): string | undefined {
    if (group.id === 'group-species-biodiversity') {
      return undefined;
    }
    if (!this.hasLayerSearchQuery()) {
      const visibleRows = this.domainVisibleGroupRows(group).filter((row) => !row.hideAddButton);
      return this.toLayerCountLabel(visibleRows.length);
    }
    const match = this.searchMatchesByGroup().get(group.id);
    if (!match) {
      return undefined;
    }
    const noun =
      match.rowMatches === 1
        ? this.localizedText('mapLayersPanel.layerMatchSingular')
        : this.localizedText('mapLayersPanel.layerMatchPlural');
    return `${match.rowMatches} ${noun}`;
  }

  protected shouldShowTaxonShowAll(taxon: TaxonRow): boolean {
    if (this.hasLayerSearchQuery()) {
      return false;
    }
    return (
      taxon.searchQuery.trim().length === 0 &&
      !taxon.showAll &&
      taxon.species.length > SPECIES_VISIBLE_LIMIT
    );
  }

  protected resetDefaults(): void {
    this.overlaysCollapsed.set(false);
    this.layerSearchQuery.set('');
    this.layerCatalogScope.set(this.activeSolutionDomain() ?? 'land');
    this.overlays.set(this.createDefaultOverlays());
    this.taxa.set(this.createDefaultTaxa());
    this.groups.set(this.createDefaultGroups());
    this.loadSpeciesManifestRows(this.speciesCollectionManifestUrl());
    this.selectedLayerOrder.set(
      this.normalizeSelectedLayerOrder(
        this.computeSelectedLayerOrder(this.overlays(), this.groups(), this.taxa()),
      ),
    );
    this.syncAllRowsToMap();
  }

  protected moveSelectedLayer(rowId: string, direction: 'up' | 'down'): void {
    this.selectedLayerOrder.update((order) =>
      this.normalizeSelectedLayerOrder(this.reorderRowsById(order, rowId, direction)),
    );
  }

  protected onSelectedLayerDragStart(event: DragEvent, rowId: string): void {
    event.stopPropagation();
    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }
    transfer.effectAllowed = 'move';
    transfer.setData('text/plain', rowId);
    this.selectedLayerDragId.set(rowId);
    this.selectedLayerDropTargetId.set(null);
    this.selectedLayerDropPosition.set('before');
  }

  protected onSelectedLayerDragOver(event: DragEvent, targetRowId: string): void {
    event.preventDefault();
    if (!this.selectedLayerDragId() || this.selectedLayerDragId() === targetRowId) {
      this.selectedLayerDropTargetId.set(null);
      return;
    }

    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      const rect = target.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      this.selectedLayerDropPosition.set(offsetY > rect.height / 2 ? 'after' : 'before');
    }

    this.selectedLayerDropTargetId.set(targetRowId);
  }

  protected onSelectedLayerDrop(event: DragEvent, targetRowId: string): void {
    event.preventDefault();
    const draggedRowId = this.selectedLayerDragId() ?? event.dataTransfer?.getData('text/plain');
    if (!draggedRowId || draggedRowId === targetRowId) {
      this.clearSelectedLayerDragState();
      return;
    }

    const dropPosition = this.selectedLayerDropPosition();
    this.selectedLayerOrder.update((order) =>
      this.normalizeSelectedLayerOrder(
        this.reorderRowsByDropTarget(order, draggedRowId, targetRowId, dropPosition),
      ),
    );
    this.clearSelectedLayerDragState();
  }

  protected onSelectedLayerDragEnd(): void {
    this.clearSelectedLayerDragState();
  }

  protected removeSelectedLayer(rowId: string): void {
    if (rowId === BASELINE_SOLUTION_OVERLAY_ID) {
      return;
    }

    this.closeSelectedLayerAppearancePopover(rowId);

    if (rowId.startsWith('overlay-')) {
      this.toggleOverlaySelected(rowId);
      return;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      this.toggleTaxonSelected(rowId);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.toggleLayerSelected(groupId, rowId);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.toggleSpeciesSelected(speciesMatch.taxonId, rowId);
    }
  }

  protected isSelectedLayerVisible(rowId: string): boolean {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.visible;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.visible;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.visible;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.visible;
    }

    return false;
  }

  protected isSelectedLayerExpanded(rowId: string): boolean {
    if (!this.selectedLayerCanExpand(rowId)) {
      return false;
    }

    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.expanded;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.expanded;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.expanded;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.expanded;
    }

    return false;
  }

  protected selectedLayerCanExpand(rowId: string): boolean {
    const row = this.findLayerControlRowById(rowId);
    return !!row && !row.mapUnavailable;
  }

  protected isEcosystemClassificationRow(rowId: string): boolean {
    return rowId === IAVH_ECOSYSTEM_LAYER_ID || rowId === 'layer-ecosistemas';
  }

  protected openEcosystemInfoModal(event?: Event): void {
    event?.stopPropagation();
    this.closeLayerInfoPopover();
    this.loadEcosystemClassificationSummary();
    this.ecosystemInfoModalOpen.set(true);
  }

  protected closeEcosystemInfoModal(): void {
    this.ecosystemInfoModalOpen.set(false);
  }

  protected ecosystemClassificationSummarySections(): EcosystemClassificationSummarySection[] {
    const summary = this.ecosystemClassificationSummary();
    if (!summary) {
      return [];
    }
    const sectionByView = new Map(
      summary.classifications.map((section) => [section.view, section]),
    );
    return ECOSYSTEM_CLASSIFICATION_VIEW_OPTIONS.map((option) =>
      sectionByView.get(option.value),
    ).filter((section): section is EcosystemClassificationSummarySection => Boolean(section));
  }

  protected isEcosystemClassificationSummarySectionExpanded(view: string): boolean {
    return this.expandedEcosystemClassificationSummaryViews().has(view);
  }

  protected toggleEcosystemClassificationSummarySection(view: string): void {
    this.expandedEcosystemClassificationSummaryViews.update((expandedViews) => {
      const next = new Set(expandedViews);
      if (next.has(view)) {
        next.delete(view);
      } else {
        next.add(view);
      }
      return next;
    });
  }

  protected updateEcosystemClassificationSummaryFilter(view: string, value: string): void {
    this.ecosystemClassificationSummaryFilterQueries.update((queries) => ({
      ...queries,
      [view]: value,
    }));
    this.ecosystemClassificationSummaryVisibleLimits.update((limits) => ({
      ...limits,
      [view]: ECOSYSTEM_CLASSIFICATION_VALUE_PREVIEW_LIMIT,
    }));
  }

  protected ecosystemClassificationSummaryFilter(view: string): string {
    return this.ecosystemClassificationSummaryFilterQueries()[view] ?? '';
  }

  protected visibleEcosystemClassificationValues(
    section: EcosystemClassificationSummarySection,
  ): EcosystemClassificationSummaryValue[] {
    const query = this.ecosystemClassificationSummaryFilter(section.view)
      .trim()
      .toLocaleLowerCase();
    const values = query
      ? section.values.filter((value) => value.label.toLocaleLowerCase().includes(query))
      : section.values;
    return values.slice(0, this.ecosystemClassificationSummaryVisibleLimit(section.view));
  }

  protected ecosystemClassificationHiddenValueCount(
    section: EcosystemClassificationSummarySection,
  ): number {
    const query = this.ecosystemClassificationSummaryFilter(section.view)
      .trim()
      .toLocaleLowerCase();
    const values = query
      ? section.values.filter((value) => value.label.toLocaleLowerCase().includes(query))
      : section.values;
    return Math.max(
      0,
      values.length - this.ecosystemClassificationSummaryVisibleLimit(section.view),
    );
  }

  protected loadMoreEcosystemClassificationValues(view: string): void {
    this.ecosystemClassificationSummaryVisibleLimits.update((limits) => ({
      ...limits,
      [view]:
        this.ecosystemClassificationSummaryVisibleLimit(view) +
        ECOSYSTEM_CLASSIFICATION_VALUE_PREVIEW_LIMIT,
    }));
  }

  private ecosystemClassificationSummaryVisibleLimit(view: string): number {
    return (
      this.ecosystemClassificationSummaryVisibleLimits()[view] ??
      ECOSYSTEM_CLASSIFICATION_VALUE_PREVIEW_LIMIT
    );
  }

  protected formatEcosystemAreaSquareKilometers(value: number): string {
    return new Intl.NumberFormat(this.activeLanguage(), {
      maximumFractionDigits: 0,
    }).format(value);
  }

  protected formatEcosystemPolygonCount(value: number): string {
    return new Intl.NumberFormat(this.activeLanguage(), {
      maximumFractionDigits: 0,
    }).format(value);
  }

  protected formattedEcosystemClassificationSummaryGeneratedAt(): string | null {
    const generatedAt = this.ecosystemClassificationSummary()?.generatedAt;
    if (!generatedAt) {
      return null;
    }
    return new Intl.DateTimeFormat(this.activeLanguage(), {
      dateStyle: 'medium',
    }).format(new Date(generatedAt));
  }

  private loadEcosystemClassificationSummary(): void {
    if (this.ecosystemClassificationSummary() || this.ecosystemClassificationSummaryLoading()) {
      return;
    }
    const metadataUrl = this.ecosystemLayerMetadataUrl();
    if (!metadataUrl) {
      this.ecosystemClassificationSummaryError.set(true);
      return;
    }
    this.ecosystemClassificationSummaryLoading.set(true);
    this.ecosystemClassificationSummaryError.set(false);
    this.http
      .get<EcosystemLayerMetadata>(metadataUrl)
      .pipe(
        switchMap((metadata) => {
          const summaryUrl = metadata.references?.classificationSummaryUrl?.trim();
          return summaryUrl ? this.http.get<EcosystemClassificationSummary>(summaryUrl) : of(null);
        }),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((summary) => {
        this.ecosystemClassificationSummaryLoading.set(false);
        if (!summary) {
          this.ecosystemClassificationSummaryError.set(true);
          return;
        }
        this.ecosystemClassificationSummary.set(summary);
      });
  }

  private ecosystemLayerMetadataUrl(): string | null {
    return (
      this.findLayerControlRowById('layer-ecosistemas')?.metadataUrl ??
      this.findLayerControlRowById(IAVH_ECOSYSTEM_LAYER_ID)?.metadataUrl ??
      null
    );
  }

  private refreshIavhEcosystemRendering(): void {
    this.groups.update((groups) =>
      groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) => {
          if (
            !this.isEcosystemClassificationRow(row.id) ||
            row.mapSync?.type !== 'manifest-raster'
          ) {
            return row;
          }
          return {
            ...row,
            mapSync: {
              ...row.mapSync,
              rendering: this.iavhEcosystemRenderingForSelectedView(),
            },
          };
        }),
      })),
    );
    this.syncGroupRowById('group-ecosystems', IAVH_ECOSYSTEM_LAYER_ID);
  }

  protected toggleSelectedLayerVisibility(rowId: string): void {
    if (rowId.startsWith('overlay-')) {
      this.toggleOverlayVisibility(rowId);
      return;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      this.toggleTaxonVisibility(rowId);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.toggleLayerVisibility(groupId, rowId);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.toggleSpeciesVisibility(speciesMatch.taxonId, rowId);
    }
  }

  protected toggleSelectedLayerExpanded(rowId: string): void {
    if (!this.selectedLayerCanExpand(rowId)) {
      return;
    }

    if (rowId.startsWith('overlay-')) {
      this.toggleOverlayExpanded(rowId);
      return;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      this.toggleTaxonExpanded(rowId);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.toggleLayerExpanded(groupId, rowId);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.toggleSpeciesExpanded(speciesMatch.taxonId, rowId);
    }
  }

  protected selectedLayerOpacity(rowId: string): number {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.opacity;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.opacity;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.opacity;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.opacity;
    }

    return 0;
  }

  protected updateSelectedLayerOpacity(rowId: string, opacityText: string): void {
    if (rowId.startsWith('overlay-')) {
      this.updateOverlayOpacity(rowId, opacityText);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.updateLayerOpacity(groupId, rowId, opacityText);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.updateSpeciesOpacity(speciesMatch.taxonId, rowId, opacityText);
    }
  }

  protected selectedLayerHasColorControl(rowId: string): boolean {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.hasColorControl;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.hasColorControl;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.hasColorControl;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.hasColorControl;
    }

    return false;
  }

  protected selectedLayerHasFillControl(rowId: string): boolean {
    const row = this.findLayerControlRowById(rowId);
    return !!row && row.hasColorControl && this.isVectorPolygonStyleRow(row);
  }

  protected selectedLayerHasBorderControl(rowId: string): boolean {
    const row = this.findLayerControlRowById(rowId);
    return !!row && (row.mapSync?.type === 'admin-boundary' || this.isVectorPolygonStyleRow(row));
  }

  protected selectedLayerIsAdminBoundary(rowId: string): boolean {
    return this.findLayerControlRowById(rowId)?.mapSync?.type === 'admin-boundary';
  }

  protected selectedLayerHasColorOnlyControl(rowId: string): boolean {
    return (
      this.selectedLayerHasColorControl(rowId) &&
      !this.selectedLayerHasSolutionCoverageControl(rowId) &&
      !this.selectedLayerHasFillControl(rowId) &&
      !this.selectedLayerHasBorderControl(rowId)
    );
  }

  protected selectedLayerHasAppearanceControls(rowId: string): boolean {
    return (
      this.selectedLayerHasSolutionCoverageControl(rowId) ||
      this.selectedLayerHasFillControl(rowId) ||
      this.selectedLayerHasBorderControl(rowId)
    );
  }

  protected selectedLayerHasSolutionCoverageControl(rowId: string): boolean {
    const row = this.findLayerControlRowById(rowId);
    return row?.mapSync?.type === 'solution-baseline' && !this.isComparisonSelectionActive();
  }

  protected selectedLayerColor(rowId: string): string {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.color;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.color;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.color;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.color;
    }

    return '#64748b';
  }

  protected updateSelectedLayerColor(rowId: string, color: string): void {
    if (rowId.startsWith('overlay-')) {
      this.updateOverlayColor(rowId, color);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.updateLayerColor(groupId, rowId, color);
      return;
    }
  }

  protected selectedLayerExistingProtectedColor(rowId: string): string {
    return this.selectedLayerHasSolutionCoverageControl(rowId)
      ? this.solutionLayerService.existingProtectedColor$()
      : EXISTING_PROTECTED_COLOR;
  }

  protected selectedLayerNewCoverageColor(rowId: string): string {
    return this.selectedLayerColor(rowId);
  }

  protected updateSelectedLayerExistingProtectedColor(rowId: string, color: string): void {
    if (!this.selectedLayerHasSolutionCoverageControl(rowId)) {
      return;
    }
    this.solutionLayerService.setExistingProtectedColor(color);
  }

  protected updateSelectedLayerNewCoverageColor(rowId: string, color: string): void {
    if (!this.selectedLayerHasSolutionCoverageControl(rowId)) {
      return;
    }
    this.updateSelectedLayerColor(rowId, color);
  }

  protected isSelectedLayerAppearancePopoverOpen(rowId: string): boolean {
    return this.selectedLayerAppearancePopoverId() === rowId;
  }

  protected toggleSelectedLayerAppearancePopover(rowId: string): void {
    if (!this.selectedLayerHasAppearanceControls(rowId)) {
      this.closeSelectedLayerAppearancePopover(rowId);
      return;
    }
    this.selectedLayerAppearancePopoverId.update((openRowId) =>
      openRowId === rowId ? null : rowId,
    );
    if (this.selectedLayerAppearancePopoverId() === rowId) {
      this.scheduleAppearancePopoverReposition(rowId);
    }
  }

  protected closeSelectedLayerAppearancePopover(rowId?: string): void {
    if (!rowId || this.selectedLayerAppearancePopoverId() === rowId) {
      this.selectedLayerAppearancePopoverId.set(null);
    }
  }

  protected layerInfoPopoverId(groupId: string, rowId: string): string {
    return `${groupId}:${rowId}`;
  }

  protected isLayerInfoPopoverOpen(groupId: string, rowId: string): boolean {
    return this.openLayerInfoPopoverId() === this.layerInfoPopoverId(groupId, rowId);
  }

  protected toggleLayerInfoPopover(event: Event, groupId: string, rowId: string): void {
    event.stopPropagation();
    const popoverId = this.layerInfoPopoverId(groupId, rowId);
    if (this.openLayerInfoPopoverId() === popoverId) {
      this.closeLayerInfoPopover();
      return;
    }
    this.layerInfoPopoverPosition.set(this.resolveLayerInfoPopoverPosition(event));
    this.openLayerInfoPopoverId.set(popoverId);
  }

  protected closeLayerInfoPopover(): void {
    this.openLayerInfoPopoverId.set(null);
    this.layerInfoPopoverPosition.set(null);
  }

  private resolveLayerInfoPopoverPosition(event: Event): LayerInfoPopoverPosition {
    const button = event.currentTarget;
    if (!(button instanceof HTMLElement)) {
      return { top: 0, left: 0 };
    }
    const rect = button.getBoundingClientRect();
    const popoverWidth = 384;
    const estimatedPopoverHeight = 260;
    const viewportPadding = 12;
    const left = Math.min(
      Math.max(rect.right + 10, viewportPadding),
      window.innerWidth - popoverWidth - viewportPadding,
    );
    const top = Math.min(
      Math.max(rect.top - 8, viewportPadding),
      window.innerHeight - estimatedPopoverHeight - viewportPadding,
    );
    return {
      top,
      left,
    };
  }

  protected layerInfoText(row: LayerControlRow): string | null {
    const copy = this.ecosystemsCopy();
    const language = this.activeLanguage();
    const ecosystemInfo = {
      en: 'This map layer is a simplified display of the Ecosystems target used in the prioritizr run. The model targets 429 detailed Humboldt/IAvH biome-region classes from Colombia’s official MEC 2024 ecosystem data; each class combines a broad biome family with a biodiversity region, for example “Hidrobioma Alto Caquetá.” To keep the map readable, DISES groups those detailed classes into 8 broad biome families in the sidebar display.',
      es: 'Esta capa del mapa es una visualización simplificada de la meta Ecosistemas usada en la ejecución de prioritizr. El modelo usa 429 clases detalladas de bioma-región de Humboldt/IAvH del mapa oficial de ecosistemas MEC 2024 de Colombia; cada clase combina una gran familia de bioma con una región de biodiversidad, por ejemplo “Hidrobioma Alto Caquetá”. Para que el mapa sea legible, DISES agrupa esas clases detalladas en 8 grandes familias de biomas en la barra lateral.',
    };
    const strategicInfo = {
      en: 'Strategic ecosystem overlays are decision-facing layers such as paramos, wetlands, dry forest, and mangroves. They are separate input layers, not classes pulled from the full MEC ecosystem map.',
      es: 'Las capas de ecosistemas estratégicos son capas de decisión, como páramos, humedales, bosque seco y manglares. Son capas de entrada separadas, no clases extraídas del mapa completo de ecosistemas MEC.',
    };
    const layerInfoById: Record<string, { en: string; es: string }> = {
      [IAVH_ECOSYSTEM_LAYER_ID]: ecosystemInfo,
      'layer-ecosistemas': ecosystemInfo,
      'layer-eco-types': ecosystemInfo,
      [STRATEGIC_ECOSYSTEM_GROUP_ROW_ID]: strategicInfo,
      'layer-paramos': {
        en: 'Official paramo complexes layer from Minambiente/SIAC. Used as one of the strategic ecosystem inputs.',
        es: 'Capa oficial de complejos de páramo de Minambiente/SIAC. Se usa como una de las entradas de ecosistemas estratégicos.',
      },
      'layer-eco-paramos': {
        en: 'Official paramo complexes layer from Minambiente/SIAC. Used as one of the strategic ecosystem inputs.',
        es: 'Capa oficial de complejos de páramo de Minambiente/SIAC. Se usa como una de las entradas de ecosistemas estratégicos.',
      },
      'layer-wetlands': {
        en: 'Official continental wetlands layer from Minambiente/SIAC. Used as one of the strategic ecosystem inputs.',
        es: 'Capa oficial de humedales continentales de Minambiente/SIAC. Se usa como una de las entradas de ecosistemas estratégicos.',
      },
      'layer-eco-wetlands': {
        en: 'Official continental wetlands layer from Minambiente/SIAC. Used as one of the strategic ecosystem inputs.',
        es: 'Capa oficial de humedales continentales de Minambiente/SIAC. Se usa como una de las entradas de ecosistemas estratégicos.',
      },
      'layer-bosque_seco': {
        en: 'Official tropical dry forest layer from Minambiente/SIAC. Used as one of the strategic ecosystem inputs.',
        es: 'Capa oficial de bosque seco tropical de Minambiente/SIAC. Se usa como una de las entradas de ecosistemas estratégicos.',
      },
      'layer-eco-dry-forest': {
        en: 'Official tropical dry forest layer from Minambiente/SIAC. Used as one of the strategic ecosystem inputs.',
        es: 'Capa oficial de bosque seco tropical de Minambiente/SIAC. Se usa como una de las entradas de ecosistemas estratégicos.',
      },
      'layer-mangroves': {
        en: 'Official mangroves layer from INVEMAR. Used as one of the strategic ecosystem inputs.',
        es: 'Capa oficial de manglares de INVEMAR. Se usa como una de las entradas de ecosistemas estratégicos.',
      },
      'layer-eco-mangroves': {
        en: 'Official mangroves layer from INVEMAR. Used as one of the strategic ecosystem inputs.',
        es: 'Capa oficial de manglares de INVEMAR. Se usa como una de las entradas de ecosistemas estratégicos.',
      },
    };

    if (
      row.id === IAVH_ECOSYSTEM_LAYER_ID ||
      row.id === 'layer-ecosistemas' ||
      row.id === 'layer-eco-types'
    ) {
      return layerInfoById[row.id][language];
    }
    return (
      layerInfoById[row.id]?.[language] ??
      (row.id === STRATEGIC_ECOSYSTEM_GROUP_ROW_ID ? copy.groupNote : null)
    );
  }

  protected selectedLayerInfoText(rowId: string): string | null {
    const row = this.findLayerControlRowById(rowId);
    return row ? this.layerInfoText(row) : null;
  }

  private bindLayerInfoOutsidePointerListener(): void {
    if (this.layerInfoOutsidePointerListener) {
      return;
    }
    this.layerInfoOutsidePointerListener = (event) => this.onLayerInfoDocumentPointerDown(event);
    this.document.addEventListener('pointerdown', this.layerInfoOutsidePointerListener, {
      capture: true,
    });
  }

  private unbindLayerInfoOutsidePointerListener(): void {
    if (!this.layerInfoOutsidePointerListener) {
      return;
    }
    this.document.removeEventListener('pointerdown', this.layerInfoOutsidePointerListener, true);
    this.layerInfoOutsidePointerListener = null;
  }

  private onLayerInfoDocumentPointerDown(event: PointerEvent): void {
    if (!this.openLayerInfoPopoverId()) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      this.closeLayerInfoPopover();
      return;
    }
    const targetElement =
      target instanceof Element
        ? target
        : target.parentElement instanceof Element
          ? target.parentElement
          : null;
    if (targetElement?.closest('[data-ui="map-layer-info-control"]')) {
      return;
    }
    this.closeLayerInfoPopover();
  }

  /**
   * Portals the appearance popover to `document.body` (same escape hatch as
   * ngx-color-picker's `cpUseRootViewContainer`) so sidebar overflow rules
   * cannot clip it at the pane edge.
   */
  private mountAppearancePopoverPortal(): void {
    const portalHost = this.appearancePopoverPortalHost?.nativeElement;
    if (!portalHost || portalHost.parentElement === this.document.body) {
      return;
    }
    this.appearancePopoverPortalHome = portalHost.parentElement;
    this.document.body.appendChild(portalHost);
  }

  private unmountAppearancePopoverPortal(): void {
    const portalHost = this.appearancePopoverPortalHost?.nativeElement;
    if (!portalHost || !this.appearancePopoverPortalHome) {
      return;
    }
    this.appearancePopoverPortalHome.appendChild(portalHost);
    this.appearancePopoverPortalHome = null;
  }

  private bindAppearancePopoverRepositionListeners(): void {
    if (this.appearancePopoverRepositionListener) {
      return;
    }
    this.appearancePopoverRepositionListener = () => {
      const rowId = this.selectedLayerAppearancePopoverId();
      if (rowId) {
        this.scheduleAppearancePopoverReposition(rowId);
      }
    };
    window.addEventListener('resize', this.appearancePopoverRepositionListener, { passive: true });
    window.addEventListener('scroll', this.appearancePopoverRepositionListener, {
      passive: true,
      capture: true,
    });
  }

  private unbindAppearancePopoverRepositionListeners(): void {
    if (!this.appearancePopoverRepositionListener) {
      return;
    }
    window.removeEventListener('resize', this.appearancePopoverRepositionListener);
    window.removeEventListener('scroll', this.appearancePopoverRepositionListener, true);
    this.appearancePopoverRepositionListener = null;
  }

  private bindAppearancePopoverOutsidePointerListener(): void {
    if (this.appearancePopoverOutsidePointerListener) {
      return;
    }
    this.appearancePopoverOutsidePointerListener = (event) =>
      this.onAppearancePopoverDocumentPointerDown(event);
    this.document.addEventListener('pointerdown', this.appearancePopoverOutsidePointerListener, {
      capture: true,
    });
  }

  private unbindAppearancePopoverOutsidePointerListener(): void {
    if (!this.appearancePopoverOutsidePointerListener) {
      return;
    }
    this.document.removeEventListener(
      'pointerdown',
      this.appearancePopoverOutsidePointerListener,
      true,
    );
    this.appearancePopoverOutsidePointerListener = null;
  }

  private onAppearancePopoverDocumentPointerDown(event: PointerEvent): void {
    if (!this.selectedLayerAppearancePopoverId()) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      this.closeSelectedLayerAppearancePopover();
      return;
    }
    const targetElement =
      target instanceof Element
        ? target
        : target.parentElement instanceof Element
          ? target.parentElement
          : null;
    if (
      targetElement?.closest(
        [
          '[data-ui="selected-layer-appearance-popover"]',
          '[data-ui="selected-layer-solution-coverage-control"]',
          '[data-ui="selected-layer-fill-control"]',
          '[data-ui="selected-layer-border-control"]',
          '.color-picker',
        ].join(', '),
      )
    ) {
      return;
    }
    this.closeSelectedLayerAppearancePopover();
  }

  private scheduleAppearancePopoverReposition(rowId: string): void {
    if (this.appearancePopoverRepositionFrame !== null) {
      cancelAnimationFrame(this.appearancePopoverRepositionFrame);
    }
    this.appearancePopoverRepositionFrame = requestAnimationFrame(() => {
      this.appearancePopoverRepositionFrame = requestAnimationFrame(() => {
        this.appearancePopoverRepositionFrame = null;
        this.mountAppearancePopoverPortal();
        this.updateAppearancePopoverPosition(rowId);
      });
    });
  }

  private updateAppearancePopoverPosition(rowId: string): void {
    const rowElement = this.document.getElementById(`map-layers-selected-layer-row-${rowId}`);
    if (!rowElement) {
      return;
    }
    const rowRect = rowElement.getBoundingClientRect();
    this.appearancePopoverPosition.set({
      top: Math.round(rowRect.top + APPEARANCE_POPOVER_TOP_OFFSET_PX),
      left: Math.round(rowRect.left + APPEARANCE_POPOVER_LEFT_OFFSET_PX),
      width: APPEARANCE_POPOVER_MAX_WIDTH_PX,
      arrowRightPx: APPEARANCE_POPOVER_ARROW_RIGHT_PX,
    });
  }

  protected selectedLayerFillStyle(rowId: string): SelectedLayerFillStyle {
    return this.findLayerControlRowById(rowId)?.fillStyle ?? DEFAULT_SELECTED_LAYER_FILL_STYLE;
  }

  protected selectedLayerFillDensity(rowId: string): number {
    return this.findLayerControlRowById(rowId)?.fillDensity ?? DEFAULT_SELECTED_LAYER_FILL_DENSITY;
  }

  protected selectedLayerFillDensityLabelKey(rowId: string): string {
    const density = this.selectedLayerFillDensity(rowId);
    if (density <= 2) {
      return 'mapLayersPanel.appearanceDensityLow';
    }
    if (density >= 4) {
      return 'mapLayersPanel.appearanceDensityHigh';
    }
    return 'mapLayersPanel.appearanceDensityMedium';
  }

  protected selectedLayerFillPatternSize(rowId: string): string {
    const density = this.selectedLayerFillDensity(rowId);
    const sizeByDensity: Record<number, string> = {
      1: '14px',
      2: '11px',
      3: '8px',
      4: '6px',
      5: '4px',
    };
    return sizeByDensity[density] ?? sizeByDensity[DEFAULT_SELECTED_LAYER_FILL_DENSITY];
  }

  protected selectedLayerFillPreviewClass(rowId: string): string {
    return `map-layers-fill-preview--${this.selectedLayerFillStyle(rowId)}`;
  }

  protected updateSelectedLayerFillStyle(rowId: string, fillStyle: SelectedLayerFillStyle): void {
    if (!this.selectedLayerHasFillControl(rowId)) {
      return;
    }
    this.updateSelectedLayerAppearance(rowId, { fillStyle });
  }

  protected updateSelectedLayerFillDensity(rowId: string, densityText: string): void {
    if (!this.selectedLayerHasFillControl(rowId)) {
      return;
    }
    this.updateSelectedLayerAppearance(rowId, {
      fillDensity: this.parseAppearanceRange(densityText, 1, 5),
    });
  }

  protected selectedLayerBorderColor(rowId: string): string {
    return this.findLayerControlRowById(rowId)?.borderColor ?? DEFAULT_SELECTED_LAYER_BORDER_COLOR;
  }

  protected selectedLayerBorderStyle(rowId: string): SelectedLayerBorderStyle {
    return this.findLayerControlRowById(rowId)?.borderStyle ?? DEFAULT_SELECTED_LAYER_BORDER_STYLE;
  }

  protected selectedLayerBorderWidth(rowId: string): number {
    return this.findLayerControlRowById(rowId)?.borderWidth ?? DEFAULT_SELECTED_LAYER_BORDER_WIDTH;
  }

  protected selectedLayerBorderStyleClass(rowId: string): string {
    return `map-layers-border-preview--${this.selectedLayerBorderStyle(rowId)}`;
  }

  protected updateSelectedLayerBorderColor(rowId: string, borderColor: string): void {
    if (!this.selectedLayerHasBorderControl(rowId)) {
      return;
    }
    this.updateSelectedLayerAppearance(rowId, { borderColor });
  }

  protected updateSelectedLayerBorderStyle(
    rowId: string,
    borderStyle: SelectedLayerBorderStyle,
  ): void {
    if (!this.selectedLayerHasBorderControl(rowId)) {
      return;
    }
    this.updateSelectedLayerAppearance(rowId, { borderStyle });
  }

  protected updateSelectedLayerBorderWidth(rowId: string, borderWidthText: string): void {
    if (!this.selectedLayerHasBorderControl(rowId)) {
      return;
    }
    this.updateSelectedLayerAppearance(rowId, {
      borderWidth: this.parseAppearanceRange(borderWidthText, 0, 6),
    });
  }

  /**
   * Forces the picker popup to greet the user with the hex input every time it
   * opens. Without this, ngx-color-picker keeps the last input mode the user
   * picked (e.g. R G B) sticky across reopens of the same swatch.
   */
  protected onColorPickerOpen(picker: ColorPickerDirective): void {
    const dialog = (picker as unknown as ColorPickerDirectiveWithPrivateDialog).dialog;
    if (dialog) {
      dialog.format = COLOR_PICKER_HEX_FORMAT;
      // Wait one frame for the popup DOM to exist + be positioned, then inline
      // the format control AND remeasure the hue slider so the cursor's visual
      // range matches the strip's actual rendered width. See
      // `ColorPickerComponentWithPrivateSliderDims` for the why.
      requestAnimationFrame(() => {
        this.inlineColorPickerFormatControl(dialog);
        this.remeasureColorPickerSliderDimensions(dialog);
      });
    }
  }

  /**
   * Forces ngx-color-picker to recompute its internal `sliderDimMax` against
   * the popup's *actual* rendered slider widths, then redraws the cursor.
   *
   * The library captures slider widths once in `ngOnInit` (before the dialog
   * has been positioned and our overrides applied) and only refreshes them in
   * `ngAfterViewInit` if `cpWidth !== 230` — which it does, so the captured
   * widths are stale. Without this, the hue cursor's visual position is
   * computed against the stale narrow width while drag math uses the live
   * (wider) width, making the cursor appear to "stop" before the right edge
   * even though the underlying hue value reaches the max.
   */
  private remeasureColorPickerSliderDimensions(dialog: ColorPickerComponent): void {
    const host = this.colorPickerDialogHost(dialog);
    if (!host) {
      return;
    }
    const dialogWithDims = dialog as unknown as ColorPickerComponentWithPrivateSliderDims;
    if (!dialogWithDims.sliderDimMax) {
      return;
    }
    const hueWidth = host.querySelector<HTMLElement>('.hue')?.offsetWidth ?? 0;
    const satLightnessEl = host.querySelector<HTMLElement>('.saturation-lightness');
    const satLightnessWidth = satLightnessEl?.offsetWidth ?? 0;
    const satLightnessHeight = satLightnessEl?.offsetHeight ?? 0;
    if (hueWidth > 0) {
      dialogWithDims.sliderDimMax.h = hueWidth;
    }
    if (satLightnessWidth > 0) {
      dialogWithDims.sliderDimMax.s = satLightnessWidth;
    }
    if (satLightnessHeight > 0) {
      dialogWithDims.sliderDimMax.v = satLightnessHeight;
    }
    // Recompute slider cursor positions (and re-emit nothing) with the corrected dims.
    dialogWithDims.updateColorPicker(false, true);
  }

  /**
   * Replaces ngx-color-picker's up/down format arrows with a real <select>
   * dropdown rendered inline to the right of the code input.
   *
   * The library renders one `<div class="hex-text|rgba-text|hsla-text|cmyk-text">`
   * per format and shows only the active one via `[style.display]`. We inject one
   * <select> into the input row of each supported container; only the active
   * container's select is visible at any time, and they all stay in sync.
   */
  private inlineColorPickerFormatControl(dialog: ColorPickerComponent): void {
    const host = this.colorPickerDialogHost(dialog);
    if (!host) {
      return;
    }

    // Hide the original up/down format arrows; they're replaced by the dropdown.
    const typePolicy = host.querySelector<HTMLElement>('.type-policy');
    if (typePolicy) {
      typePolicy.style.display = 'none';
    }

    for (const containerClass of COLOR_PICKER_FORMAT_CONTAINER_CLASSES) {
      const container = host.querySelector<HTMLElement>(`.${containerClass}`);
      if (!container) {
        continue;
      }
      const inputBox = container.querySelector<HTMLElement>(':scope > .box:first-child');
      const labelBox = container.querySelector<HTMLElement>(':scope > .box:nth-child(2)');
      if (!inputBox) {
        continue;
      }
      // Drop the under-input format label ("Hex" / "R G B" / ...); the dropdown is the label.
      if (labelBox) {
        labelBox.style.display = 'none';
      }
      inputBox.classList.add('map-layers-format-row');

      if (!inputBox.querySelector('.map-layers-format-select')) {
        inputBox.appendChild(this.createColorPickerFormatSelect(dialog, host));
      }
    }

    // Sync every select to the current format on each (re)open.
    host.querySelectorAll<HTMLSelectElement>('.map-layers-format-select').forEach((select) => {
      select.value = String(dialog.format);
    });
  }

  private createColorPickerFormatSelect(
    dialog: ColorPickerComponent,
    host: HTMLElement,
  ): HTMLSelectElement {
    const select = document.createElement('select');
    select.id = `map-layers-color-picker-format-select-${this.formatSelectIdSequence++}`;
    select.className = 'map-layers-format-select';
    for (const option of COLOR_PICKER_FORMAT_OPTIONS) {
      const optionEl = document.createElement('option');
      optionEl.value = String(option.format);
      optionEl.textContent = option.label;
      select.appendChild(optionEl);
    }
    select.value = String(dialog.format);
    select.addEventListener('change', () => {
      dialog.format = Number(select.value);
      // Mirror the new value across the (hidden) sibling selects in other format containers.
      host.querySelectorAll<HTMLSelectElement>('.map-layers-format-select').forEach((other) => {
        other.value = select.value;
      });
    });
    return select;
  }

  private colorPickerDialogHost(dialog: ColorPickerComponent): HTMLElement | null {
    const dialogWithElement = dialog as unknown as ColorPickerComponentWithPrivateDialogElement;
    return dialogWithElement.dialogElement?.nativeElement ?? null;
  }

  private syncAllRowsToMap(): void {
    this.mapSync.syncRows([
      ...this.overlays(),
      ...this.groups().flatMap((group) => group.rows),
      ...this.taxa().flatMap((taxon) => taxon.species),
    ]);
  }

  private syncOverlayById(rowId: string): void {
    const row = this.overlays().find((overlay) => overlay.id === rowId);
    if (row) {
      this.mapSync.syncRow(row);
    }
  }

  private syncGroupRowById(groupId: string, rowId: string): void {
    const group = this.groups().find((item) => item.id === groupId);
    const row = group?.rows.find((item) => item.id === rowId);
    if (row) {
      this.mapSync.syncRow(row);
    }
  }

  private scheduleOpacitySync(rowKey: string): void {
    this.mapSync.scheduleOpacitySync(rowKey, () => this.findRowBySyncKey(rowKey));
  }

  private scheduleRowSyncAfterPaint(rowKey: string): void {
    this.ngZone.runOutsideAngular(() => {
      this.mapSync.scheduleAfterPaintSync(rowKey, () => this.findRowBySyncKey(rowKey));
    });
  }

  private scheduleColorSync(rowKey: string): void {
    this.mapSync.scheduleColorSync(rowKey, () => this.findRowBySyncKey(rowKey));
  }

  private syncRowToMap(row: LayerControlRow): void {
    this.mapSync.syncRow(row);
  }

  private findRowBySyncKey(rowKey: string): LayerControlRow | null {
    if (!rowKey.includes(':')) {
      return this.overlays().find((row) => row.id === rowKey) ?? null;
    }
    const [scopeId, rowId] = rowKey.split(':');
    if (scopeId.startsWith('taxon-')) {
      return (
        this.taxa()
          .find((taxon) => taxon.id === scopeId)
          ?.species.find((species) => species.id === rowId) ?? null
      );
    }
    return (
      this.groups()
        .find((group) => group.id === scopeId)
        ?.rows.find((row) => row.id === rowId) ?? null
    );
  }

  private reorderRows<T extends { id: string; canReorder: boolean }>(
    rows: T[],
    rowId: string,
    direction: 'up' | 'down',
  ): T[] {
    const index = rows.findIndex((row) => row.id === rowId);
    if (index < 0 || !rows[index].canReorder) {
      return rows;
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return rows;
    }

    const nextRows = [...rows];
    const [row] = nextRows.splice(index, 1);
    nextRows.splice(targetIndex, 0, row);
    return nextRows;
  }

  private reorderRowsById(rows: string[], rowId: string, direction: 'up' | 'down'): string[] {
    return reorderRowsById(rows, rowId, direction);
  }

  private reorderRowsByDropTarget(
    rows: string[],
    draggedRowId: string,
    targetRowId: string,
    dropPosition: SelectedLayerDropPosition,
  ): string[] {
    return reorderRowsByDropTarget(rows, draggedRowId, targetRowId, dropPosition);
  }

  private clearSelectedLayerDragState(): void {
    this.selectedLayerDragId.set(null);
    this.selectedLayerDropTargetId.set(null);
    this.selectedLayerDropPosition.set('before');
  }

  private parsePercent(rawValue: string): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  private parseAppearanceRange(rawValue: string, min: number, max: number): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return min;
    }
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }

  private findLayerControlRowById(rowId: string): LayerControlRow | null {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row;
    }

    return this.findSpeciesById(rowId)?.species ?? null;
  }

  private updateSelectedLayerAppearance(
    rowId: string,
    patch: Partial<
      Pick<
        LayerControlRow,
        'fillStyle' | 'fillDensity' | 'borderColor' | 'borderStyle' | 'borderWidth'
      >
    >,
  ): void {
    this.overlays.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );

    this.taxa.update((taxa) =>
      taxa.map((taxon) =>
        taxon.id === rowId
          ? { ...taxon, ...patch }
          : {
              ...taxon,
              species: taxon.species.map((species) =>
                species.id === rowId ? { ...species, ...patch } : species,
              ),
            },
      ),
    );

    this.groups.update((groups) =>
      groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
      })),
    );
    this.scheduleSelectedLayerAppearanceSync(rowId);
  }

  private scheduleSelectedLayerAppearanceSync(rowId: string): void {
    if (rowId.startsWith('overlay-')) {
      this.scheduleColorSync(rowId);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.scheduleColorSync(`${groupId}:${rowId}`);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.scheduleColorSync(`${speciesMatch.taxonId}:${rowId}`);
    }
  }

  private syncInitialBoundaryState(): void {
    const group = this.groups().find((g) => g.id === 'group-admin-boundaries');
    for (const row of group?.rows ?? []) {
      this.syncRowToMap(row);
    }
  }

  private updateSelectedLayerOrder(
    rowId: string,
    selected: boolean,
    position: 'start' | 'end' = 'end',
  ): void {
    this.selectedLayerOrder.update((order) => {
      const exists = order.includes(rowId);
      if (selected && !exists) {
        const nextOrder = position === 'start' ? [rowId, ...order] : [...order, rowId];
        return this.normalizeSelectedLayerOrder(nextOrder);
      }
      if (!selected && exists) {
        return this.normalizeSelectedLayerOrder(order.filter((id) => id !== rowId));
      }
      return this.normalizeSelectedLayerOrder(order);
    });
  }

  private shouldPrioritizeComparisonLayers(): boolean {
    return this.appState.comparisonSolution$() !== null;
  }

  private normalizeSelectedLayerOrder(order: string[]): string[] {
    return normalizeSelectedLayerOrder(
      order,
      COMPARISON_PRIORITY_OVERLAY_IDS,
      this.shouldPrioritizeComparisonLayers(),
    );
  }

  private areOrdersEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }

    return true;
  }

  private computeSelectedLayerOrder(
    overlays: LayerControlRow[],
    groups: LayerGroup[],
    taxa: TaxonRow[],
  ): string[] {
    return computeSelectedLayerOrder(overlays, groups, taxa);
  }

  private buildSelectedLayers(): SelectedLayerRow[] {
    const overlays = this.overlays();
    const groups = this.groups();
    const taxa = this.taxa();
    const order = this.selectedLayerOrder();
    const rowLookup = new Map<string, SelectedLayerRow>();

    for (const overlay of overlays) {
      if (!overlay.selected) {
        continue;
      }
      rowLookup.set(overlay.id, {
        id: overlay.id,
        name: overlay.name,
        sourceLabel:
          overlay.id === BASELINE_SOLUTION_OVERLAY_ID
            ? this.localizedText('mapLayersPanel.sourceLabels.selectedSolution')
            : overlay.id === CANDIDATE_SOLUTION_OVERLAY_ID
              ? this.localizedText('mapLayersPanel.sourceLabels.comparisonSolution')
              : overlay.id === OVERLAP_SOLUTION_OVERLAY_ID
                ? this.localizedText('mapLayersPanel.sourceLabels.comparisonOverlay')
                : this.localizedText('mapLayersPanel.sourceLabels.availableLayers'),
        sourceType: 'overlay',
        mapUnavailable: !!overlay.mapUnavailable,
      });
    }

    for (const group of groups) {
      for (const row of group.rows) {
        if (!row.selected) {
          continue;
        }
        rowLookup.set(row.id, {
          id: row.id,
          name: row.name,
          sourceLabel: group.title,
          sourceType: 'group',
          mapUnavailable: !!row.mapUnavailable,
        });
      }
    }

    for (const taxon of taxa) {
      if (taxon.selected) {
        rowLookup.set(taxon.id, {
          id: taxon.id,
          name: taxon.name,
          sourceLabel: this.localizedText('mapLayersPanel.sourceLabels.speciesBiodiversity'),
          sourceType: 'group',
          mapUnavailable: !!taxon.mapUnavailable,
        });
      }
      for (const species of taxon.species) {
        if (!species.selected) {
          continue;
        }
        rowLookup.set(species.id, {
          id: species.id,
          name: species.common,
          sourceLabel: this.localizedText('mapLayersPanel.sourceLabels.speciesBiodiversityTaxon', {
            taxon: taxon.name,
          }),
          sourceType: 'group',
          mapUnavailable: !!species.mapUnavailable,
        });
      }
    }

    const orderedSelectedRows: SelectedLayerRow[] = [];
    for (const rowId of order) {
      const row = rowLookup.get(rowId);
      if (!row) {
        continue;
      }
      orderedSelectedRows.push(row);
      rowLookup.delete(rowId);
    }

    for (const row of rowLookup.values()) {
      orderedSelectedRows.push(row);
    }

    return this.applyComparisonPriorityToSelectedRows(orderedSelectedRows);
  }

  private applyComparisonPriorityToSelectedRows(rows: SelectedLayerRow[]): SelectedLayerRow[] {
    if (!this.shouldPrioritizeComparisonLayers()) {
      return rows;
    }

    const priorityRows: SelectedLayerRow[] = [];
    for (const priorityId of COMPARISON_PRIORITY_OVERLAY_IDS) {
      const row = rows.find((candidate) => candidate.id === priorityId);
      if (row) {
        priorityRows.push(row);
      }
    }

    if (priorityRows.length === 0) {
      return rows;
    }

    const priorityIds = new Set(priorityRows.map((row) => row.id));
    const remainingRows = rows.filter((row) => !priorityIds.has(row.id));
    return [...priorityRows, ...remainingRows];
  }

  private buildMasterLegendLayerEntries(): MapLegendLayerEntry[] {
    const overlays = this.overlays();
    const groups = this.groups();
    const taxa = this.taxa();
    const order = this.selectedLayerOrder();
    const entryLookup = new Map<string, MapLegendLayerEntry>();

    for (const row of overlays) {
      if (!this.shouldIncludeRowInMasterLegend(row)) {
        continue;
      }
      entryLookup.set(row.id, this.toMasterLegendLayerEntry(row));
    }

    for (const group of groups) {
      for (const row of group.rows) {
        if (!this.shouldIncludeRowInMasterLegend(row)) {
          continue;
        }
        entryLookup.set(row.id, this.toMasterLegendLayerEntry(row));
      }
    }

    for (const taxon of taxa) {
      if (taxon.selected && shouldIncludeInMasterLegend(taxon.mapSync)) {
        entryLookup.set(taxon.id, this.toMasterLegendLayerEntry(taxon));
      }
      for (const species of taxon.species) {
        if (!species.selected || !shouldIncludeInMasterLegend(species.mapSync)) {
          continue;
        }
        entryLookup.set(species.id, this.toMasterLegendLayerEntry(species));
      }
    }

    const orderedEntries: MapLegendLayerEntry[] = [];
    for (const rowId of order) {
      const entry = entryLookup.get(rowId);
      if (!entry) {
        continue;
      }
      orderedEntries.push(entry);
      entryLookup.delete(rowId);
    }

    for (const entry of entryLookup.values()) {
      orderedEntries.push(entry);
    }

    return orderedEntries;
  }

  private toMasterLegendLayerEntry(row: LayerControlRow): MapLegendLayerEntry {
    const rendering = row.mapSync?.type === 'manifest-raster' ? row.mapSync.rendering : undefined;
    const categories = rendering
      ? buildLegendCategories(row.id, rendering, this.activeLanguage())
      : [];

    return buildLegendLayerEntry({
      id: row.id,
      name: row.name,
      color: row.color,
      borderColor: row.borderColor,
      borderStyle: row.borderStyle,
      borderWidth: row.borderWidth,
      boundaryStyle:
        row.mapSync?.type === 'admin-boundary'
          ? LEGEND_BOUNDARY_STYLES[row.mapSync.boundaryLayerKey]
          : undefined,
      rendering,
      language: this.activeLanguage(),
      denseCategorySummary: this.denseLegendSummaryForRow(row, categories),
    });
  }

  private denseLegendSummaryForRow(
    row: LayerControlRow,
    categories: NonNullable<MapLegendLayerEntry['categories']>,
  ): MapLegendLayerEntry['denseCategorySummary'] {
    if (categories.length < 25) {
      return undefined;
    }
    if (
      this.isEcosystemClassificationRow(row.id) &&
      this.ecosystemClassificationView() === 'biomeRegion'
    ) {
      return {
        count: categories.length,
        messageKey: 'mapLegend.iavhDenseCategories',
        sampleColors: [...IAVH_BIOME_REGION_SAMPLE_COLORS],
      };
    }

    return {
      count: categories.length,
      messageKey: 'mapLegend.denseCategories',
      sampleColors: [...new Set(categories.map((category) => category.color))].slice(0, 6),
    };
  }

  private isSolutionLayerRow(row: LayerControlRow): boolean {
    const mapType = row.mapSync?.type;
    return (
      row.id === BASELINE_SOLUTION_OVERLAY_ID ||
      row.id === CANDIDATE_SOLUTION_OVERLAY_ID ||
      row.id === OVERLAP_SOLUTION_OVERLAY_ID ||
      mapType === 'solution-baseline' ||
      mapType === 'solution-candidate' ||
      mapType === 'solution-overlap'
    );
  }

  private shouldIncludeRowInMasterLegend(row: LayerControlRow): boolean {
    return (
      row.selected && !this.isSolutionLayerRow(row) && shouldIncludeInMasterLegend(row.mapSync)
    );
  }

  private isComparisonSelectionActive(): boolean {
    return (
      this.appState.rightSidebarMode$() === 'comparison' && !!this.appState.comparisonSolution$()
    );
  }

  private isVectorPolygonStyleRow(row: LayerControlRow): boolean {
    if (this.isSolutionLayerRow(row)) {
      return false;
    }
    if (row.mapSync?.type === 'app-state-layer') {
      return true;
    }
    if (row.mapSync?.type === 'manifest-raster') {
      return VECTOR_OVERLAY_LAYER_IDS.has(row.mapSync.layerId);
    }
    return !row.mapSync && !row.mapUnavailable && row.hasColorControl;
  }

  private findGroupIdByRowId(rowId: string): string | undefined {
    const group = this.groups().find((item) => item.rows.some((row) => row.id === rowId));
    return group?.id;
  }

  private findGroupRowById(rowId: string): { groupId: string; row: LayerControlRow } | undefined {
    for (const group of this.groups()) {
      const row = group.rows.find((candidate) => candidate.id === rowId);
      if (row) {
        return { groupId: group.id, row };
      }
    }
    return undefined;
  }

  private findSpeciesById(
    speciesId: string,
  ): { taxonId: string; taxonName: string; species: SpeciesRow } | undefined {
    for (const taxon of this.taxa()) {
      const species = taxon.species.find((candidate) => candidate.id === speciesId);
      if (species) {
        return { taxonId: taxon.id, taxonName: taxon.name, species };
      }
    }
    return undefined;
  }

  private findTaxonById(taxonId: string): TaxonRow | undefined {
    return this.taxa().find((taxon) => taxon.id === taxonId);
  }

  private createDefaultOverlays(): LayerControlRow[] {
    return [
      {
        id: BASELINE_SOLUTION_OVERLAY_ID,
        name: this.localizedTextOrFallback(
          'mapLayersPanel.overlayNames.conservationSolution',
          'Conservation Scenario',
        ),
        selected: true,
        visible: true,
        expanded: true,
        opacity: DEFAULT_SOLUTION_LAYER_OPACITY_PERCENT,
        color: SINGLE_SOLUTION_COLOR,
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapSync: { type: 'solution-baseline' },
      },
      {
        id: RUNAP_OVERLAY_LAYER_ID,
        name: this.localizedTextOrFallback(
          'mapLayersPanel.overlayNames.protectedAreasRunap',
          'Protected Areas (RUNAP)',
        ),
        selected: false,
        visible: false,
        expanded: false,
        opacity: DEFAULT_DATA_LAYER_OPACITY,
        color: MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[RUNAP_OVERLAY_LAYER_ID]?.color ?? '#f97316',
        fillStyle: MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[RUNAP_OVERLAY_LAYER_ID]?.fillStyle,
        borderColor:
          MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[RUNAP_OVERLAY_LAYER_ID]?.borderColor ?? '#c2410c',
        borderWidth: MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[RUNAP_OVERLAY_LAYER_ID]?.borderWidth,
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapUnavailable: true,
      },
      {
        id: RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
        name: this.localizedTextOrFallback(
          'mapLayersPanel.overlayNames.nationalNaturalParks',
          'National Natural Parks',
        ),
        selected: false,
        visible: false,
        expanded: false,
        opacity: DEFAULT_DATA_LAYER_OPACITY,
        color:
          MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID]?.color ??
          '#dc2626',
        fillStyle:
          MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID]?.fillStyle,
        borderColor:
          MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID]
            ?.borderColor ?? '#991b1b',
        borderWidth:
          MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID]?.borderWidth,
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapUnavailable: false,
        mapSync: {
          type: 'manifest-raster',
          layerId: RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
          displayUrl:
            'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/includes/runap_identify.geojson',
          rendering: {
            valueType: 'binary',
            renderMode: 'mask',
            selectedColor: '#dc2626',
          },
        },
      },
      {
        id: OMEC_OVERLAY_LAYER_ID,
        name: this.localizedTextOrFallback('mapLayersPanel.overlayNames.omecs', 'OMECs'),
        selected: false,
        visible: false,
        expanded: false,
        opacity: DEFAULT_DATA_LAYER_OPACITY,
        color: MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[OMEC_OVERLAY_LAYER_ID]?.color ?? '#c026d3',
        fillStyle: MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[OMEC_OVERLAY_LAYER_ID]?.fillStyle,
        fillDensity: MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[OMEC_OVERLAY_LAYER_ID]?.fillDensity,
        borderColor:
          MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[OMEC_OVERLAY_LAYER_ID]?.borderColor ?? '#86198f',
        borderWidth: MANAGEMENT_OVERLAY_DEFAULT_APPEARANCE[OMEC_OVERLAY_LAYER_ID]?.borderWidth,
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapUnavailable: true,
      },
    ];
  }

  private syncPrimarySolutionOverlay(solutionName: string | null): void {
    this.overlays.update((rows) =>
      rows.map((row) =>
        row.id === BASELINE_SOLUTION_OVERLAY_ID && solutionName
          ? { ...row, name: solutionName }
          : row,
      ),
    );
  }

  private syncBaselineOverlayColor(isComparing: boolean): void {
    if (isComparing === this.lastIsComparing) {
      // Mode hasn't changed (e.g. Overview↔AOI); preserve the user's chosen color.
      return;
    }

    // Save the current row color before switching modes so we can restore it on return.
    const currentRow = this.overlays().find((r) => r.id === BASELINE_SOLUTION_OVERLAY_ID);
    if (this.lastIsComparing === false) {
      this.savedSingleSolutionColor = currentRow?.color ?? null;
    } else if (this.lastIsComparing === true) {
      this.savedBaselineColor = currentRow?.color ?? null;
    }
    this.lastIsComparing = isComparing;

    // Restore the color last used in this mode, falling back to the per-mode default.
    const targetColor = isComparing
      ? (this.savedBaselineColor ?? COMPARISON_BASELINE_COLOR)
      : (this.savedSingleSolutionColor ?? SINGLE_SOLUTION_COLOR);

    this.overlays.update((rows) =>
      rows.map((row) =>
        row.id === BASELINE_SOLUTION_OVERLAY_ID ? { ...row, color: targetColor } : row,
      ),
    );
    this.syncOverlayById(BASELINE_SOLUTION_OVERLAY_ID);
  }

  private hideComparisonOverlays(): void {
    this.overlays.update((rows) =>
      rows.map((row) =>
        row.id === CANDIDATE_SOLUTION_OVERLAY_ID || row.id === OVERLAP_SOLUTION_OVERLAY_ID
          ? { ...row, selected: false, visible: false }
          : row,
      ),
    );
    this.updateSelectedLayerOrder(CANDIDATE_SOLUTION_OVERLAY_ID, false);
    this.updateSelectedLayerOrder(OVERLAP_SOLUTION_OVERLAY_ID, false);
  }

  private syncComparisonSolutionOverlay(solutionName: string | null): void {
    if (!solutionName) {
      this.overlays.update((rows) =>
        rows.filter((row) => row.id !== CANDIDATE_SOLUTION_OVERLAY_ID),
      );
      this.updateSelectedLayerOrder(CANDIDATE_SOLUTION_OVERLAY_ID, false);
      return;
    }

    let hasCandidateOverlay = false;
    this.overlays.update((rows) => {
      const nextRows = rows.map((row) => {
        if (row.id !== CANDIDATE_SOLUTION_OVERLAY_ID) {
          return row;
        }
        hasCandidateOverlay = true;
        return {
          ...row,
          name: solutionName,
          selected: true,
          visible: true,
        };
      });

      if (hasCandidateOverlay) {
        return nextRows;
      }

      return [
        ...nextRows,
        {
          id: CANDIDATE_SOLUTION_OVERLAY_ID,
          name: solutionName,
          selected: true,
          visible: true,
          expanded: true,
          opacity: DEFAULT_SOLUTION_LAYER_OPACITY_PERCENT,
          color: COMPARISON_CANDIDATE_COLOR,
          canReorder: true,
          hasStyleControls: true,
          hasColorControl: true,
          mapSync: { type: 'solution-candidate' },
        },
      ];
    });

    this.updateSelectedLayerOrder(CANDIDATE_SOLUTION_OVERLAY_ID, true);
    this.syncOverlayById(CANDIDATE_SOLUTION_OVERLAY_ID);
  }

  private syncComparisonOverlapOverlay(
    solutionName: string | null,
    shouldShowOverlap: boolean,
  ): void {
    if (!solutionName || !shouldShowOverlap) {
      this.overlays.update((rows) => rows.filter((row) => row.id !== OVERLAP_SOLUTION_OVERLAY_ID));
      this.updateSelectedLayerOrder(OVERLAP_SOLUTION_OVERLAY_ID, false);
      return;
    }

    let hasOverlapOverlay = false;
    this.overlays.update((rows) => {
      const nextRows = rows.map((row) => {
        if (row.id !== OVERLAP_SOLUTION_OVERLAY_ID) {
          return row;
        }
        hasOverlapOverlay = true;
        return {
          ...row,
          selected: true,
          visible: true,
        };
      });

      if (hasOverlapOverlay) {
        return nextRows;
      }

      return [
        ...nextRows,
        {
          id: OVERLAP_SOLUTION_OVERLAY_ID,
          name: this.localizedTextOrFallback(
            'mapLayersPanel.overlayNames.agreementOverlap',
            'Agreement / Overlap',
          ),
          selected: true,
          visible: true,
          expanded: true,
          opacity: 100,
          color: COMPARISON_OVERLAP_COLOR,
          canReorder: true,
          hasStyleControls: true,
          hasColorControl: true,
          mapSync: { type: 'solution-overlap' },
        },
      ];
    });

    this.updateSelectedLayerOrder(OVERLAP_SOLUTION_OVERLAY_ID, true, 'start');
  }

  private createDefaultTaxa(): TaxonRow[] {
    return [
      {
        id: 'taxon-mammals',
        name: this.localizedText('mapLayersPanel.taxaNames.mammals'),
        countLabel: this.toSpeciesCountLabel(412),
        speciesCount: 412,
        selected: false,
        visible: false,
        expanded: false,
        opacity: DEFAULT_DATA_LAYER_OPACITY,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-mammals', [
          { common: 'Jaguar', latin: 'Panthera onca' },
          { common: 'Spectacled Bear', latin: 'Tremarctos ornatus' },
          { common: 'Mountain Tapir', latin: 'Tapirus pinchaque' },
          { common: 'Brown Spider Monkey', latin: 'Ateles hybridus' },
          { common: 'Puma', latin: 'Puma concolor' },
          { common: 'Giant Otter', latin: 'Pteronura brasiliensis' },
          { common: 'Woolly Monkey', latin: 'Lagothrix lagothricha' },
        ]),
      },
      {
        id: 'taxon-birds',
        name: this.localizedText('mapLayersPanel.taxaNames.birds'),
        countLabel: this.toSpeciesCountLabel(1932),
        speciesCount: 1932,
        selected: false,
        visible: false,
        expanded: false,
        opacity: DEFAULT_DATA_LAYER_OPACITY,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-birds', [
          { common: 'Andean Condor', latin: 'Vultur gryphus' },
          { common: 'Yellow-eared Parrot', latin: 'Ognorhynchus icterotis' },
          { common: 'Blue-billed Curassow', latin: 'Crax alberti' },
          { common: 'Multicolored Tanager', latin: 'Chlorochrysa nitidissima' },
          { common: 'Turquoise Dacnis', latin: 'Dacnis hartlaubi' },
          { common: 'Rusty-faced Parrot', latin: 'Hapalopsittaca amazonina' },
          { common: 'Tolima Dove', latin: 'Leptotila conoveri' },
        ]),
      },
      {
        id: 'taxon-amphibians',
        name: this.localizedText('mapLayersPanel.taxaNames.amphibians'),
        countLabel: this.toSpeciesCountLabel(803),
        speciesCount: 803,
        selected: false,
        visible: false,
        expanded: false,
        opacity: DEFAULT_DATA_LAYER_OPACITY,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-amphibians', [
          { common: 'Golden Poison Frog', latin: 'Phyllobates terribilis' },
          { common: 'Harlequin Poison Frog', latin: 'Oophaga histrionica' },
          { common: "Lehmann's Poison Frog", latin: 'Oophaga lehmanni' },
          { common: 'Elegant Stubfoot Toad', latin: 'Atelopus elegans' },
          { common: "Buckley's Glass Frog", latin: 'Centrolene buckleyi' },
          { common: 'Cauca Poison Frog', latin: 'Andinobates bombetes' },
          { common: "Lynch's Robber Frog", latin: 'Pristimantis lynchi' },
        ]),
      },
      {
        id: 'taxon-reptiles',
        name: this.localizedText('mapLayersPanel.taxaNames.reptiles'),
        countLabel: this.toSpeciesCountLabel(590),
        speciesCount: 590,
        selected: false,
        visible: false,
        expanded: false,
        opacity: DEFAULT_DATA_LAYER_OPACITY,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-reptiles', [
          { common: 'Orinoco Crocodile', latin: 'Crocodylus intermedius' },
          { common: 'Hawksbill Sea Turtle', latin: 'Eretmochelys imbricata' },
          { common: 'Green Iguana', latin: 'Iguana iguana' },
          { common: 'Bushmaster', latin: 'Lachesis muta' },
          { common: 'Leatherback Sea Turtle', latin: 'Dermochelys coriacea' },
          { common: 'Spectacled Caiman', latin: 'Caiman crocodilus' },
        ]),
      },
      {
        id: 'taxon-plants',
        name: this.localizedText('mapLayersPanel.taxaNames.plants'),
        countLabel: this.toSpeciesCountLabel(4963),
        speciesCount: 4963,
        selected: false,
        visible: false,
        expanded: false,
        opacity: DEFAULT_DATA_LAYER_OPACITY,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-plants', [
          { common: 'Quindio Wax Palm', latin: 'Ceroxylon quindiuense' },
          { common: 'Frailejon', latin: 'Espeletia grandiflora' },
          { common: 'May Flower Orchid', latin: 'Cattleya trianae' },
          { common: 'Guayacan', latin: 'Tabebuia chrysantha' },
          { common: 'Abarco', latin: 'Cariniana pyriformis' },
          { common: 'Heaven Lotus', latin: 'Gustavia superba' },
          { common: 'Lobster Claw', latin: 'Heliconia rostrata' },
        ]),
      },
      this.excludedSpeciesTaxonRow(undefined),
    ];
  }

  private reconcileTaxaWithSpeciesManifest(manifestLayers: RuntimeSpeciesManifestLayer[]): void {
    const existingTaxaById = new Map(this.taxa().map((taxon) => [taxon.id, taxon]));
    const manifestLayersByTaxonId = this.groupSpeciesManifestLayersByTaxon(manifestLayers);
    const taxa = Array.from(manifestLayersByTaxonId.entries())
      .filter(([taxonId]) => !EXCLUDED_SPECIES_TAXON_IDS.has(taxonId))
      .map(([taxonId, layers]) =>
        this.speciesManifestTaxonRow(taxonId, layers, existingTaxaById.get(taxonId)),
      )
      .sort((left, right) => this.compareSpeciesTaxa(left, right));
    taxa.push(this.excludedSpeciesTaxonRow(existingTaxaById.get(FISH_TAXON_ROW_ID)));
    const speciesLayerCount = taxa.reduce((total, taxon) => total + taxon.speciesCount, 0);

    this.taxa.set(taxa);
    this.groups.update((groups) =>
      groups.map((group) =>
        group.id === 'group-species-biodiversity'
          ? {
              ...group,
              countLabel: this.toLayerCountLabel(group.rows.length + speciesLayerCount),
              rows: group.rows.map((row) =>
                this.isSpeciesCollectionRow(row)
                  ? { ...row, countLabel: this.toSpeciesCountLabel(speciesLayerCount) }
                  : row,
              ),
            }
          : group,
      ),
    );
    this.selectedLayerOrder.update((order) => this.normalizeSelectedLayerOrder(order));
  }

  private groupSpeciesManifestLayersByTaxon(
    manifestLayers: RuntimeSpeciesManifestLayer[],
  ): Map<string, RuntimeSpeciesManifestLayer[]> {
    const groups = new Map<string, RuntimeSpeciesManifestLayer[]>();
    for (const layer of manifestLayers) {
      const taxonId = this.speciesTaxonRowId(layer);
      groups.set(taxonId, [...(groups.get(taxonId) ?? []), layer]);
    }
    return groups;
  }

  private speciesManifestTaxonRow(
    taxonId: string,
    layers: RuntimeSpeciesManifestLayer[],
    existingTaxon: TaxonRow | undefined,
  ): TaxonRow {
    const taxonName = this.speciesTaxonName(layers[0]);
    const species = layers.map((layer) =>
      this.speciesManifestLayerRow(taxonId, layer, existingTaxon?.species),
    );

    return {
      id: taxonId,
      name: taxonName,
      countLabel: this.toSpeciesCountLabel(species.length),
      speciesCount: species.length,
      selected: existingTaxon?.selected ?? false,
      visible: existingTaxon?.visible ?? false,
      expanded: existingTaxon?.expanded ?? false,
      opacity: existingTaxon?.opacity ?? DEFAULT_DATA_LAYER_OPACITY,
      color: existingTaxon?.color ?? '#64748b',
      canReorder: false,
      hasStyleControls: false,
      hasColorControl: false,
      mapUnavailable: true,
      searchQuery: existingTaxon?.searchQuery ?? '',
      showAll: existingTaxon?.showAll ?? false,
      species,
    };
  }

  private excludedSpeciesTaxonRow(existingTaxon: TaxonRow | undefined): TaxonRow {
    return {
      id: FISH_TAXON_ROW_ID,
      name: this.localizedTextOrFallback('mapLayersPanel.taxaNames.fish', 'Fish'),
      countLabel: this.localizedTextOrFallback('mapLayersPanel.fishExcludedBadge', 'Excluded'),
      speciesCount: 0,
      selected: false,
      visible: false,
      expanded: false,
      opacity: existingTaxon?.opacity ?? DEFAULT_DATA_LAYER_OPACITY,
      color: existingTaxon?.color ?? '#64748b',
      canReorder: false,
      hasStyleControls: false,
      hasColorControl: false,
      disabled: true,
      mapUnavailable: true,
      searchQuery: '',
      showAll: false,
      species: [],
    };
  }

  private compareSpeciesTaxa(left: TaxonRow, right: TaxonRow): number {
    const leftOrder = SPECIES_TAXON_SORT_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = SPECIES_TAXON_SORT_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.name.localeCompare(right.name);
  }

  private speciesManifestLayerRow(
    taxonId: string,
    layer: RuntimeSpeciesManifestLayer,
    existingSpeciesRows: SpeciesRow[] | undefined,
  ): SpeciesRow {
    const rowId = `species-${layer.id}`;
    const existingSpecies = existingSpeciesRows?.find((species) => species.id === rowId);
    const rendering = layer.rendering;
    const displayUrl = layer.displayUrl?.trim() ?? '';
    const isRenderable =
      !!rendering && isManifestRenderingSupported(rendering) && displayUrl.length > 0;
    const commonName = layer.commonName?.trim() || layer.scientificName;
    const scientificName = layer.scientificName?.trim() || commonName;

    return {
      id: rowId,
      name: commonName,
      common: commonName,
      latin: scientificName,
      taxonId,
      slug: layer.id,
      selected: existingSpecies?.selected ?? false,
      visible: isRenderable ? (existingSpecies?.visible ?? false) : false,
      expanded: existingSpecies?.expanded ?? false,
      opacity: existingSpecies?.opacity ?? DEFAULT_DATA_LAYER_OPACITY,
      color: existingSpecies?.color ?? rendering?.selectedColor ?? '#475569',
      canReorder: true,
      hasStyleControls: true,
      hasColorControl: false,
      mapUnavailable: !isRenderable,
      mapSync:
        isRenderable && rendering
          ? {
              type: 'manifest-raster',
              layerId: rowId,
              displayUrl,
              rendering,
            }
          : undefined,
    };
  }

  private speciesTaxonRowId(layer: RuntimeSpeciesManifestLayer): string {
    if (layer.taxonId?.trim()) {
      return `taxon-${this.toSlug(layer.taxonId)}`;
    }
    if (layer.taxonLabel?.trim()) {
      return `taxon-${this.toSlug(layer.taxonLabel)}`;
    }
    return 'taxon-individual-species';
  }

  private speciesTaxonName(layer: RuntimeSpeciesManifestLayer | undefined): string {
    return layer?.taxonLabel?.trim() || 'Unclassified species';
  }

  private isSpeciesCollectionRow(row: LayerControlRow): boolean {
    return row.id === SPECIES_COLLECTION_ROW_ID;
  }

  private parseSpeciesTaxonomyLookup(
    csvText: string,
  ): Map<string, { taxonId: string; taxonLabel: string }> {
    const rows = csvText.split(/\r?\n/).filter((row) => row.trim().length > 0);
    if (rows.length === 0) {
      return new Map();
    }

    const header = this.parseCsvRow(rows[0]);
    const scientificNameIndex = header.indexOf('scientific_name');
    const classIndex = header.indexOf('class');
    if (scientificNameIndex < 0 || classIndex < 0) {
      return new Map();
    }

    const taxonomyLookup = new Map<string, { taxonId: string; taxonLabel: string }>();
    for (const row of rows.slice(1)) {
      const cells = this.parseCsvRow(row);
      const scientificName = cells[scientificNameIndex] ?? '';
      const speciesClass = cells[classIndex] ?? '';
      const taxonomy = SPECIES_CLASS_TO_TAXON[speciesClass.trim()];
      const lookupKey = this.normalizeSpeciesLookupKey(scientificName);
      if (!lookupKey || !taxonomy) {
        continue;
      }
      taxonomyLookup.set(lookupKey, taxonomy);
    }
    return taxonomyLookup;
  }

  private parseCsvRow(row: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let index = 0; index < row.length; index += 1) {
      const char = row[index];
      if (char === '"') {
        const nextChar = row[index + 1];
        if (inQuotes && nextChar === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        fields.push(currentField.trim());
        currentField = '';
        continue;
      }

      currentField += char;
    }

    fields.push(currentField.trim());
    return fields;
  }

  private normalizeSpeciesLookupKey(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Category cards below Conservation Areas — all start collapsed (UCS-101).
   * Conservation Areas itself uses `overlaysCollapsed` (default expanded).
   */
  private createDefaultGroups(): LayerGroup[] {
    const sirapNameKeys = {
      siraps: 'mapLayersPanel.boundaryNames.combinedSirapReviewLayer',
      siraps_territorial: 'mapLayersPanel.boundaryNames.territorialSiraps',
      siraps_territorial_updated: 'mapLayersPanel.boundaryNames.territorialSirapsUpdated',
      siraps_thematic: 'mapLayersPanel.boundaryNames.thematicSirapAdditions',
    } as const;
    const sirapRows = enabledSirapBoundaryLayerKeys().map((layerKey) =>
      this.boundaryRow(
        layerKey,
        'sirap',
        this.localizedText(sirapNameKeys[layerKey]),
        false,
        false,
      ),
    );
    const adminBoundaryRows = [
      ...sirapRows,
      this.boundaryRow(
        'admin_country_outline',
        'department',
        this.localizedText('mapLayersPanel.boundaryNames.colombiaOutline'),
        true,
        true,
      ),
      this.boundaryRow(
        'admin_departments',
        'department',
        this.localizedText('mapLayersPanel.boundaryNames.departments'),
        false,
        false,
      ),
      this.boundaryRow(
        'admin_municipalities',
        'municipality',
        this.localizedText('mapLayersPanel.boundaryNames.municipalities'),
        false,
        false,
      ),
    ];

    return [
      {
        id: 'group-admin-boundaries',
        title: this.localizedText('mapLayersPanel.groupTitles.administrativeBoundaries'),
        countLabel: this.toLayerCountLabel(adminBoundaryRows.length),
        ...this.defaultSidebarCategoryState('group-admin-boundaries'),
        rows: adminBoundaryRows,
      },
      {
        id: 'group-species-biodiversity',
        title: this.localizedText('mapLayersPanel.groupTitles.speciesBiodiversity'),
        countLabel: this.toLayerCountLabel(0),
        ...this.defaultSidebarCategoryState('group-species-biodiversity'),
        rows: [],
      },
      {
        id: 'group-ecosystems',
        title: this.ecosystemsCopy().groupTitle,
        countLabel: this.toLayerCountLabel(5),
        ...this.defaultSidebarCategoryState('group-ecosystems'),
        note: this.ecosystemsCopy().groupNote,
        rows: [
          this.layerRow(
            'eco-types',
            this.ecosystemsCopy().iavhRowName,
            '#0d9488',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
          {
            ...this.layerRow(
              'strategic-ecosystems',
              this.ecosystemsCopy().strategicGroupName,
              '#15803d',
              DEFAULT_DATA_LAYER_OPACITY,
            ),
            selected: false,
            visible: false,
            expanded: true,
            canReorder: false,
            hasStyleControls: false,
            hasColorControl: false,
            hideAddButton: true,
          },
          this.layerRow('eco-paramos', 'Páramos', '#6d8e7e', DEFAULT_DATA_LAYER_OPACITY),
          this.layerRow(
            'eco-wetlands',
            this.activeLanguage() === 'es' ? 'Humedales' : 'Wetlands',
            '#0284c7',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
          this.layerRow(
            'eco-dry-forest',
            this.activeLanguage() === 'es' ? 'Bosque seco' : 'Dry Forest',
            '#a16207',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
          this.layerRow(
            'eco-mangroves',
            this.activeLanguage() === 'es' ? 'Manglares' : 'Mangroves',
            '#15803d',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
        ].map((row) =>
          STRATEGIC_ECOSYSTEM_ROW_IDS.has(row.id)
            ? { ...row, parentId: STRATEGIC_ECOSYSTEM_GROUP_ROW_ID }
            : row,
        ),
      },
      {
        id: MARINE_ECOSYSTEMS_GROUP_ID,
        title: this.localizedText('mapLayersPanel.groupTitles.marineEcosystems'),
        countLabel: this.toLayerCountLabel(0),
        ...this.defaultSidebarCategoryState(MARINE_ECOSYSTEMS_GROUP_ID),
        rows: [],
      },
      {
        id: 'group-cultural-ethnic',
        title: this.localizedText('mapLayersPanel.groupTitles.culturalEthnicTerritories'),
        countLabel: this.toLayerCountLabel(2),
        ...this.defaultSidebarCategoryState('group-cultural-ethnic'),
        rows: [
          this.layerRow(
            'cult-indigenous',
            'Indigenous Reserves',
            '#6366f1',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
          this.layerRow(
            'cult-afro',
            'Community Councils for Black Communities',
            '#a855f7',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
        ],
      },
      {
        id: 'group-socio-economic',
        title: this.localizedText('mapLayersPanel.groupTitles.costs'),
        countLabel: this.toLayerCountLabel(4),
        ...this.defaultSidebarCategoryState('group-socio-economic'),
        rows: [
          this.layerRow(
            'soc-human-footprint',
            'Human Footprint',
            '#d97706',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
          this.layerRow(
            'soc-ag-opportunity-cost',
            'Agricultural Opportunity Cost',
            '#ea580c',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
          this.layerRow('soc-land-use', 'Land Use', '#78716c', DEFAULT_DATA_LAYER_OPACITY),
          this.layerRow(
            'hhm',
            this.localizedText('mapLayersPanel.layerNames.marineHumanModification'),
            '#0e7490',
            DEFAULT_DATA_LAYER_OPACITY,
          ),
        ],
      },
    ];
  }

  private defaultSidebarCategoryState(
    sidebarGroupId: string,
  ): Pick<LayerGroup, 'collapsed' | 'comingSoon'> {
    const binding = sidebarCategoryBindingForGroup(sidebarGroupId);
    return {
      collapsed: binding?.defaultCollapsed ?? true,
      comingSoon: binding?.defaultComingSoon ?? false,
    };
  }

  private layerRow(id: string, name: string, color: string, opacity: number): LayerControlRow {
    return {
      id: `layer-${id}`,
      name,
      selected: false,
      visible: false,
      expanded: false,
      opacity,
      color,
      canReorder: true,
      hasStyleControls: true,
      hasColorControl: true,
      mapUnavailable: true,
    };
  }

  private boundaryRow(
    boundaryLayerKey: AdminBoundaryLayerKey,
    boundaryType: AoiType,
    name: string,
    visible: boolean,
    selected: boolean,
  ): LayerControlRow {
    return {
      id: `boundary-${boundaryLayerKey}`,
      name,
      selected,
      visible,
      expanded: selected,
      opacity: 100,
      color: '#111827',
      borderColor: '#111827',
      borderStyle:
        boundaryLayerKey === 'siraps'
          ? 'dashed'
          : boundaryLayerKey === 'siraps_thematic' ||
              boundaryLayerKey === 'siraps_territorial_updated'
            ? 'dotted'
            : 'solid',
      borderWidth:
        boundaryLayerKey === 'admin_country_outline'
          ? 1.6
          : boundaryLayerKey === 'siraps' ||
              boundaryLayerKey === 'siraps_territorial' ||
              boundaryLayerKey === 'siraps_territorial_updated' ||
              boundaryLayerKey === 'siraps_thematic'
            ? 1.25
            : 1,
      canReorder: false,
      hasStyleControls: false,
      hasColorControl: false,
      mapSync: { type: 'admin-boundary', boundaryType, boundaryLayerKey },
    };
  }

  private syncLocaleSensitiveSidebarLabels(): void {
    const activeSolutionName = this.appState.activeSolution$()?.name ?? null;
    const speciesLayerCount = this.taxa().reduce((total, taxon) => total + taxon.speciesCount, 0);

    this.managementFiguresTitle.set(
      this.localizedTextOrFallback(
        'mapLayersPanel.groupTitles.managementFigures',
        'Conservation Areas',
      ),
    );

    this.overlays.update((rows) =>
      rows.map((row) => {
        if (row.id === BASELINE_SOLUTION_OVERLAY_ID && !activeSolutionName) {
          return {
            ...row,
            name: this.localizedTextOrFallback(
              'mapLayersPanel.overlayNames.conservationSolution',
              'Conservation Scenario',
            ),
          };
        }
        if (row.id === 'overlay-runap') {
          return {
            ...row,
            name: this.localizedTextOrFallback(
              'mapLayersPanel.overlayNames.protectedAreasRunap',
              'Protected Areas (RUNAP)',
            ),
          };
        }
        if (row.id === RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID) {
          return {
            ...row,
            name: this.localizedTextOrFallback(
              'mapLayersPanel.overlayNames.nationalNaturalParks',
              'National Natural Parks',
            ),
          };
        }
        if (row.id === 'overlay-omecs') {
          return {
            ...row,
            name: this.localizedTextOrFallback('mapLayersPanel.overlayNames.omecs', 'OMECs'),
          };
        }
        if (row.id === OVERLAP_SOLUTION_OVERLAY_ID) {
          return {
            ...row,
            name: this.localizedTextOrFallback(
              'mapLayersPanel.overlayNames.agreementOverlap',
              'Agreement / Overlap',
            ),
          };
        }
        return row;
      }),
    );

    this.groups.update((groups) =>
      groups.map((group) => {
        const translatedTitle = this.groupTitleForId(group.id);
        const translatedRows = group.rows.map((row) => {
          if (group.id === 'group-admin-boundaries') {
            return {
              ...row,
              name: this.boundaryNameForId(row.id) ?? row.name,
            };
          }
          if (row.id === SPECIES_COLLECTION_ROW_ID) {
            return {
              ...row,
              name: this.localizedTextOrFallback(
                'mapLayersPanel.individualSpecies',
                'Individual species ranges',
              ),
            };
          }
          if (group.id === 'group-ecosystems') {
            return {
              ...row,
              name: this.ecosystemRowNameForId(row.id) ?? row.name,
            };
          }
          if (row.id === 'layer-hhm') {
            return {
              ...row,
              name: this.localizedTextOrFallback(
                'mapLayersPanel.layerNames.marineHumanModification',
                'Marine human modification (HHM)',
              ),
            };
          }
          return row;
        });
        const nextCountLabel =
          group.id === 'group-species-biodiversity'
            ? this.toLayerCountLabel(group.rows.length + speciesLayerCount)
            : this.toLayerCountLabel(this.layerRowCount(group.rows));

        return {
          ...group,
          title: translatedTitle ?? group.title,
          countLabel: nextCountLabel,
          rows: translatedRows,
        };
      }),
    );

    this.taxa.update((taxa) =>
      taxa.map((taxon) => ({
        ...taxon,
        name: this.taxonNameForId(taxon.id) ?? taxon.name,
        countLabel: this.toSpeciesCountLabel(taxon.speciesCount),
      })),
    );
  }

  private groupTitleForId(groupId: string): string | undefined {
    const titleKeys: Record<string, string> = {
      'group-admin-boundaries': 'mapLayersPanel.groupTitles.administrativeBoundaries',
      'group-species-biodiversity': 'mapLayersPanel.groupTitles.speciesBiodiversity',
      'group-ecosystems': 'mapLayersPanel.groupTitles.ecosystems',
      [MARINE_ECOSYSTEMS_GROUP_ID]: 'mapLayersPanel.groupTitles.marineEcosystems',
      'group-cultural-ethnic': 'mapLayersPanel.groupTitles.culturalEthnicTerritories',
      'group-socio-economic': 'mapLayersPanel.groupTitles.costs',
    };
    const key = titleKeys[groupId];
    return key ? this.localizedText(key) : undefined;
  }

  private layerRowCount(rows: LayerControlRow[]): number {
    return rows.filter((row) => !row.hideAddButton).length;
  }

  private boundaryNameForId(rowId: string): string | undefined {
    const boundaryNameKeys: Record<string, string> = {
      'boundary-siraps': 'mapLayersPanel.boundaryNames.combinedSirapReviewLayer',
      'boundary-siraps_territorial': 'mapLayersPanel.boundaryNames.territorialSiraps',
      'boundary-siraps_territorial_updated':
        'mapLayersPanel.boundaryNames.territorialSirapsUpdated',
      'boundary-siraps_thematic': 'mapLayersPanel.boundaryNames.thematicSirapAdditions',
      'boundary-admin_country_outline': 'mapLayersPanel.boundaryNames.colombiaOutline',
      'boundary-admin_departments': 'mapLayersPanel.boundaryNames.departments',
      'boundary-admin_municipalities': 'mapLayersPanel.boundaryNames.municipalities',
    };
    const boundaryNameFallbacks: Record<string, string> = {
      'boundary-siraps': 'SIRAP',
      'boundary-siraps_territorial': 'Territorial SIRAPs (outdated)',
      'boundary-siraps_territorial_updated': 'Territorial SIRAPs',
      'boundary-siraps_thematic': 'Thematic SIRAPs',
      'boundary-admin_country_outline': 'Colombia Outline',
      'boundary-admin_departments': 'Departments',
      'boundary-admin_municipalities': 'Municipalities',
    };
    const key = boundaryNameKeys[rowId];
    return key
      ? this.localizedTextOrFallback(key, boundaryNameFallbacks[rowId] ?? rowId)
      : undefined;
  }

  private ecosystemRowNameForId(rowId: string): string | undefined {
    const copy = this.ecosystemsCopy();
    const strategicNames: Record<string, { en: string; es: string }> = {
      'layer-paramos': { en: 'Páramos', es: 'Páramos' },
      'layer-eco-paramos': { en: 'Páramos', es: 'Páramos' },
      'layer-wetlands': { en: 'Wetlands', es: 'Humedales' },
      'layer-eco-wetlands': { en: 'Wetlands', es: 'Humedales' },
      'layer-bosque_seco': { en: 'Dry Forest', es: 'Bosque seco' },
      'layer-eco-dry-forest': { en: 'Dry Forest', es: 'Bosque seco' },
      'layer-mangroves': { en: 'Mangroves', es: 'Manglares' },
      'layer-eco-mangroves': { en: 'Mangroves', es: 'Manglares' },
    };

    if (rowId === STRATEGIC_ECOSYSTEM_GROUP_ROW_ID) {
      return copy.strategicGroupName;
    }
    if (
      rowId === IAVH_ECOSYSTEM_LAYER_ID ||
      rowId === 'layer-ecosistemas' ||
      rowId === 'layer-eco-types'
    ) {
      return this.localizedTextOrFallback('mapLayersPanel.ecosystemsLayerName', copy.iavhRowName);
    }
    return strategicNames[rowId]?.[this.activeLanguage()];
  }

  private taxonNameForId(taxonId: string): string | undefined {
    const taxonNameKeys: Record<string, string> = {
      'taxon-mammals': 'mapLayersPanel.taxaNames.mammals',
      'taxon-birds': 'mapLayersPanel.taxaNames.birds',
      'taxon-amphibians': 'mapLayersPanel.taxaNames.amphibians',
      'taxon-reptiles': 'mapLayersPanel.taxaNames.reptiles',
      'taxon-plants': 'mapLayersPanel.taxaNames.plants',
      'taxon-fish': 'mapLayersPanel.taxaNames.fish',
    };
    const key = taxonNameKeys[taxonId];
    return key ? this.localizedText(key) : undefined;
  }

  private localizedText(key: string, params?: Record<string, string | number>): string {
    this.appLocaleService.locale();
    return this.translate.instant(key, params);
  }

  private localizedTextOrFallback(
    key: string,
    fallback: string,
    params?: Record<string, string | number>,
  ): string {
    const localizedValue = this.localizedText(key, params);
    if (!localizedValue || localizedValue === key) {
      return fallback;
    }
    return localizedValue;
  }

  private createSpeciesRows(taxonId: string, species: SpeciesSample[]): SpeciesRow[] {
    return species.map((sample) => this.speciesRow(taxonId, sample.common, sample.latin));
  }

  private speciesRow(taxonId: string, common: string, latin: string): SpeciesRow {
    const slug = this.toSlug(common);
    return {
      id: `species-${taxonId}-${slug}`,
      name: common,
      common,
      latin,
      taxonId,
      slug,
      selected: false,
      visible: false,
      expanded: false,
      opacity: DEFAULT_DATA_LAYER_OPACITY,
      color: '#475569',
      canReorder: true,
      hasStyleControls: true,
      hasColorControl: false,
      mapUnavailable: true,
    };
  }

  private toSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private toSpeciesCountLabel(speciesCount: number): string {
    const noun = this.localizedTextOrFallback('mapLayersPanel.speciesNoun', 'species');
    return `${speciesCount.toLocaleString()} ${noun}`;
  }

  private nameMatchesSearch(name: string, normalizedQuery: string): boolean {
    return nameMatchesSearch(name, normalizedQuery);
  }

  private speciesMatchesSearch(species: SpeciesRow, normalizedQuery: string): boolean {
    return speciesMatchesSearch(species, normalizedQuery);
  }

  private taxonMatchesSearch(taxon: TaxonRow, normalizedQuery: string): boolean {
    return taxonMatchesSearch(taxon, normalizedQuery);
  }
}
