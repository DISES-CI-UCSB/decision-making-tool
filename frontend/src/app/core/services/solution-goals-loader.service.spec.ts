import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CatalogSolution } from '@core/models/solution-catalog.model';

import { SolutionCatalogService } from './solution-catalog.service';
import { SolutionGoalsLoaderService } from './solution-goals-loader.service';

describe('SolutionGoalsLoaderService', () => {
  let service: SolutionGoalsLoaderService;
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
        SolutionGoalsLoaderService,
        { provide: SolutionCatalogService, useValue: catalogStub },
      ],
    });

    service = TestBed.inject(SolutionGoalsLoaderService);
  });

  it('prefers the manifest-provided goals URL', () => {
    catalogSolution = {
      id: 'nick runs/ecos17',
      displayUrl: 'https://example.com/solutions/nick-runs/2026-05-27/ecos17.tif',
      precomputedMetricUrls: {
        goals: 'https://metrics.example.com/custom/ecos17.goals.json',
      },
    } as unknown as CatalogSolution;

    expect(service.buildGoalsUrl('nick runs/ecos17')).toBe(
      'https://metrics.example.com/custom/ecos17.goals.json',
    );
  });

  it('falls back to a sanitized goals URL on the display URL host', () => {
    catalogSolution = {
      id: 'nick runs/ecos17',
      displayUrl: 'https://example.com/solutions/nick-runs/2026-05-27/ecos17.tif',
    } as unknown as CatalogSolution;

    expect(service.buildGoalsUrl('nick runs/ecos17')).toBe(
      'https://example.com/metrics/goals/nick_runs_ecos17.goals.json',
    );
  });
});
