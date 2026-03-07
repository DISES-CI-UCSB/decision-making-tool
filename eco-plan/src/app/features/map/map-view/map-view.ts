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
  private readonly basemapService = inject(MapBasemapService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly debugMarker = 'UCS-39-map-debug-v1';
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
  }

  ngAfterViewInit(): void {
    console.info(`[MapView][${this.debugMarker}] ngAfterViewInit`);
    this.initMapWhenReady();
  }

  ngOnDestroy(): void {
    console.info(`[MapView][${this.debugMarker}] ngOnDestroy`);
    this.view?.destroy();
    this.view = null;
    this.map = null;
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

      this.view = new ArcGISMapView({
        container: el,
        map: this.map,
        center: COLOMBIA_CENTER,
        zoom: COLOMBIA_ZOOM,
        constraints: { minZoom: 4 },
      });

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
