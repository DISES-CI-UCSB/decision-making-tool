import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SolutionGoalsDocument } from '@core/models';
import type { CatalogSolution } from '@core/models/solution-catalog.model';
import { firstValueFrom } from 'rxjs';

import { SolutionCatalogService } from './solution-catalog.service';
import { SolutionGoalsLoaderService } from './solution-goals-loader.service';

describe('SolutionGoalsLoaderService', () => {
  let service: SolutionGoalsLoaderService;
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
        SolutionGoalsLoaderService,
        { provide: SolutionCatalogService, useValue: catalogStub },
      ],
    });

    service = TestBed.inject(SolutionGoalsLoaderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

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

  it('keeps the legacy national goals fallback available', async () => {
    catalogSolution = {
      id: 'nick runs/ecos17',
      scope: 'national',
      displayUrl: 'https://example.com/solutions/nick-runs/2026-05-27/ecos17.tif',
    } as unknown as CatalogSolution;

    const fallbackUrl = 'https://example.com/metrics/goals/nick_runs_ecos17.goals.json';
    expect(service.buildGoalsUrl('nick runs/ecos17')).toBe(fallbackUrl);

    const resultPromise = firstValueFrom(service.loadGoals('nick runs/ecos17'));
    const document = { solutionId: 'nick runs/ecos17' } as SolutionGoalsDocument;
    httpMock.expectOne(fallbackUrl).flush(document);
    await expect(resultPromise).resolves.toEqual(document);
  });

  it('does not infer or request absent goals artifacts for SIRAP packets', async () => {
    catalogSolution = {
      id: 'sirap-orinoquia-estr17-cong17-sab17-runap-omec-iheh2030',
      scope: 'sirap',
      displayUrl:
        'https://aagibolq28slyfof.public.blob.vercel-storage.com/solutions/sirap/orinoquia.tif',
      precomputedMetricUrls: {
        compactCache:
          'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/sirap/orinoquia.metrics.compact.json',
      },
    } as unknown as CatalogSolution;

    expect(service.buildGoalsUrl(catalogSolution.id)).toBeNull();
    await expect(firstValueFrom(service.loadGoals(catalogSolution.id))).resolves.toBeNull();
    httpMock.expectNone(() => true);
  });

  it('loads only the manifest-provided regional goal summary for SIRAP', async () => {
    const goalsUrl = 'https://example.com/releases/sirap-v3/goals/cache/orinoquia.goals.json';
    catalogSolution = {
      id: 'sirap-orinoquia',
      scope: 'sirap',
      displayUrl: 'https://example.com/releases/sirap-v3/solutions/orinoquia.tif',
      precomputedMetricUrls: { goals: goalsUrl },
    } as unknown as CatalogSolution;

    const resultPromise = firstValueFrom(service.loadGoals(catalogSolution.id));
    const document = {
      format: 'conservation-goals-v1',
      solutionId: catalogSolution.id,
    } as SolutionGoalsDocument;
    httpMock.expectOne(goalsUrl).flush(document);

    await expect(resultPromise).resolves.toEqual(document);
  });

  it('does not infer national goals when finder inputs identify a SIRAP scope', () => {
    catalogSolution = {
      id: 'legacy-sirap-entry',
      scope: 'national',
      displayUrl: 'https://example.com/solutions/legacy-sirap.tif',
      finderInputs: { scope: 'sirap' },
    } as unknown as CatalogSolution;

    expect(service.buildGoalsUrl(catalogSolution.id)).toBeNull();
    httpMock.expectNone(() => true);
  });
});
