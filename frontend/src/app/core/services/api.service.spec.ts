import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CachedSolutionMetricsDocument, CustomPolygonMetricsRequest } from '@core/models';
import { environment } from '../../../environments/environment';
import { MockDataService } from './mock-data.service';
import { SolutionMetricsLoaderService } from './solution-metrics-loader.service';
import { ApiService } from './api.service';
import { of } from 'rxjs';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;
  let metricsLoader: { loadCachedMetrics: ReturnType<typeof vi.fn> };
  let mockData: { getSolutionMetrics: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    metricsLoader = { loadCachedMetrics: vi.fn() };
    mockData = { getSolutionMetrics: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SolutionMetricsLoaderService, useValue: metricsLoader },
        { provide: MockDataService, useValue: mockData },
      ],
    });

    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts custom polygon metrics requests to the configured backend API', () => {
    const request: CustomPolygonMetricsRequest = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      metrics: ['area'],
    };

    let result: unknown;
    service.getCustomPolygonMetrics(request).subscribe((response) => {
      result = response;
    });

    const req = httpMock.expectOne(`${environment.metricsApiBaseUrl}/metrics/custom-polygon`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);

    req.flush({
      status: 'ok',
      message: 'Custom polygon metrics calculated from the loaded runtime artifact.',
      artifact_state: {
        required: true,
        available: true,
        manifest_path: '/backend/artifacts/fixtures/tiny-area/manifest.json',
        schema_version: 'metrics-artifact-manifest/v1',
        artifact_version: 'tiny-area-fixture-v1',
        checksum: 'fixture-checksum',
        message: 'Runtime artifact loaded.',
        warmup_status: 'ready',
        warmup_ms: 0.5,
        loaded_at: '2026-06-04T00:00:00Z',
        metadata: {},
      },
      requested_metrics: ['area'],
      metrics: {
        priority_area_in_region: 1.5,
        national_contribution: 50,
      },
      metadata: {
        matched_cell_count: 2,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        metrics: expect.objectContaining({ priority_area_in_region: 1.5 }),
      }),
    );
  });

  it('keeps solution metrics on the cached metrics loader path', () => {
    const cachedDocument: CachedSolutionMetricsDocument = {
      solutionId: 'solution-with-cache',
      generatedAt: '2026-06-04T00:00:00Z',
      geographies: {
        national: {
          colombia: { metrics: [] },
        },
      },
    };
    metricsLoader.loadCachedMetrics.mockReturnValue(of(cachedDocument));

    let result: unknown;
    service.getSolutionMetrics('solution-with-cache').subscribe((response) => {
      result = response;
    });

    expect(metricsLoader.loadCachedMetrics).toHaveBeenCalledWith('solution-with-cache');
    expect(mockData.getSolutionMetrics).not.toHaveBeenCalled();
    expect(result).toBe(cachedDocument);
  });
});
