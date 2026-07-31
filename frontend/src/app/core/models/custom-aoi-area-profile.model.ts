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
  share_of_classified_pct: number | null;
  share_of_national_class_pct: number | null;
  solution_covered_area_km2: number | null;
  solution_covered_pct_of_aoi: number | null;
  pre_existing_covered_area_km2: number | null;
  pre_existing_covered_pct_of_aoi: number | null;
  new_covered_area_km2: number | null;
  new_covered_pct_of_aoi: number | null;
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
}

export interface CustomAoiEcosystemsSection {
  status: CustomAoiProfileSectionStatus;
  canonical_summary_view: 'broadEcosystem';
  classified_area_km2: number;
  views: {
    id: CustomAoiEcosystemView;
    label: string;
    records: CustomAoiEcosystemRecord[];
  }[];
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
