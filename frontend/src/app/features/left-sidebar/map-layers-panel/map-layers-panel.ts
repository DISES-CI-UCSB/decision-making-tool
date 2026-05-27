import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  EventEmitter,
  OnDestroy,
  Output,
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
  buildManifestSidebarLayerGroups,
  type AoiType,
  type ManifestSidebarLayerGroup,
  type ManifestSidebarLayerRow,
  type RuntimeLayerManifest,
  type RuntimeLayerManifestRenderingConfig,
  type RuntimeLayerManifestDataRole,
  type RuntimeSpeciesManifest,
  type RuntimeSpeciesManifestLayer,
} from '@core/models';
import { AppLocaleService } from '@core/services/app-locale.service';
import { AppStateService, type MapLegendLayerEntry } from '@core/services/app-state.service';
import { LayerManifestService } from '@core/services/layer-manifest.service';
import {
  AdminBoundaryService,
  type AdminBoundaryLayerKey,
} from '@features/map/services/admin-boundary.service';
import {
  ManifestRasterLayerService,
  VECTOR_OVERLAY_ARCGIS_LAYER_ID_BY_OVERLAY_ID,
} from '@features/map/services/manifest-raster-layer.service';
import {
  DEFAULT_COMPARISON_BASELINE_HEX,
  DEFAULT_COMPARISON_CANDIDATE_HEX,
  DEFAULT_COMPARISON_OVERLAP_HEX,
  DEFAULT_SINGLE_SOLUTION_HEX,
  SolutionLayerService,
} from '@features/map/services/solution-layer.service';
import { catchError, map, of, switchMap } from 'rxjs';
import { FEATURE_FLAGS } from '@feature-flags';

interface LayerControlRow {
  id: string;
  name: string;
  countLabel?: string;
  selected: boolean;
  visible: boolean;
  expanded: boolean;
  opacity: number;
  color: string;
  canReorder: boolean;
  hasStyleControls: boolean;
  hasColorControl: boolean;
  disabled?: boolean;
  mapUnavailable?: boolean;
  hideAddButton?: boolean;
  mapSync?:
    | { type: 'solution-baseline' }
    | { type: 'solution-candidate' }
    | { type: 'solution-overlap' }
    | { type: 'app-state-layer'; layerId: string }
    | {
        type: 'manifest-raster';
        layerId: string;
        displayUrl: string;
        rendering: RuntimeLayerManifestRenderingConfig;
      }
    | {
        type: 'admin-boundary';
        boundaryType: AoiType;
        boundaryLayerKey: AdminBoundaryLayerKey;
      };
}

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

interface LayerGroup {
  id: string;
  title: string;
  countLabel?: string;
  collapsed: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
  note?: string;
  rows: LayerControlRow[];
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

const SPECIES_VISIBLE_LIMIT = 6;
/**
 * ngx-color-picker remembers whichever input format (Hex / R G B / H S L) the
 * user last selected and does not reset it across reopens. The directive's
 * `dialog` field is the live `ColorPickerComponent` instance — declared
 * `private` for TS but reachable at runtime — and `format` on that component
 * is the numeric input mode (0 = HEX). We reset to 0 on every open below so
 * the popup always greets the user with the hex input.
 */
const COLOR_PICKER_HEX_FORMAT = 0;
/** Formats exposed in the inlined dropdown; values match ngx-color-picker's `format` field. */
const COLOR_PICKER_FORMAT_OPTIONS = [
  { format: 0, label: 'Hex' },
  { format: 1, label: 'RGB' },
  { format: 2, label: 'HSL' },
] as const;
/** Class names of the per-format input containers ngx-color-picker renders into the dialog. */
const COLOR_PICKER_FORMAT_CONTAINER_CLASSES = ['hex-text', 'rgba-text', 'hsla-text'] as const;
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
type SelectedLayerDropPosition = 'before' | 'after';
type SupportedLanguage = 'en' | 'es';
const BASELINE_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution';
const CANDIDATE_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution-candidate';
const OVERLAP_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution-overlap';
const DEFAULT_SPECIES_MANIFEST_URL = '/data/layer-manifest/species.manifest.json';
const SPECIES_COLLECTION_ROW_ID = 'layer-species';
const SPECIES_TAXONOMY_CSV_URL =
  'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/species/biomod_spp_ranges_updatedIUCN.csv';
const SIDEBAR_GROUP_TO_MANIFEST_CATEGORY_ID: Partial<Record<LayerGroup['id'], string>> = {
  'group-ecosystems': 'ecosystems',
  'group-socio-economic': 'socioeconomic',
  'group-cultural-ethnic': 'cultural_and_ethnic_territories',
  'group-species-biodiversity': 'species_and_biodiversity',
};
const MANIFEST_CATEGORY_TITLE_OVERRIDES: Partial<Record<string, { en: string; es: string }>> = {
  socioeconomic: { en: 'Costs', es: 'Costos' },
};
const SPECIES_CLASS_TO_TAXON: Record<string, { taxonId: string; taxonLabel: string }> = {
  Mammalia: { taxonId: 'mammals', taxonLabel: 'Mammals' },
  Aves: { taxonId: 'birds', taxonLabel: 'Birds' },
  Amphibia: { taxonId: 'amphibians', taxonLabel: 'Amphibians' },
  Squamata: { taxonId: 'reptiles', taxonLabel: 'Reptiles' },
  Crocodylia: { taxonId: 'reptiles', taxonLabel: 'Reptiles' },
  Magnoliopsida: { taxonId: 'plants', taxonLabel: 'Plants' },
};
const SPECIES_TAXON_SORT_ORDER = new Map<string, number>([
  ['taxon-mammals', 0],
  ['taxon-birds', 1],
  ['taxon-amphibians', 2],
  ['taxon-reptiles', 3],
  ['taxon-plants', 4],
]);
const MANIFEST_OVERLAY_ROW_BY_LAYER_ID: Record<string, string> = {
  runap: 'overlay-runap',
  omecs: 'overlay-omecs',
};
const MANIFEST_ADMIN_BOUNDARY_LAYER_TO_SYNC: Record<
  string,
  { boundaryType: AoiType; boundaryLayerKey: AdminBoundaryLayerKey }
> = {
  siraps: { boundaryType: 'sirap', boundaryLayerKey: 'siraps' },
  siraps_territorial: { boundaryType: 'sirap', boundaryLayerKey: 'siraps_territorial' },
  siraps_thematic: { boundaryType: 'sirap', boundaryLayerKey: 'siraps_thematic' },
  admin_country_outline: {
    boundaryType: 'department',
    boundaryLayerKey: 'admin_country_outline',
  },
  admin_departments: { boundaryType: 'department', boundaryLayerKey: 'admin_departments' },
  admin_municipalities: { boundaryType: 'municipality', boundaryLayerKey: 'admin_municipalities' },
};
const MANIFEST_GROUP_COLOR_PALETTES: Record<string, string[]> = {
  'group-ecosystems': ['#0d9488', '#6d8e7e', '#0284c7', '#a16207', '#15803d'],
  'group-socio-economic': ['#d97706', '#ea580c', '#78716c'],
  'group-cultural-ethnic': ['#6366f1', '#a855f7'],
};
const IAVH_ECOSYSTEM_LAYER_ID = 'ecosistemas';
const STRATEGIC_ECOSYSTEM_LAYER_IDS = new Set(['paramos', 'wetlands', 'bosque_seco', 'mangroves']);
const ECOSYSTEMS_COPY = {
  en: {
    groupTitle: 'Ecosystems',
    groupNote:
      'Strategic ecosystem overlays are decision-facing layers such as paramos, wetlands, dry forest, and mangroves. IAVH Ecosystems Classification is a 430-class national reference layer, grouped into broad biome families for display.',
    iavhRowName: 'IAVH Ecosystems Classification (2024)',
    strategicPrefix: 'Strategic',
    otherBiomeFamily: 'Other / N.A.',
  },
  es: {
    groupTitle: 'Ecosistemas',
    groupNote:
      'Las capas de ecosistemas estratégicos son capas de decisión, como páramos, humedales, bosque seco y manglares. La Clasificación de ecosistemas IAVH es una capa nacional de referencia con 430 clases, agrupada en grandes familias de biomas para su visualización.',
    iavhRowName: 'Clasificación de ecosistemas IAVH (2024)',
    strategicPrefix: 'Estratégico',
    otherBiomeFamily: 'Otro / N.A.',
  },
} as const;
const IAVH_ECOSYSTEM_NO_DATA_VALUE = 4294967295;
const IAVH_ECOSYSTEM_BIOME_GROUPS = [
  {
    label: { en: 'Orobioma', es: 'Orobioma' },
    color: '#4d7c0f',
    values: [
      14, 29, 33, 37, 38, 39, 41, 42, 43, 45, 46, 48, 49, 52, 53, 54, 55, 63, 64, 68, 74, 76, 77,
      80, 82, 84, 86, 87, 89, 90, 92, 93, 96, 97, 98, 99, 100, 101, 111, 112, 114, 116, 118, 122,
      124, 125, 126, 129, 132, 133, 134, 135, 136, 168, 176, 181, 182, 183, 184, 185, 187, 188, 189,
      197, 217, 218, 220, 221, 223, 224, 226, 227, 228, 231, 239, 241, 246, 248, 249, 250, 261, 264,
      265, 271, 278, 279, 280, 283, 292, 293, 312, 313, 314, 317, 318, 319, 320, 321, 322, 325, 327,
      328, 335, 336, 353, 355, 356, 357, 360, 361, 362, 363, 364, 365, 371, 373, 406, 409, 410, 411,
      413, 415, 416, 417, 419, 420, 421, 422, 423, 425, 426, 427, 428,
    ],
  },
  {
    label: { en: 'Zonobioma', es: 'Zonobioma' },
    color: '#15803d',
    values: [
      4, 5, 9, 15, 17, 21, 27, 34, 35, 47, 60, 78, 81, 83, 85, 91, 95, 102, 105, 106, 108, 110, 115,
      117, 120, 121, 123, 127, 139, 143, 147, 152, 154, 162, 165, 170, 177, 193, 196, 199, 206, 212,
      219, 230, 234, 240, 243, 245, 251, 252, 254, 263, 266, 272, 275, 277, 286, 288, 296, 297, 301,
      302, 305, 309, 323, 326, 332, 333, 334, 340, 342, 347, 350, 352, 359, 367, 368, 372, 379, 384,
      385, 386, 388, 389, 392, 393, 394, 398, 399, 404,
    ],
  },
  {
    label: { en: 'Hidrobioma', es: 'Hidrobioma' },
    color: '#0369a1',
    values: [
      1, 11, 13, 19, 23, 25, 26, 31, 40, 44, 57, 59, 62, 66, 73, 75, 88, 104, 107, 113, 131, 142,
      146, 150, 151, 160, 172, 174, 180, 194, 201, 204, 209, 211, 215, 216, 225, 233, 244, 247, 256,
      257, 258, 262, 274, 276, 285, 295, 298, 310, 316, 324, 331, 345, 351, 358, 374, 377, 382, 383,
      387, 396, 401, 405,
    ],
  },
  {
    label: { en: 'Helobioma', es: 'Helobioma' },
    color: '#0f766e',
    values: [
      2, 7, 8, 12, 16, 20, 24, 30, 32, 36, 50, 51, 56, 61, 65, 79, 94, 103, 109, 128, 130, 138, 141,
      145, 148, 149, 161, 164, 169, 179, 191, 198, 203, 210, 214, 232, 237, 238, 242, 253, 259, 260,
      267, 268, 282, 287, 294, 299, 311, 315, 330, 341, 344, 346, 349, 354, 376, 381, 390, 395, 402,
      407, 408,
    ],
  },
  {
    label: { en: 'Peinobioma', es: 'Peinobioma' },
    color: '#a16207',
    values: [
      3, 6, 10, 18, 28, 67, 69, 71, 119, 140, 144, 156, 157, 158, 163, 166, 171, 178, 186, 192, 202,
      207, 213, 229, 236, 269, 270, 281, 284, 289, 290, 303, 306, 308, 338, 339, 343, 369, 370, 380,
      391, 412, 430,
    ],
  },
  {
    label: { en: 'Litobioma', es: 'Litobioma' },
    color: '#78716c',
    values: [
      137, 153, 155, 159, 167, 173, 175, 190, 195, 200, 205, 208, 222, 235, 307, 329, 337, 348, 366,
      375, 378, 418, 424, 429,
    ],
  },
  {
    label: { en: 'Halobioma', es: 'Halobioma' },
    color: '#0e7490',
    values: [22, 58, 72, 255, 273, 291, 300, 304, 397, 400, 403, 414],
  },
  {
    label: { en: ECOSYSTEMS_COPY.en.otherBiomeFamily, es: ECOSYSTEMS_COPY.es.otherBiomeFamily },
    color: '#64748b',
    values: [70],
  },
] as const;
const MANIFEST_LIVE_RENDER_POLICY = {
  enabledCategoryIds: new Set<string>([
    'ecosystems',
    'socioeconomic',
    'cultural_and_ethnic_territories',
    'species_and_biodiversity',
  ]),
  blockedCategoryReasons: {
    // Management figures are rendered via the dedicated overlays card
    // (see reconcileOverlaysWithManifest) rather than the generic group rows path.
    administrative_boundaries:
      'Administrative boundary rows use boundary feature services, not raster display assets.',
  } as Record<string, string>,
} as const;
const COMPARISON_PRIORITY_OVERLAY_IDS = [
  OVERLAP_SOLUTION_OVERLAY_ID,
  BASELINE_SOLUTION_OVERLAY_ID,
  CANDIDATE_SOLUTION_OVERLAY_ID,
] as const;
const SPECIES_RICHNESS_RENDER_RANGE = {
  minValue: 815,
  maxValue: 3562,
} as const;
const HUMAN_FOOTPRINT_RENDER_RANGE = {
  minValue: 0,
  maxValue: 100,
} as const;
// Canonical color defaults live in solution-layer.service.ts; re-aliased here for readability.
const SINGLE_SOLUTION_COLOR = DEFAULT_SINGLE_SOLUTION_HEX;
const COMPARISON_BASELINE_COLOR = DEFAULT_COMPARISON_BASELINE_HEX;
const COMPARISON_CANDIDATE_COLOR = DEFAULT_COMPARISON_CANDIDATE_HEX;
const COMPARISON_OVERLAP_COLOR = DEFAULT_COMPARISON_OVERLAP_HEX;
const LEGEND_BOUNDARY_STYLES: Record<
  AdminBoundaryLayerKey,
  { lineStyle: 'solid' | 'dashed'; lineWidth: number; color: string }
> = {
  siraps: { lineStyle: 'dashed', lineWidth: 1.25, color: '#111827' },
  siraps_territorial: { lineStyle: 'solid', lineWidth: 1.25, color: '#2563eb' },
  siraps_thematic: { lineStyle: 'dashed', lineWidth: 1.25, color: '#9333ea' },
  admin_country_outline: { lineStyle: 'solid', lineWidth: 1.6, color: '#111827' },
  admin_departments: { lineStyle: 'solid', lineWidth: 1, color: '#111827' },
  admin_municipalities: { lineStyle: 'solid', lineWidth: 1, color: '#111827' },
};

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
  private readonly adminBoundaryService = inject(AdminBoundaryService);
  private readonly manifestRasterLayerService = inject(ManifestRasterLayerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly layerManifestService = inject(LayerManifestService);
  private readonly solutionLayerService = inject(SolutionLayerService);
  private readonly translate = inject(TranslateService);
  private readonly appLocaleService = inject(AppLocaleService);
  private readonly opacitySyncFrames = new Map<string, number>();
  private readonly colorSyncFrames = new Map<string, number>();
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

  protected readonly activeScenarioName = signal('Ecos30 + RUNAP + OMEC (HF)');
  protected readonly hasActiveSolution = computed(() => this.appState.hasActiveSolution());
  protected readonly overlays = signal<LayerControlRow[]>(this.createDefaultOverlays());
  protected readonly managementFiguresTitle = signal(
    this.localizedText('mapLayersPanel.groupTitles.managementFigures'),
  );
  protected readonly availableOverlays = computed(() =>
    this.overlays().filter(
      (row) => row.id !== BASELINE_SOLUTION_OVERLAY_ID && row.id !== CANDIDATE_SOLUTION_OVERLAY_ID,
    ),
  );
  /** Management Figures card: expanded by default so RUNAP/OMEC are visible; category groups start collapsed (UCS-101). */
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
    const taxa = this.taxa();
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
      const rowMatches =
        query.length === 0
          ? group.rows.length
          : group.rows.filter((row) => this.nameMatchesSearch(row.name, query)).length;
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
  protected readonly selectedLayers = computed<SelectedLayerRow[]>(() =>
    this.buildSelectedLayers(),
  );
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

    effect(() => {
      const solution = this.appState.activeSolution$();
      const speciesManifestUrl = this.speciesCollectionManifestUrl();
      untracked(() => {
        if (solution?.name) {
          this.activeScenarioName.set(solution.name);
        }
        if (solution && speciesManifestUrl) {
          this.layerManifestService.preloadSpeciesManifest(speciesManifestUrl);
        }
        this.syncPrimarySolutionOverlay(solution?.name ?? null);
      });
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
          // scenario pick starts from defaults.
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
      untracked(() => {
        this.syncSelectedLayerStackingToMap(order, overlays, groups, taxa);
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
  }

  ngOnDestroy(): void {
    document.removeEventListener('pointermove', this.rainforestProximityHandler);
    for (const frameId of this.opacitySyncFrames.values()) {
      cancelAnimationFrame(frameId);
    }
    this.opacitySyncFrames.clear();
    for (const frameId of this.colorSyncFrames.values()) {
      cancelAnimationFrame(frameId);
    }
    this.colorSyncFrames.clear();
  }

  protected requestSolutionFinder(): void {
    this.solutionFinderRequested.emit();
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
    this.reconcileGroupsWithManifest(groups);
    this.reconcileOverlaysWithManifest(groups);
    this.reconcileAdminBoundariesWithManifest(groups);
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
    return this.http.get(SPECIES_TAXONOMY_CSV_URL, { responseType: 'text' }).pipe(
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

  private reconcileGroupsWithManifest(manifestGroups: ManifestSidebarLayerGroup[]): void {
    const groupsByManifestCategoryId = new Map(
      manifestGroups.map((group) => [group.sidebarCategoryId, group]),
    );

    this.groups.update((groups) =>
      groups.map((group) => {
        const manifestCategoryId = SIDEBAR_GROUP_TO_MANIFEST_CATEGORY_ID[group.id];
        if (!manifestCategoryId) {
          return group;
        }

        const manifestGroup = groupsByManifestCategoryId.get(manifestCategoryId);
        if (!manifestGroup) {
          return group;
        }

        const rows = manifestGroup.rows.map((row, index) =>
          this.manifestSidebarLayerRow(group.id, row, index, group.rows),
        );

        return {
          ...group,
          title:
            this.manifestCategoryTitle(manifestCategoryId) ??
            this.manifestSidebarGroupTitle(manifestGroup),
          countLabel: this.toLayerCountLabel(rows.length),
          note: group.id === 'group-ecosystems' ? this.ecosystemsCopy().groupNote : group.note,
          rows,
        };
      }),
    );
    this.selectedLayerOrder.update((order) => this.normalizeSelectedLayerOrder(order));
  }

  private reconcileOverlaysWithManifest(manifestGroups: ManifestSidebarLayerGroup[]): void {
    const managementGroup = manifestGroups.find(
      (group) => group.sidebarCategoryId === 'management_figures',
    );
    if (!managementGroup) {
      return;
    }
    this.managementFiguresTitle.set(managementGroup.title);

    this.overlays.update((rows) => {
      const rowById = new Map(rows.map((row) => [row.id, row]));
      const baselineRow = rowById.get(BASELINE_SOLUTION_OVERLAY_ID);
      const candidateRow = rowById.get(CANDIDATE_SOLUTION_OVERLAY_ID);
      const overlapRow = rowById.get(OVERLAP_SOLUTION_OVERLAY_ID);
      const reconciledManagementRows: LayerControlRow[] = [];

      for (const manifestRow of managementGroup.rows) {
        const overlayId = MANIFEST_OVERLAY_ROW_BY_LAYER_ID[manifestRow.id];
        if (!overlayId) {
          continue;
        }
        const existingOverlay = rowById.get(overlayId);
        if (!existingOverlay) {
          continue;
        }
        reconciledManagementRows.push(
          this.applyManifestToManagementOverlay(existingOverlay, manifestRow),
        );
      }

      // Preserve non-manifest overlays that are still part of active comparison flows.
      return [
        ...(baselineRow ? [baselineRow] : []),
        ...(candidateRow ? [candidateRow] : []),
        ...(overlapRow ? [overlapRow] : []),
        ...reconciledManagementRows,
      ];
    });
  }

  private reconcileAdminBoundariesWithManifest(manifestGroups: ManifestSidebarLayerGroup[]): void {
    const adminGroup = manifestGroups.find(
      (group) => group.sidebarCategoryId === 'administrative_boundaries',
    );
    if (!adminGroup) {
      return;
    }

    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== 'group-admin-boundaries') {
          return group;
        }

        const existingRowsByBoundaryKey = new Map(
          group.rows
            .map((row) =>
              row.mapSync?.type === 'admin-boundary'
                ? ([row.mapSync.boundaryLayerKey, row] as const)
                : null,
            )
            .filter(
              (entry): entry is readonly [AdminBoundaryLayerKey, LayerControlRow] => entry !== null,
            ),
        );

        const rows = adminGroup.rows
          .map((manifestRow) => {
            const boundarySync = MANIFEST_ADMIN_BOUNDARY_LAYER_TO_SYNC[manifestRow.id];
            if (!boundarySync) {
              return null;
            }
            const existingRow = existingRowsByBoundaryKey.get(boundarySync.boundaryLayerKey);
            if (!existingRow) {
              return null;
            }
            return {
              ...existingRow,
              name: manifestRow.name,
              color: this.colorFromRendering(manifestRow.rendering) ?? existingRow.color,
            };
          })
          .filter((row): row is LayerControlRow => row !== null);

        const manifestBoundaryKeys = new Set(
          rows
            .map((row) =>
              row.mapSync?.type === 'admin-boundary' ? row.mapSync.boundaryLayerKey : null,
            )
            .filter((key): key is AdminBoundaryLayerKey => key !== null),
        );
        const preservedRows = group.rows.filter(
          (row) =>
            row.mapSync?.type === 'admin-boundary' &&
            row.mapSync.boundaryLayerKey === 'admin_country_outline' &&
            !manifestBoundaryKeys.has(row.mapSync.boundaryLayerKey),
        );
        const reconciledRows = [...preservedRows, ...rows];

        if (reconciledRows.length === 0) {
          return group;
        }

        return {
          ...group,
          title: adminGroup.title,
          countLabel: this.toLayerCountLabel(reconciledRows.length),
          rows: reconciledRows,
        };
      }),
    );
  }

  /**
   * Management figures (RUNAP, OMECs) live in the dedicated overlays card but render
   * via the same `manifest-raster` plumbing as ecosystems/socioeconomic rows.
   *
   * If the manifest exposes a renderable display asset, we wire up `mapSync` and clear
   * `mapUnavailable`. Otherwise we keep the row but flag it unavailable so the UI can
   * disable visibility/opacity controls (graceful fallback).
   */
  private applyManifestToManagementOverlay(
    existingOverlay: LayerControlRow,
    manifestRow: ManifestSidebarLayerRow,
  ): LayerControlRow {
    const isRenderable =
      this.isManifestRenderingSupported(manifestRow.rendering) &&
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

    const rendering = this.normalizeManagementFigureRendering(
      manifestRow.id,
      manifestRow.rendering,
    );

    // Sync swatch color with the manifest's selectedColor so the sidebar swatch
    // matches the raster fill (see ManifestRasterLayerService.rasterToCanvas).
    const manifestSelectedColor = this.colorFromRendering(rendering);
    const nextColor =
      typeof manifestSelectedColor === 'string' && manifestSelectedColor.length > 0
        ? manifestSelectedColor
        : existingOverlay.color;

    // OMECs render as smooth vector polygons (see MapView), so strip the
    // misleading "(raster)" suffix that the published manifest still carries.
    const displayName =
      existingOverlay.id === 'overlay-omecs'
        ? manifestRow.name.replace(/\s*\(raster\)\s*/i, '').trim() || 'OMECs'
        : manifestRow.name;

    return {
      ...existingOverlay,
      name: displayName,
      color: nextColor,
      mapUnavailable: false,
      mapSync: {
        type: 'manifest-raster',
        layerId: existingOverlay.id,
        displayUrl: manifestRow.displayUrl,
        rendering,
      },
    };
  }

  /**
   * Management figure rasters (RUNAP, OMECs) are mode-code grids rather than strict
   * binary 0/1 masks, so `selectedValue: 1` drops valid coverage. We intentionally
   * treat these as presence masks (any non-zero value) so they render as a single
   * category/color in the map and legend.
   */
  private normalizeManagementFigureRendering(
    manifestLayerId: string,
    rendering: RuntimeLayerManifestRenderingConfig,
  ): RuntimeLayerManifestRenderingConfig {
    if (rendering.renderMode !== 'mask') {
      return rendering;
    }

    return {
      ...rendering,
      selectedValue: null,
    };
  }

  private manifestSidebarLayerRow(
    sidebarGroupId: LayerGroup['id'],
    manifestRow: ManifestSidebarLayerRow,
    index: number,
    existingRows: LayerControlRow[],
  ): LayerControlRow {
    if (sidebarGroupId === 'group-species-biodiversity' && manifestRow.isSpeciesCollection) {
      const layerId = `layer-${manifestRow.id}`;
      const existingRow = existingRows.find((row) => row.id === layerId);
      return {
        id: layerId,
        name: this.localizedText('mapLayersPanel.individualSpecies'),
        selected: false,
        visible: false,
        expanded: existingRow?.expanded ?? false,
        opacity: 60,
        color: '#854d0e',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        hideAddButton: true,
      };
    }

    const layerId = `layer-${manifestRow.id}`;
    const existingRow = existingRows.find((row) => row.id === layerId);
    const isLiveRenderable = this.isManifestRowLiveRenderable(manifestRow);
    const rendering = this.normalizeManifestRendering(manifestRow);
    const existingSelected = existingRow?.selected ?? false;
    const manifestColor = this.colorFromRendering(rendering);

    return {
      id: layerId,
      name: this.manifestSidebarLayerName(manifestRow),
      selected: existingSelected,
      visible: existingSelected && !isLiveRenderable ? false : (existingRow?.visible ?? false),
      expanded: existingRow?.expanded ?? false,
      opacity: existingRow?.opacity ?? this.manifestRowOpacity(manifestRow.dataRole),
      color: manifestColor ?? existingRow?.color ?? this.manifestRowColor(sidebarGroupId, index),
      canReorder: true,
      hasStyleControls: true,
      hasColorControl: rendering.renderMode !== 'categorical',
      mapUnavailable: !isLiveRenderable,
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

  private manifestSidebarLayerName(manifestRow: ManifestSidebarLayerRow): string {
    if (manifestRow.id === IAVH_ECOSYSTEM_LAYER_ID) {
      return this.ecosystemsCopy().iavhRowName;
    }
    if (STRATEGIC_ECOSYSTEM_LAYER_IDS.has(manifestRow.id)) {
      return `${this.ecosystemsCopy().strategicPrefix}: ${this.localizedManifestLayerName(
        manifestRow,
      )}`;
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
      return this.iavhEcosystemGroupedRendering();
    }

    if (manifestRow.id === 'human_footprint_2022') {
      return this.humanFootprintGradientRendering(manifestRow.rendering);
    }

    if (manifestRow.id !== 'species_richness') {
      return manifestRow.rendering;
    }

    if (
      manifestRow.rendering.valueType === 'continuous' &&
      manifestRow.rendering.renderMode === 'gradient'
    ) {
      return {
        ...manifestRow.rendering,
        minValue: SPECIES_RICHNESS_RENDER_RANGE.minValue,
        maxValue: SPECIES_RICHNESS_RENDER_RANGE.maxValue,
      };
    }

    // Species richness data is continuous; mask rendering makes most cells transparent.
    return {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: manifestRow.rendering.noDataValue ?? 255,
      minValue: SPECIES_RICHNESS_RENDER_RANGE.minValue,
      maxValue: SPECIES_RICHNESS_RENDER_RANGE.maxValue,
      startColor: '#fef3c7',
      endColor: '#854d0e',
    };
  }

  private humanFootprintGradientRendering(
    rendering: RuntimeLayerManifestRenderingConfig,
  ): RuntimeLayerManifestRenderingConfig {
    if (rendering.valueType === 'continuous' && rendering.renderMode === 'gradient') {
      return {
        ...rendering,
        minValue: HUMAN_FOOTPRINT_RENDER_RANGE.minValue,
        maxValue: HUMAN_FOOTPRINT_RENDER_RANGE.maxValue,
      };
    }

    return {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue: rendering.noDataValue ?? null,
      minValue: HUMAN_FOOTPRINT_RENDER_RANGE.minValue,
      maxValue: HUMAN_FOOTPRINT_RENDER_RANGE.maxValue,
      startColor: '#fee2e2',
      endColor: '#991b1b',
    };
  }

  private iavhEcosystemGroupedRendering(): RuntimeLayerManifestRenderingConfig {
    return {
      valueType: 'categorical',
      renderMode: 'categorical',
      noDataValue: IAVH_ECOSYSTEM_NO_DATA_VALUE,
      classColors: IAVH_ECOSYSTEM_BIOME_GROUPS.flatMap((group) =>
        group.values.map((value) => ({
          value,
          color: group.color,
          label: group.label[this.activeLanguage()],
        })),
      ),
    };
  }

  private manifestRowOpacity(dataRole: RuntimeLayerManifestDataRole): number {
    if (dataRole === 'cost_layer') {
      return 55;
    }

    if (dataRole === 'include_layer') {
      return 60;
    }

    return 55;
  }

  private manifestRowColor(sidebarGroupId: LayerGroup['id'], index: number): string {
    const palette = MANIFEST_GROUP_COLOR_PALETTES[sidebarGroupId];
    if (!palette || palette.length === 0) {
      return '#475569';
    }
    return palette[index % palette.length];
  }

  private colorFromRendering(rendering: RuntimeLayerManifestRenderingConfig): string | null {
    if (rendering.renderMode === 'mask') {
      return rendering.selectedColor ?? null;
    }
    if (rendering.renderMode === 'gradient') {
      return rendering.endColor ?? rendering.startColor ?? null;
    }
    return rendering.classColors?.[0]?.color ?? null;
  }

  private applyRowColorToRendering(
    rendering: RuntimeLayerManifestRenderingConfig,
    color: string,
  ): RuntimeLayerManifestRenderingConfig {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return rendering;
    }
    if (rendering.renderMode === 'mask') {
      return { ...rendering, selectedColor: color };
    }
    if (rendering.renderMode === 'gradient') {
      return { ...rendering, endColor: color };
    }
    return rendering;
  }

  private isManifestRowLiveRenderable(manifestRow: ManifestSidebarLayerRow): boolean {
    if (manifestRow.isSpeciesCollection) {
      return false;
    }
    if (!MANIFEST_LIVE_RENDER_POLICY.enabledCategoryIds.has(manifestRow.sidebarCategoryId)) {
      return false;
    }
    if (!this.isManifestRenderingSupported(manifestRow.rendering)) {
      return false;
    }
    return typeof manifestRow.displayUrl === 'string' && manifestRow.displayUrl.length > 0;
  }

  private isManifestRenderingSupported(
    rendering: RuntimeLayerManifestRenderingConfig | null | undefined,
  ): boolean {
    if (!rendering) {
      return false;
    }
    if (rendering.renderMode === 'categorical') {
      return Array.isArray(rendering.classColors) && rendering.classColors.length > 0;
    }
    return rendering.renderMode === 'mask' || rendering.renderMode === 'gradient';
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
        return { ...row, selected: nextSelected, visible: nextVisible };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.syncOverlayById(rowId);
  }

  protected toggleOverlaySelected(rowId: string): void {
    let nextSelected = false;
    this.overlays.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        nextSelected = !row.selected;
        // Manifest-raster overlays (e.g. management figures) auto-show on add to
        // mirror the behavior used by manifest-driven group rows in toggleLayerSelected.
        const shouldAutoShowWhenAdded = row.mapSync?.type === 'manifest-raster';
        return {
          ...row,
          selected: nextSelected,
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
    this.syncOverlayById(rowId);
  }

  protected toggleOverlaysCollapsed(): void {
    this.overlaysCollapsed.update((collapsed) => !collapsed);
  }

  protected toggleOverlayExpanded(rowId: string): void {
    this.overlays.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, expanded: !row.expanded } : row)),
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
                  return { ...row, selected: nextSelected, visible: nextVisible };
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
    this.syncGroupRowById(groupId, rowId);
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
    this.syncGroupRowById(groupId, rowId);
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
        return { ...row, selected: nextSelected, visible: nextVisible };
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
          // If a row cannot be visualized on the map, keep visibility off.
          visible: row.mapUnavailable ? false : nextSelected ? row.visible : false,
        };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
  }

  protected toggleTaxonExpanded(rowId: string): void {
    this.taxa.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, expanded: !row.expanded } : row)),
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
                  return { ...species, selected: nextSelected, visible: nextVisible };
                })()
              : species,
          ),
        };
      }),
    );
    this.updateSelectedLayerOrder(speciesId, nextSelected);
    this.syncSpeciesById(taxonId, speciesId);
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
    this.syncSpeciesById(taxonId, speciesId);
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
    if (!this.hasLayerSearchQuery()) {
      return group.rows;
    }
    const query = this.normalizedLayerSearchQuery();
    if (group.id !== 'group-species-biodiversity') {
      return group.rows.filter((row) => this.nameMatchesSearch(row.name, query));
    }
    return group.rows.filter(
      (row) => this.isSpeciesCollectionRow(row) || this.nameMatchesSearch(row.name, query),
    );
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
      return group.countLabel;
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
    for (const overlay of this.overlays()) {
      this.syncRowToMap(overlay);
    }
    for (const group of this.groups()) {
      for (const row of group.rows) {
        this.syncRowToMap(row);
      }
    }
    for (const taxon of this.taxa()) {
      for (const species of taxon.species) {
        this.syncRowToMap(species);
      }
    }
  }

  private syncOverlayById(rowId: string): void {
    const row = this.overlays().find((overlay) => overlay.id === rowId);
    if (row) {
      this.syncRowToMap(row);
    }
  }

  private syncGroupRowById(groupId: string, rowId: string): void {
    const group = this.groups().find((item) => item.id === groupId);
    const row = group?.rows.find((item) => item.id === rowId);
    if (row) {
      this.syncRowToMap(row);
    }
  }

  private syncSpeciesById(taxonId: string, speciesId: string): void {
    const taxon = this.taxa().find((item) => item.id === taxonId);
    const species = taxon?.species.find((item) => item.id === speciesId);
    if (species) {
      this.syncRowToMap(species);
    }
  }

  private scheduleOpacitySync(rowKey: string): void {
    const previousFrame = this.opacitySyncFrames.get(rowKey);
    if (previousFrame) {
      cancelAnimationFrame(previousFrame);
    }

    const frameId = requestAnimationFrame(() => {
      if (rowKey.includes(':')) {
        const [scopeId, rowId] = rowKey.split(':');
        if (scopeId.startsWith('taxon-')) {
          this.syncSpeciesById(scopeId, rowId);
        } else {
          this.syncGroupRowById(scopeId, rowId);
        }
      } else {
        this.syncOverlayById(rowKey);
      }
      this.opacitySyncFrames.delete(rowKey);
    });

    this.opacitySyncFrames.set(rowKey, frameId);
  }

  private scheduleColorSync(rowKey: string): void {
    const previous = this.colorSyncFrames.get(rowKey);
    if (previous) {
      cancelAnimationFrame(previous);
    }

    const frameId = requestAnimationFrame(() => {
      if (rowKey.includes(':')) {
        const [scopeId, rowId] = rowKey.split(':');
        if (scopeId.startsWith('taxon-')) {
          this.syncSpeciesById(scopeId, rowId);
        } else {
          this.syncGroupRowById(scopeId, rowId);
        }
      } else {
        this.syncOverlayById(rowKey);
      }
      this.colorSyncFrames.delete(rowKey);
    });

    this.colorSyncFrames.set(rowKey, frameId);
  }

  private syncSelectedLayerStackingToMap(
    order: string[],
    overlays: LayerControlRow[],
    groups: LayerGroup[],
    taxa: TaxonRow[],
  ): void {
    const effectiveOrder = this.shouldPrioritizeComparisonLayers()
      ? this.normalizeSelectedLayerOrder(order)
      : order;

    // Build a unified mapSync lookup covering all row sources.
    const mapSyncById = new Map<string, LayerControlRow['mapSync']>();
    for (const overlay of overlays) {
      if (overlay.selected && overlay.mapSync) {
        mapSyncById.set(overlay.id, overlay.mapSync);
      }
    }
    for (const group of groups) {
      for (const row of group.rows) {
        if (row.selected && row.mapSync) {
          mapSyncById.set(row.id, row.mapSync);
        }
      }
    }
    for (const taxon of taxa) {
      if (taxon.selected && taxon.mapSync) {
        mapSyncById.set(taxon.id, taxon.mapSync);
      }
      for (const species of taxon.species) {
        if (species.selected && species.mapSync) {
          mapSyncById.set(species.id, species.mapSync);
        }
      }
    }

    // Resolve each ordered row to the ArcGIS layer ID(s) it controls.
    const idsTopToBottom: string[] = [];
    for (const rowId of effectiveOrder) {
      const mapSync = mapSyncById.get(rowId);
      if (!mapSync) {
        continue;
      }
      if (mapSync.type === 'manifest-raster' || mapSync.type === 'app-state-layer') {
        idsTopToBottom.push(this.resolveArcGisLayerId(mapSync.layerId));
      } else if (
        mapSync.type === 'solution-baseline' ||
        mapSync.type === 'solution-candidate' ||
        mapSync.type === 'solution-overlap'
      ) {
        const layer = this.solutionLayerService.resolveLayerForSidebarType(mapSync.type);
        if (layer) {
          idsTopToBottom.push(layer.id);
        }
      } else if (mapSync.type === 'admin-boundary') {
        idsTopToBottom.push(
          ...this.adminBoundaryService.getLayerIdsByBoundaryKey(mapSync.boundaryLayerKey),
        );
      }
    }

    if (idsTopToBottom.length === 0) {
      return;
    }
    this.solutionLayerService.reorderLayersByIds(idsTopToBottom);
  }

  private resolveArcGisLayerId(layerId: string): string {
    return VECTOR_OVERLAY_ARCGIS_LAYER_ID_BY_OVERLAY_ID[layerId] ?? layerId;
  }

  private syncRowToMap(row: LayerControlRow): void {
    const mapSync = row.mapSync;
    if (!mapSync) {
      return;
    }

    if (mapSync.type === 'solution-baseline') {
      this.solutionLayerService.setBaselineVisibility(row.visible);
      this.solutionLayerService.setBaselineOpacity(row.opacity / 100);
      this.solutionLayerService.setBaselineColor(row.color);
      return;
    }

    if (mapSync.type === 'solution-candidate') {
      this.solutionLayerService.setCandidateVisibility(row.visible);
      this.solutionLayerService.setCandidateOpacity(row.opacity / 100);
      this.solutionLayerService.setCandidateColor(row.color);
      return;
    }

    if (mapSync.type === 'solution-overlap') {
      this.solutionLayerService.setOverlapVisibility(row.visible);
      this.solutionLayerService.setOverlapOpacity(row.opacity / 100);
      this.solutionLayerService.setOverlapColor(row.color);
      return;
    }

    if (mapSync.type === 'admin-boundary') {
      this.adminBoundaryService.setLayerStyle(mapSync.boundaryLayerKey, { color: row.color });
      this.adminBoundaryService.setLayerVisibility(mapSync.boundaryLayerKey, row.visible);
      return;
    }

    if (mapSync.type === 'manifest-raster') {
      this.manifestRasterLayerService.syncLayer(
        mapSync.layerId,
        {
          displayUrl: mapSync.displayUrl,
          visible: row.visible,
          opacity: row.opacity / 100,
          color: row.color,
          rendering: this.applyRowColorToRendering(mapSync.rendering, row.color),
        },
        { selected: row.selected },
      );
      return;
    }

    if (mapSync.type !== 'app-state-layer') {
      return;
    }

    const visibleLayers = this.appState.visibleLayers$();
    const index = visibleLayers.findIndex((layer) => layer.id === mapSync.layerId);
    if (index < 0) {
      return;
    }

    const nextLayer = {
      ...visibleLayers[index],
      visible: row.visible,
      opacity: row.opacity / 100,
    };
    const nextVisibleLayers = [...visibleLayers];
    nextVisibleLayers.splice(index, 1, nextLayer);
    this.appState.visibleLayers$.set(nextVisibleLayers);
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
    const index = rows.findIndex((id) => id === rowId);
    if (index < 0) {
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

  private reorderRowsByDropTarget(
    rows: string[],
    draggedRowId: string,
    targetRowId: string,
    dropPosition: SelectedLayerDropPosition,
  ): string[] {
    const fromIndex = rows.findIndex((id) => id === draggedRowId);
    const targetIndex = rows.findIndex((id) => id === targetRowId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
      return rows;
    }

    const nextRows = [...rows];
    const [movedRowId] = nextRows.splice(fromIndex, 1);
    const nextTargetIndex = nextRows.findIndex((id) => id === targetRowId);
    if (nextTargetIndex < 0) {
      return rows;
    }
    const insertionIndex = dropPosition === 'before' ? nextTargetIndex : nextTargetIndex + 1;
    nextRows.splice(insertionIndex, 0, movedRowId);
    return nextRows;
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
    if (!this.shouldPrioritizeComparisonLayers()) {
      return order;
    }

    const priorityRowIds: string[] = COMPARISON_PRIORITY_OVERLAY_IDS.filter((id) =>
      order.includes(id),
    );
    if (priorityRowIds.length === 0) {
      return order;
    }

    const priorityRowIdSet = new Set(priorityRowIds);
    const nonPriorityRows = order.filter((id) => !priorityRowIdSet.has(id));
    return [...priorityRowIds, ...nonPriorityRows];
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
    const selectedOverlayIds = overlays.filter((row) => row.selected).map((row) => row.id);
    const selectedGroupRowIds = groups
      .flatMap((group) => group.rows)
      .filter((row) => row.selected)
      .map((row) => row.id);
    const selectedTaxonIds = taxa.filter((taxon) => taxon.selected).map((taxon) => taxon.id);
    const selectedSpeciesIds = taxa
      .flatMap((taxon) => taxon.species)
      .filter((species) => species.selected)
      .map((species) => species.id);
    return [
      ...selectedOverlayIds,
      ...selectedGroupRowIds,
      ...selectedTaxonIds,
      ...selectedSpeciesIds,
    ];
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
            ? this.localizedText('mapLayersPanel.sourceLabels.selectedScenario')
            : overlay.id === CANDIDATE_SOLUTION_OVERLAY_ID
              ? this.localizedText('mapLayersPanel.sourceLabels.comparisonScenario')
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
      if (!row.selected || this.isSolutionLayerRow(row)) {
        continue;
      }
      entryLookup.set(row.id, this.toMasterLegendLayerEntry(row));
    }

    for (const group of groups) {
      for (const row of group.rows) {
        if (!row.selected || this.isSolutionLayerRow(row)) {
          continue;
        }
        entryLookup.set(row.id, this.toMasterLegendLayerEntry(row));
      }
    }

    for (const taxon of taxa) {
      if (taxon.selected) {
        entryLookup.set(taxon.id, this.toMasterLegendLayerEntry(taxon));
      }
      for (const species of taxon.species) {
        if (!species.selected) {
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
    if (row.mapSync?.type === 'admin-boundary') {
      const style = LEGEND_BOUNDARY_STYLES[row.mapSync.boundaryLayerKey];
      return {
        id: row.id,
        name: row.name,
        swatchType: 'line',
        color: row.color || style.color,
        lineStyle: style.lineStyle,
        lineWidth: style.lineWidth,
      };
    }

    if (this.isContinuousGradientRaster(row)) {
      const gradientRendering = row.mapSync.rendering;
      return {
        id: row.id,
        name: row.name,
        swatchType: 'gradient',
        color: row.color,
        lineStyle: 'solid',
        lineWidth: 1,
        gradientStartColor: gradientRendering?.startColor ?? '#dbeafe',
        gradientEndColor: gradientRendering?.endColor ?? row.color ?? '#7f1d1d',
        gradientMinLabel: this.formatLegendValue(gradientRendering?.minValue),
        gradientMaxLabel: this.formatLegendValue(gradientRendering?.maxValue),
      };
    }

    if (
      row.mapSync?.type === 'manifest-raster' &&
      row.mapSync.rendering.renderMode === 'categorical' &&
      Array.isArray(row.mapSync.rendering.classColors) &&
      row.mapSync.rendering.classColors.length > 0
    ) {
      const categories = this.groupLegendCategories(row);
      return {
        id: row.id,
        name: row.name,
        swatchType: 'fill',
        color: categories[0]?.color ?? row.color ?? '#64748b',
        lineStyle: 'solid',
        lineWidth: 1,
        categories,
      };
    }

    return {
      id: row.id,
      name: row.name,
      swatchType: 'fill',
      color: row.color || '#64748b',
      lineStyle: 'solid',
      lineWidth: 1,
    };
  }

  private groupLegendCategories(
    row: LayerControlRow,
  ): NonNullable<MapLegendLayerEntry['categories']> {
    if (row.mapSync?.type !== 'manifest-raster') {
      return [];
    }

    const categoryByLabel = new Map<string, { id: string; label: string; color: string }>();
    for (const entry of row.mapSync.rendering.classColors ?? []) {
      const label = entry.label?.trim() || `Category ${entry.value}`;
      if (categoryByLabel.has(label)) {
        continue;
      }
      categoryByLabel.set(label, {
        id: `${row.id}-class-${this.toSlug(label)}`,
        label,
        color: entry.color,
      });
    }
    return [...categoryByLabel.values()];
  }

  private isHumanFootprintLayerRow(row: LayerControlRow): boolean {
    const normalizedName = row.name.trim().toLowerCase();
    return normalizedName === 'human footprint';
  }

  private isContinuousGradientRaster(row: LayerControlRow): row is LayerControlRow & {
    mapSync: {
      type: 'manifest-raster';
      layerId: string;
      displayUrl: string;
      rendering: RuntimeLayerManifestRenderingConfig;
    };
  } {
    return (
      row.mapSync?.type === 'manifest-raster' &&
      row.mapSync.rendering.renderMode === 'gradient' &&
      row.mapSync.rendering.valueType === 'continuous'
    );
  }

  private formatLegendValue(value: number | null | undefined): string | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    return Number.isInteger(value) ? `${value}` : value.toFixed(2);
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
        name: this.localizedText('mapLayersPanel.overlayNames.conservationSolution'),
        selected: true,
        visible: true,
        expanded: true,
        opacity: 70,
        color: SINGLE_SOLUTION_COLOR,
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapSync: { type: 'solution-baseline' },
      },
      {
        id: 'overlay-runap',
        name: this.localizedText('mapLayersPanel.overlayNames.protectedAreasRunap'),
        selected: false,
        visible: false,
        expanded: false,
        opacity: 80,
        color: '#2563eb',
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapUnavailable: true,
      },
      {
        id: 'overlay-omecs',
        name: this.localizedText('mapLayersPanel.overlayNames.omecs'),
        selected: false,
        visible: false,
        expanded: false,
        opacity: 75,
        color: '#7c3aed',
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
          opacity: 70,
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
          name: this.localizedText('mapLayersPanel.overlayNames.agreementOverlap'),
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
        opacity: 60,
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
        opacity: 60,
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
        opacity: 60,
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
        opacity: 60,
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
        opacity: 60,
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
    ];
  }

  private reconcileTaxaWithSpeciesManifest(manifestLayers: RuntimeSpeciesManifestLayer[]): void {
    const existingTaxaById = new Map(this.taxa().map((taxon) => [taxon.id, taxon]));
    const manifestLayersByTaxonId = this.groupSpeciesManifestLayersByTaxon(manifestLayers);
    const taxa = Array.from(manifestLayersByTaxonId.entries())
      .map(([taxonId, layers]) =>
        this.speciesManifestTaxonRow(taxonId, layers, existingTaxaById.get(taxonId)),
      )
      .sort((left, right) => this.compareSpeciesTaxa(left, right));
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
      opacity: existingTaxon?.opacity ?? 60,
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
      !!rendering && this.isManifestRenderingSupported(rendering) && displayUrl.length > 0;
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
      opacity: existingSpecies?.opacity ?? 65,
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
   * Category cards below Management Figures — all start collapsed (UCS-101).
   * Management Figures itself uses `overlaysCollapsed` (default expanded).
   */
  private createDefaultGroups(): LayerGroup[] {
    const sirapRows = [
      ...(FEATURE_FLAGS.sirapLayers.combined
        ? [
            this.boundaryRow(
              'siraps',
              'sirap',
              this.localizedText('mapLayersPanel.boundaryNames.combinedSirapReviewLayer'),
              false,
              false,
            ),
          ]
        : []),
      ...(FEATURE_FLAGS.sirapLayers.territorial
        ? [
            this.boundaryRow(
              'siraps_territorial',
              'sirap',
              this.localizedText('mapLayersPanel.boundaryNames.territorialSiraps'),
              false,
              false,
            ),
          ]
        : []),
      ...(FEATURE_FLAGS.sirapLayers.thematic
        ? [
            this.boundaryRow(
              'siraps_thematic',
              'sirap',
              this.localizedText('mapLayersPanel.boundaryNames.thematicSirapAdditions'),
              false,
              false,
            ),
          ]
        : []),
    ];
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
        collapsed: false,
        rows: adminBoundaryRows,
      },
      {
        id: 'group-species-biodiversity',
        title: this.localizedText('mapLayersPanel.groupTitles.speciesBiodiversity'),
        countLabel: this.toLayerCountLabel(0),
        collapsed: true,
        rows: [],
      },
      {
        id: 'group-ecosystems',
        title: this.ecosystemsCopy().groupTitle,
        countLabel: this.toLayerCountLabel(5),
        collapsed: true,
        note: this.ecosystemsCopy().groupNote,
        rows: [
          this.layerRow('eco-types', this.ecosystemsCopy().iavhRowName, '#0d9488', 60),
          this.layerRow(
            'eco-paramos',
            `${this.ecosystemsCopy().strategicPrefix}: ${
              this.activeLanguage() === 'es' ? 'Páramos' : 'Paramos'
            }`,
            '#6d8e7e',
            55,
          ),
          this.layerRow(
            'eco-wetlands',
            `${this.ecosystemsCopy().strategicPrefix}: ${
              this.activeLanguage() === 'es' ? 'Humedales' : 'Wetlands'
            }`,
            '#0284c7',
            55,
          ),
          this.layerRow(
            'eco-dry-forest',
            `${this.ecosystemsCopy().strategicPrefix}: ${
              this.activeLanguage() === 'es' ? 'Bosque seco' : 'Dry Forest'
            }`,
            '#a16207',
            55,
          ),
          this.layerRow(
            'eco-mangroves',
            `${this.ecosystemsCopy().strategicPrefix}: ${
              this.activeLanguage() === 'es' ? 'Manglares' : 'Mangroves'
            }`,
            '#15803d',
            55,
          ),
        ],
      },
      {
        id: 'group-cultural-ethnic',
        title: this.localizedText('mapLayersPanel.groupTitles.culturalEthnicTerritories'),
        countLabel: this.toLayerCountLabel(2),
        collapsed: true,
        rows: [
          this.layerRow('cult-indigenous', 'Indigenous Reserves', '#6366f1', 60),
          this.layerRow('cult-afro', 'Afro-Colombian Community Territories', '#a855f7', 60),
        ],
      },
      {
        id: 'group-socio-economic',
        title: this.localizedText('mapLayersPanel.groupTitles.costs'),
        countLabel: this.toLayerCountLabel(3),
        collapsed: true,
        rows: [
          this.layerRow('soc-human-footprint', 'Human Footprint', '#d97706', 55),
          this.layerRow('soc-ag-opportunity-cost', 'Agricultural Opportunity Cost', '#ea580c', 55),
          this.layerRow('soc-land-use', 'Land Use', '#78716c', 50),
        ],
      },
    ];
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
      expanded: false,
      opacity: 100,
      color: '#111827',
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
      this.localizedText('mapLayersPanel.groupTitles.managementFigures'),
    );

    this.overlays.update((rows) =>
      rows.map((row) => {
        if (row.id === BASELINE_SOLUTION_OVERLAY_ID && !activeSolutionName) {
          return {
            ...row,
            name: this.localizedText('mapLayersPanel.overlayNames.conservationSolution'),
          };
        }
        if (row.id === 'overlay-runap') {
          return {
            ...row,
            name: this.localizedText('mapLayersPanel.overlayNames.protectedAreasRunap'),
          };
        }
        if (row.id === 'overlay-omecs') {
          return {
            ...row,
            name: this.localizedText('mapLayersPanel.overlayNames.omecs'),
          };
        }
        if (row.id === OVERLAP_SOLUTION_OVERLAY_ID) {
          return {
            ...row,
            name: this.localizedText('mapLayersPanel.overlayNames.agreementOverlap'),
          };
        }
        return row;
      }),
    );

    this.groups.update((groups) =>
      groups.map((group) => {
        const translatedTitle = this.groupTitleForId(group.id);
        const translatedRows =
          group.id === 'group-admin-boundaries'
            ? group.rows.map((row) => ({
                ...row,
                name: this.boundaryNameForId(row.id) ?? row.name,
              }))
            : group.rows;
        const nextCountLabel =
          group.id === 'group-species-biodiversity'
            ? this.toLayerCountLabel(group.rows.length + speciesLayerCount)
            : this.toLayerCountLabel(group.rows.length);

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
      'group-cultural-ethnic': 'mapLayersPanel.groupTitles.culturalEthnicTerritories',
      'group-socio-economic': 'mapLayersPanel.groupTitles.costs',
    };
    const key = titleKeys[groupId];
    return key ? this.localizedText(key) : undefined;
  }

  private boundaryNameForId(rowId: string): string | undefined {
    const boundaryNameKeys: Record<string, string> = {
      'boundary-siraps': 'mapLayersPanel.boundaryNames.combinedSirapReviewLayer',
      'boundary-siraps_territorial': 'mapLayersPanel.boundaryNames.territorialSiraps',
      'boundary-siraps_thematic': 'mapLayersPanel.boundaryNames.thematicSirapAdditions',
      'boundary-admin_country_outline': 'mapLayersPanel.boundaryNames.colombiaOutline',
      'boundary-admin_departments': 'mapLayersPanel.boundaryNames.departments',
      'boundary-admin_municipalities': 'mapLayersPanel.boundaryNames.municipalities',
    };
    const boundaryNameFallbacks: Record<string, string> = {
      'boundary-siraps': 'Combined SIRAP review layer',
      'boundary-siraps_territorial': 'Territorial SIRAPs',
      'boundary-siraps_thematic': 'Thematic SIRAP additions',
      'boundary-admin_country_outline': 'Colombia Outline',
      'boundary-admin_departments': 'Departments',
      'boundary-admin_municipalities': 'Municipalities',
    };
    const key = boundaryNameKeys[rowId];
    return key
      ? this.localizedTextOrFallback(key, boundaryNameFallbacks[rowId] ?? rowId)
      : undefined;
  }

  private taxonNameForId(taxonId: string): string | undefined {
    const taxonNameKeys: Record<string, string> = {
      'taxon-mammals': 'mapLayersPanel.taxaNames.mammals',
      'taxon-birds': 'mapLayersPanel.taxaNames.birds',
      'taxon-amphibians': 'mapLayersPanel.taxaNames.amphibians',
      'taxon-reptiles': 'mapLayersPanel.taxaNames.reptiles',
      'taxon-plants': 'mapLayersPanel.taxaNames.plants',
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
      opacity: 65,
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
    return name.toLowerCase().includes(normalizedQuery);
  }

  private speciesMatchesSearch(species: SpeciesRow, normalizedQuery: string): boolean {
    const combinedName = `${species.common} ${species.latin}`.toLowerCase();
    return combinedName.includes(normalizedQuery);
  }

  private taxonMatchesSearch(taxon: TaxonRow, normalizedQuery: string): boolean {
    return (
      this.nameMatchesSearch(taxon.name, normalizedQuery) ||
      taxon.species.some((species) => this.speciesMatchesSearch(species, normalizedQuery))
    );
  }
}
