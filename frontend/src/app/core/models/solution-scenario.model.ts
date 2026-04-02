export interface SolutionScenario {
  id: string;
  filename: string;
  name: string;
  description: string;
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
}

export interface LoadedSolution {
  scenario: SolutionScenario;
  rasterMeta: RasterMetadata;
  rasterData: Float64Array | Float32Array | Uint8Array;
  canvas: HTMLCanvasElement;
  loadTimeMs: number;
}
