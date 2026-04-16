import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { UI_TEXT_TOKENS } from '@core/config/ui-text-tokens';
import { AppStateService, type MapLegendLayerEntry } from '@core/services/app-state.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';

@Component({
  selector: 'app-master-legend',
  standalone: true,
  templateUrl: './master-legend.html',
  styleUrl: './master-legend.scss',
})
export class MasterLegendComponent implements OnDestroy {
  private readonly compactViewportMaxWidthPx = 1280;
  private readonly onWindowResize = (): void => this.syncViewportMode();
  protected readonly legendText = UI_TEXT_TOKENS.mapLegend;
  private readonly appState = inject(AppStateService);
  private readonly solutionLayer = inject(SolutionLayerService);

  readonly collapsed = signal(false);
  readonly isCompactViewport = signal(false);
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
  readonly shouldShowActiveScenarioName = computed(
    () => this.isComparing() || this.isCompactViewport(),
  );

  readonly hasLegendContent = computed(() => {
    return this.loaded() !== null || this.selectedLayerEntries().length > 0;
  });

  constructor() {
    this.syncViewportMode();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onWindowResize);
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onWindowResize);
    }
  }

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }

  private syncViewportMode(): void {
    if (typeof window === 'undefined') {
      this.isCompactViewport.set(false);
      return;
    }
    this.isCompactViewport.set(window.innerWidth <= this.compactViewportMaxWidthPx);
  }
}
