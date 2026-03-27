import { Component, computed, inject } from '@angular/core';
import { AppStateService } from '@core/services/app-state.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';

@Component({
  selector: 'app-solution-legend',
  standalone: true,
  template: `
    @if (loaded(); as sol) {
      <section
        id="solution-legend-panel"
        class="pointer-events-auto absolute right-3 bottom-14 z-10 max-w-72 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm"
      >
        <h3
          id="solution-legend-title"
          class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 truncate"
          [title]="isComparing() ? 'Comparison legend' : sol.scenario.name"
        >
          {{ isComparing() ? 'Comparison Legend' : sol.scenario.name }}
        </h3>

        @if (!isComparing()) {
          <ul id="solution-legend-items-single" class="space-y-1.5 text-xs text-slate-700">
            <li id="solution-legend-selected-item" class="flex items-center gap-2">
              <span
                id="solution-legend-selected-swatch"
                class="inline-block h-3 w-5 rounded-sm"
                style="background-color: rgba(22,163,74,0.7);"
              >
              </span>
              Selected ({{ sol.rasterMeta.selectedPct.toFixed(1) }}%)
            </li>
            <li id="solution-legend-not-selected-item" class="flex items-center gap-2">
              <span
                id="solution-legend-not-selected-swatch"
                class="inline-block h-3 w-5 rounded-sm border border-slate-300"
                style="background-color: transparent;"
              >
              </span>
              Not selected
            </li>
          </ul>
          <p id="solution-legend-description" class="mt-2 text-[10px] leading-tight text-slate-400">
            {{ sol.scenario.description }}
          </p>
        } @else if (comparisonMode() === 'threeColorOverlay') {
          <ul id="solution-legend-items-three-color" class="space-y-1.5 text-xs text-slate-700">
            <li id="solution-legend-baseline-item-three-color" class="flex items-center gap-2">
              <span
                id="solution-legend-baseline-swatch-three-color"
                class="inline-block h-3 w-5 rounded-sm"
                [style.background-color]="baselineColor()"
                [style.opacity]="baselineOpacity()"
              ></span>
              A only: {{ baselineName() }}
            </li>
            <li id="solution-legend-candidate-item-three-color" class="flex items-center gap-2">
              <span
                id="solution-legend-candidate-swatch-three-color"
                class="inline-block h-3 w-5 rounded-sm"
                [style.background-color]="candidateColor()"
                [style.opacity]="candidateOpacity()"
              ></span>
              B only: {{ candidateName() }}
            </li>
            <li id="solution-legend-overlap-item-three-color" class="flex items-center gap-2">
              <span
                id="solution-legend-overlap-swatch-three-color"
                class="inline-block h-3 w-5 rounded-sm"
                [style.background-color]="overlapColor()"
                [style.opacity]="overlapOpacity()"
              ></span>
              Overlap (A + B)
            </li>
          </ul>
        } @else if (comparisonMode() === 'twoColorOpacity') {
          <ul id="solution-legend-items-two-color" class="space-y-1.5 text-xs text-slate-700">
            <li id="solution-legend-baseline-item-two-color" class="flex items-center gap-2">
              <span
                id="solution-legend-baseline-swatch-two-color"
                class="inline-block h-3 w-5 rounded-sm"
                [style.background-color]="baselineColor()"
                [style.opacity]="baselineOpacity()"
              ></span>
              Scenario A: {{ baselineName() }} ({{ baselineOpacityPercent() }}%)
            </li>
            <li id="solution-legend-candidate-item-two-color" class="flex items-center gap-2">
              <span
                id="solution-legend-candidate-swatch-two-color"
                class="inline-block h-3 w-5 rounded-sm"
                [style.background-color]="candidateColor()"
                [style.opacity]="candidateOpacity()"
              ></span>
              Scenario B: {{ candidateName() }} ({{ candidateOpacityPercent() }}%)
            </li>
          </ul>
        } @else {
          <ul id="solution-legend-items-swipe" class="space-y-1.5 text-xs text-slate-700">
            <li id="solution-legend-baseline-item-swipe" class="flex items-center gap-2">
              <span
                id="solution-legend-baseline-swatch-swipe"
                class="inline-block h-3 w-5 rounded-sm"
                [style.background-color]="baselineColor()"
                [style.opacity]="baselineOpacity()"
              ></span>
              Left side: {{ baselineName() }}
            </li>
            <li id="solution-legend-candidate-item-swipe" class="flex items-center gap-2">
              <span
                id="solution-legend-candidate-swatch-swipe"
                class="inline-block h-3 w-5 rounded-sm"
                [style.background-color]="candidateColor()"
                [style.opacity]="candidateOpacity()"
              ></span>
              Right side: {{ candidateName() }}
            </li>
          </ul>
          <p id="solution-legend-swipe-note" class="mt-2 text-[10px] leading-tight text-slate-500">
            Drag the swipe handle to inspect local differences.
          </p>
        }
      </section>
    }

    @if (isLoading()) {
      <div
        id="solution-legend-loading"
        class="pointer-events-none absolute left-3 bottom-14 z-10 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm"
      >
        <span id="solution-legend-loading-text" class="text-xs text-slate-500 animate-pulse">
          Loading solution...
        </span>
      </div>
    }
  `,
})
export class SolutionLegendComponent {
  private readonly solutionLayer = inject(SolutionLayerService);
  private readonly appState = inject(AppStateService);

  readonly loaded = computed(() => this.solutionLayer.loadedSolution$());
  readonly isLoading = computed(() => this.solutionLayer.isLoading$());
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
}
