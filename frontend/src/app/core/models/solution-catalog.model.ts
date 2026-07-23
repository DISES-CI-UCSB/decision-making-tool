import type {
  RuntimeLayerManifestRenderingConfig,
  RuntimeSolutionManifestFinderInputs,
  RuntimeSolutionManifestInputLayerIds,
} from './layer-manifest.model';

export interface CatalogSolution {
  id: string;
  filename: string;
  name: string;
  description: string;
  domain?: 'land' | 'marine';
  scope: string;
  sirapId: string | null;
  displayUrl: string;
  displayCogUrl?: string | null;
  metadataUrl: string;
  precomputedMetricUrls?: Record<string, string>;
  rendering: RuntimeLayerManifestRenderingConfig;
  finderInputs: RuntimeSolutionManifestFinderInputs;
  inputLayerIds: RuntimeSolutionManifestInputLayerIds;
  ecosystemTargets: number;
  constraints: string[];
  costLayer: string;
  nSelected: number;
  totalCost: number;
  pctTargetsMet: number;
}

export interface RasterMetadata {
  width: number;
  height: number;
  bbox: [number, number, number, number];
  resolution: [number, number];
  crs: string;
  bandCount: number;
  bandDescription: string;
  noDataValue: number | null;
  selectedCount: number;
  totalValidCells: number;
  selectedPct: number;
  countryValidCells: number;
  newCoveragePctOfCountry: number;
}

export interface LoadedSolution {
  solution: CatalogSolution;
  rasterMeta: RasterMetadata;
  rasterData: Float64Array | Float32Array | Uint8Array;
  canvas: HTMLCanvasElement;
  loadTimeMs: number;
}
