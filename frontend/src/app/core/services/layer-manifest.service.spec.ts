import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  RuntimeCatalogReleaseIndex,
  RuntimeLayerManifest,
  RuntimeSirapManifest,
  RuntimeSolutionManifestEntry,
} from '@core/models/layer-manifest.model';
import { AppStateService } from './app-state.service';
import {
  LayerManifestService,
  isSirapCatalogBatch,
  mergeCatalogReleaseBatches,
  mergeRuntimeSolutionBatches,
  validateCatalogReleaseIndex,
} from './layer-manifest.service';

function solution(id: string, scope = 'nacional'): RuntimeSolutionManifestEntry {
  return {
    id,
    name: id,
    description: id,
    domain: 'land',
    scope,
    sirapId: scope === 'sirap' ? 'caribe' : null,
    displayUrl: `https://example.test/${id}.tif`,
    metadataUrl: `https://example.test/${id}.json`,
    rasterFile: `${id}.tif`,
    metadataFile: `${id}.json`,
    blobPath: `releases/test/solutions/${id}.tif`,
    generatedAt: null,
    finderInputs: {
      domain: 'land',
      scope,
      targetFeatureSet: null,
      targetFeatureIds: [],
      targetPercent: null,
      structuredTargets: {
        format: 'solution-target-metadata-v1',
        sourceEvaluation: 'final_summary_csv',
        ecosystems: [],
        strategicEcosystems: [],
        ecosystemServices: [],
        speciesRepresentation: [],
        espRn: [],
      },
      costLayerId: null,
      includeLayerIds: [],
      excludeLayerIds: [],
    },
    inputLayerIds: { features: [], cost: null, includes: [], excludes: [] },
    summaryMetrics: { nSelected: null, totalCost: null, pctTargetsMet: null, coverageRowCount: 0 },
    coverage: [],
    rendering: { valueType: 'binary', renderMode: 'mask', selectedValue: 1 },
  };
}

function nationalManifest(): RuntimeLayerManifest {
  return {
    version: '1',
    generatedAt: '2026-08-29T00:00:00Z',
    publicBlobHost: 'https://example.test',
    sourceCsv: 'test',
    categories: [],
    layers: [],
    solutions: [solution('national')],
  };
}

function sirapManifest(solutions: RuntimeSolutionManifestEntry[]): RuntimeSirapManifest {
  return {
    format: 'sirap-runtime-manifest-v1',
    releaseId: 'sirap-test',
    catalogVersion: '1.0.0',
    catalogSha256: 'a'.repeat(64),
    generatedAt: '2026-08-29T00:00:00Z',
    publicBlobHost: 'https://example.test',
    expectedSolutionCount: solutions.length,
    expectedRegularArtifactCount: solutions.length * 2,
    expectedGoalSummaryArtifactCount: solutions.length,
    expectedSourceSummaryArtifactCount: solutions.length,
    solutions,
  };
}

function catalogIndex(
  overrides: Partial<RuntimeCatalogReleaseIndex> = {},
): RuntimeCatalogReleaseIndex {
  return {
    format: 'runtime-catalog-release-v1',
    catalogVersion: '3.0.1',
    releaseId: 'catalog-v3-0-1-20260829',
    generatedAt: '2026-08-29T00:00:00Z',
    expectedSolutionCount: 2,
    batches: [
      {
        id: 'national',
        manifestUrl: 'https://example.test/national.json',
        expectedSolutionCount: 1,
      },
      { id: 'sirap', manifestUrl: 'https://example.test/sirap.json', expectedSolutionCount: 1 },
    ],
    ...overrides,
  };
}

describe('mergeRuntimeSolutionBatches', () => {
  it('leaves the primary batch untouched when no SIRAP batch is configured', () => {
    const national = nationalManifest();

    expect(mergeRuntimeSolutionBatches(national, null)).toBe(national);
  });

  it('appends SIRAP solutions without changing primary URLs', () => {
    const national = nationalManifest();
    const merged = mergeRuntimeSolutionBatches(
      national,
      sirapManifest([solution('sirap', 'sirap')]),
    );

    expect(merged.solutions.map((item) => item.id)).toEqual(['national', 'sirap']);
    expect(merged.solutions[0].displayUrl).toBe('https://example.test/national.tif');
  });

  it('fails closed on duplicate solution IDs', () => {
    expect(() =>
      mergeRuntimeSolutionBatches(
        nationalManifest(),
        sirapManifest([solution('national', 'sirap')]),
      ),
    ).toThrow('SIRAP manifest duplicates primary solution IDs: national');
  });
});

describe('catalog release indexes', () => {
  it('sets the merged runtime catalog version and preserves batch artifact URLs', () => {
    const national = nationalManifest();
    const sirap = sirapManifest([solution('sirap', 'sirap')]);

    const merged = mergeCatalogReleaseBatches(catalogIndex(), [national, sirap]);

    expect(merged.catalogVersion).toBe('3.0.1');
    expect(merged.releaseId).toBe('catalog-v3-0-1-20260829');
    expect(merged.solutions.map((item) => item.id)).toEqual(['national', 'sirap']);
    expect(merged.solutions[0].displayUrl).toBe('https://example.test/national.tif');
    expect(merged.solutions[1].displayUrl).toBe('https://example.test/sirap.tif');
  });

  it('fails closed when a declared batch is missing', () => {
    expect(() => mergeCatalogReleaseBatches(catalogIndex(), [nationalManifest()])).toThrow(
      'Catalog release index did not load every declared batch',
    );
  });

  it('rejects malformed catalog release indexes', () => {
    expect(() => validateCatalogReleaseIndex({ format: 'wrong' })).toThrow(
      'Catalog release index format must be runtime-catalog-release-v1',
    );
  });

  it('fails closed on duplicate solution IDs across batches', () => {
    expect(() =>
      mergeCatalogReleaseBatches(catalogIndex(), [
        nationalManifest(),
        sirapManifest([solution('national', 'sirap')]),
      ]),
    ).toThrow('Catalog release duplicates solution ID: national');
  });

  it('recognizes SIRAP batches by their batch ID', () => {
    const batch = (id: string) => ({
      id,
      manifestUrl: 'https://example.test/x.json',
      expectedSolutionCount: 1,
    });

    expect(isSirapCatalogBatch(batch('sirap'))).toBe(true);
    expect(isSirapCatalogBatch(batch('sirap-2026-09-09-v7-endemic'))).toBe(true);
    expect(isSirapCatalogBatch(batch('national'))).toBe(false);
    expect(isSirapCatalogBatch(batch('sirapless'))).toBe(false);
  });

  it('accepts a skipped SIRAP batch and expects only the loaded solution count', () => {
    const index = catalogIndex();

    const merged = mergeCatalogReleaseBatches(index, [nationalManifest()], [index.batches[0]]);

    expect(merged.solutions.map((item) => item.id)).toEqual(['national']);
  });

  it('fails closed when a skipped batch is not a SIRAP batch', () => {
    const index = catalogIndex({
      expectedSolutionCount: 2,
      batches: [
        {
          id: 'national',
          manifestUrl: 'https://example.test/national.json',
          expectedSolutionCount: 1,
        },
        { id: 'marine', manifestUrl: 'https://example.test/marine.json', expectedSolutionCount: 1 },
      ],
    });

    expect(() =>
      mergeCatalogReleaseBatches(index, [nationalManifest()], [index.batches[0]]),
    ).toThrow('Catalog release index did not load every declared batch');
  });

  it('fails closed when the loaded batches miss the release solution count', () => {
    const index = catalogIndex({ expectedSolutionCount: 3 });

    expect(() =>
      mergeCatalogReleaseBatches(index, [nationalManifest()], [index.batches[0]]),
    ).toThrow('Catalog release index expectedSolutionCount does not match loaded solutions');
  });
});

describe('LayerManifestService SIRAP batch access', () => {
  const indexUrl = 'https://example.test/catalog-release-index.json';
  const nationalUrl = 'https://example.test/national.json';
  const sirapUrl = 'https://example.test/sirap.json';
  const runtimeWindow = globalThis as { __CATALOG_RELEASE_INDEX_BLOB_URL__?: string };
  let httpMock: HttpTestingController;
  let appState: AppStateService;
  let latestSolutionIds: string[] | null;

  const isRequestTo = (url: string) => (request: { url: string }) =>
    request.url.startsWith(`${url}?`);
  const expectRequest = (url: string) => httpMock.expectOne(isRequestTo(url));
  const expectNoRequest = (url: string) => httpMock.expectNone(isRequestTo(url));

  function startLoadingCatalog(): void {
    TestBed.inject(LayerManifestService)
      .getManifest()
      .subscribe((manifest) => {
        latestSolutionIds = manifest.solutions.map((item) => item.id);
      });
    TestBed.tick();
    expectRequest(indexUrl).flush(catalogIndex());
    expectRequest(nationalUrl).flush(nationalManifest());
  }

  function grantSirapAccess(): void {
    appState.allowedSirapIds$.set(['orinoquia']);
    TestBed.tick();
  }

  beforeEach(() => {
    runtimeWindow.__CATALOG_RELEASE_INDEX_BLOB_URL__ = indexUrl;
    latestSolutionIds = null;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    appState = TestBed.inject(AppStateService);
  });

  afterEach(() => {
    httpMock.verify();
    delete runtimeWindow.__CATALOG_RELEASE_INDEX_BLOB_URL__;
  });

  it('loads only national batches for a signed-out visitor', () => {
    startLoadingCatalog();

    expectNoRequest(sirapUrl);
    expect(latestSolutionIds).toEqual(['national']);
  });

  it('loads the SIRAP batch once the user gains SIRAP access, without reloading national data', () => {
    startLoadingCatalog();

    grantSirapAccess();
    expectRequest(sirapUrl).flush(sirapManifest([solution('sirap', 'sirap')]));

    expectNoRequest(indexUrl);
    expectNoRequest(nationalUrl);
    expect(latestSolutionIds).toEqual(['national', 'sirap']);
  });

  it('loads the SIRAP batch for a super admin without region grants', () => {
    startLoadingCatalog();

    appState.userIsSuperAdmin$.set(true);
    TestBed.tick();
    expectRequest(sirapUrl).flush(sirapManifest([solution('sirap', 'sirap')]));

    expect(latestSolutionIds).toEqual(['national', 'sirap']);
  });

  it('drops SIRAP solutions when access ends and requests them again when access returns', () => {
    startLoadingCatalog();
    grantSirapAccess();
    expectRequest(sirapUrl).flush(sirapManifest([solution('sirap', 'sirap')]));

    appState.allowedSirapIds$.set([]);
    TestBed.tick();
    expect(latestSolutionIds).toEqual(['national']);

    grantSirapAccess();
    expectRequest(sirapUrl).flush(sirapManifest([solution('sirap', 'sirap')]));
    expect(latestSolutionIds).toEqual(['national', 'sirap']);
  });

  it('cancels an unfinished SIRAP request when access ends', () => {
    startLoadingCatalog();
    grantSirapAccess();
    const sirapRequest = expectRequest(sirapUrl);

    appState.allowedSirapIds$.set([]);
    TestBed.tick();

    expect(sirapRequest.cancelled).toBe(true);
    expect(latestSolutionIds).toEqual(['national']);
  });

  it('keeps national scenarios when the SIRAP batch fails to load', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    startLoadingCatalog();

    grantSirapAccess();
    expectRequest(sirapUrl).flush('missing', { status: 404, statusText: 'Not Found' });

    expect(latestSolutionIds).toEqual(['national']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  describe('SIRAP load failure flag', () => {
    const sirapLoadFailed = () => TestBed.inject(LayerManifestService).sirapCatalogLoadFailed();

    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('stays off for a visitor and after a successful SIRAP load', () => {
      startLoadingCatalog();
      expect(sirapLoadFailed()).toBe(false);

      grantSirapAccess();
      expectRequest(sirapUrl).flush(sirapManifest([solution('sirap', 'sirap')]));

      expect(sirapLoadFailed()).toBe(false);
    });

    it('turns on when the SIRAP batch request fails for a user with access', () => {
      startLoadingCatalog();

      grantSirapAccess();
      expectRequest(sirapUrl).flush('missing', { status: 404, statusText: 'Not Found' });

      expect(sirapLoadFailed()).toBe(true);
    });

    it('turns on when the loaded SIRAP batch fails validation', () => {
      startLoadingCatalog();

      grantSirapAccess();
      expectRequest(sirapUrl).flush(sirapManifest([solution('national', 'sirap')]));

      expect(latestSolutionIds).toEqual(['national']);
      expect(sirapLoadFailed()).toBe(true);
    });

    it('turns off when access ends and stays off once a later SIRAP load succeeds', () => {
      startLoadingCatalog();
      grantSirapAccess();
      expectRequest(sirapUrl).flush('missing', { status: 404, statusText: 'Not Found' });
      expect(sirapLoadFailed()).toBe(true);

      appState.allowedSirapIds$.set([]);
      TestBed.tick();
      expect(sirapLoadFailed()).toBe(false);

      grantSirapAccess();
      expectRequest(sirapUrl).flush(sirapManifest([solution('sirap', 'sirap')]));
      expect(latestSolutionIds).toEqual(['national', 'sirap']);
      expect(sirapLoadFailed()).toBe(false);
    });
  });
});
