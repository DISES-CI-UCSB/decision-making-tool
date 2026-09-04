import type { CustomPolygonMetricsGeometry } from './metric-value.model';

export type CustomAoiProfileSection = 'species' | 'ecosystems';
export type CustomAoiProfileSectionStatus =
  | 'complete'
  | 'empty'
  | 'zero_cells'
  | 'unavailable'
  | 'failed';

export interface CustomAoiAreaProfileRequest {
  geometry: CustomPolygonMetricsGeometry;
  sections: [CustomAoiProfileSection];
  artifact_version?: string;
  solution_id?: string;
}

export interface CustomAoiProfileSelection {
  status: 'selected' | 'zero_cells' | 'unavailable';
  selected_cell_count: number | null;
  available_cell_count: number | null;
  area_km2: number | null;
  source: string;
  crs?: string | null;
}

export interface CustomAoiSpeciesRecord {
  id: string;
  scientific_name: string;
  group: string;
  iucn_status: string | null;
}

export interface CustomAoiEcosystemRecord {
  id: string;
  label: string;
  area_km2: number;
  national_area_km2: number;
  /** Present for SIRAP-scoped responses; the regional artifact is the denominator. */
  sirap_area_km2?: number | null;
  /** Retained for composition summaries that intentionally exclude unclassified AOI land. */
  share_of_classified_pct: number | null;
  /** Optional only for compatibility with older v1 responses; consumers must not substitute classified share. */
  share_of_total_aoi_pct?: number | null;
  share_of_national_class_pct: number | null;
  /** Present for SIRAP-scoped responses; never infer this from a national percentage. */
  share_of_sirap_class_pct?: number | null;
  solution_covered_area_km2: number | null;
  solution_covered_pct_of_aoi: number | null;
  pre_existing_covered_area_km2: number | null;
  pre_existing_covered_pct_of_aoi: number | null;
  new_covered_area_km2: number | null;
  new_covered_pct_of_aoi: number | null;
}

/**
 * Mesa-compatible coverage values arrive as approximately 1 km² raster-cell counts.
 * UI consumers display their equivalent km² areas; ratio fields are decimal fractions (0–1).
 */
export interface MesaAoiCoverageRecord {
  feature: string;
  /** Approximately 1 km² ecosystem cells inside the AOI. */
  total_in_aoi: number;
  /** Approximately 1 km² ecosystem cells across the national aligned raster. */
  national_total: number;
  /** All valid, classified ecosystem cells inside the AOI. */
  classified_total_in_aoi: number;
  /** total_in_aoi / national_total. */
  share_of_national_total: number | null;
  /** total_in_aoi / classified_total_in_aoi. */
  share_of_classified_aoi: number | null;
  held_in_aoi: number;
  coverage_within_aoi: number | null;
  pre_existing_held_in_aoi: number;
  pre_existing_coverage_within_aoi: number | null;
  new_prioritizr_held_in_aoi: number;
  new_prioritizr_coverage_within_aoi: number | null;
  contribution_to_national_coverage: number | null;
  pre_existing_contribution_to_national_coverage: number | null;
  new_prioritizr_contribution_to_national_coverage: number | null;
  contribution_to_national_target: number | null;
}

export type CustomAoiEcosystemView =
  | 'biomeFamily'
  | 'broadBiomeContext'
  | 'biomeRegion'
  | 'broadEcosystem'
  | 'detailedEcosystem';

export interface CustomAoiSpeciesSection {
  status: CustomAoiProfileSectionStatus;
  records: CustomAoiSpeciesRecord[];
  reason?: string | null;
}

export interface CustomAoiEcosystemsSection {
  status: CustomAoiProfileSectionStatus;
  canonical_summary_view: 'broadEcosystem';
  /** Identifies whether the returned class denominator is national or SIRAP-scoped. */
  reference_scope?: 'national' | 'sirap';
  classified_area_km2: number;
  views: {
    id: CustomAoiEcosystemView;
    label: string;
    records: CustomAoiEcosystemRecord[];
  }[];
  /** Optional only for compatibility with responses produced before Mesa/V3 remediation. */
  solution_coverage?: MesaAoiCoverageRecord[];
  reason?: string | null;
}

export interface CustomAoiAreaProfileResponse {
  format: 'custom-aoi-area-profile-v1';
  status: string;
  selection: CustomAoiProfileSelection;
  sections: {
    species?: CustomAoiSpeciesSection;
    ecosystems?: CustomAoiEcosystemsSection;
  };
  solution_id?: string | null;
  solution_raster_checksum?: string | null;
}

export interface DetailedSpeciesCoverageRequest {
  geometry: CustomPolygonMetricsGeometry;
  solution_id: string;
  artifact_version?: string;
}

export interface DetailedSpeciesCoverageRecord extends CustomAoiSpeciesRecord {
  range_area_km2: number;
  range_in_aoi_area_km2: number;
  range_in_aoi_pct: number;
  solution_covered_in_aoi_area_km2: number;
  solution_covered_in_aoi_pct: number;
  pre_existing_covered_in_aoi_area_km2: number;
  pre_existing_covered_in_aoi_pct: number;
  new_covered_in_aoi_area_km2: number;
  new_covered_in_aoi_pct: number;
  /** Mesa planning-cell count within the AOI; optional for legacy precomputed sidecars. */
  total_in_aoi?: number | null;
  /** Mesa planning-cell count held by the active solution; optional for legacy sidecars. */
  held_in_aoi?: number | null;
  /** Decimal fraction of AOI cells for this feature held by the active solution. */
  coverage_within_aoi?: number | null;
  /** Decimal fraction of the feature's national total contributed by this AOI and solution. */
  contribution_to_national_coverage?: number | null;
  /** Decimal fraction of the national target contributed by this AOI and solution. */
  contribution_to_national_target?: number | null;
}

export interface DetailedSpeciesCoverageResult {
  artifact_version: string;
  solution_id: string;
  solution_raster_checksum: string;
  records: DetailedSpeciesCoverageRecord[];
}

export interface DetailedSpeciesJobResponse {
  job_id: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  queue_position: number | null;
  estimated_wait_seconds: number | null;
  compute_ms: number | null;
  result: DetailedSpeciesCoverageResult | null;
  error_code: string | null;
  coalesced: boolean;
}
