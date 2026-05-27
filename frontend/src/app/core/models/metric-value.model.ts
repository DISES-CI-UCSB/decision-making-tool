export type MetricReadinessStatus =
  | 'ready'
  | 'derivation_needed'
  | 'blocked'
  | 'pending'
  | 'not_applicable'
  | 'empty';

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

/** One administrative scope (national Colombia, a department, municipality, SIRAP, …). */
export interface GeographyMetricsScope {
  name?: string;
  /** Legacy SIRAP discriminator (territorial vs thematic). */
  kind?: string;
  /**
   * Secondary descriptor surfaced as the AOI panel kicker — e.g. RUNAP
   * management category ("Parque Nacional Natural") or OMEC designation
   * ("Area Marina Protegida"). Set by the metrics pipeline from the source
   * GeoJSON properties.
   */
  subtype?: string;
  metrics: MetricValue[];
}

export type GeographyLevel =
  | 'national'
  | 'departments'
  | 'municipalities'
  | 'siraps'
  | 'runaps'
  | 'omecs';

export interface CachedSolutionMetricsGeographies {
  national?: Record<string, GeographyMetricsScope>;
  departments?: Record<string, GeographyMetricsScope>;
  municipalities?: Record<string, GeographyMetricsScope>;
  siraps?: Record<string, GeographyMetricsScope>;
  runaps?: Record<string, GeographyMetricsScope>;
  omecs?: Record<string, GeographyMetricsScope>;
  [level: string]: Record<string, GeographyMetricsScope> | undefined;
}

/**
 * Canonical cached metrics document published to Vercel Blob at
 * `metrics/cache/{solutionId}.metrics.json`.
 */
export interface CachedSolutionMetricsDocument {
  solutionId: string;
  generatedAt: string;
  geographies: CachedSolutionMetricsGeographies;
}

/** @deprecated Mock API only — real solutions use CachedSolutionMetricsDocument. */
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
