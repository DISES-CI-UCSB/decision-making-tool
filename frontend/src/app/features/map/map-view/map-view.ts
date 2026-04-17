import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  untracked,
} from '@angular/core';
import ArcGISMap from '@arcgis/core/Map';
import ArcGISMapView from '@arcgis/core/views/MapView';
import Point from '@arcgis/core/geometry/Point';
import Attribution from '@arcgis/core/widgets/Attribution';
import CoordinateConversion from '@arcgis/core/widgets/CoordinateConversion';
import ScaleBar from '@arcgis/core/widgets/ScaleBar';
import type Widget from '@arcgis/core/widgets/Widget';
import type { Solution } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { LayerRendererService } from '@features/map/services/layer-renderer.service';
import { MapBasemapService } from '@features/map/services/map-basemap.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { MasterLegendComponent } from '@features/map/components/master-legend/master-legend';

const COLOMBIA_CENTER = new Point({ longitude: -74.0, latitude: 4.5 });
const COLOMBIA_ZOOM = 6;
type SwipeInstance = {
  destroy: () => void;
} & Widget;
type SwipeConstructor = new (properties: Record<string, unknown>) => SwipeInstance;

@Component({
  selector: 'app-map-view',
  standalone: true,
  imports: [MasterLegendComponent],
  templateUrl: './map-view.html',
  styleUrl: './map-view.scss',
  host: {
    class: 'block h-full w-full min-w-0',
  },
})
export class MapViewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapViewContainer')
  private mapViewContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('comparisonSwipeContainer')
  private comparisonSwipeContainerRef!: ElementRef<HTMLDivElement>;

  private map: InstanceType<typeof ArcGISMap> | null = null;
  private view: InstanceType<typeof ArcGISMapView> | null = null;
  private scaleBarWidget: InstanceType<typeof ScaleBar> | null = null;
  private attributionWidget: InstanceType<typeof Attribution> | null = null;
  private coordinateConversionWidget: InstanceType<typeof CoordinateConversion> | null = null;
  private comparisonSwipeWidget: SwipeInstance | null = null;
  private comparisonSwipeHostEl: HTMLDivElement | null = null;
  private swipeConstructor: SwipeConstructor | null = null;
  private comparisonSyncRequestId = 0;
  private lastComparisonKey = '';
  private isCoordinateToolEnabled = false;
  private readonly basemapService = inject(MapBasemapService);
  private readonly adminBoundaries = inject(AdminBoundaryService);
  private readonly layerRenderer = inject(LayerRendererService);
  private readonly solutionLayer = inject(SolutionLayerService);
  private readonly appState = inject(AppStateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly debugMarker = 'UCS-40-layer-infra-v1';
  protected mapErrorMessage = '';
  protected readonly comparisonVisualizationMode = this.appState.comparisonVisualizationMode$;
  protected readonly isSolutionLoading = computed(() => this.solutionLayer.isLoading$());

  @Input()
  set coordinateToolEnabled(value: boolean) {
    this.isCoordinateToolEnabled = value;
    this.syncCoordinateToolVisibility();
  }

  constructor() {
    console.info(`[MapView][${this.debugMarker}] constructor`);

    effect(() => {
      const activeBasemap = this.basemapService.basemap();
      console.info(`[MapView][${this.debugMarker}] basemap signal -> ${activeBasemap}`);
      if (this.map) {
        this.map.basemap = activeBasemap as never;
      }
    });

    effect(() => {
      const layers = this.appState.visibleLayers$();
      console.info(`[MapView][${this.debugMarker}] visibleLayers$ -> ${layers.length} layer(s)`);
      this.layerRenderer.syncLayers(layers);
    });

    effect(() => {
      this.appState.activeSolution$();
      this.appState.comparisonSolution$();
      this.appState.rightSidebarMode$();
      this.appState.comparisonVisualizationMode$();
      untracked(() => void this.syncComparisonMode());
    });
  }

  ngAfterViewInit(): void {
    console.info(`[MapView][${this.debugMarker}] ngAfterViewInit`);
    this.initMapWhenReady();
  }

  ngOnDestroy(): void {
    console.info(`[MapView][${this.debugMarker}] ngOnDestroy`);
    this.teardownComparisonSwipeWidget();
    this.removeMapWidgets();
    this.adminBoundaries.destroy(this.map);
    this.view?.destroy();
    this.view = null;
    this.map = null;
  }

  protected zoomIn(): void {
    void this.animateZoomBy(1);
  }

  protected zoomOut(): void {
    void this.animateZoomBy(-1);
  }

  private async animateZoomBy(delta: number): Promise<void> {
    if (!this.view) {
      return;
    }

    const currentZoom = this.view.zoom ?? COLOMBIA_ZOOM;
    const minZoom = this.view.constraints.minZoom ?? 0;
    const maxZoom = this.view.constraints.maxZoom ?? 24;
    const targetZoom = Math.max(minZoom, Math.min(maxZoom, currentZoom + delta));

    if (targetZoom === currentZoom) {
      return;
    }

    try {
      await this.view.goTo(
        { zoom: targetZoom },
        {
          animate: true,
          duration: 250,
          easing: 'ease-in-out',
        },
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      console.error(`[MapView][${this.debugMarker}] zoom animation failed:`, error);
    }
  }

  private initMapWhenReady(retries = 15): void {
    const el = this.mapViewContainerRef?.nativeElement;
    if (retries === 15 && el) {
      this.logContainerHierarchy(el);
    }

    console.info(
      `[MapView][${this.debugMarker}] initMapWhenReady retries=${retries} size=${el?.clientWidth ?? 0}x${el?.clientHeight ?? 0}`,
    );
    if (!el || (el.clientWidth === 0 && retries > 0)) {
      setTimeout(() => this.initMapWhenReady(retries - 1), 100);
      return;
    }

    if (el.clientWidth === 0) {
      // Last-resort fallback for debugging layout: force a measurable box.
      el.style.minWidth = '320px';
      el.style.minHeight = '320px';
      el.style.width = '100%';
      el.style.height = '100%';

      const forcedWidth = el.clientWidth;
      const forcedHeight = el.clientHeight;
      console.error(
        `[MapView][${this.debugMarker}] container width is zero (forced size=${forcedWidth}x${forcedHeight})`,
      );
      this.logContainerHierarchy(el);

      if (forcedWidth > 0 && forcedHeight > 0) {
        console.warn(`[MapView][${this.debugMarker}] continuing with forced container dimensions`);
        this.createMapView(el);
        return;
      }

      this.mapErrorMessage = 'Map container has zero width — check layout.';
      this.cdr.detectChanges();
      return;
    }

    this.createMapView(el);
  }

  private createMapView(el: HTMLDivElement): void {
    try {
      console.info(`[MapView][${this.debugMarker}] creating ArcGISMap + ArcGISMapView`);
      this.map = new ArcGISMap({ basemap: 'topo-vector' });
      this.layerRenderer.initialize(this.map);
      this.solutionLayer.initialize(this.map);
      this.layerRenderer.syncLayers(this.appState.visibleLayers$());

      this.view = new ArcGISMapView({
        container: el,
        map: this.map,
        center: COLOMBIA_CENTER,
        zoom: COLOMBIA_ZOOM,
        constraints: { minZoom: 4 },
        ui: { components: [] },
      });

      this.addMapWidgets();
      this.adminBoundaries.initialize(this.map, this.view);
      void this.syncComparisonMode();

      this.view.when(
        () => console.info(`[MapView][${this.debugMarker}] ready`),
        (err: unknown) => {
          console.error(`[MapView][${this.debugMarker}] failed:`, err);
          this.mapErrorMessage = 'Map failed to initialise — see console.';
          this.cdr.detectChanges();
        },
      );
    } catch (err) {
      console.error(`[MapView][${this.debugMarker}] constructor threw:`, err);
      this.mapErrorMessage = `Map creation error: ${err}`;
      this.cdr.detectChanges();
    }
  }

  private addMapWidgets(): void {
    if (!this.view) {
      return;
    }

    this.scaleBarWidget = new ScaleBar({
      id: 'map-view-scale-bar-widget',
      unit: 'metric',
      view: this.view,
    });

    this.attributionWidget = new Attribution({
      id: 'map-view-attribution-widget',
      view: this.view,
    });

    this.coordinateConversionWidget = new CoordinateConversion({
      id: 'map-view-coordinate-conversion-widget',
      view: this.view,
      multipleConversions: false,
    });

    this.view.ui.add(this.scaleBarWidget, 'bottom-left');
    this.syncCoordinateToolVisibility();
    this.view.ui.add(this.attributionWidget, 'bottom-right');
  }

  private removeMapWidgets(): void {
    if (!this.view) {
      return;
    }

    if (this.scaleBarWidget) {
      this.view.ui.remove(this.scaleBarWidget);
      this.scaleBarWidget.destroy();
      this.scaleBarWidget = null;
    }

    if (this.attributionWidget) {
      this.view.ui.remove(this.attributionWidget);
      this.attributionWidget.destroy();
      this.attributionWidget = null;
    }

    if (this.coordinateConversionWidget) {
      this.view.ui.remove(this.coordinateConversionWidget);
      this.coordinateConversionWidget.destroy();
      this.coordinateConversionWidget = null;
    }
  }

  private async syncComparisonMode(): Promise<void> {
    if (!this.map || !this.view) {
      return;
    }

    const activeScenarioId = this.getScenarioId(this.appState.activeSolution$());
    const comparisonScenarioId = this.getScenarioId(this.appState.comparisonSolution$());
    const shouldShowComparison =
      this.appState.rightSidebarMode$() === 'comparison' &&
      !!activeScenarioId &&
      !!comparisonScenarioId;
    const visualizationMode = this.appState.comparisonVisualizationMode$();
    console.info(
      `[MapView][${this.debugMarker}] comparison check mode=${this.appState.rightSidebarMode$()} viz=${visualizationMode} active=${activeScenarioId ?? 'none'} candidate=${comparisonScenarioId ?? 'none'} enabled=${shouldShowComparison}`,
    );
    // Ignore stale async layer loads when users switch scenarios quickly.
    const requestId = ++this.comparisonSyncRequestId;

    if (!shouldShowComparison) {
      this.teardownComparisonSwipeWidget();
      if (activeScenarioId && this.solutionLayer.isComparisonModeActive()) {
        await this.solutionLayer.showSolution(activeScenarioId, { syncAppState: false });
        if (requestId !== this.comparisonSyncRequestId) {
          return;
        }
      } else {
        this.solutionLayer.exitComparisonMode();
      }
      return;
    }

    const previousPosition =
      this.comparisonSwipeWidget && 'position' in this.comparisonSwipeWidget
        ? (this.comparisonSwipeWidget as unknown as { position: number }).position
        : 50;
    const comparisonKey = `${activeScenarioId}::${comparisonScenarioId}::${visualizationMode}`;
    if (
      comparisonKey === this.lastComparisonKey &&
      this.solutionLayer.hasComparisonScenarios(activeScenarioId, comparisonScenarioId)
    ) {
      return;
    }

    this.teardownComparisonSwipeWidget();
    if (!this.solutionLayer.hasComparisonScenarios(activeScenarioId, comparisonScenarioId)) {
      await this.solutionLayer.showComparison(activeScenarioId, comparisonScenarioId);
      if (requestId !== this.comparisonSyncRequestId) {
        return;
      }
      if (!this.solutionLayer.hasComparisonScenarios(activeScenarioId, comparisonScenarioId)) {
        // Comparison load failed (or was interrupted): keep key unset so future attempts can retry.
        this.lastComparisonKey = '';
        console.error(
          `[MapView][${this.debugMarker}] comparison layers unavailable after load attempt`,
        );
        return;
      }
    }
    this.solutionLayer.applyComparisonVisualizationMode(visualizationMode);
    if (requestId !== this.comparisonSyncRequestId) {
      return;
    }

    this.lastComparisonKey = comparisonKey;

    if (visualizationMode === 'swipe') {
      try {
        await this.setupComparisonSwipeWidget(previousPosition);
      } catch (error) {
        console.error(`[MapView][${this.debugMarker}] failed to attach Swipe widget:`, error);
      }
    }
  }

  private async setupComparisonSwipeWidget(position = 50): Promise<void> {
    const parentEl = this.comparisonSwipeContainerRef?.nativeElement;
    if (!this.view || !parentEl) {
      return;
    }

    const comparisonLayers = this.solutionLayer.getComparisonLayers();
    if (!comparisonLayers) {
      return;
    }

    const hostEl = document.createElement('div');
    hostEl.id = 'map-view-comparison-swipe-host';
    hostEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    parentEl.appendChild(hostEl);
    this.comparisonSwipeHostEl = hostEl;

    const Swipe = await this.getSwipeConstructor();
    this.comparisonSwipeWidget = new Swipe({
      id: 'map-view-comparison-swipe-widget',
      container: hostEl,
      view: this.view,
      leadingLayers: [comparisonLayers.baselineLayer],
      trailingLayers: [comparisonLayers.candidateLayer],
      direction: 'horizontal',
      position,
    });
    console.info(`[MapView][${this.debugMarker}] Swipe widget created (position=${position})`);
  }

  private teardownComparisonSwipeWidget(): void {
    if (this.comparisonSwipeWidget) {
      this.comparisonSwipeWidget.destroy();
      this.comparisonSwipeWidget = null;
    }
    if (this.comparisonSwipeHostEl) {
      this.comparisonSwipeHostEl.remove();
      this.comparisonSwipeHostEl = null;
    }
    this.lastComparisonKey = '';
  }

  private async getSwipeConstructor(): Promise<SwipeConstructor> {
    if (this.swipeConstructor) {
      return this.swipeConstructor;
    }

    // Lazy import prevents ArcGIS CSS side-effects during unit-test bootstrap.
    const swipeModule = await import('@arcgis/core/widgets/Swipe');
    this.swipeConstructor = swipeModule.default as unknown as SwipeConstructor;
    return this.swipeConstructor;
  }

  private getScenarioId(solution: Solution | null): string | null {
    const metadata = solution?.metadata;
    const scenarioId = metadata ? metadata['scenarioId'] : null;
    return typeof scenarioId === 'string' && scenarioId.length > 0 ? scenarioId : null;
  }

  private logContainerHierarchy(el: HTMLDivElement): void {
    const debugNodes: (HTMLElement | null)[] = [
      el,
      el.parentElement,
      el.parentElement?.parentElement ?? null,
      el.parentElement?.parentElement?.parentElement ?? null,
      el.parentElement?.parentElement?.parentElement?.parentElement ?? null,
    ];

    debugNodes.forEach((node, index) => {
      if (!node) {
        return;
      }

      const rect = node.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(node);
      console.info(
        `[MapView][${this.debugMarker}] hierarchy[${index}] id=${node.id || '(none)'} tag=${node.tagName.toLowerCase()} display=${computedStyle.display} size=${Math.round(rect.width)}x${Math.round(rect.height)}`,
      );
    });
  }

  private syncCoordinateToolVisibility(): void {
    if (!this.view || !this.coordinateConversionWidget) {
      return;
    }

    if (this.isCoordinateToolEnabled) {
      this.view.ui.remove(this.coordinateConversionWidget);
      this.view.ui.add(this.coordinateConversionWidget, { position: 'top-left', index: 0 });
      return;
    }

    this.view.ui.remove(this.coordinateConversionWidget);
  }
}
