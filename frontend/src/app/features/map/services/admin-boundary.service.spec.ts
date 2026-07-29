import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type Geometry from '@arcgis/core/geometry/Geometry';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import { PRODUCTION_SIRAP_BOUNDARY_SOURCE, type AOI, type AoiType } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { AdminBoundaryService, type AdminBoundaryLayerKey } from './admin-boundary.service';

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

  it('uses distinct blue hover and yellow selection polygon outlines', () => {
    const service = TestBed.inject(AdminBoundaryService);

    expect(interactionSymbol(service, 'polygon', [37, 99, 235, 255], 2.5)).toEqual(
      expect.objectContaining({
        color: [37, 99, 235, 0],
        outline: expect.objectContaining({
          color: [37, 99, 235, 255],
          width: 2.5,
        }),
      }),
    );
    expect(interactionSymbol(service, 'polygon', [250, 204, 21, 255], 3)).toEqual(
      expect.objectContaining({
        color: [250, 204, 21, 0],
        outline: expect.objectContaining({
          color: [250, 204, 21, 255],
          width: 3,
        }),
      }),
    );
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
    ['thematic_eje_cafetero_1', 'Eje Cafetero'],
    ['thematic_macizo_2', 'Macizo'],
    ['territorial_territorial_amazonia_3', 'Territorial Amazonia'],
    ['territorial_territorial_andes_nororientales_4', 'Territorial Andes Nororientales'],
    ['territorial_territorial_andes_occidentales_5', 'Territorial Andes Occidentales'],
    ['territorial_territorial_caribe_6', 'Territorial Caribe'],
    ['territorial_territorial_orinoquia_7', 'Territorial Orinoquia'],
    ['territorial_territorial_pacifico_8', 'Territorial Pacifico'],
    ['territorial_territorial_caribe_9', 'Territorial Caribe'],
    ['territorial_territorial_pacifico_10', 'Territorial Pacifico'],
  ])('selects a complete metric-compatible SIRAP from a map click: %s', async (sirapId, name) => {
    const service = TestBed.inject(AdminBoundaryService);
    const polygon = multipartPolygon();
    const thematic = sirapId.startsWith('thematic_');
    const layerKey = thematic ? 'siraps_thematic' : 'siraps_territorial';
    const sourceId = thematic ? 'aoi-siraps-thematic-colombia' : 'aoi-siraps-territorial-colombia';
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
        geometryUrl: expect.stringContaining(
          '/inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
        ),
        boundarySourceLayerKey: layerKey,
        boundarySourceId: sourceId,
        boundaryGeometrySelection: 'whole-feature',
      }),
    );
    expect(view.goTo).toHaveBeenCalledOnce();
  });

  it('pins the polygon-only SIRAP source contract without changing layer identity', () => {
    expect(PRODUCTION_SIRAP_BOUNDARY_SOURCE).toEqual({
      layerKey: 'siraps',
      sourceId: 'aoi-siraps-combined-colombia',
      pathname: 'inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
      sha256: '2a44a7a4726448959432924a11703250a444fe9e06be3324563e7b89d14912de',
      featureCount: 10,
    });
  });

  it('registers only feature-flag-enabled SIRAP boundary configurations', () => {
    const service = TestBed.inject(AdminBoundaryService);
    const configs = (
      service as unknown as {
        getConfigsForTarget(target: AoiType): {
          layerKey: AdminBoundaryLayerKey;
          url: string;
          definitionExpression?: string;
        }[];
      }
    ).getConfigsForTarget('sirap');

    expect(configs).toEqual([
      expect.objectContaining({
        layerKey: 'siraps_territorial',
        url: expect.stringContaining(PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname),
        definitionExpression: "sirap_kind = 'territorial'",
      }),
      expect.objectContaining({
        layerKey: 'siraps_thematic',
        url: expect.stringContaining(PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname),
        definitionExpression: "sirap_kind = 'thematic'",
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
