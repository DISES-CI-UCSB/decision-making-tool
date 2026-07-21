import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AOI, AoiType } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { AdminBoundaryService, type AdminBoundaryLayerKey } from './admin-boundary.service';

describe('AdminBoundaryService', () => {
  let selectedAOI: ReturnType<typeof signal<AOI | null>>;
  let appState: {
    selectedAOI$: typeof selectedAOI;
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

  beforeEach(() => {
    selectedAOI = signal<AOI | null>(null);
    appState = {
      selectedAOI$: selectedAOI,
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
    expect(boundaryRenderer(service, 'sirap')).toEqual(
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
