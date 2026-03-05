export type MetricReadinessStatus = 'ready' | 'derivation_needed' | 'blocked' | 'pending';

export type MetricValueFormatHint = 'number' | 'percent' | 'currency' | 'ratio' | 'index';

export interface MetricValue {
  metricId: string;
  /**
   * Nullability convention:
   * - `ready` => value should be a number
   * - `derivation_needed|blocked|pending` => value should be null
   */
  value: number | null;
  unit: string | null;
  status: MetricReadinessStatus;
  source: string;
  notes: string | null;
  labelKey: string;
  formatHint: MetricValueFormatHint;
}

export interface SolutionMetricsResponse {
  solutionId: string;
  generatedAt: string;
  metrics: MetricValue[];
}

export interface AoiMetricsResponse {
  solutionId: string;
  aoiId: string;
  generatedAt: string;
  metrics: MetricValue[];
}

export interface MetricComparisonValue {
  metricId: string;
  labelKey: string;
  formatHint: MetricValueFormatHint;
  baseline: MetricValue;
  candidate: MetricValue;
  delta: number | null;
}

export interface CompareSolutionsResponse {
  baselineSolutionId: string;
  candidateSolutionId: string;
  generatedAt: string;
  metrics: MetricComparisonValue[];
}

export interface AnalysisMetricSectionFixture {
  sectionId: string;
  sectionLabelKey: string;
  metrics: MetricValue[];
}

export interface AnalysisMetricFixturesResponse {
  solutionId: string;
  generatedAt: string;
  sections: AnalysisMetricSectionFixture[];
}
