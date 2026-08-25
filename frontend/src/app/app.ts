import { Component, OnInit, ViewContainerRef, inject } from '@angular/core';
import type { LayerLocale, Solution, CatalogSolution } from '@core/models';
import { AppLocaleService } from '@core/services/app-locale.service';
import { AppStateService } from '@core/services/app-state.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { TranslateService } from '@ngx-translate/core';
import { RouterOutlet } from '@angular/router';
import { AppShellComponent } from '@core/layout/app-shell/app-shell';
import { HeaderComponent } from '@core/layout/header/header';
import { ModalShellComponent } from '@core/shared/modal-shell/modal-shell';
import { PanelSwitcherComponent } from '@features/analysis/panel-switcher/panel-switcher';
import { SidebarContainerComponent } from '@features/left-sidebar/sidebar-container/sidebar-container';
import { MapViewComponent } from '@features/map/map-view/map-view';
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
    TranslatePipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  /**
   * Exposed for ngx-color-picker `cpUseRootViewContainer`.
   * This lets popup dialogs render from the app root instead of being clipped
   * by nested containers with overflow rules.
   */
  public readonly viewContainerRef = inject(ViewContainerRef);
  private readonly appLocaleService = inject(AppLocaleService);
  private readonly appState = inject(AppStateService);
  private readonly solutionCatalog = inject(SolutionCatalogService);
  private readonly solutionLayer = inject(SolutionLayerService);
  private readonly translate = inject(TranslateService);
  private readonly debugMarker = 'UCS-39-map-debug-v1';
  protected perspectiveModalOpen = false;
  protected landingWelcomeModalOpen = true;
  protected coordinateToolEnabled = false;
  protected readonly solutionFinderModalOpen = this.appState.solutionFinderModalOpen$;
  protected readonly solutionFinderContext = this.appState.solutionFinderContext$;

  ngOnInit(): void {
    const runtimePort = window.location.port || '(default)';
    console.info(`[App][${this.debugMarker}] ngOnInit on port ${runtimePort}`);
    (window as Window & { __ecoPlanDebugMarker?: string }).__ecoPlanDebugMarker = this.debugMarker;
  }

  protected get activeLanguage(): string {
    return (
      this.translate.getCurrentLang() ||
      this.translate.getDefaultLang() ||
      this.appLocaleService.locale()
    );
  }

  protected openSolutionFinderModal(): void {
    this.appState.openSolutionFinder();
  }

  protected closeLandingWelcomeModal(): void {
    this.landingWelcomeModalOpen = false;
  }

  protected startFromLandingWelcome(): void {
    this.closeLandingWelcomeModal();
    this.openSolutionFinderModal();
  }

  protected setLanguage(language: LayerLocale): void {
    this.translate.use(language).subscribe(() => {
      this.appLocaleService.setLocale(language);
    });
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

  protected onSolutionApplied(match: { solutionId: string; customLabel?: string }): void {
    const selectedSolution = this.buildManifestSolution(match);
    if (!selectedSolution) {
      return;
    }

    if (this.solutionFinderContext() === 'comparison-candidate') {
      this.appState.setComparisonSolution(
        this.buildCandidateComparisonSolution(selectedSolution, match),
      );
      this.appState.setRightSidebarMode('comparison');
    } else {
      this.applySolution(selectedSolution, match.solutionId, match.customLabel);
    }

    this.closeSolutionFinderModal();
  }

  protected onCoordinateToolEnabledChange(isEnabled: boolean): void {
    this.coordinateToolEnabled = isEnabled;
  }

  private applySolution(solution: Solution, solutionId: string, customLabel?: string): void {
    this.appState.setComparisonSolution(null);
    this.appState.loadSolution(solution);
    if (customLabel) {
      this.appState.labelActiveSolution(customLabel);
    }
    this.appState.setRightSidebarMode('overview');
    void this.solutionLayer.showSolution(solutionId, { syncAppState: false });
  }

  private buildCandidateComparisonSolution(
    selectedSolution: Solution,
    match: { solutionId: string; matchPercentage?: number },
  ): Solution {
    const solution = this.solutionCatalog.getById(match.solutionId);
    return {
      ...selectedSolution,
      name: solution?.name ?? selectedSolution.name,
      description: solution?.description ?? selectedSolution.description,
      geometryUrl: solution?.filename ?? selectedSolution.geometryUrl,
      matchPercentage: match.matchPercentage ?? selectedSolution.matchPercentage,
      metadata: {
        ...selectedSolution.metadata,
        solutionId: match.solutionId,
      },
    };
  }

  private buildManifestSolution(match: { solutionId: string }): Solution | null {
    const solution = this.solutionCatalog.getById(match.solutionId);
    if (!solution) {
      return null;
    }

    return this.toSolution(solution);
  }

  private toSolution(solution: CatalogSolution): Solution {
    return {
      id: solution.id,
      name: solution.name,
      description: solution.description,
      matchPercentage: solution.pctTargetsMet,
      geometryUrl: solution.displayUrl,
      metrics: [],
      metadata: {
        solutionId: solution.id,
        scope: solution.scope,
        rasterFile: solution.filename,
        metadataUrl: solution.metadataUrl,
      },
    };
  }
}
