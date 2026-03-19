import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import type { Solution } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { TranslateService } from '@ngx-translate/core';
import { RouterOutlet } from '@angular/router';
import { AppShellComponent } from '@core/layout/app-shell/app-shell';
import { HeaderComponent } from '@core/layout/header/header';
import { ModalShellComponent } from '@core/shared/modal-shell/modal-shell';
import { PanelSwitcherComponent } from '@features/analysis/panel-switcher/panel-switcher';
import { SidebarContainerComponent } from '@features/left-sidebar/sidebar-container/sidebar-container';
import { MapViewComponent } from '@features/map/map-view/map-view';
import { DevToolsPanelComponent } from '@features/map/components/dev-tools-panel/dev-tools-panel';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { FinderModalComponent } from '@features/solution-finder/finder-modal/finder-modal';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  imports: [
    AppShellComponent,
    HeaderComponent,
    MapViewComponent,
    ModalShellComponent,
    PanelSwitcherComponent,
    RouterOutlet,
    SidebarContainerComponent,
    FinderModalComponent,
    DevToolsPanelComponent,
    TranslatePipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  private readonly appState = inject(AppStateService);
  private readonly mockData = inject(MockDataService);
  private readonly solutionCatalog = inject(SolutionCatalogService);
  private readonly solutionLayer = inject(SolutionLayerService);
  private readonly translate = inject(TranslateService);
  private readonly debugMarker = 'UCS-39-map-debug-v1';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  protected perspectiveModalOpen = false;
  protected coordinateToolEnabled = false;
  protected solutionLoadedToastVisible = false;
  protected solutionLoadedToastMessage = '';
  protected readonly solutionFinderModalOpen = this.appState.solutionFinderModalOpen$;
  protected readonly solutionFinderContext = this.appState.solutionFinderContext$;

  ngOnInit(): void {
    const runtimePort = window.location.port || '(default)';
    console.info(`[App][${this.debugMarker}] ngOnInit on port ${runtimePort}`);
    (window as Window & { __ecoPlanDebugMarker?: string }).__ecoPlanDebugMarker = this.debugMarker;
  }

  ngOnDestroy(): void {
    this.clearToastTimer();
  }

  protected openSolutionFinderModal(): void {
    this.appState.openSolutionFinder();
  }

  protected closeSolutionFinderModal(): void {
    this.appState.closeSolutionFinder();
  }

  protected openPerspectiveModal(): void {
    this.perspectiveModalOpen = true;
  }

  protected closePerspectiveModal(): void {
    this.perspectiveModalOpen = false;
  }

  protected onScenarioApplied(match: { solutionId: string; scenarioId: string }): void {
    const selectedSolution = this.mockData.getSolutionById(match.solutionId);
    if (selectedSolution && this.solutionFinderContext() === 'comparison-candidate') {
      this.appState.setComparisonSolution(
        this.buildCandidateComparisonSolution(selectedSolution, match),
      );
      this.appState.setRightSidebarMode('comparison');
    } else if (selectedSolution) {
      this.applySolution(selectedSolution, match.scenarioId);
    }

    this.showSolutionLoadedToast();
    this.closeSolutionFinderModal();
  }

  protected getSolutionFinderModalTitleKey(): string {
    return this.solutionFinderContext() === 'comparison-candidate'
      ? 'solutionControls.modal.solutionFinderComparisonTitle'
      : 'solutionControls.modal.solutionFinderTitle';
  }

  protected onCoordinateToolEnabledChange(isEnabled: boolean): void {
    this.coordinateToolEnabled = isEnabled;
  }

  protected dismissSolutionLoadedToast(): void {
    this.solutionLoadedToastVisible = false;
    this.clearToastTimer();
  }

  private applySolution(solution: Solution, scenarioId: string): void {
    this.appState.loadSolution(solution);
    this.appState.setRightSidebarMode('overview');
    void this.solutionLayer.showSolution(scenarioId);
  }

  private buildCandidateComparisonSolution(
    selectedSolution: Solution,
    match: { solutionId: string; scenarioId: string; matchPercentage?: number },
  ): Solution {
    const scenario = this.solutionCatalog.getById(match.scenarioId);
    return {
      ...selectedSolution,
      name: scenario?.name ?? selectedSolution.name,
      description: scenario?.description ?? selectedSolution.description,
      geometryUrl: scenario?.filename ?? selectedSolution.geometryUrl,
      matchPercentage: match.matchPercentage ?? selectedSolution.matchPercentage,
      metadata: {
        ...selectedSolution.metadata,
        scenarioId: match.scenarioId,
      },
    };
  }

  private showSolutionLoadedToast(): void {
    this.solutionLoadedToastMessage = this.translate.instant(
      'solutionControls.finder.toast.solutionLoaded',
    );
    this.solutionLoadedToastVisible = true;
    this.clearToastTimer();
    this.toastTimer = setTimeout(() => {
      this.solutionLoadedToastVisible = false;
      this.toastTimer = null;
    }, 3200);
  }

  private clearToastTimer(): void {
    if (!this.toastTimer) {
      return;
    }

    clearTimeout(this.toastTimer);
    this.toastTimer = null;
  }
}
