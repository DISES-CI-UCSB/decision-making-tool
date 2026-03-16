import { Component, computed, inject } from '@angular/core';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';

@Component({
  selector: 'app-solution-legend',
  standalone: true,
  template: `
    @if (loaded(); as sol) {
      <section
        id="solution-legend-panel"
        class="pointer-events-auto absolute left-3 bottom-14 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm max-w-64"
      >
        <h3
          id="solution-legend-title"
          class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 truncate"
          [title]="sol.scenario.name"
        >
          {{ sol.scenario.name }}
        </h3>
        <ul id="solution-legend-items" class="space-y-1.5 text-xs text-slate-700">
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

  readonly loaded = computed(() => this.solutionLayer.loadedSolution$());
  readonly isLoading = computed(() => this.solutionLayer.isLoading$());
}
