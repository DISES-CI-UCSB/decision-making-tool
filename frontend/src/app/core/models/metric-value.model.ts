export type MetricReadinessStatus =
  | 'ready'
  | 'partial'
  | 'derivation_needed'
  | 'blocked'
  | 'pending'
  | 'not_applicable'
  | 'empty';

export type MetricValueFormatHint = 'number' | 'percent' | 'currency' | 'ratio' | 'index';

export type CustomPolygonMetricId = string;

export interface GeoJsonPolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoJsonMultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

export type CustomPolygonMetricsGeometry = GeoJsonPolygonGeometry | GeoJsonMultiPolygonGeometry;

export interface CustomPolygonMetricsRequest {
  geometry: CustomPolygonMetricsGeometry;
  metrics?: CustomPolygonMetricId[];
  artifact_version?: string;
  solution_id?: string;
}

export interface CustomPolygonMetricsArtifactState {
  required: boolean;
  available: boolean;
  manifest_path: string;
  schema_version: string | null;
  artifact_version: string | null;
  checksum: string | null;
  message: string;
  warmup_status: string;
  warmup_ms: number | null;
  loaded_at: string | null;
  metadata: Record<string, unknown>;
}

export interface CustomPolygonMetricsResponse {
  status: 'ok' | 'artifact_required' | 'invalid_request' | 'not_implemented';
  message: string;
  artifact_state: CustomPolygonMetricsArtifactState;
  requested_metrics: CustomPolygonMetricId[] | null;
  metrics: Partial<Record<CustomPolygonMetricId, number | null>> | null;
  metadata: Record<string, unknown>;
}

export interface MetricValue {
  metricId: string;
  /**
   * Nullability convention:
   * - `ready` and ordinary `partial` => value should be a number
   * - dual-reference target `partial` => value is null and thresholdOutcomes are finite
   * - `derivation_needed|blocked|pending|not_applicable|empty` => value should be null
   */
  value: number | null;
  unit: string | null;
  status: MetricReadinessStatus;
  source: string;
  notes: string | null;
  labelKey: string;
  formatHint: MetricValueFormatHint;
  details?: MetricValueDetails;
}

export interface SpeciesThresholdOutcome {
  targetPercent: 17 | 30;
  value: number;
  details?: Record<string, unknown>;
}

export interface MetricValueDetails extends Record<string, unknown> {
  thresholdOutcomes?: [SpeciesThresholdOutcome, SpeciesThresholdOutcome];
}

export interface GeographyScopeState {
  format: 'solution-raster-scope-state-v1';
  classification: 'supported' | 'empty';
  reason: 'positive_solution_valid_support' | 'zero_solution_valid_support';
  solutionValidCellCount: number;
  selectedCellCount: number;
  boundaryGridCellCount: number;
  targetGridSha256: string;
  solutionRasterSha256: string;
  solutionValidityMaskSha256: string;
  boundary: {
    geographyLevel: string;
    scopeId: string;
    sourceSha256: string;
    geometrySha256: string;
  } | null;
  rasterizationPolicy: {
    boundaryInclusion: 'none' | 'pixel-center';
    allTouched: false;
    referenceGrid: 'solution raster grid';
  };
}

export type SpeciesTargetPolicyKind = 'scalar' | 'per_species' | 'dual_reference';

export interface SpeciesTargetMatchingInventory {
  normalization: 'manifest-target-feature-id-v1';
  catalogSpeciesCount: number;
  availableSpeciesCount: number;
  matchedTargetCount: number;
  availableMatchedTargetCount: number;
  excludedMatchedTargetCount: number;
}

export interface SpeciesTargetPolicyProvenance {
  format: 'species-target-policy-v1';
  kind: Exclude<SpeciesTargetPolicyKind, 'scalar'>;
  source: 'manifest:finderInputs.structuredTargets';
  structuredTargetDimension: 'espRn' | null;
  structuredTargetCount: number;
  structuredTargetsSha256: string;
  matchingInventory?: SpeciesTargetMatchingInventory;
  decisionSource?: 'approved:dual-reference-species-thresholds-v1';
  referenceThresholds?: [17, 30];
  referenceThresholdsSha256?: string;
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
  scopeState?: GeographyScopeState;
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
  sirap?: Record<string, GeographyMetricsScope>;
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
  /** Explicit primary scope for regional packet artifacts; otherwise Colombia. */
  primaryGeography?: {
    level: GeographyLevel | 'sirap';
    scopeId: string;
  };
  metricsProvenance?: {
    speciesTargetPolicy?: SpeciesTargetPolicyProvenance;
    [key: string]: unknown;
  };
  geographies: CachedSolutionMetricsGeographies;
}

export type CompactMetricsFormat = 'metrics-compact-v1';
export type CompactMetricCatalogEntry = [
  metricId: string,
  unit: string | null,
  labelKey: string,
  formatHint: MetricValueFormatHint,
];
export type CompactMetricRow = [
  metricIndex: number,
  value: number | null,
  statusIndex: number,
  sourceIndex: number,
  notesIndex: number,
  details?: Record<string, unknown>,
];

export interface CompactGeographyMetricsScope {
  name?: string;
  kind?: string;
  subtype?: string;
  scopeState?: GeographyScopeState;
  metrics: CompactMetricRow[];
}

export interface CompactSolutionMetricsDocument {
  format: CompactMetricsFormat;
  solutionId: string;
  generatedAt: string;
  primaryGeography?: CachedSolutionMetricsDocument['primaryGeography'];
  metricCatalog: CompactMetricCatalogEntry[];
  statusCatalog: MetricReadinessStatus[];
  sourceCatalog: string[];
  notesCatalog: (string | null)[];
  metricsProvenance?: CachedSolutionMetricsDocument['metricsProvenance'];
  geographies: Record<string, Record<string, CompactGeographyMetricsScope> | undefined>;
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
