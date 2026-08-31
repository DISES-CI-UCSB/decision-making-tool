import type {
  RuntimeCatalogReleaseIndex,
  RuntimeLayerManifest,
  RuntimeSirapManifest,
  RuntimeSolutionManifestEntry,
} from '@core/models/layer-manifest.model';
import {
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
});
