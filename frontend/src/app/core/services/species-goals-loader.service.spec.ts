import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  CatalogSolution,
  SpeciesGoalsCatalog,
  SpeciesGoalsCompactDocument,
} from '@core/models';
import { firstValueFrom } from 'rxjs';

import { SolutionCatalogService } from './solution-catalog.service';
import { SpeciesGoalsLoaderService } from './species-goals-loader.service';

const SHA = 'a'.repeat(64);
const RELEASE = 'fixture-release';
const CATALOG_URL = `/releases/${RELEASE}/species-goals/catalog/v1/catalog.json`;
const COMPACT_URL =
  `/releases/${RELEASE}/species-goals/compact/v1/fixture/` +
  'departments.species-goals.compact.json';
const NATIONAL_URL =
  `/releases/${RELEASE}/species-goals/compact/v1/fixture/` + 'national.species-goals.compact.json';
const OVERLAY_URL =
  `/releases/${RELEASE}/species-goals/targets/v1/` + 'species-target-overlays-v1.json';

describe('SpeciesGoalsLoaderService', () => {
  let http: HttpTestingController;
  let service: SpeciesGoalsLoaderService;
  let targetOverlayUrl: string | undefined;

  beforeEach(() => {
    targetOverlayUrl = undefined;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SpeciesGoalsLoaderService,
        {
          provide: SolutionCatalogService,
          useValue: {
            getById: () =>
              ({
                id: 'fixture',
                precomputedMetricUrls: {
                  speciesGoalsCatalog: CATALOG_URL,
                  speciesGoalsByGeography: {
                    departments: COMPACT_URL,
                    national: NATIONAL_URL,
                  },
                  speciesGoalsTargetOverlay: targetOverlayUrl,
                },
              }) as CatalogSolution,
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(SpeciesGoalsLoaderService);
  });

  afterEach(() => http.verify());

  it('hydrates validated predefined AOI artifacts', async () => {
    const catalogText = JSON.stringify(catalog());
    const compactText = JSON.stringify(compact());
    const catalogSha256 = await sha256(catalogText);
    const compactSha256 = await sha256(compactText);
    const resultPromise = firstValueFrom(service.load('fixture', 'departments', '05'));

    http.expectOne(`${CATALOG_URL}.complete.json`).flush({
      format: 'species-goals-catalog-completion-v1',
      status: 'complete',
      releaseId: RELEASE,
      catalogSha256: SHA,
      artifactSha256: catalogSha256,
    });
    http.expectOne(`${COMPACT_URL}.complete.json`).flush({
      format: 'species-goals-completion-v1',
      status: 'complete',
      solutionId: 'fixture',
      geographyLevel: 'departments',
      catalogSha256: SHA,
      artifactSha256: compactSha256,
      provenance: { releaseId: RELEASE },
    });
    http.expectOne(CATALOG_URL).flush(catalogText);
    http.expectOne(COMPACT_URL).flush(compactText);

    expect(await resultPromise).toEqual([
      expect.objectContaining({
        id: 'species-1',
        solution_covered_in_aoi_pct: 40,
      }),
    ]);
  });

  it('fails closed when an artifact checksum is tampered', async () => {
    const catalogText = JSON.stringify(catalog());
    const compactText = JSON.stringify(compact());
    const resultPromise = firstValueFrom(service.load('fixture', 'departments', '05'));

    http.expectOne(`${CATALOG_URL}.complete.json`).flush({
      format: 'species-goals-catalog-completion-v1',
      status: 'complete',
      releaseId: RELEASE,
      catalogSha256: SHA,
      artifactSha256: 'b'.repeat(64),
    });
    http.expectOne(`${COMPACT_URL}.complete.json`).flush({
      format: 'species-goals-completion-v1',
      status: 'complete',
      solutionId: 'fixture',
      geographyLevel: 'departments',
      catalogSha256: SHA,
      artifactSha256: 'c'.repeat(64),
      provenance: { releaseId: RELEASE },
    });
    http.expectOne(CATALOG_URL).flush(catalogText);
    http.expectOne(COMPACT_URL).flush(compactText);

    expect(await resultPromise).toBeNull();
  });

  it('rejects stale completion metadata before downloading large artifacts', async () => {
    const resultPromise = firstValueFrom(service.load('fixture', 'departments', '05'));
    http.expectOne(`${CATALOG_URL}.complete.json`).flush({
      format: 'species-goals-catalog-completion-v1',
      status: 'complete',
      releaseId: 'stale-release',
      catalogSha256: SHA,
      artifactSha256: SHA,
    });
    http.expectOne(`${COMPACT_URL}.complete.json`).flush({
      format: 'species-goals-completion-v1',
      status: 'complete',
      solutionId: 'fixture',
      geographyLevel: 'departments',
      catalogSha256: SHA,
      artifactSha256: SHA,
      provenance: { releaseId: 'stale-release' },
    });

    expect(await resultPromise).toBeNull();
    http.expectNone(CATALOG_URL);
    http.expectNone(COMPACT_URL);
  });

  it('loads and caches the release overlay, overriding legacy sidecar targets', async () => {
    targetOverlayUrl = OVERLAY_URL;
    const catalogText = JSON.stringify(catalog());
    const compactText = JSON.stringify(compact());
    const overlayText = await targetOverlayText();
    const catalogSha256 = await sha256(catalogText);
    const compactSha256 = await sha256(compactText);
    const resultPromise = firstValueFrom(service.load('fixture', 'departments', '05'));

    flushCompletions(catalogSha256, compactSha256);
    http.expectOne(CATALOG_URL).flush(catalogText);
    http.expectOne(COMPACT_URL).flush(compactText);
    http.expectOne(OVERLAY_URL).flush(overlayText);

    expect(await resultPromise).toEqual([
      expect.objectContaining({
        configured_target_percent: 0,
        configured_target_met: true,
        solution_covered_in_aoi_area_km2: 0.8,
      }),
    ]);

    const cachedPromise = firstValueFrom(service.load('fixture', 'departments', '05'));
    flushCompletions(catalogSha256, compactSha256);
    http.expectOne(CATALOG_URL).flush(catalogText);
    http.expectOne(COMPACT_URL).flush(compactText);
    http.expectNone(OVERLAY_URL);
    expect((await cachedPromise)?.[0].configured_target_percent).toBe(0);
  });

  it('hydrates all 8,300 national rows with 8,001 configured targets', async () => {
    targetOverlayUrl = OVERLAY_URL;
    const catalogText = JSON.stringify(largeCatalog());
    const compactText = JSON.stringify(nationalCompact());
    const overlayText = await targetOverlayText(8_001);
    const catalogSha256 = await sha256(catalogText);
    const compactSha256 = await sha256(compactText);
    const resultPromise = firstValueFrom(service.load('fixture', 'national', 'colombia'));

    http.expectOne(`${CATALOG_URL}.complete.json`).flush({
      format: 'species-goals-catalog-completion-v1',
      status: 'complete',
      releaseId: RELEASE,
      catalogSha256: SHA,
      artifactSha256: catalogSha256,
    });
    http.expectOne(`${NATIONAL_URL}.complete.json`).flush({
      format: 'species-goals-completion-v1',
      status: 'complete',
      solutionId: 'fixture',
      geographyLevel: 'national',
      catalogSha256: SHA,
      artifactSha256: compactSha256,
      provenance: { releaseId: RELEASE },
    });
    http.expectOne(CATALOG_URL).flush(catalogText);
    http.expectOne(NATIONAL_URL).flush(compactText);
    http.expectOne(OVERLAY_URL).flush(overlayText);

    const result = await resultPromise;
    expect(result).toHaveLength(8_300);
    expect(result?.filter((row) => row.configured_target_percent !== null)).toHaveLength(8_001);
  });

  function flushCompletions(catalogSha256: string, compactSha256: string): void {
    http.expectOne(`${CATALOG_URL}.complete.json`).flush({
      format: 'species-goals-catalog-completion-v1',
      status: 'complete',
      releaseId: RELEASE,
      catalogSha256: SHA,
      artifactSha256: catalogSha256,
    });
    http.expectOne(`${COMPACT_URL}.complete.json`).flush({
      format: 'species-goals-completion-v1',
      status: 'complete',
      solutionId: 'fixture',
      geographyLevel: 'departments',
      catalogSha256: SHA,
      artifactSha256: compactSha256,
      provenance: { releaseId: RELEASE },
    });
  }
});

function catalog(): SpeciesGoalsCatalog {
  return {
    format: 'species-goals-catalog-v1',
    generatedAt: '2026-08-08T00:00:00Z',
    catalogSha256: SHA,
    provenance: {
      releaseId: RELEASE,
      speciesCsvSha256: SHA,
      exceptionSourceSha256: null,
      exceptionPolicySha256: null,
      exceptionBindingSha256: null,
      inventory: { catalogTotal: 1, unavailable: 0, zeroRange: 0 },
    },
    rowLayout: [
      'speciesId',
      'scientificName',
      'group',
      'iucnStatus',
      'nationalRangeKm2',
      'availability',
    ],
    rows: [['species-1', 'Species one', 'birds', 'LC', 10, 'available']],
  };
}

function compact(): SpeciesGoalsCompactDocument {
  return {
    format: 'species-goals-compact-v1',
    generatedAt: '2026-08-08T00:00:00Z',
    solutionId: 'fixture',
    catalogSha256: SHA,
    geographyLevel: 'departments',
    encoding: 'sparse-no-range-omitted',
    provenance: {
      releaseId: RELEASE,
      speciesCsvSha256: SHA,
      exceptionSourceSha256: null,
      exceptionPolicySha256: null,
      exceptionBindingSha256: null,
      exactOverlapAlgorithmVersion: 'fixture-exact-v1',
      exactOverlapPolicySha256: SHA,
      targetGridSha256: SHA,
      speciesAlignmentInventorySha256: SHA,
      solutionRasterSha256: SHA,
      targetPolicySha256: SHA,
      boundaryProvenanceSha256: SHA,
      catalogSha256: SHA,
    },
    scopeCatalog: [['05', 'Antioquia']],
    rowLayout: [
      'scopeIndex',
      'speciesIndex',
      'rangeAreaKm2',
      'solutionCoveredAreaKm2',
      'preExistingCoveredAreaKm2',
      'newPrioritizrCoveredAreaKm2',
      'configuredTargetPercent',
      'flags',
    ],
    rows: [[0, 0, 2, 0.8, 0.3, 0.5, 30, 60]],
    completion: {
      format: 'species-goals-completion-v1',
      status: 'complete',
      rowCount: 1,
      payloadSha256: SHA,
    },
  };
}

function largeCatalog(): SpeciesGoalsCatalog {
  const result = catalog();
  result.provenance.inventory.catalogTotal = 8_300;
  result.rows = Array.from(
    { length: 8_300 },
    (_, index) =>
      [
        `species-${index}`,
        `Species ${index}`,
        'birds',
        'LC',
        10,
        'available',
      ] as SpeciesGoalsCatalog['rows'][number],
  );
  return result;
}

function nationalCompact(): SpeciesGoalsCompactDocument {
  const result = compact();
  result.geographyLevel = 'national';
  result.encoding = 'dense';
  result.scopeCatalog = [['colombia', 'Colombia']];
  result.rows = Array.from(
    { length: 8_300 },
    (_, index) =>
      [0, index, 10, 10, 0, 10, null, 24] as SpeciesGoalsCompactDocument['rows'][number],
  );
  result.completion.rowCount = result.rows.length;
  return result;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function targetOverlayText(targetCount = 1): Promise<string> {
  const rows = Array.from({ length: targetCount }, (_, index) => [index, index === 0 ? 0 : 17]);
  const unavailableRows: never[] = [];
  const targetMap = {
    canonicalSha256: await sha256(canonicalJson({ rows, unavailableRows })),
    sourceTargetCount: targetCount,
    applicableTargetCount: targetCount,
    unavailableTargetCount: 0,
    rows,
    unavailableRows,
  };
  const solutions = Object.fromEntries([
    ['fixture', 'map-1'],
    ...Array.from({ length: 167 }, (_, index) => [`solution-${index}`, null]),
  ]);
  const body = {
    format: 'species-target-overlays-v1',
    releaseId: RELEASE,
    catalogSha256: SHA,
    rowLayout: ['speciesIndex', 'targetPercent'],
    provenance: {},
    inventory: {},
    targetMaps: { 'map-1': targetMap },
    solutions,
    legacyEmbeddedTargetRepairEvidence: null,
  };
  return JSON.stringify({
    ...body,
    completion: {
      format: 'species-target-overlays-completion-v1',
      status: 'complete',
      payloadSha256: await sha256(canonicalJson(body)),
    },
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
