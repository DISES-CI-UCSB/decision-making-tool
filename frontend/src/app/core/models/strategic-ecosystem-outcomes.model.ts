export type StrategicEcosystemFeatureId = 'paramos' | 'wetlands' | 'bosque_seco' | 'mangroves';

export interface StrategicEcosystemDenominator {
  metricId: string;
  sourcePath: string;
  sourceSha256: string;
  alignedSha256: string;
  alignmentPolicySha256: string;
  totalAlignedFeatureValue1Cells: number;
  totalAlignedFeatureValue1AreaKm2: number;
}

export interface StrategicEcosystemOutcome {
  coveredAreaKm2: number;
  coverageFraction: number;
  coveragePercent: number;
  checkpoints: {
    '17': boolean;
    '30': boolean;
  };
}

export interface StrategicEcosystemOutcomesDocument {
  format: 'strategic-ecosystem-outcomes-v1';
  releaseId: string;
  generatedAt: string;
  measurementMethod: 'post-hoc-raster-derived';
  areaUnit: 'km2';
  checkpointsPercent: [17, 30];
  denominatorSpecSha256: string;
  sourceMetricsReportSha256: string;
  alignedGrid: {
    crs: 'EPSG:9377';
    width: 1353;
    height: 1838;
    pixelSizeMeters: 1000;
    resampling: 'nearest';
    targetGridSha256: string;
  };
  featurePresenceValue: 1;
  solutionSelectedValues: [1, 2];
  features: Record<StrategicEcosystemFeatureId, StrategicEcosystemDenominator>;
  solutions: Record<
    string,
    {
      features: Record<StrategicEcosystemFeatureId, StrategicEcosystemOutcome>;
    }
  >;
}
