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
  signal,
  untracked,
} from '@angular/core';
import ArcGISMap from '@arcgis/core/Map';
import ArcGISMapView from '@arcgis/core/views/MapView';
import Extent from '@arcgis/core/geometry/Extent';
import Geometry from '@arcgis/core/geometry/Geometry';
import Point from '@arcgis/core/geometry/Point';
import GeoJSONLayer from '@arcgis/core/layers/GeoJSONLayer';
import Attribution from '@arcgis/core/widgets/Attribution';
import CoordinateConversion from '@arcgis/core/widgets/CoordinateConversion';
import ScaleBar from '@arcgis/core/widgets/ScaleBar';
import type Widget from '@arcgis/core/widgets/Widget';
import type { Solution } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { LayerRendererService } from '@features/map/services/layer-renderer.service';
import {
  ManifestRasterLayerService,
  type OmecOverlayState,
} from '@features/map/services/manifest-raster-layer.service';
import { MapBasemapService } from '@features/map/services/map-basemap.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { MasterLegendComponent } from '@features/map/components/master-legend/master-legend';
import { TranslatePipe } from '@ngx-translate/core';

const COLOMBIA_CENTER = new Point({ longitude: -74.0, latitude: 4.5 });
const COLOMBIA_ZOOM = 6;
const OVERLAY_OMECS_ID = 'overlay-omecs';
const OMEC_IDENTIFY_GEOJSON_URL =
  'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/includes/omecs_identify.geojson';
const COLOMBIA_EXTENT = new Extent({
  xmin: -79.1,
  ymin: -4.3,
  xmax: -66.8,
  ymax: 13.7,
  spatialReference: { wkid: 4326 },
});
type SwipeInstance = {
  destroy: () => void;
} & Widget;
type SwipeConstructor = new (properties: Record<string, unknown>) => SwipeInstance;

@Component({
  selector: 'app-map-view',
  standalone: true,
  imports: [MasterLegendComponent, TranslatePipe],
  templateUrl: './map-view.html',
  styleUrl: './map-view.scss',
  host: {
    class: 'block h-full w-full min-w-0',
  },
})
export class MapViewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapRootContainer')
  private mapRootContainerRef!: ElementRef<HTMLElement>;
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
  private mapClickHandle: { remove: () => void } | null = null;
  private omecIdentifyLayer: InstanceType<typeof GeoJSONLayer> | null = null;
  private comparisonSyncRequestId = 0;
  private lastComparisonKey = '';
  private isCoordinateToolEnabled = false;
  private readonly basemapService = inject(MapBasemapService);
  private readonly adminBoundaries = inject(AdminBoundaryService);
  private readonly layerRenderer = inject(LayerRendererService);
  private readonly manifestRasterLayerService = inject(ManifestRasterLayerService);
  private readonly solutionLayer = inject(SolutionLayerService);
  private readonly appState = inject(AppStateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly debugMarker = 'UCS-40-layer-infra-v1';
  protected mapErrorMessage = '';
  protected isExportInProgress = false;
  protected readonly comparisonVisualizationMode = this.appState.comparisonVisualizationMode$;
  protected readonly isSolutionLoading = computed(() => this.solutionLayer.isLoading$());
  /** True while the OMEC vector GeoJSON is fetching from Vercel Blob. */
  protected readonly isOmecLayerLoading = signal(false);
  private omecLoadStatusHandle: { remove: () => void } | null = null;

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

    // Mirror OMEC sidebar state (visibility, opacity, color) onto the vector
    // GeoJSON display layer. We display OMECs from the vector source instead of
    // the 1 km raster so polygon edges look smooth and match the AOI highlight.
    effect(() => {
      const state = this.manifestRasterLayerService.omecOverlayState$();
      untracked(() => this.applyOmecOverlayState(state));
    });
  }

  ngAfterViewInit(): void {
    console.info(`[MapView][${this.debugMarker}] ngAfterViewInit`);
    this.initMapWhenReady();
  }

  ngOnDestroy(): void {
    console.info(`[MapView][${this.debugMarker}] ngOnDestroy`);
    this.mapClickHandle?.remove();
    this.mapClickHandle = null;
    this.omecLoadStatusHandle?.remove();
    this.omecLoadStatusHandle = null;
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

  protected zoomToCountry(): void {
    void this.animateZoomToCountry();
  }

  protected exportCurrentView(): void {
    void this.downloadCurrentMapViewAsPng();
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

  private async animateZoomToCountry(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      await this.view.goTo(
        {
          target: COLOMBIA_EXTENT,
        },
        {
          animate: true,
          duration: 300,
          easing: 'ease-in-out',
        },
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      console.error(`[MapView][${this.debugMarker}] country zoom reset failed:`, error);
    }
  }

  private async downloadCurrentMapViewAsPng(): Promise<void> {
    if (!this.view || this.isExportInProgress) {
      return;
    }

    this.isExportInProgress = true;
    try {
      const screenshot = await this.view.takeScreenshot({
        format: 'png',
      });
      const exportDataUrl = await this.composeExportImageDataUrl(screenshot.dataUrl);
      const link = document.createElement('a');
      link.href = exportDataUrl;
      link.download = this.buildScreenshotFilename();
      link.click();
    } catch (error: unknown) {
      console.error(`[MapView][${this.debugMarker}] export screenshot failed:`, error);
    } finally {
      this.isExportInProgress = false;
    }
  }

  private buildScreenshotFilename(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `solution-view-${timestamp}.png`;
  }

  private async composeExportImageDataUrl(baseMapDataUrl: string): Promise<string> {
    const baseImage = await this.loadImage(baseMapDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = baseImage.width;
    canvas.height = baseImage.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return baseMapDataUrl;
    }

    context.drawImage(baseImage, 0, 0);
    await this.drawLegendOverlay(context, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  private async drawLegendOverlay(
    context: CanvasRenderingContext2D,
    targetWidth: number,
    targetHeight: number,
  ): Promise<void> {
    const mapRoot = this.mapRootContainerRef?.nativeElement;
    const legendHost = document.getElementById('map-view-master-legend') as HTMLElement | null;
    if (!mapRoot || !legendHost || legendHost.offsetParent === null) {
      return;
    }

    const legendToggle = document.getElementById('master-legend-toggle');
    if (legendToggle?.getAttribute('aria-expanded') === 'false') {
      return;
    }

    const mapBounds = mapRoot.getBoundingClientRect();
    const legendBounds = legendHost.getBoundingClientRect();
    if (legendBounds.width <= 0 || legendBounds.height <= 0) {
      return;
    }

    const scaleX = targetWidth / mapBounds.width;
    const scaleY = targetHeight / mapBounds.height;
    const legendX = (legendBounds.left - mapBounds.left) * scaleX;
    const legendY = (legendBounds.top - mapBounds.top) * scaleY;
    const legendWidth = legendBounds.width * scaleX;
    const legendHeight = legendBounds.height * scaleY;

    try {
      const legendDataUrl = this.buildLegendDataUrl(
        legendHost,
        legendBounds.width,
        legendBounds.height,
      );
      const legendImage = await this.loadImage(legendDataUrl);
      context.drawImage(legendImage, legendX, legendY, legendWidth, legendHeight);
    } catch (error: unknown) {
      console.warn(`[MapView][${this.debugMarker}] legend overlay capture failed:`, error);
    }
  }

  private buildLegendDataUrl(legendHost: HTMLElement, width: number, height: number): string {
    const legendClone = this.cloneElementWithInlineStyles(legendHost);
    const serializer = new XMLSerializer();
    const legendMarkup = serializer.serializeToString(legendClone);
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${legendMarkup}</div></foreignObject></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  }

  private cloneElementWithInlineStyles(sourceElement: Element): Element {
    const clonedElement = sourceElement.cloneNode(false) as Element;
    clonedElement.setAttribute('style', this.serializeComputedStyle(sourceElement));

    sourceElement.childNodes.forEach((childNode) => {
      if (childNode.nodeType === Node.ELEMENT_NODE && childNode instanceof Element) {
        if (childNode.getAttribute('data-export-ignore') === 'true') {
          return;
        }
        clonedElement.appendChild(this.cloneElementWithInlineStyles(childNode));
        return;
      }

      clonedElement.appendChild(childNode.cloneNode(true));
    });

    return clonedElement;
  }

  private serializeComputedStyle(element: Element): string {
    const computedStyle = window.getComputedStyle(element);
    return Array.from(computedStyle)
      .map((propertyName) => `${propertyName}:${computedStyle.getPropertyValue(propertyName)};`)
      .join('');
  }

  private async loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image'));
      image.src = dataUrl;
    });
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
      this.manifestRasterLayerService.initialize(this.map);
      this.solutionLayer.initialize(this.map);
      this.setupOmecIdentifyLayer();
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
      this.registerMapClickHandler();
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

  private setupOmecIdentifyLayer(): void {
    if (!this.map || this.omecIdentifyLayer) {
      return;
    }
    // Single GeoJSON layer used for both display and click identification of
    // OMECs. Sidebar visibility/opacity/color drive its state via the effect
    // wired in the constructor (see applyOmecOverlayState).
    this.omecIdentifyLayer = new GeoJSONLayer({
      id: 'map-view-omec-vector-layer',
      url: OMEC_IDENTIFY_GEOJSON_URL,
      visible: false,
      opacity: 0.75,
      listMode: 'hide',
      popupEnabled: false,
      outFields: ['SITE_ID', 'NAME', 'DESIG', 'STATUS'],
      renderer: this.buildOmecRenderer('#7c3aed') as never,
    });
    this.map.add(this.omecIdentifyLayer);
    this.watchOmecLoadStatus();
    // If sidebar state was synced before the layer existed, apply it now.
    this.applyOmecOverlayState(this.manifestRasterLayerService.omecOverlayState$());
  }

  private buildOmecRenderer(hexColor: string): Record<string, unknown> {
    const [r, g, b] = this.hexToRgb(hexColor);
    return {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [r, g, b, 165],
        outline: { color: [r, g, b, 230], width: 1 },
      },
    };
  }

  private hexToRgb(hex: string): [number, number, number] {
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) {
      return [124, 58, 237];
    }
    const value = Number.parseInt(normalized, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  private applyOmecOverlayState(state: OmecOverlayState | null): void {
    const layer = this.omecIdentifyLayer;
    if (!layer || !state) {
      return;
    }
    layer.visible = state.visible;
    layer.opacity = state.opacity;
    layer.renderer = this.buildOmecRenderer(state.color) as never;
  }

  private watchOmecLoadStatus(): void {
    const layer = this.omecIdentifyLayer;
    if (!layer) {
      return;
    }
    this.omecLoadStatusHandle?.remove();
    const sync = () => {
      this.isOmecLayerLoading.set(layer.loadStatus === 'loading');
    };
    sync();
    this.omecLoadStatusHandle = layer.watch('loadStatus', sync);
  }

  private registerMapClickHandler(): void {
    if (!this.view) {
      return;
    }
    this.mapClickHandle?.remove();
    // Use immediate-click so OMEC hits can suppress downstream click handlers
    // (notably AdminBoundaryService click handling) for the same pointer event.
    this.mapClickHandle = this.view.on('immediate-click', (event) => {
      void this.handleOmecMapClick(event);
    });
  }

  private async handleOmecMapClick(event: {
    x: number;
    y: number;
    mapPoint?: Point | null;
    stopPropagation: () => void;
  }): Promise<void> {
    // Respect sidebar stacking: only claim the click when OMEC is the topmost
    // interactive layer (above any visible boundary row).
    if (!this.isOmecTopmostInteractiveLayer()) {
      return;
    }
    // Claim the click synchronously. stopPropagation() on immediate-click only
    // suppresses the subsequent click event if called before we yield to the
    // microtask queue; otherwise AdminBoundaryService's click handler races in
    // and clears/overwrites the OMEC AOI before our async hitTest resolves.
    event.stopPropagation();
    await this.showOmecPopupIfHit(event.mapPoint ?? null, event.x, event.y);
  }

  private isOmecTopmostInteractiveLayer(): boolean {
    if (!this.manifestRasterLayerService.isLayerVisible(OVERLAY_OMECS_ID)) {
      return false;
    }
    const entries = this.appState.selectedLegendLayers$();
    const omecIndex = entries.findIndex((entry) => entry.id === OVERLAY_OMECS_ID);
    if (omecIndex < 0) {
      // OMEC not in the user's selected layers — defer to default click handling.
      return false;
    }
    for (let index = 0; index < omecIndex; index += 1) {
      if (entries[index].id.startsWith('boundary-')) {
        return false;
      }
    }
    return true;
  }

  private async showOmecPopupIfHit(
    mapPoint: Point | null,
    screenX: number,
    screenY: number,
  ): Promise<boolean> {
    if (!this.view || !mapPoint || !this.omecIdentifyLayer) {
      return false;
    }
    const view = this.view;
    if (this.adminBoundaries.popupEnabled$()) {
      return false;
    }
    if (!this.manifestRasterLayerService.isLayerVisible(OVERLAY_OMECS_ID)) {
      return false;
    }

    try {
      if (this.omecIdentifyLayer.loadStatus === 'not-loaded') {
        await this.omecIdentifyLayer.load();
      }
      const hitTest = await view.hitTest(
        { x: screenX, y: screenY },
        { include: [this.omecIdentifyLayer] },
      );
      const firstGraphicHit = hitTest.results.find((result) => result.type === 'graphic');
      const hit = firstGraphicHit?.type === 'graphic' ? firstGraphicHit.graphic : null;
      if (!hit) {
        return false;
      }
      const attributes = hit.attributes as Record<string, unknown>;
      const omecName = `${attributes['NAME'] ?? ''}`.trim();
      const designation = `${attributes['DESIG'] ?? ''}`.trim();
      const siteId = `${attributes['SITE_ID'] ?? ''}`.trim();
      const status = `${attributes['STATUS'] ?? ''}`.trim();
      const detailLines = [
        designation,
        status ? `Status: ${status}` : '',
        siteId ? `ID: ${siteId}` : '',
      ]
        .filter((value) => value.length > 0)
        .join('<br/>');
      const aoiName = omecName || (siteId ? `OMEC ${siteId}` : 'OMEC');
      const aoiId = siteId || aoiName;

      try {
        await view.openPopup({
          location: mapPoint,
          title: aoiName,
          content: detailLines || 'OMEC',
        });
      } catch (popupError) {
        console.warn(`[MapView][${this.debugMarker}] OMEC popup open failed:`, popupError);
      }
      this.appState.selectAOI({
        id: `omec:${aoiId}`,
        name: aoiName,
        type: 'omec',
        geometryUrl: OMEC_IDENTIFY_GEOJSON_URL,
      });
      this.appState.setRightSidebarMode('aoi');
      // Reuse the boundary service's AOI highlight layer so the selected OMEC
      // polygon gets the same selection outline as admin boundaries.
      const highlightGeometry = (hit.geometry as Geometry | null) ?? mapPoint;
      this.adminBoundaries.highlightAoiGeometry(highlightGeometry);
      return true;
    } catch (error) {
      console.warn(`[MapView][${this.debugMarker}] OMEC identify query failed:`, error);
      return false;
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
