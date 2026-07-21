import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import type { CatalogSolution } from '@core/models/solution-catalog.model';
import { SolutionMetricsLoaderService } from './solution-metrics-loader.service';
import { SolutionCatalogService } from './solution-catalog.service';

describe('SolutionMetricsLoaderService', () => {
  let service: SolutionMetricsLoaderService;
  let httpMock: HttpTestingController;
  let catalogSolution: CatalogSolution | null = null;

  const catalogStub = {
    getById: () => catalogSolution,
  };

  beforeEach(() => {
    catalogSolution = null;
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
    catalogSolution = {
      id: 'ecos17_estr30_runap_hf',
      displayUrl:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/nacional/Ecos17%2BESTR30%2BRUNAP_HF.tif',
    } as unknown as CatalogSolution;

    expect(service.buildCacheUrl('ecos17_estr30_runap_hf')).toBe(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/cache/ecos17_estr30_runap_hf.metrics.json',
    );
  });

  it('prefers manifest-provided compact metrics URLs when available', () => {
    catalogSolution = {
      id: 'ecos17_estr30_runap_hf',
      displayUrl:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/nacional/Ecos17%2BESTR30%2BRUNAP_HF.tif',
      precomputedMetricUrls: {
        compactCache:
          'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/nick-runs/2026-05-27/compact-cache/ecos17_estr30_runap_hf.metrics.compact.json',
      },
    } as unknown as CatalogSolution;

    expect(service.buildCacheUrl('ecos17_estr30_runap_hf')).toBe(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/nick-runs/2026-05-27/compact-cache/ecos17_estr30_runap_hf.metrics.compact.json',
    );
  });

  it('falls back to the nick-runs compact cache without a precomputed URL', () => {
    catalogSolution = {
      id: 'ecos17_estr30_runap_hf',
      displayUrl:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/nick-runs/2026-05-27/Ecos17%2BESTR30%2BRUNAP_HF.tif',
    } as unknown as CatalogSolution;

    expect(service.buildCacheUrl('ecos17_estr30_runap_hf')).toBe(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/nick-runs/2026-05-27/compact-cache/ecos17_estr30_runap_hf.metrics.compact.json',
    );
  });

  it('returns null when the solution is unknown', () => {
    catalogSolution = null;
    expect(service.buildCacheUrl('missing')).toBeNull();
  });

  it('loads the cached metrics document from blob', () => {
    catalogSolution = {
      id: 'ecos17_estr30_runap_hf',
      displayUrl:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/nacional/Ecos17%2BESTR30%2BRUNAP_HF.tif',
    } as unknown as CatalogSolution;

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

  it('expands compact cached metrics documents from blob', () => {
    catalogSolution = {
      id: 'ecos17_estr30_runap_hf',
      displayUrl:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/nacional/Ecos17%2BESTR30%2BRUNAP_HF.tif',
      precomputedMetricUrls: {
        compactCache:
          'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/compact/ecos17_estr30_runap_hf.metrics.compact.json',
      },
    } as unknown as CatalogSolution;

    let result: unknown;
    service.loadCachedMetrics('ecos17_estr30_runap_hf').subscribe((value) => {
      result = value;
    });

    const req = httpMock.expectOne(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/compact/ecos17_estr30_runap_hf.metrics.compact.json',
    );
    req.flush({
      format: 'metrics-compact-v1',
      solutionId: 'ecos17_estr30_runap_hf',
      generatedAt: '2026-05-28T00:00:00Z',
      metricCatalog: [['national_contribution', '%', 'metrics.national_contribution', 'percent']],
      statusCatalog: ['ready'],
      sourceCatalog: ['raster:solution'],
      notesCatalog: [null],
      geographies: {
        national: {
          colombia: {
            name: 'Colombia',
            metrics: [[0, 12.5, 0, 0, 0]],
          },
        },
      },
    });

    expect(result).toEqual({
      solutionId: 'ecos17_estr30_runap_hf',
      generatedAt: '2026-05-28T00:00:00Z',
      geographies: {
        national: {
          colombia: {
            name: 'Colombia',
            metrics: [
              {
                metricId: 'national_contribution',
                value: 12.5,
                unit: '%',
                status: 'ready',
                source: 'raster:solution',
                notes: null,
                labelKey: 'metrics.national_contribution',
                formatHint: 'percent',
              },
            ],
          },
        },
      },
    });
  });
});
