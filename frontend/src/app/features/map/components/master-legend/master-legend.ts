import { Component, computed, inject, signal } from '@angular/core';
import { UI_TEXT_TOKENS } from '@core/config/ui-text-tokens';
import { AppStateService, type MapLegendLayerEntry } from '@core/services/app-state.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';

@Component({
  selector: 'app-master-legend',
  standalone: true,
  template: `
    @if (hasLegendContent()) {
      <section
        id="master-legend-panel"
        class="pointer-events-auto max-w-80 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
      >
        <button
          id="master-legend-toggle"
          type="button"
          class="flex w-full items-center gap-2 border-b border-slate-200 px-3 py-2 text-left"
          [attr.aria-expanded]="!collapsed()"
          (click)="toggleCollapsed()"
        >
          <h3
            id="master-legend-title"
            class="master-legend-heading-trim flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500 leading-none"
          >
            Master Legend
          </h3>
          <svg
            id="master-legend-chevron"
            class="h-3 w-3 text-slate-400 transition-transform duration-200"
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
          <div id="master-legend-content" class="divide-y divide-slate-100">
            @if (loaded(); as sol) {
              <section id="master-legend-solution-section" class="space-y-1.5 px-3 py-2">
                <div
                  id="master-legend-solution-header"
                  class="flex items-baseline justify-between gap-2"
                >
                  <p
                    id="master-legend-solution-section-title"
                    class="text-sm font-semibold text-slate-500"
                  >
                    {{ legendText.activeScenarioLabel }}
                  </p>
                  <p
                    id="master-legend-solution-name"
                    class="truncate text-sm font-medium text-slate-500"
                  >
                    {{ isComparing() ? 'Comparison' : sol.scenario.name }}
                  </p>
                </div>

                @if (!isComparing()) {
                  <ul
                    id="master-legend-solution-items-single"
                    class="space-y-1.5 text-xs text-slate-700"
                  >
                    <li id="master-legend-solution-selected-item" class="flex items-center gap-2">
                      <span
                        id="master-legend-solution-selected-swatch"
                        class="inline-block h-3 w-3 rounded-[3px]"
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
                        class="inline-block h-3 w-3 rounded-[3px] border border-slate-300"
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
              <section id="master-legend-layer-section" class="space-y-1.5 px-3 py-2">
                <p
                  id="master-legend-layer-section-title"
                  class="text-sm font-semibold text-slate-500"
                >
                  {{ legendText.otherSelectedLayersLabel }} ({{ selectedLayerEntries().length }})
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
                          class="inline-block h-3 w-3 rounded-[3px] border border-slate-300"
                          style="background-image: linear-gradient(to right, #dbeafe, #f97316, #7f1d1d);"
                        ></span>
                      } @else {
                        <span
                          [id]="'master-legend-layer-fill-swatch-' + entry.id"
                          class="inline-block h-3 w-3 rounded-[3px] border border-slate-300"
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
  styles: `
    /* Progressive enhancement for optical vertical alignment of all-caps heading text. */
    @supports (text-box-trim: trim-both) and (text-box-edge: cap alphabetic) {
      #master-legend-title.master-legend-heading-trim {
        text-box-trim: trim-both;
        text-box-edge: cap alphabetic;
      }
    }
  `,
})
export class MasterLegendComponent {
  protected readonly legendText = UI_TEXT_TOKENS.mapLegend;
  private readonly appState = inject(AppStateService);
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

  readonly selectedLayerEntries = computed<MapLegendLayerEntry[]>(() =>
    this.appState.selectedLegendLayers$(),
  );

  readonly hasLegendContent = computed(() => {
    return this.loaded() !== null || this.selectedLayerEntries().length > 0;
  });

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }
}
