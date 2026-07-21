import type {
  ManifestSidebarLayerGroup,
  ManifestSidebarLayerRow,
  RuntimeLayerManifestRenderingConfig,
} from '@core/models';
import {
  OMEC_OVERLAY_LAYER_ID,
  RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
  RUNAP_OVERLAY_LAYER_ID,
} from '@features/map/services/manifest-raster-layer.service';
import {
  BASELINE_SOLUTION_OVERLAY_ID,
  CANDIDATE_SOLUTION_OVERLAY_ID,
  OVERLAP_SOLUTION_OVERLAY_ID,
} from './map-layers-panel.config';
import {
  reconcileMapLayersManifest,
  type LayerControlRow,
  type LayerGroup,
  type ManifestReconcilePorts,
} from './map-layers-panel-manifest-reconcile';

const gradientRendering: RuntimeLayerManifestRenderingConfig = {
  valueType: 'continuous',
  renderMode: 'gradient',
  minValue: 0,
  maxValue: 1,
  startColor: '#eeeeee',
  endColor: '#123456',
};

const ports: ManifestReconcilePorts = {
  manifestRowName: (row) => `localized ${row.id}`,
  manifestGroupTitle: (group) => `localized ${group.sidebarCategoryId}`,
  manifestCategoryTitle: () => undefined,
  normalizeManifestRendering: (row) => row.rendering,
  layerCountLabel: (count) => `${count} layers`,
  individualSpeciesName: () => 'Individual species',
  speciesRichnessTaxonName: (definition) => definition.englishLabel,
  strategicEcosystemGroupName: () => 'Strategic ecosystems',
  ecosystemGroupNote: () => 'Ecosystem note',
  managementFiguresTitle: () => 'Management figures',
};

function row(overrides: Partial<LayerControlRow> & Pick<LayerControlRow, 'id'>): LayerControlRow {
  return {
    name: overrides.id,
    selected: false,
    visible: false,
    expanded: false,
    opacity: 80,
    color: '#64748b',
    canReorder: true,
    hasStyleControls: true,
    hasColorControl: true,
    ...overrides,
  };
}

function group(id: string, rows: LayerControlRow[]): LayerGroup {
  return { id, title: id, collapsed: true, rows };
}

function manifestRow(
  id: string,
  sidebarCategoryId: string,
  overrides: Partial<ManifestSidebarLayerRow> = {},
): ManifestSidebarLayerRow {
  return {
    id,
    name: id,
    spanishLabel: id,
    englishLabel: id,
    description: '',
    tooltip: null,
    sidebarCategoryId,
    sidebarSubcategoryId: null,
    dataRole: 'feature_layer',
    roleInMetricCalculation: 'none',
    displayUrl: `/${id}.tif`,
    displayCollectionUrl: null,
    speciesManifestUrl: null,
    metadataUrl: `/${id}.json`,
    rendering: gradientRendering,
    hasDisplayAsset: true,
    isSpeciesCollection: false,
    ...overrides,
  };
}

function manifestGroup(
  sidebarCategoryId: string,
  rows: ManifestSidebarLayerRow[],
): ManifestSidebarLayerGroup {
  return {
    sidebarCategoryId,
    title: `${sidebarCategoryId} title`,
    spanishLabel: sidebarCategoryId,
    englishLabel: sidebarCategoryId,
    rows,
  };
}

describe('reconcileMapLayersManifest', () => {
  it('reconciles a registry-bound generic group and preserves row interaction state', () => {
    const existing = row({
      id: 'layer-indigenous_reserves',
      selected: true,
      visible: true,
      expanded: true,
      opacity: 35,
      color: '#old-color',
    });

    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('cultural_and_ethnic_territories', [
          manifestRow('indigenous_reserves', 'cultural_and_ethnic_territories'),
        ]),
      ],
      groups: [group('group-cultural-ethnic', [existing])],
      overlays: [],
      ports,
    });

    expect(result.groups[0]).toMatchObject({
      title: 'localized cultural_and_ethnic_territories',
      countLabel: '1 layers',
    });
    expect(result.groups[0].rows[0]).toMatchObject({
      id: existing.id,
      name: 'localized indigenous_reserves',
      selected: true,
      visible: true,
      expanded: true,
      opacity: 35,
      color: '#123456',
      mapUnavailable: false,
    });
  });

  it('maps management overlays while preserving comparison and fallback rows', () => {
    const overlays = [
      row({ id: BASELINE_SOLUTION_OVERLAY_ID }),
      row({ id: CANDIDATE_SOLUTION_OVERLAY_ID }),
      row({ id: OVERLAP_SOLUTION_OVERLAY_ID }),
      row({ id: RUNAP_OVERLAY_LAYER_ID }),
      row({ id: RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID }),
      row({ id: OMEC_OVERLAY_LAYER_ID }),
    ];

    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('management_figures', [
          manifestRow('runap', 'management_figures', {
            rendering: { ...gradientRendering, renderMode: 'mask', valueType: 'binary' },
          }),
          manifestRow('omecs', 'management_figures', { name: 'OMECs (raster)' }),
        ]),
      ],
      groups: [],
      overlays,
      ports,
    });

    expect(result.overlays.map((overlay) => overlay.id)).toEqual([
      BASELINE_SOLUTION_OVERLAY_ID,
      CANDIDATE_SOLUTION_OVERLAY_ID,
      OVERLAP_SOLUTION_OVERLAY_ID,
      RUNAP_OVERLAY_LAYER_ID,
      RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
      OMEC_OVERLAY_LAYER_ID,
    ]);
    expect(result.overlays.at(-1)).toMatchObject({
      name: 'OMECs',
      mapUnavailable: false,
      mapSync: { type: 'manifest-raster', layerId: OMEC_OVERLAY_LAYER_ID },
    });
    expect(result.managementFiguresTitle).toBe('Management figures');
  });

  it('maps admin rows by boundary key and preserves an omitted country outline', () => {
    const country = row({
      id: 'boundary-country',
      mapSync: {
        type: 'admin-boundary',
        boundaryType: 'department',
        boundaryLayerKey: 'admin_country_outline',
      },
    });
    const departments = row({
      id: 'boundary-departments',
      color: '#old-color',
      mapSync: {
        type: 'admin-boundary',
        boundaryType: 'department',
        boundaryLayerKey: 'admin_departments',
      },
    });

    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('administrative_boundaries', [
          manifestRow('admin_departments', 'administrative_boundaries'),
        ]),
      ],
      groups: [group('group-admin-boundaries', [country, departments])],
      overlays: [],
      ports,
    });

    expect(result.groups[0].rows).toEqual([
      country,
      expect.objectContaining({
        id: departments.id,
        name: 'localized admin_departments',
        color: '#123456',
      }),
    ]);
  });

  it('keeps selected state but hides a row when its manifest asset is unavailable', () => {
    const existing = row({
      id: 'layer-human_footprint_2022',
      selected: true,
      visible: true,
      opacity: 42,
    });

    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('socioeconomic', [
          manifestRow('human_footprint_2022', 'socioeconomic', { displayUrl: null }),
        ]),
      ],
      groups: [group('group-socio-economic', [existing])],
      overlays: [],
      ports,
    });

    expect(result.groups[0].rows[0]).toMatchObject({
      selected: true,
      visible: false,
      opacity: 42,
      mapUnavailable: true,
      mapSync: undefined,
    });
  });
});
