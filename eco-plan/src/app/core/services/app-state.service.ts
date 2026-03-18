import { computed, Injectable, signal } from '@angular/core';
import type Extent from '@arcgis/core/geometry/Extent';
import { type AOI, type LayerConfig, type Solution, UserTier } from '@core/models';

export type RightSidebarMode = 'welcome' | 'overview' | 'aoi' | 'comparison';

@Injectable({
  providedIn: 'root',
})
export class AppStateService {
  readonly activeSolution$ = signal<Solution | null>(null);
  readonly selectedAOI$ = signal<AOI | null>(null);
  readonly visibleLayers$ = signal<LayerConfig[]>([]);
  readonly comparisonSolution$ = signal<Solution | null>(null);
  readonly rightSidebarMode$ = signal<RightSidebarMode>('welcome');
  readonly fillDummyOverviewMetrics$ = signal(true);
  readonly userTier$ = signal<UserTier>(UserTier.Public);
  readonly mapExtent$ = signal<Extent | null>(null);

  readonly hasActiveSolution = computed(() => this.activeSolution$() !== null);
  readonly isComparing = computed(() => this.comparisonSolution$() !== null);
  readonly canAccessTier2 = computed(() => this.userTier$() >= UserTier.DecisionMaker);

  loadSolution(solution: Solution): void {
    this.activeSolution$.set(solution);
    this.rightSidebarMode$.set('overview');
  }

  clearSolution(): void {
    this.activeSolution$.set(null);
    this.selectedAOI$.set(null);
    this.comparisonSolution$.set(null);
    this.rightSidebarMode$.set('welcome');
  }

  selectAOI(aoi: AOI): void {
    this.selectedAOI$.set(aoi);
  }

  clearAOI(): void {
    this.selectedAOI$.set(null);
  }

  toggleLayer(layerId: string): void {
    this.visibleLayers$.update((layers) =>
      layers.map((layer) => (layer.id === layerId ? { ...layer, visible: !layer.visible } : layer)),
    );
  }

  setRightSidebarMode(mode: RightSidebarMode): void {
    this.rightSidebarMode$.set(mode);
  }

  setFillDummyOverviewMetrics(enabled: boolean): void {
    this.fillDummyOverviewMetrics$.set(enabled);
  }
}
