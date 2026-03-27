import {
  Component,
  computed,
  effect,
  EventEmitter,
  inject,
  Input,
  Output,
  signal,
} from '@angular/core';
import { AppStateService } from '@core/services/app-state.service';
import { type AoiType, type Solution } from '@core/models';
import { MockDataService } from '@core/services/mock-data.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';

@Component({
  selector: 'app-dev-tools-panel',
  standalone: true,
  template: `
    <section id="dev-tools-root" class="relative pointer-events-auto z-20">
      <div id="dev-tools-toggle-row" class="flex items-center justify-end gap-2">
        <div id="dev-tools-toggle" class="flex justify-end">
          <button
            id="dev-tools-toggle-btn"
            type="button"
            class="rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-xs font-mono font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
            (click)="isOpen.set(!isOpen())"
          >
            {{ isOpen() ? 'Close DevTools' : 'DevTools' }}
          </button>
        </div>
      </div>

      @if (isOpen()) {
        <div
          id="dev-tools-panel"
          class="pointer-events-auto absolute bottom-full right-0 mb-2 w-96 max-h-[65vh] overflow-auto rounded-xl border border-slate-200 bg-white/98 p-4 shadow-lg font-mono text-xs"
        >
          <h3 id="dev-tools-title" class="text-sm font-bold text-slate-800 mb-3">
            Solution Dev Tools
          </h3>

          <!-- Scenario Picker -->
          <section id="dev-tools-scenario-picker" class="mb-3">
            <label
              id="dev-tools-scenario-label"
              for="dev-tools-scenario-select"
              class="block text-slate-500 mb-1"
              >Load Scenario</label
            >
            <select
              id="dev-tools-scenario-select"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              [value]="selectedScenarioId()"
              (change)="onScenarioChange($event)"
            >
              <option value="">-- select --</option>
              @for (s of scenarios; track s.id) {
                <option [value]="s.id">{{ s.id }}</option>
              }
            </select>
            <div id="dev-tools-scenario-actions" class="mt-1.5 flex gap-1.5">
              <button
                id="dev-tools-load-btn"
                type="button"
                class="rounded border border-emerald-400 bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                [disabled]="!selectedScenarioId() || solutionLayer.isLoading$()"
                (click)="loadScenario()"
              >
                {{ solutionLayer.isLoading$() ? 'Loading...' : 'Load on Map' }}
              </button>
              <button
                id="dev-tools-clear-btn"
                type="button"
                class="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-600 hover:bg-red-100"
                (click)="clearSolution()"
              >
                Clear
              </button>
            </div>

            <section
              id="dev-tools-candidate-scenario-picker"
              class="mt-3 border-t border-slate-200 pt-3"
            >
              <label
                id="dev-tools-candidate-scenario-label"
                for="dev-tools-candidate-scenario-select"
                class="block text-slate-500 mb-1"
                >Load Candidate Scenario</label
              >
              <select
                id="dev-tools-candidate-scenario-select"
                class="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                [value]="selectedCandidateScenarioId()"
                (change)="onCandidateScenarioChange($event)"
              >
                <option value="">-- select --</option>
                @for (s of scenarios; track s.id) {
                  <option [value]="s.id">{{ s.id }}</option>
                }
              </select>
              <div id="dev-tools-candidate-scenario-actions" class="mt-1.5 flex gap-1.5">
                <button
                  id="dev-tools-load-candidate-btn"
                  type="button"
                  class="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                  [disabled]="!selectedCandidateScenarioId() || solutionLayer.isLoading$()"
                  (click)="loadCandidateScenario()"
                >
                  Load in Comparison
                </button>
              </div>
            </section>

            <div
              id="dev-tools-coordinate-picker-toggle-row"
              class="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2"
            >
              <p id="dev-tools-coordinate-picker-toggle-label" class="text-[11px] text-slate-600">
                Coordinate picker
              </p>
              <button
                id="dev-tools-coordinate-toggle-btn"
                type="button"
                class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                (click)="toggleCoordinateTool()"
              >
                {{ coordinateToolEnabled ? 'Hide long/lat' : 'Show long/lat' }}
              </button>
            </div>

            <div
              id="dev-tools-select-solution-hover-row"
              class="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2"
            >
              <div id="dev-tools-select-solution-hover-copy" class="min-w-0 pr-2">
                <p
                  id="dev-tools-select-solution-hover-label"
                  class="text-[11px] font-semibold text-slate-700"
                >
                  Select solution hover
                </p>
                <p
                  id="dev-tools-select-solution-hover-hint"
                  class="text-[10px] leading-4 text-slate-500"
                >
                  Cycles: slate wash → mint spotlight → rainforest photo reveal (localStorage).
                </p>
              </div>
              <button
                id="dev-tools-select-solution-hover-toggle-btn"
                type="button"
                class="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                (click)="toggleSelectSolutionButtonHoverFx()"
              >
                {{ selectSolutionHoverFxButtonLabel() }}
              </button>
            </div>

            <div
              id="dev-tools-overview-dummy-toggle-row"
              class="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2"
            >
              <p id="dev-tools-overview-dummy-toggle-label" class="text-[11px] text-slate-600">
                Fill missing overview metrics
              </p>
              <button
                id="dev-tools-overview-dummy-toggle-btn"
                type="button"
                class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                (click)="toggleOverviewMetricFill()"
              >
                {{ fillDummyOverviewMetrics() ? 'ON' : 'OFF' }}
              </button>
            </div>
            <div
              id="dev-tools-comparison-dummy-toggle-row"
              class="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2"
            >
              <p id="dev-tools-comparison-dummy-toggle-label" class="text-[11px] text-slate-600">
                Fill missing solution comparison metrics
              </p>
              <button
                id="dev-tools-comparison-dummy-toggle-btn"
                type="button"
                class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                (click)="toggleComparisonMetricFill()"
              >
                {{ fillDummyComparisonMetrics() ? 'ON' : 'OFF' }}
              </button>
            </div>
            <div
              id="dev-tools-aoi-dummy-toggle-row"
              class="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2"
            >
              <p id="dev-tools-aoi-dummy-toggle-label" class="text-[11px] text-slate-600">
                Fill missing AOI dashboard metrics
              </p>
              <button
                id="dev-tools-aoi-dummy-toggle-btn"
                type="button"
                class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                (click)="toggleAoiMetricFill()"
              >
                {{ fillDummyAoiMetrics() ? 'ON' : 'OFF' }}
              </button>
            </div>
            <div
              id="dev-tools-popup-toggle-row"
              class="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2"
            >
              <p id="dev-tools-popup-toggle-label" class="text-[11px] text-slate-600">
                Boundary tooltips
              </p>
              <button
                id="dev-tools-popup-toggle-btn"
                type="button"
                class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
                (click)="toggleBoundaryPopups()"
              >
                {{ boundaryPopupsEnabled() ? 'Disable tooltips' : 'Enable tooltips' }}
              </button>
            </div>

            <section
              id="dev-tools-admin-boundaries-toggle-section"
              class="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2"
            >
              <h4
                id="dev-tools-admin-boundaries-toggle-title"
                class="text-[11px] font-semibold uppercase tracking-wide text-slate-600"
              >
                AOI Boundary Toggles
              </h4>

              <div id="dev-tools-admin-boundaries-toggle-list" class="mt-2 space-y-1.5">
                <button
                  id="dev-tools-toggle-sirap-btn"
                  type="button"
                  class="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition"
                  [class.border-emerald-300]="isBoundaryVisible('sirap')"
                  [class.bg-emerald-50]="isBoundaryVisible('sirap')"
                  [class.text-emerald-700]="isBoundaryVisible('sirap')"
                  [class.border-slate-300]="!isBoundaryVisible('sirap')"
                  [class.bg-white]="!isBoundaryVisible('sirap')"
                  [class.text-slate-700]="!isBoundaryVisible('sirap')"
                  (click)="toggleBoundary('sirap')"
                >
                  <span id="dev-tools-toggle-sirap-label">SIRAP</span>
                  <span id="dev-tools-toggle-sirap-state">{{
                    isBoundaryVisible('sirap') ? 'On' : 'Off'
                  }}</span>
                </button>

                <button
                  id="dev-tools-toggle-departments-btn"
                  type="button"
                  class="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition"
                  [class.border-emerald-300]="isBoundaryVisible('department')"
                  [class.bg-emerald-50]="isBoundaryVisible('department')"
                  [class.text-emerald-700]="isBoundaryVisible('department')"
                  [class.border-slate-300]="!isBoundaryVisible('department')"
                  [class.bg-white]="!isBoundaryVisible('department')"
                  [class.text-slate-700]="!isBoundaryVisible('department')"
                  (click)="toggleBoundary('department')"
                >
                  <span id="dev-tools-toggle-departments-label">ADM1 (Departments)</span>
                  <span id="dev-tools-toggle-departments-state">{{
                    isBoundaryVisible('department') ? 'On' : 'Off'
                  }}</span>
                </button>

                <button
                  id="dev-tools-toggle-municipalities-btn"
                  type="button"
                  class="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition"
                  [class.border-emerald-300]="isBoundaryVisible('municipality')"
                  [class.bg-emerald-50]="isBoundaryVisible('municipality')"
                  [class.text-emerald-700]="isBoundaryVisible('municipality')"
                  [class.border-slate-300]="!isBoundaryVisible('municipality')"
                  [class.bg-white]="!isBoundaryVisible('municipality')"
                  [class.text-slate-700]="!isBoundaryVisible('municipality')"
                  (click)="toggleBoundary('municipality')"
                >
                  <span id="dev-tools-toggle-municipalities-label">ADM2 (Municipalities)</span>
                  <span id="dev-tools-toggle-municipalities-state">{{
                    isBoundaryVisible('municipality') ? 'On' : 'Off'
                  }}</span>
                </button>
              </div>
            </section>
          </section>

          @if (solutionLayer.loadError$()) {
            <div
              id="dev-tools-error"
              class="mb-3 rounded bg-red-50 border border-red-200 p-2 text-red-700"
            >
              {{ solutionLayer.loadError$() }}
            </div>
          }

          @if (loaded(); as sol) {
            <!-- Scenario Info -->
            <section id="dev-tools-scenario-info" class="mb-3 border-t border-slate-200 pt-3">
              <h4 id="dev-tools-scenario-info-title" class="font-bold text-slate-700 mb-1">
                Scenario
              </h4>
              <dl id="dev-tools-scenario-dl" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt class="text-slate-400">ID</dt>
                <dd class="text-slate-800">{{ sol.scenario.id }}</dd>
                <dt class="text-slate-400">Targets</dt>
                <dd class="text-slate-800">{{ sol.scenario.ecosystemTargets }}%</dd>
                <dt class="text-slate-400">Constraints</dt>
                <dd class="text-slate-800">{{ sol.scenario.constraints.join(', ') }}</dd>
                <dt class="text-slate-400">Cost Layer</dt>
                <dd class="text-slate-800">{{ sol.scenario.costLayer }}</dd>
                <dt class="text-slate-400">Description</dt>
                <dd class="text-slate-800">{{ sol.scenario.description }}</dd>
              </dl>
            </section>

            <!-- Raster Metadata -->
            <section id="dev-tools-raster-meta" class="mb-3 border-t border-slate-200 pt-3">
              <h4 id="dev-tools-raster-meta-title" class="font-bold text-slate-700 mb-1">
                Raster Metadata
              </h4>
              <dl id="dev-tools-raster-dl" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt class="text-slate-400">Dimensions</dt>
                <dd class="text-slate-800">
                  {{ sol.rasterMeta.width }} x {{ sol.rasterMeta.height }}
                </dd>
                <dt class="text-slate-400">CRS</dt>
                <dd class="text-slate-800">{{ sol.rasterMeta.crs }}</dd>
                <dt class="text-slate-400">Bands</dt>
                <dd class="text-slate-800">{{ sol.rasterMeta.bandCount }}</dd>
                <dt class="text-slate-400">Resolution</dt>
                <dd class="text-slate-800">{{ formatRes(sol.rasterMeta.resolution) }}</dd>
                <dt class="text-slate-400">Extent</dt>
                <dd class="text-slate-800">{{ formatBbox(sol.rasterMeta.bbox) }}</dd>
                <dt class="text-slate-400">NoData</dt>
                <dd class="text-slate-800">{{ sol.rasterMeta.noDataValue ?? 'none' }}</dd>
              </dl>
            </section>

            <!-- Statistics -->
            <section id="dev-tools-stats" class="mb-3 border-t border-slate-200 pt-3">
              <h4 id="dev-tools-stats-title" class="font-bold text-slate-700 mb-1">
                Selection Statistics
              </h4>
              <dl id="dev-tools-stats-dl" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt class="text-slate-400">Selected</dt>
                <dd class="text-slate-800">
                  {{ sol.rasterMeta.selectedCount.toLocaleString() }} cells
                </dd>
                <dt class="text-slate-400">Total Valid</dt>
                <dd class="text-slate-800">
                  {{ sol.rasterMeta.totalValidCells.toLocaleString() }} cells
                </dd>
                <dt class="text-slate-400">Selected %</dt>
                <dd class="text-slate-800">{{ sol.rasterMeta.selectedPct.toFixed(1) }}%</dd>
                <dt class="text-slate-400">Cost</dt>
                <dd class="text-slate-800">{{ sol.scenario.totalCost.toLocaleString() }}</dd>
                <dt class="text-slate-400">Load Time</dt>
                <dd class="text-slate-800">{{ sol.loadTimeMs }}ms</dd>
              </dl>
            </section>

            <!-- Mini Canvas Preview -->
            <section id="dev-tools-preview" class="border-t border-slate-200 pt-3">
              <h4 id="dev-tools-preview-title" class="font-bold text-slate-700 mb-1">
                Raster Preview
              </h4>
              <div
                id="dev-tools-preview-canvas-wrapper"
                class="rounded border border-slate-200 bg-slate-900 p-1 inline-block"
              >
                <canvas
                  id="dev-tools-preview-canvas"
                  #previewCanvas
                  class="block"
                  [width]="200"
                  [height]="previewHeight()"
                  style="image-rendering: pixelated;"
                >
                </canvas>
              </div>
            </section>
          }
        </div>
      }
    </section>
  `,
})
export class DevToolsPanelComponent {
  protected readonly solutionLayer = inject(SolutionLayerService);
  private readonly adminBoundaries = inject(AdminBoundaryService);
  private readonly catalog = inject(SolutionCatalogService);
  private readonly appState = inject(AppStateService);
  private readonly mockData = inject(MockDataService);

  readonly scenarios = this.catalog.getAll();
  readonly selectedScenarioId = signal('');
  readonly selectedCandidateScenarioId = signal('');
  readonly isOpen = signal(false);

  readonly loaded = computed(() => this.solutionLayer.loadedSolution$());
  readonly fillDummyOverviewMetrics = this.appState.fillDummyOverviewMetrics$;
  readonly fillDummyComparisonMetrics = this.appState.fillDummyComparisonMetrics$;
  readonly fillDummyAoiMetrics = this.appState.fillDummyAoiMetrics$;
  readonly selectSolutionButtonHoverFx = this.appState.selectSolutionButtonHoverFx$;
  readonly boundaryVisibility = computed(() => this.adminBoundaries.layerVisibilityByType$());
  readonly boundaryPopupsEnabled = computed(() => this.adminBoundaries.popupEnabled$());

  @Input() coordinateToolEnabled = false;
  @Output() readonly coordinateToolEnabledChange = new EventEmitter<boolean>();

  readonly previewHeight = computed(() => {
    const sol = this.loaded();
    if (!sol) return 140;
    return Math.round((sol.rasterMeta.height / sol.rasterMeta.width) * 200);
  });

  constructor() {
    effect(() => {
      const sol = this.loaded();
      if (!sol) return;
      requestAnimationFrame(() => this.drawPreview(sol.canvas));
    });
  }

  onScenarioChange(event: Event): void {
    this.selectedScenarioId.set((event.target as HTMLSelectElement).value);
  }

  onCandidateScenarioChange(event: Event): void {
    this.selectedCandidateScenarioId.set((event.target as HTMLSelectElement).value);
  }

  loadScenario(): void {
    const id = this.selectedScenarioId();
    if (id) void this.solutionLayer.showSolution(id);
  }

  loadCandidateScenario(): void {
    const scenarioId = this.selectedCandidateScenarioId();
    if (!scenarioId) {
      return;
    }

    const scenario = this.catalog.getById(scenarioId);
    if (!scenario) {
      return;
    }

    this.appState.setComparisonSolution(this.buildCandidateComparisonSolution(scenarioId));
    this.appState.setRightSidebarMode('comparison');
  }

  clearSolution(): void {
    this.solutionLayer.removeSolutionLayer();
  }

  toggleCoordinateTool(): void {
    this.coordinateToolEnabledChange.emit(!this.coordinateToolEnabled);
  }

  toggleSelectSolutionButtonHoverFx(): void {
    this.appState.toggleSelectSolutionButtonHoverFx();
  }

  selectSolutionHoverFxButtonLabel(): string {
    switch (this.selectSolutionButtonHoverFx()) {
      case 'cursorFollowGreen':
        return 'Cursor spotlight';
      case 'rainforestReveal':
        return 'Rainforest reveal';
      default:
        return 'Professional';
    }
  }

  toggleOverviewMetricFill(): void {
    this.appState.setFillDummyOverviewMetrics(!this.fillDummyOverviewMetrics());
  }

  toggleComparisonMetricFill(): void {
    this.appState.setFillDummyComparisonMetrics(!this.fillDummyComparisonMetrics());
  }

  toggleAoiMetricFill(): void {
    this.appState.setFillDummyAoiMetrics(!this.fillDummyAoiMetrics());
  }

  toggleBoundary(type: AoiType): void {
    this.adminBoundaries.toggleLayerVisibility(type);
  }

  toggleBoundaryPopups(): void {
    this.adminBoundaries.togglePopupEnabled();
  }

  isBoundaryVisible(type: AoiType): boolean {
    return this.boundaryVisibility()[type];
  }

  formatRes(res: [number, number]): string {
    return `${Math.abs(res[0]).toFixed(5)}° x ${Math.abs(res[1]).toFixed(5)}°`;
  }

  formatBbox(bbox: [number, number, number, number]): string {
    return `[${bbox.map((v) => v.toFixed(2)).join(', ')}]`;
  }

  private buildCandidateComparisonSolution(scenarioId: string): Solution {
    const scenario = this.catalog.getById(scenarioId);
    const mockSolution = this.getMockSolutionForScenario(scenarioId);
    const hash = Array.from(scenarioId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const matchPercentage = 70 + (hash % 29);

    return {
      ...mockSolution,
      name: scenario?.name ?? mockSolution.name,
      description: scenario?.description ?? mockSolution.description,
      geometryUrl: scenario?.filename ?? mockSolution.geometryUrl,
      matchPercentage,
      metadata: {
        ...mockSolution.metadata,
        scenarioId,
      },
    };
  }

  private getMockSolutionForScenario(scenarioId: string): Solution {
    const mockSolutionIds = ['sol-001', 'sol-002', 'sol-003'] as const;
    const hash = Array.from(scenarioId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const fallbackId = mockSolutionIds[hash % mockSolutionIds.length];
    return this.mockData.getSolutionById(fallbackId) ?? this.mockData.getSolutionById('sol-001')!;
  }

  private drawPreview(source: HTMLCanvasElement): void {
    const el = document.getElementById('dev-tools-preview-canvas') as HTMLCanvasElement | null;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(source, 0, 0, el.width, el.height);
  }
}
