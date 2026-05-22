import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import type { SolutionScenario } from '@core/models/solution-scenario.model';
import { SolutionMetricsLoaderService } from './solution-metrics-loader.service';
import { SolutionCatalogService } from './solution-catalog.service';

describe('SolutionMetricsLoaderService', () => {
  let service: SolutionMetricsLoaderService;
  let httpMock: HttpTestingController;
  let catalogScenario: SolutionScenario | null = null;

  const catalogStub = {
    getById: () => catalogScenario,
  };

  beforeEach(() => {
    catalogScenario = null;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SolutionMetricsLoaderService,
        { provide: SolutionCatalogService, useValue: catalogStub },
      ],
    });

    service = TestBed.inject(SolutionMetricsLoaderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('builds the metrics/cache blob URL from the solution displayUrl host', () => {
    catalogScenario = {
      id: 'ecos17_estr30_runap_hf',
      displayUrl:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/nacional/Ecos17%2BESTR30%2BRUNAP_HF.tif',
    } as SolutionScenario;

    expect(service.buildCacheUrl('ecos17_estr30_runap_hf')).toBe(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/cache/ecos17_estr30_runap_hf.metrics.json',
    );
  });

  it('returns null when the solution is unknown', () => {
    catalogScenario = null;
    expect(service.buildCacheUrl('missing')).toBeNull();
  });

  it('loads the cached metrics document from blob', () => {
    catalogScenario = {
      id: 'ecos17_estr30_runap_hf',
      displayUrl:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/nacional/Ecos17%2BESTR30%2BRUNAP_HF.tif',
    } as SolutionScenario;

    let result: unknown;
    service.loadCachedMetrics('ecos17_estr30_runap_hf').subscribe((value) => {
      result = value;
    });

    const req = httpMock.expectOne(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/cache/ecos17_estr30_runap_hf.metrics.json',
    );
    req.flush({
      solutionId: 'ecos17_estr30_runap_hf',
      generatedAt: '2026-05-22T00:00:00Z',
      geographies: {
        national: { colombia: { metrics: [] } },
      },
    });

    expect(result).toEqual({
      solutionId: 'ecos17_estr30_runap_hf',
      generatedAt: '2026-05-22T00:00:00Z',
      geographies: {
        national: { colombia: { metrics: [] } },
      },
    });
  });
});
