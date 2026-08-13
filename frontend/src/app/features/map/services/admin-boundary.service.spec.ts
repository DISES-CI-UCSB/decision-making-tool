import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type Geometry from '@arcgis/core/geometry/Geometry';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import {
  PRODUCTION_SIRAP_BOUNDARY_SOURCE,
  UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE,
  type AOI,
  type AoiType,
} from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import {
  AdminBoundaryService,
  COLOMBIA_OUTLINE_VISUAL_URL,
  type AdminBoundaryLayerKey,
} from './admin-boundary.service';

describe('AdminBoundaryService', () => {
  let selectedAOI: ReturnType<typeof signal<AOI | null>>;
  let appState: {
    selectedAOI$: typeof selectedAOI;
    selectAOI: ReturnType<typeof vi.fn>;
    clearAOI: ReturnType<typeof vi.fn>;
    setRightSidebarMode: ReturnType<typeof vi.fn>;
    hasActiveSolution: ReturnType<typeof vi.fn>;
  };

  function boundaryRenderer(
    service: AdminBoundaryService,
    type: AoiType | AdminBoundaryLayerKey,
  ): Record<string, unknown> | null {
    return (
      service as unknown as {
        getBoundaryRenderer(
          boundaryType: AoiType | AdminBoundaryLayerKey,
        ): Record<string, unknown> | null;
      }
    ).getBoundaryRenderer(type);
  }

  function interactionSymbol(
    service: AdminBoundaryService,
    geometryType: string,
    color: [number, number, number, number],
    width: number,
  ): Record<string, unknown> {
    return (
      service as unknown as {
        getInteractionSymbol(
          geometry: { type: string },
          symbolColor: [number, number, number, number],
          symbolWidth: number,
        ): Record<string, unknown>;
      }
    ).getInteractionSymbol({ type: geometryType }, color, width);
  }

  function resolveSelectionGeometry(
    service: AdminBoundaryService,
    geometry: Geometry,
    clickedPoint: Point,
    aoiType: AoiType,
  ): { geometry: Geometry | null; geometrySelection?: 'whole-feature' | 'component' } {
    return (
      service as unknown as {
        resolveSelectionGeometry(
          sourceGeometry: Geometry,
          point: Point,
          type: AoiType,
        ): { geometry: Geometry | null; geometrySelection?: 'whole-feature' | 'component' };
      }
    ).resolveSelectionGeometry(geometry, clickedPoint, aoiType);
  }

  beforeEach(() => {
    selectedAOI = signal<AOI | null>(null);
    appState = {
      selectedAOI$: selectedAOI,
      selectAOI: vi.fn((aoi: AOI) => selectedAOI.set(aoi)),
      clearAOI: vi.fn(() => selectedAOI.set(null)),
      setRightSidebarMode: vi.fn(),
      hasActiveSolution: vi.fn(() => true),
    };

    TestBed.configureTestingModule({
      providers: [
        AdminBoundaryService,
        {
          provide: AppStateService,
          useValue: appState,
        },
      ],
    });
  });

  it('defaults to country outline only (departments hidden)', () => {
    const service = TestBed.inject(AdminBoundaryService);

    expect(service.layerVisibilityByType$()).toEqual({
      sirap: false,
      department: false,
      municipality: false,
      runap: false,
      omec: false,
      custom: false,
    });
  });

  it('keeps feature-layer boundary outlines aligned with the manifest/sidebar gray style', () => {
    const service = TestBed.inject(AdminBoundaryService);

    expect(boundaryRenderer(service, 'department')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [107, 114, 128, 235],
          }),
        }),
      }),
    );
    expect(boundaryRenderer(service, 'municipality')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [107, 114, 128, 235],
          }),
        }),
      }),
    );
    expect(boundaryRenderer(service, 'siraps_territorial')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [107, 114, 128, 235],
            style: 'solid',
            width: 1.25,
          }),
        }),
      }),
    );
    expect(boundaryRenderer(service, 'siraps_territorial_updated')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [107, 114, 128, 235],
            style: 'dot',
            width: 1.25,
          }),
        }),
      }),
    );
    expect(boundaryRenderer(service, 'siraps_thematic')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [107, 114, 128, 235],
            style: 'long-dash',
            width: 1.25,
          }),
        }),
      }),
    );
  });

  it('renders the default country outline as a transparent polygon boundary', () => {
    const service = TestBed.inject(AdminBoundaryService);

    expect(boundaryRenderer(service, 'admin_country_outline')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          type: 'simple-fill',
          color: [0, 0, 0, 0],
          outline: expect.objectContaining({
            color: [107, 114, 128, 235],
            width: 1.6,
          }),
        }),
      }),
    );
  });

  it('uses the immutable visual-only outline without changing AOI boundary sources', () => {
    expect(COLOMBIA_OUTLINE_VISUAL_URL).toBe(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/reference/colombia_outline_visual/v0.1.0/colombia_outline_visual.geojson',
    );
    expect(PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname).not.toContain('colombia_outline_visual');
  });

  it('applies manifest preview colors to boundary renderers', () => {
    const service = TestBed.inject(AdminBoundaryService);

    service.setLayerStyle('department', { color: '#ff0000' });

    expect(boundaryRenderer(service, 'department')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [255, 0, 0, 235],
          }),
        }),
      }),
    );
  });

  it('uses distinct yellow hover and orange selection polygon outlines', () => {
    const service = TestBed.inject(AdminBoundaryService);

    expect(interactionSymbol(service, 'polygon', [250, 204, 21, 255], 2.5)).toEqual(
      expect.objectContaining({
        color: [250, 204, 21, 0],
        outline: expect.objectContaining({
          color: [250, 204, 21, 255],
          width: 2.5,
        }),
      }),
    );
    expect(interactionSymbol(service, 'polygon', [249, 115, 22, 255], 3)).toEqual(
      expect.objectContaining({
        color: [249, 115, 22, 0],
        outline: expect.objectContaining({
          color: [249, 115, 22, 255],
          width: 3,
        }),
      }),
    );
  });

  it('registers the yellow native hover highlight without a polygon fill', () => {
    const service = TestBed.inject(AdminBoundaryService);
    const highlights: Record<string, unknown>[] = [];

    (
      service as unknown as {
        registerHoverHighlightOptions(view: { highlights: Record<string, unknown>[] }): void;
      }
    ).registerHoverHighlightOptions({ highlights });

    expect(highlights).toEqual([
      {
        name: 'aoi-hover',
        color: [250, 204, 21],
        haloOpacity: 1,
        fillOpacity: 0,
        shadowOpacity: 0,
      },
    ]);
  });

  it('caps hover hit tests at two while retaining the latest pointer position', async () => {
    const service = TestBed.inject(AdminBoundaryService);
    const hitResolvers: ((value: { results: [] }) => void)[] = [];
    const view = {
      hitTest: vi.fn((screenPoint: unknown, options: unknown) => {
        void screenPoint;
        void options;
        return new Promise<{ results: [] }>((resolve) => {
          hitResolvers.push(resolve);
        });
      }),
      allLayerViews: [],
    };
    Object.assign(service as unknown as Record<string, unknown>, {
      boundaryLayers: [{ id: 'aoi-departments-colombia', visible: true }],
    });
    const hoverService = service as unknown as {
      enqueuePointerMove(mapView: never, screenX: number, screenY: number): void;
    };

    hoverService.enqueuePointerMove(view as never, 10, 10);
    hoverService.enqueuePointerMove(view as never, 20, 20);
    hoverService.enqueuePointerMove(view as never, 30, 30);

    expect(view.hitTest).toHaveBeenCalledTimes(2);
    hitResolvers[0]?.({ results: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(view.hitTest).toHaveBeenCalledTimes(3);
    expect(view.hitTest.mock.calls[2]?.[0]).toEqual({ x: 30, y: 30 });

    hitResolvers[1]?.({ results: [] });
    hitResolvers[2]?.({ results: [] });
    await Promise.resolve();
  });

  it('does not redraw hover and selection highlights for unchanged geometry', () => {
    const service = TestBed.inject(AdminBoundaryService);
    const geometry = new Polygon({
      rings: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    });
    const nextGeometry = geometry.clone();
    nextGeometry.rings = nextGeometry.rings.map((ring) => ring.map(([x, y]) => [x + 20, y]));
    const hoverLayer = { removeAll: vi.fn(), add: vi.fn() };
    const selectionLayer = { removeAll: vi.fn(), add: vi.fn() };
    Object.assign(service as unknown as Record<string, unknown>, {
      aoiHoverLayer: hoverLayer,
      aoiHighlightLayer: selectionLayer,
    });
    const highlightService = service as unknown as {
      setHoverHighlight(hoverGeometry: Geometry): void;
      setSelectionHighlight(selectionGeometry: Geometry): void;
    };

    highlightService.setHoverHighlight(geometry);
    highlightService.setHoverHighlight(geometry);
    highlightService.setHoverHighlight(nextGeometry);
    highlightService.setSelectionHighlight(geometry);
    highlightService.setSelectionHighlight(geometry);
    highlightService.setSelectionHighlight(nextGeometry);

    expect(hoverLayer.removeAll).not.toHaveBeenCalled();
    expect(hoverLayer.add).toHaveBeenCalledOnce();
    expect(hoverLayer.add.mock.calls[0][0].geometry).toBe(nextGeometry);
    expect(hoverLayer.add.mock.calls[0][0].symbol.outline.color.toRgba()).toEqual([
      250, 204, 21, 1,
    ]);
    expect(selectionLayer.removeAll).not.toHaveBeenCalled();
    expect(selectionLayer.add).toHaveBeenCalledOnce();
    expect(selectionLayer.add.mock.calls[0][0].geometry).toBe(nextGeometry);
    expect(selectionLayer.add.mock.calls[0][0].symbol.outline.color.toRgba()).toEqual([
      249, 115, 22, 1,
    ]);
  });

  it('highlights a hovered boundary through its layer view only once per feature', () => {
    const service = TestBed.inject(AdminBoundaryService);
    const removeHighlight = vi.fn();
    const highlight = vi.fn(() => ({ remove: removeHighlight }));
    const layer = { id: 'aoi-departments-colombia', objectIdField: 'OBJECTID' };
    const view = { allLayerViews: [{ layer, highlight }] };
    const hoverLayer = { removeAll: vi.fn(), add: vi.fn() };
    Object.assign(service as unknown as Record<string, unknown>, { aoiHoverLayer: hoverLayer });
    const hoverService = service as unknown as {
      applyHoverHighlight(mapView: never, graphic: never): void;
    };
    const graphicFor = (objectId: number) => ({
      layer,
      attributes: { OBJECTID: objectId },
      geometry: null,
    });

    hoverService.applyHoverHighlight(view as never, graphicFor(1) as never);
    hoverService.applyHoverHighlight(view as never, graphicFor(1) as never);

    expect(highlight).toHaveBeenCalledOnce();
    expect(highlight).toHaveBeenCalledWith(expect.anything(), { name: 'aoi-hover' });
    expect(hoverLayer.add).not.toHaveBeenCalled();

    hoverService.applyHoverHighlight(view as never, graphicFor(2) as never);

    expect(removeHighlight).toHaveBeenCalledOnce();
    expect(highlight).toHaveBeenCalledTimes(2);
  });

  it('falls back to an outline graphic when no layer view can highlight the feature', () => {
    const service = TestBed.inject(AdminBoundaryService);
    const geometry = new Polygon({
      rings: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    });
    const hoverLayer = { removeAll: vi.fn(), add: vi.fn() };
    Object.assign(service as unknown as Record<string, unknown>, { aoiHoverLayer: hoverLayer });
    const hoverService = service as unknown as {
      applyHoverHighlight(mapView: never, graphic: never): void;
    };

    hoverService.applyHoverHighlight(
      { allLayerViews: [] } as never,
      {
        layer: { id: 'custom-layer', objectIdField: 'OBJECTID' },
        attributes: { OBJECTID: 7 },
        geometry,
      } as never,
    );

    expect(hoverLayer.add).toHaveBeenCalledOnce();
    expect(hoverLayer.add.mock.calls[0][0].geometry).toBe(geometry);
  });

  it('classifies an unchanged single-ring SIRAP polygon as the whole feature', () => {
    const service = TestBed.inject(AdminBoundaryService);
    const polygon = new Polygon({
      rings: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    });

    const resolved = resolveSelectionGeometry(service, polygon, new Point({ x: 5, y: 5 }), 'sirap');

    expect(resolved.geometry).toBe(polygon);
    expect(resolved.geometrySelection).toBe('whole-feature');
  });

  it('keeps reusable component extraction for non-SIRAP multipart boundaries', () => {
    const service = TestBed.inject(AdminBoundaryService);
    const polygon = multipartPolygon();

    const resolved = resolveSelectionGeometry(
      service,
      polygon,
      new Point({ x: 5, y: 5 }),
      'department',
    );

    expect(resolved.geometry).not.toBe(polygon);
    expect((resolved.geometry as Polygon).rings).toHaveLength(1);
    expect(resolved.geometrySelection).toBe('component');
  });

  it.each([
    [
      'thematic_eje_cafetero_1',
      'Eje Cafetero',
      'siraps_thematic',
      'aoi-siraps-thematic-colombia',
      PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname,
    ],
    [
      'thematic_macizo_2',
      'Macizo',
      'siraps_thematic',
      'aoi-siraps-thematic-colombia',
      PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname,
    ],
    [
      'territorial_territorial_amazonia_3',
      'Territorial Amazonia',
      'siraps_territorial_updated',
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.sourceId,
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.pathname,
    ],
    [
      'territorial_territorial_andes_nororientales_4',
      'Territorial Andes Nororientales',
      'siraps_territorial_updated',
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.sourceId,
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.pathname,
    ],
    [
      'territorial_territorial_andes_occidentales_5',
      'Territorial Andes Occidentales',
      'siraps_territorial_updated',
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.sourceId,
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.pathname,
    ],
    [
      'territorial_territorial_caribe_6',
      'Territorial Caribe',
      'siraps_territorial_updated',
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.sourceId,
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.pathname,
    ],
    [
      'territorial_territorial_orinoquia_7',
      'Territorial Orinoquia',
      'siraps_territorial_updated',
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.sourceId,
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.pathname,
    ],
    [
      'territorial_territorial_pacifico_8',
      'Territorial Pacifico',
      'siraps_territorial_updated',
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.sourceId,
      UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.pathname,
    ],
  ])(
    'selects a complete metric-compatible SIRAP from a map click: %s',
    async (sirapId, name, layerKey, sourceId, pathname) => {
      const service = TestBed.inject(AdminBoundaryService);
      const polygon = multipartPolygon();
      const layer = { id: sourceId, visible: true };
      const view = {
        hitTest: vi.fn().mockResolvedValue({
          results: [
            {
              type: 'graphic',
              graphic: {
                layer,
                attributes: { sirap_id: sirapId, sirap_name: name },
                geometry: polygon,
              },
            },
          ],
        }),
        goTo: vi.fn().mockResolvedValue(undefined),
      };
      Object.assign(service as unknown as Record<string, unknown>, {
        boundaryLayers: [layer],
      });

      await (
        service as unknown as {
          handleMapClick(
            mapView: never,
            mapPoint: Point,
            screenX: number,
            screenY: number,
          ): Promise<void>;
        }
      ).handleMapClick(view as never, new Point({ x: 5, y: 5 }), 100, 100);

      expect(selectedAOI()).toEqual(
        expect.objectContaining({
          id: `sirap:${sirapId}`,
          name,
          type: 'sirap',
          geometryUrl: expect.stringContaining(pathname),
          boundarySourceLayerKey: layerKey,
          boundarySourceId: sourceId,
          boundaryGeometrySelection: 'whole-feature',
        }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(view.goTo).toHaveBeenCalledOnce();
    },
  );

  it('pins the polygon-only SIRAP source contract without changing layer identity', () => {
    expect(PRODUCTION_SIRAP_BOUNDARY_SOURCE).toEqual({
      layerKey: 'siraps',
      sourceId: 'aoi-siraps-combined-colombia',
      pathname: 'inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
      sha256: '2a44a7a4726448959432924a11703250a444fe9e06be3324563e7b89d14912de',
      featureCount: 10,
    });
  });

  it('keeps the outdated territorial source view-only when its geometry is clicked', async () => {
    const service = TestBed.inject(AdminBoundaryService);
    const layer = {
      id: 'aoi-siraps-territorial-colombia',
      visible: true,
    };
    const view = {
      hitTest: vi.fn(),
      goTo: vi.fn().mockResolvedValue(undefined),
    };
    Object.assign(service as unknown as Record<string, unknown>, {
      boundaryLayers: [layer],
    });

    await (
      service as unknown as {
        handleMapClick(
          mapView: never,
          mapPoint: Point,
          screenX: number,
          screenY: number,
        ): Promise<void>;
      }
    ).handleMapClick(view as never, new Point({ x: 5, y: 5 }), 100, 100);

    expect(view.hitTest).not.toHaveBeenCalled();
    expect(view.goTo).not.toHaveBeenCalled();
    expect(selectedAOI()).toBeNull();
  });

  it('registers only feature-flag-enabled SIRAP boundary configurations', () => {
    const service = TestBed.inject(AdminBoundaryService);
    const configs = (
      service as unknown as {
        getConfigsForTarget(target: AoiType): {
          layerKey: AdminBoundaryLayerKey;
          url: string;
          definitionExpression?: string;
          selectable?: boolean;
        }[];
      }
    ).getConfigsForTarget('sirap');

    expect(configs).toEqual([
      expect.objectContaining({
        layerKey: 'siraps_territorial',
        selectable: false,
        url: expect.stringContaining(PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname),
        definitionExpression: "sirap_kind = 'territorial'",
      }),
      expect.objectContaining({
        layerKey: 'siraps_thematic',
        url: expect.stringContaining(PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname),
        definitionExpression: "sirap_kind = 'thematic'",
      }),
      expect.objectContaining({
        layerKey: 'siraps_territorial_updated',
        url: expect.stringContaining(UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.pathname),
      }),
    ]);
  });

  it('clears a selected department when the departments layer is hidden', () => {
    const service = TestBed.inject(AdminBoundaryService);
    selectedAOI.set({
      id: 'department:05',
      name: 'Antioquia',
      type: 'department',
      geometryUrl: '/boundaries/departments.geojson',
    });

    service.setLayerVisibility('admin_departments', false);

    expect(appState.clearAOI).toHaveBeenCalledOnce();
    expect(appState.setRightSidebarMode).toHaveBeenCalledWith('overview');
    expect(selectedAOI()).toBeNull();
  });

  it('keeps a non-department AOI when the departments layer is hidden', () => {
    const service = TestBed.inject(AdminBoundaryService);
    selectedAOI.set({
      id: 'omec:site-1',
      name: 'Protected Site',
      type: 'omec',
      geometryUrl: '/boundaries/omec.geojson',
    });

    service.setLayerVisibility('admin_departments', false);

    expect(appState.clearAOI).not.toHaveBeenCalled();
    expect(appState.setRightSidebarMode).not.toHaveBeenCalled();
    expect(selectedAOI()?.id).toBe('omec:site-1');
  });
});

function multipartPolygon(): Polygon {
  return new Polygon({
    rings: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [20, 20],
        [30, 20],
        [30, 30],
        [20, 30],
        [20, 20],
      ],
    ],
  });
}
