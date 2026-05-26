import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AoiType } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { AdminBoundaryService } from './admin-boundary.service';

describe('AdminBoundaryService', () => {
  function boundaryRenderer(
    service: AdminBoundaryService,
    type: AoiType,
  ): Record<string, unknown> | null {
    return (
      service as unknown as {
        getBoundaryRenderer(boundaryType: AoiType): Record<string, unknown> | null;
      }
    ).getBoundaryRenderer(type);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AdminBoundaryService,
        {
          provide: AppStateService,
          useValue: {
            selectedAOI$: signal(null),
          },
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
    });
  });

  it('keeps feature-layer boundary outlines aligned with the manifest/sidebar black style', () => {
    const service = TestBed.inject(AdminBoundaryService);

    expect(boundaryRenderer(service, 'department')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [17, 24, 39, 235],
          }),
        }),
      }),
    );
    expect(boundaryRenderer(service, 'municipality')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [17, 24, 39, 235],
          }),
        }),
      }),
    );
    expect(boundaryRenderer(service, 'sirap')).toEqual(
      expect.objectContaining({
        symbol: expect.objectContaining({
          outline: expect.objectContaining({
            color: [17, 24, 39, 235],
            style: 'long-dash',
            width: 1.25,
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
});
