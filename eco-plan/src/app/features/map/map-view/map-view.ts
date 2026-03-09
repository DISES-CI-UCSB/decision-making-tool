import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import ArcGISMap from '@arcgis/core/Map';
import ArcGISMapView from '@arcgis/core/views/MapView';
import Point from '@arcgis/core/geometry/Point';
import Attribution from '@arcgis/core/widgets/Attribution';
import ScaleBar from '@arcgis/core/widgets/ScaleBar';
import { AppStateService } from '@core/services/app-state.service';
import { LayerRendererService } from '@features/map/services/layer-renderer.service';
import { MapBasemapService } from '@features/map/services/map-basemap.service';

const COLOMBIA_CENTER = new Point({ longitude: -74.0, latitude: 4.5 });
const COLOMBIA_ZOOM = 6;

@Component({
  selector: 'app-map-view',
  standalone: true,
  templateUrl: './map-view.html',
  styleUrl: './map-view.scss',
  host: {
    class: 'block h-full w-full min-w-0',
  },
})
export class MapViewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapViewContainer')
  private mapViewContainerRef!: ElementRef<HTMLDivElement>;

  private map: InstanceType<typeof ArcGISMap> | null = null;
  private view: InstanceType<typeof ArcGISMapView> | null = null;
  private scaleBarWidget: InstanceType<typeof ScaleBar> | null = null;
  private attributionWidget: InstanceType<typeof Attribution> | null = null;
  private readonly basemapService = inject(MapBasemapService);
  private readonly layerRenderer = inject(LayerRendererService);
  private readonly appState = inject(AppStateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly debugMarker = 'UCS-40-layer-infra-v1';
  protected mapErrorMessage = '';

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
  }

  ngAfterViewInit(): void {
    console.info(`[MapView][${this.debugMarker}] ngAfterViewInit`);
    this.initMapWhenReady();
  }

  ngOnDestroy(): void {
    console.info(`[MapView][${this.debugMarker}] ngOnDestroy`);
    this.removeMapWidgets();
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

    this.view.ui.add(this.scaleBarWidget, 'bottom-left');
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
}
