import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AppStateService, type MapLegendLayerEntry } from '@core/services/app-state.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-master-legend',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './master-legend.html',
  styleUrl: './master-legend.scss',
})
export class MasterLegendComponent implements AfterViewInit, OnDestroy {
  @ViewChild('contentInner')
  private contentInnerRef?: ElementRef<HTMLDivElement>;

  private readonly compactViewportMaxWidthPx = 1280;
  private readonly onWindowResize = (): void => this.syncViewportMode();
  private resizeObserver: ResizeObserver | null = null;
  private readonly appState = inject(AppStateService);
  private readonly solutionLayer = inject(SolutionLayerService);

  readonly collapsed = signal(false);
  readonly hasMeasuredContentHeight = signal(false);
  readonly expandedContentHeight = signal(640);
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
  readonly baselineColor = this.solutionLayer.baselineColor$;
  readonly candidateColor = this.solutionLayer.candidateColor$;
  readonly overlapColor = this.solutionLayer.overlapColor$;
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

    effect(() => {
      this.loaded();
      this.selectedLayerEntries();
      this.isComparing();
      this.comparisonMode();
      this.shouldShowActiveScenarioName();
      this.collapsed();

      // Keep expanded height in sync even when ResizeObserver is unavailable.
      queueMicrotask(() => this.updateExpandedContentHeight());
    });
  }

  ngAfterViewInit(): void {
    this.setupContentResizeObserver();
    this.updateExpandedContentHeight();
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onWindowResize);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => {
      const next = !value;
      if (!next) {
        this.updateExpandedContentHeight();
      }
      return next;
    });
  }

  private syncViewportMode(): void {
    if (typeof window === 'undefined') {
      this.isCompactViewport.set(false);
      return;
    }
    this.isCompactViewport.set(window.innerWidth <= this.compactViewportMaxWidthPx);
  }

  private setupContentResizeObserver(): void {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') {
      return;
    }
    const contentEl = this.contentInnerRef?.nativeElement;
    if (!contentEl) {
      return;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      this.updateExpandedContentHeight();
    });
    this.resizeObserver.observe(contentEl);
  }

  private updateExpandedContentHeight(): void {
    const contentEl = this.contentInnerRef?.nativeElement;
    if (!contentEl) {
      return;
    }
    const nextHeight = contentEl.scrollHeight;
    if (nextHeight <= 0) {
      return;
    }
    this.expandedContentHeight.set(nextHeight);
    this.hasMeasuredContentHeight.set(true);
  }
}
