import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CatalogSolution, MecCompactDocument, MecCompactV2Document } from '@core/models';

import { MecMetricsLoaderService } from './mec-metrics-loader.service';
import { SolutionCatalogService } from './solution-catalog.service';

describe('MecMetricsLoaderService', () => {
  let service: MecMetricsLoaderService;
  let httpMock: HttpTestingController;
  let catalogSolution: CatalogSolution | null;

  const catalogStub = {
    getById: () => catalogSolution,
  };
  const document: MecCompactDocument = {
    format: 'mec-compact-v1',
    solutionId: 'land-solution',
    geographyLevel: 'departments',
    generatedAt: '2026-07-24T00:00:00Z',
    sourceMode: 'composite',
    units: 'km2',
    rowLayout: ['scopeIndex', 'classIndex', 'availableKm2', 'existingKm2', 'additionalKm2'],
    viewCatalog: [['broadEcosystem', 'Broad ecosystem']],
    classCatalog: [[0, 'broadEcosystem:forest', 'Forest']],
    scopeCatalog: [['05', 'Antioquia']],
    rows: [[0, 0, 10, 0, 4]],
    viewSupport: {
      supported: [{ view: 'broadEcosystem', mapping: 'authoritative', rule: 'Exact label.' }],
      unsupported: [],
    },
    semantics: {
      availableKm2: 'Available area.',
      existingKm2: 'Existing area.',
      additionalKm2: 'Additional area.',
      percentages: 'Derived percentages.',
      invariants: 'Coverage cannot exceed available area.',
    },
  };
  const v2Document: MecCompactV2Document = {
    format: 'mec-compact-v2',
    solutionId: 'land-solution',
    geographyLevel: 'departments',
    generatedAt: '2026-07-24T00:00:00Z',
    sourceMode: 'composite',
    units: 'km2',
    rowLayout: [
      'scopeIndex',
      'classIndex',
      'ecosystemAreaKm2',
      'preExistingCoverageKm2',
      'newPrioritizrCoverageKm2',
    ],
    scopeStatsFields: ['scopeAreaKm2', 'classifiedKm2', 'unclassifiedKm2', 'boundaryProvenanceRef'],
    viewCatalog: [['broadEcosystem', 'Broad ecosystem']],
    classCatalog: [[0, 'broadEcosystem:forest', 'Forest']],
    scopeCatalog: [['05', 'Antioquia']],
    scopeStats: {
      0: {
        scopeAreaKm2: 12,
        classifiedKm2: 10,
        unclassifiedKm2: 2,
        boundaryProvenanceRef: 'departments',
      },
    },
    rows: [[0, 0, 10, 0, 4]],
    viewSupport: {
      supported: [{ view: 'broadEcosystem', mapping: 'authoritative', rule: 'Exact label.' }],
      unsupported: [],
    },
    semantics: {
      ecosystemAreaKm2: 'Ecosystem area.',
      preExistingCoverageKm2: 'Pre-existing coverage.',
      newPrioritizrCoverageKm2: 'New Prioritizr coverage.',
      derivedValues: 'Derived.',
      scopeStats: 'Scope stats.',
      nationalBenchmark: 'National benchmark.',
      invariants: 'Coverage cannot exceed ecosystem area.',
    },
  };

  beforeEach(() => {
    catalogSolution = {
      id: 'land-solution',
      precomputedMetricUrls: {
        mecByGeography: {
          national: 'https://example.com/national.json',
          departments: 'https://example.com/departments.json',
          municipalities: 'https://example.com/municipalities.json',
          siraps: 'https://example.com/siraps.json',
          runaps: 'https://example.com/runaps.json',
          omecs: 'https://example.com/omecs.json',
        },
        mecV2ByGeography: {
          national: 'https://example.com/v2/national.json',
          departments: 'https://example.com/v2/departments.json',
          municipalities: 'https://example.com/v2/municipalities.json',
          siraps: 'https://example.com/v2/siraps.json',
          runaps: 'https://example.com/v2/runaps.json',
          omecs: 'https://example.com/v2/omecs.json',
        },
      },
    } as CatalogSolution;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        MecMetricsLoaderService,
        { provide: SolutionCatalogService, useValue: catalogStub },
      ],
    });
    service = TestBed.inject(MecMetricsLoaderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('prefers v2 and caches a format-validated response by URL pair', () => {
    const results: unknown[] = [];
    service.loadMecMetrics('land-solution', 'departments').subscribe((result) => {
      results.push(result);
    });
    service.loadMecMetrics('land-solution', 'departments').subscribe((result) => {
      results.push(result);
    });

    httpMock.expectOne('https://example.com/v2/departments.json').flush(v2Document);

    expect(results).toEqual([
      { status: 'loaded', document: v2Document, format: 'mec-compact-v2' },
      { status: 'loaded', document: v2Document, format: 'mec-compact-v2' },
    ]);
  });

  it('falls back to explicit v1 only when v2 is absent or unpublished', () => {
    const results: unknown[] = [];
    service.loadMecMetrics('land-solution', 'departments').subscribe((result) => {
      results.push(result);
    });
    httpMock.expectOne('https://example.com/v2/departments.json').flush('missing', {
      status: 404,
      statusText: 'Not Found',
    });
    httpMock.expectOne('https://example.com/departments.json').flush(document);

    expect(results).toEqual([{ status: 'loaded', document, format: 'mec-compact-v1' }]);

    catalogSolution = {
      ...catalogSolution!,
      precomputedMetricUrls: {
        mecByGeography: catalogSolution!.precomputedMetricUrls!.mecByGeography,
      },
    };
    service.loadMecMetrics('land-solution', 'municipalities').subscribe((result) => {
      results.push(result);
    });
    httpMock
      .expectOne('https://example.com/municipalities.json')
      .flush({ ...document, geographyLevel: 'municipalities' });

    expect(results.at(-1)).toEqual({
      status: 'loaded',
      document: { ...document, geographyLevel: 'municipalities' },
      format: 'mec-compact-v1',
    });
  });

  it('fails closed for invalid or failed v2 instead of reinterpreting v1 as v2', () => {
    const results: unknown[] = [];
    service.loadMecMetrics('land-solution', 'departments').subscribe((result) => {
      results.push(result);
    });
    httpMock.expectOne('https://example.com/v2/departments.json').flush(document);
    httpMock.expectNone('https://example.com/departments.json');

    catalogSolution = {
      ...catalogSolution!,
      precomputedMetricUrls: {
        ...catalogSolution!.precomputedMetricUrls,
        mecV2ByGeography: {
          ...catalogSolution!.precomputedMetricUrls!.mecV2ByGeography!,
          municipalities: 'https://example.com/v2-failed/municipalities.json',
        },
      },
    };
    service.loadMecMetrics('land-solution', 'municipalities').subscribe((result) => {
      results.push(result);
    });
    httpMock.expectOne('https://example.com/v2-failed/municipalities.json').flush('failed', {
      status: 500,
      statusText: 'Server Error',
    });
    httpMock.expectNone('https://example.com/municipalities.json');

    expect(results).toEqual([
      { status: 'error', document: null, error: 'invalid-document' },
      { status: 'error', document: null, error: 'http' },
    ]);
  });

  it('returns unavailable without requesting a fallback URL', () => {
    catalogSolution = {
      id: 'land-solution',
      displayUrl: 'https://example.com/solution.tif',
    } as CatalogSolution;
    let result: unknown;

    service.loadMecMetrics('land-solution', 'departments').subscribe((value) => {
      result = value;
    });

    expect(result).toEqual({ status: 'unavailable', document: null });
    httpMock.expectNone(() => true);
  });

  it('returns safe error results for HTTP and geography validation failures', () => {
    const results: unknown[] = [];
    service.loadMecMetrics('land-solution', 'departments').subscribe((result) => {
      results.push(result);
    });
    httpMock.expectOne('https://example.com/v2/departments.json').flush('missing', {
      status: 404,
      statusText: 'Not Found',
    });
    httpMock.expectOne('https://example.com/departments.json').flush('missing', {
      status: 404,
      statusText: 'Not Found',
    });

    catalogSolution = {
      ...catalogSolution!,
      precomputedMetricUrls: {
        ...catalogSolution!.precomputedMetricUrls,
        mecV2ByGeography: {
          ...catalogSolution!.precomputedMetricUrls!.mecV2ByGeography!,
          departments: 'https://example.com/other-v2-departments.json',
        },
      },
    };
    service.loadMecMetrics('land-solution', 'departments').subscribe((result) => {
      results.push(result);
    });
    httpMock
      .expectOne('https://example.com/other-v2-departments.json')
      .flush({ ...v2Document, geographyLevel: 'municipalities' });

    expect(results).toEqual([
      { status: 'error', document: null, error: 'http' },
      { status: 'error', document: null, error: 'invalid-document' },
    ]);
  });
});
