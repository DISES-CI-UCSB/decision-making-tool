import type {
  RuntimeLayerManifestColorDefaults,
  RuntimeLayerManifestRenderingConfig,
} from './layer-manifest.model';

export const MANIFEST_STYLE_REQUESTS_COLLECTION = 'manifestStyleRequests';

export type ManifestStyleRequestStatus = 'pending' | 'published' | 'rejected';

export interface ManifestStyleRequestDiffSummary {
  changedLayerCount: number;
  changedLayers: { layerId: string; changedFields: string[] }[];
  changedDefaultCount: number;
  changedDefaults: {
    scopeType: 'category' | 'subcategory';
    scopeId: string;
    changedFields: string[];
  }[];
  changedOverrideCount: number;
  changedOverrideLayers: string[];
}

export interface ManifestStyleRequestCategoryDefaultsChange {
  categoryId: string;
  styleDefaults: RuntimeLayerManifestColorDefaults;
}

export interface ManifestStyleRequestSubcategoryDefaultsChange {
  categoryId: string;
  subcategoryId: string;
  styleDefaults: RuntimeLayerManifestColorDefaults;
}

export interface ManifestStyleRequestLayerStyleChange {
  layerId: string;
  rendering: RuntimeLayerManifestRenderingConfig;
  styleOverride: boolean | null;
}

export interface ManifestStyleRequestChanges {
  categoryDefaults: ManifestStyleRequestCategoryDefaultsChange[];
  subcategoryDefaults: ManifestStyleRequestSubcategoryDefaultsChange[];
  layerStyles: ManifestStyleRequestLayerStyleChange[];
}

export interface ManifestStyleRequestDraft {
  editorName: string;
  sourceManifestUrl: string;
  baseManifestVersion: string | null;
  baseManifestGeneratedAt: string | null;
  diffSummary: ManifestStyleRequestDiffSummary;
  styleChanges: ManifestStyleRequestChanges;
  status: ManifestStyleRequestStatus;
}

export interface ManifestStyleRequestAuthor {
  createdByUid: string;
  createdByEmail: string;
  createdByDisplayName: string | null;
}
