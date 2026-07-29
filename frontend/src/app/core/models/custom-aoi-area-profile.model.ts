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
  share_of_classified_pct: number | null;
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
  views: {
    id: CustomAoiEcosystemView;
    label: string;
    records: CustomAoiEcosystemRecord[];
  }[];
}

export interface CustomAoiAreaProfileResponse {
  format: 'custom-aoi-area-profile-v1';
  status: string;
  selection: CustomAoiProfileSelection;
  sections: {
    species?: CustomAoiSpeciesSection;
    ecosystems?: CustomAoiEcosystemsSection;
  };
}
