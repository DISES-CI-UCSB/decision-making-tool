import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { MesaEcosystemCoverageLoaderService } from './mesa-ecosystem-coverage-loader.service';
import { SolutionCatalogService } from './solution-catalog.service';

describe('MesaEcosystemCoverageLoaderService', () => {
  it('returns unavailable when the catalog has no mesa URL', () => {
    TestBed.configureTestingModule({
      providers: [
        MesaEcosystemCoverageLoaderService,
        { provide: HttpClient, useValue: { get: vi.fn() } },
        { provide: SolutionCatalogService, useValue: { getById: () => ({ id: 'sol' }) } },
      ],
    });
    const service = TestBed.inject(MesaEcosystemCoverageLoaderService);
    let result: unknown;
    service.load('sol', 'national').subscribe((value) => {
      result = value;
    });
    expect(result).toEqual({ status: 'unavailable', document: null });
  });

  it('loads a compact national document from mesaEcosystemByGeography', () => {
    const document = {
      format: 'mesa-ecosystem-coverage-compact-v1',
      solutionId: 'sol',
      geographyLevel: 'national',
      features: [['Forest', 1, 0.17, 'post-hoc']],
      geographies: [['colombia', 'Colombia']],
      rowLayout: [],
      rows: [[0, 0, 10, 2, 0.2]],
    };
    const http = { get: vi.fn(() => of(document)) };
    TestBed.configureTestingModule({
      providers: [
        MesaEcosystemCoverageLoaderService,
        { provide: HttpClient, useValue: http },
        {
          provide: SolutionCatalogService,
          useValue: {
            getById: () => ({
              id: 'sol',
              precomputedMetricUrls: { mesaEcosystemByGeography: { national: '/mesa.json' } },
            }),
          },
        },
      ],
    });
    const service = TestBed.inject(MesaEcosystemCoverageLoaderService);
    let result: unknown;
    service.load('sol', 'national').subscribe((value) => {
      result = value;
    });
    expect(http.get).toHaveBeenCalledWith('/mesa.json');
    expect(result).toEqual({ status: 'loaded', document });
  });
});
