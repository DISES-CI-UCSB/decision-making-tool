import { Component, computed, inject, signal } from '@angular/core';
import { type LayerConfig } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';

type LayerLegendSwatchType = 'fill' | 'line' | 'gradient';

interface LayerLegendEntry {
  id: string;
  name: string;
  swatchType: LayerLegendSwatchType;
  color: string;
  lineStyle: 'solid' | 'dashed';
  lineWidth: number;
}

const BOUNDARY_LAYER_ENTRIES: Record<
  string,
  Omit<LayerLegendEntry, 'id' | 'swatchType'> & { swatchType?: LayerLegendSwatchType }
> = {
  sirap: {
    name: 'SIRAP Regions',
    swatchType: 'line',
    lineStyle: 'dashed',
    color: '#111827',
    lineWidth: 2,
  },
  department: {
    name: 'Departments',
    swatchType: 'line',
    lineStyle: 'solid',
    color: '#111827',
    lineWidth: 1,
  },
  municipality: {
    name: 'Municipalities',
    swatchType: 'line',
    lineStyle: 'solid',
    color: '#111827',
    lineWidth: 1,
  },
};

@Component({
  selector: 'app-master-legend',
  standalone: true,
  template: `
    @if (hasLegendContent()) {
      <section
        id="master-legend-panel"
        class="pointer-events-auto max-w-80 rounded-md border border-slate-200 bg-white/95 shadow-sm"
      >
        <button
          id="master-legend-toggle"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left"
          [attr.aria-expanded]="!collapsed()"
          (click)="toggleCollapsed()"
        >
          <h3
            id="master-legend-title"
            class="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Map Legend
          </h3>
          <svg
            id="master-legend-chevron"
            class="h-3 w-3 text-slate-400 transition-transform"
            [class.rotate-180]="collapsed()"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path id="master-legend-chevron-path" d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        </button>

        @if (!collapsed()) {
          <div id="master-legend-content" class="space-y-3 px-3 pb-3">
            @if (loaded(); as sol) {
              <section id="master-legend-solution-section" class="space-y-1.5">
                <p id="master-legend-solution-name" class="text-xs font-semibold text-slate-700">
                  {{ isComparing() ? 'Comparison' : sol.scenario.name }}
                </p>

                @if (!isComparing()) {
                  <ul
                    id="master-legend-solution-items-single"
                    class="space-y-1.5 text-xs text-slate-700"
                  >
                    <li id="master-legend-solution-selected-item" class="flex items-center gap-2">
                      <span
                        id="master-legend-solution-selected-swatch"
                        class="inline-block h-3 w-5 rounded-sm"
                        style="background-color: rgba(22,163,74,0.7);"
                      ></span>
                      Selected ({{ sol.rasterMeta.selectedPct.toFixed(1) }}%)
                    </li>
                    <li
                      id="master-legend-solution-not-selected-item"
                      class="flex items-center gap-2"
                    >
                      <span
                        id="master-legend-solution-not-selected-swatch"
                        class="inline-block h-3 w-5 rounded-sm border border-slate-300"
                        style="background-color: transparent;"
                      ></span>
                      Not selected
                    </li>
                  </ul>
                } @else if (comparisonMode() === 'threeColorOverlay') {
                  <ul
                    id="master-legend-solution-items-three-color"
                    class="space-y-1.5 text-xs text-slate-700"
                  >
                    <li
                      id="master-legend-solution-baseline-item-three-color"
                      class="flex items-center gap-2"
                    >
                      <span
                        id="master-legend-solution-baseline-swatch-three-color"
                        class="inline-block h-3 w-5 rounded-sm"
                        [style.background-color]="baselineColor()"
                        [style.opacity]="baselineOpacity()"
                      ></span>
                      A only: {{ baselineName() }}
                    </li>
                    <li
                      id="master-legend-solution-candidate-item-three-color"
                      class="flex items-center gap-2"
                    >
                      <span
                        id="master-legend-solution-candidate-swatch-three-color"
                        class="inline-block h-3 w-5 rounded-sm"
                        [style.background-color]="candidateColor()"
                        [style.opacity]="candidateOpacity()"
                      ></span>
                      B only: {{ candidateName() }}
                    </li>
                    <li
                      id="master-legend-solution-overlap-item-three-color"
                      class="flex items-center gap-2"
                    >
                      <span
                        id="master-legend-solution-overlap-swatch-three-color"
                        class="inline-block h-3 w-5 rounded-sm"
                        [style.background-color]="overlapColor()"
                        [style.opacity]="overlapOpacity()"
                      ></span>
                      Overlap (A + B)
                    </li>
                  </ul>
                } @else if (comparisonMode() === 'twoColorOpacity') {
                  <ul
                    id="master-legend-solution-items-two-color"
                    class="space-y-1.5 text-xs text-slate-700"
                  >
                    <li
                      id="master-legend-solution-baseline-item-two-color"
                      class="flex items-center gap-2"
                    >
                      <span
                        id="master-legend-solution-baseline-swatch-two-color"
                        class="inline-block h-3 w-5 rounded-sm"
                        [style.background-color]="baselineColor()"
                        [style.opacity]="baselineOpacity()"
                      ></span>
                      Scenario A: {{ baselineName() }} ({{ baselineOpacityPercent() }}%)
                    </li>
                    <li
                      id="master-legend-solution-candidate-item-two-color"
                      class="flex items-center gap-2"
                    >
                      <span
                        id="master-legend-solution-candidate-swatch-two-color"
                        class="inline-block h-3 w-5 rounded-sm"
                        [style.background-color]="candidateColor()"
                        [style.opacity]="candidateOpacity()"
                      ></span>
                      Scenario B: {{ candidateName() }} ({{ candidateOpacityPercent() }}%)
                    </li>
                  </ul>
                } @else {
                  <ul
                    id="master-legend-solution-items-swipe"
                    class="space-y-1.5 text-xs text-slate-700"
                  >
                    <li
                      id="master-legend-solution-baseline-item-swipe"
                      class="flex items-center gap-2"
                    >
                      <span
                        id="master-legend-solution-baseline-swatch-swipe"
                        class="inline-block h-3 w-5 rounded-sm"
                        [style.background-color]="baselineColor()"
                        [style.opacity]="baselineOpacity()"
                      ></span>
                      Left side: {{ baselineName() }}
                    </li>
                    <li
                      id="master-legend-solution-candidate-item-swipe"
                      class="flex items-center gap-2"
                    >
                      <span
                        id="master-legend-solution-candidate-swatch-swipe"
                        class="inline-block h-3 w-5 rounded-sm"
                        [style.background-color]="candidateColor()"
                        [style.opacity]="candidateOpacity()"
                      ></span>
                      Right side: {{ candidateName() }}
                    </li>
                  </ul>
                }
              </section>
            }

            @if (selectedLayerEntries().length > 0) {
              <section id="master-legend-layer-section" class="space-y-1.5">
                <p
                  id="master-legend-layer-section-title"
                  class="text-xs font-semibold text-slate-700"
                >
                  Selected layers
                </p>
                <ul id="master-legend-layer-list" class="space-y-1.5 text-xs text-slate-700">
                  @for (entry of selectedLayerEntries(); track entry.id) {
                    <li
                      [id]="'master-legend-layer-entry-' + entry.id"
                      class="flex items-center gap-2"
                    >
                      @if (entry.swatchType === 'line') {
                        <span
                          [id]="'master-legend-layer-line-swatch-' + entry.id"
                          class="inline-block h-0 w-5"
                          [style.border-top-style]="entry.lineStyle"
                          [style.border-top-color]="entry.color"
                          [style.border-top-width.px]="entry.lineWidth"
                        ></span>
                      } @else if (entry.swatchType === 'gradient') {
                        <span
                          [id]="'master-legend-layer-gradient-swatch-' + entry.id"
                          class="inline-block h-3 w-5 rounded-sm border border-slate-300"
                          style="background-image: linear-gradient(to right, #dbeafe, #f97316, #7f1d1d);"
                        ></span>
                      } @else {
                        <span
                          [id]="'master-legend-layer-fill-swatch-' + entry.id"
                          class="inline-block h-3 w-5 rounded-sm border border-slate-300"
                          [style.background-color]="entry.color"
                        ></span>
                      }
                      <span [id]="'master-legend-layer-name-' + entry.id">{{ entry.name }}</span>
                    </li>
                  }
                </ul>
              </section>
            }
          </div>
        }
      </section>
    }
  `,
})
export class MasterLegendComponent {
  private readonly appState = inject(AppStateService);
  private readonly adminBoundary = inject(AdminBoundaryService);
  private readonly solutionLayer = inject(SolutionLayerService);

  readonly collapsed = signal(false);
  readonly loaded = computed(() => this.solutionLayer.loadedSolution$());
  readonly comparisonMode = this.appState.comparisonVisualizationMode$;
  readonly isComparing = computed(
    () =>
      this.appState.rightSidebarMode$() === 'comparison' &&
      this.appState.activeSolution$() !== null &&
      this.appState.comparisonSolution$() !== null,
  );
  readonly baselineName = computed(() => this.appState.activeSolution$()?.name ?? 'Scenario A');
  readonly candidateName = computed(
    () => this.appState.comparisonSolution$()?.name ?? 'Scenario B',
  );
  readonly baselineColor = computed(() => this.solutionLayer.getBaselineColorHex());
  readonly candidateColor = computed(() => this.solutionLayer.getCandidateColorHex());
  readonly overlapColor = computed(() => this.solutionLayer.getOverlapColorHex());
  readonly baselineOpacity = computed(() => this.solutionLayer.getBaselineOpacity());
  readonly candidateOpacity = computed(() => this.solutionLayer.getCandidateOpacity());
  readonly overlapOpacity = computed(() => this.solutionLayer.getOverlapOpacity());
  readonly baselineOpacityPercent = computed(() => Math.round(this.baselineOpacity() * 100));
  readonly candidateOpacityPercent = computed(() => Math.round(this.candidateOpacity() * 100));

  readonly selectedLayerEntries = computed<LayerLegendEntry[]>(() => {
    const boundaryEntries = this.getVisibleBoundaryEntries();
    const appLayerEntries = this.getVisibleAppLayerEntries();
    return [...boundaryEntries, ...appLayerEntries];
  });

  readonly hasLegendContent = computed(() => {
    return this.loaded() !== null || this.selectedLayerEntries().length > 0;
  });

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }

  private getVisibleBoundaryEntries(): LayerLegendEntry[] {
    const visibility = this.adminBoundary.layerVisibilityByType$();
    const entries: LayerLegendEntry[] = [];
    for (const [type, isVisible] of Object.entries(visibility)) {
      if (!isVisible) {
        continue;
      }
      const meta = BOUNDARY_LAYER_ENTRIES[type];
      if (!meta) {
        continue;
      }
      entries.push({
        id: `boundary-${type}`,
        name: meta.name,
        swatchType: meta.swatchType ?? 'line',
        color: meta.color,
        lineStyle: meta.lineStyle,
        lineWidth: meta.lineWidth,
      });
    }
    return entries;
  }

  private getVisibleAppLayerEntries(): LayerLegendEntry[] {
    const visibleLayers = this.appState.visibleLayers$().filter((layer) => layer.visible);
    return visibleLayers.map((layer) => this.toLegendEntry(layer));
  }

  private toLegendEntry(layer: LayerConfig): LayerLegendEntry {
    const style = this.getSymbologyStyle(layer);
    const color = this.getSymbologyColor(layer);
    if (style === 'outline') {
      return {
        id: `app-layer-${layer.id}`,
        name: layer.name,
        swatchType: 'line',
        color,
        lineStyle: 'solid',
        lineWidth: 2,
      };
    }
    if (style === 'heatmap') {
      return {
        id: `app-layer-${layer.id}`,
        name: layer.name,
        swatchType: 'gradient',
        color,
        lineStyle: 'solid',
        lineWidth: 1,
      };
    }
    return {
      id: `app-layer-${layer.id}`,
      name: layer.name,
      swatchType: 'fill',
      color,
      lineStyle: 'solid',
      lineWidth: 1,
    };
  }

  private getSymbologyStyle(layer: LayerConfig): string {
    const symbology = layer.symbology;
    if (!symbology || typeof symbology !== 'object') {
      return 'fill';
    }
    const style = symbology['style'];
    return typeof style === 'string' ? style : 'fill';
  }

  private getSymbologyColor(layer: LayerConfig): string {
    const symbology = layer.symbology;
    if (!symbology || typeof symbology !== 'object') {
      return '#64748b';
    }
    const color = symbology['color'];
    return typeof color === 'string' ? color : '#64748b';
  }
}
