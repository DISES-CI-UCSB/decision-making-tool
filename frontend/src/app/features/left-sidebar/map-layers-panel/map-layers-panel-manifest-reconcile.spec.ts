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
  enabledSirapBoundaryLayerKeys,
  MARINE_ECOSYSTEMS_GROUP_ID,
  MARINE_HHM_LAYER_ID,
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
  individualSpeciesName: () => 'Individual species ranges',
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

  it('uses aligned COG display copies for every Batch 1 strategic ecosystem mask', () => {
    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('ecosystems', [
          manifestRow('paramos', 'ecosystems', {
            displayUrl: 'https://example.com/inputs/features/strategic/paramos.tif',
            displayCogUrl: 'https://example.com/releases/view-layers/paramos.epsg9377.cog.tif',
          }),
          manifestRow('wetlands', 'ecosystems', {
            displayUrl: 'https://example.com/inputs/features/strategic/humedales.tif',
            displayCogUrl: 'https://example.com/releases/view-layers/humedales.epsg9377.cog.tif',
          }),
          manifestRow('bosque_seco', 'ecosystems', {
            displayUrl: 'https://example.com/inputs/features/strategic/bosque_seco.tif',
            displayCogUrl: 'https://example.com/releases/view-layers/bosque_seco.epsg9377.cog.tif',
          }),
          manifestRow('mangroves', 'ecosystems', {
            displayUrl: 'https://example.com/inputs/features/strategic/mangroves.tif',
            displayCogUrl: 'https://example.com/releases/view-layers/mangroves.epsg9377.cog.tif',
          }),
        ]),
      ],
      groups: [group('group-ecosystems', [])],
      overlays: [],
      ports,
    });

    expect(result.groups[0].rows.map((row) => row.mapSync)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layerId: 'layer-paramos',
          displayUrl: expect.stringMatching(/view-layers\/paramos\.epsg9377\.cog\.tif$/),
        }),
        expect.objectContaining({
          layerId: 'layer-wetlands',
          displayUrl: expect.stringMatching(/view-layers\/humedales\.epsg9377\.cog\.tif$/),
        }),
        expect.objectContaining({
          layerId: 'layer-bosque_seco',
          displayUrl: expect.stringMatching(/view-layers\/bosque_seco\.epsg9377\.cog\.tif$/),
        }),
        expect.objectContaining({
          layerId: 'layer-mangroves',
          displayUrl: expect.stringMatching(/view-layers\/mangroves\.epsg9377\.cog\.tif$/),
        }),
      ]),
    );
  });

  it('uses aligned COG display copies for both Batch 2 inclusion-area masks', () => {
    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('cultural_and_ethnic_territories', [
          manifestRow('comunidades', 'cultural_and_ethnic_territories', {
            displayUrl: 'https://example.com/inputs/includes/comunidades.tif',
            displayCogUrl: 'https://example.com/releases/view-layers/comunidades.epsg9377.cog.tif',
            rendering: { ...gradientRendering, renderMode: 'mask', valueType: 'binary' },
          }),
          manifestRow('resguardos', 'cultural_and_ethnic_territories', {
            displayUrl: 'https://example.com/inputs/includes/resguardos.tif',
            displayCogUrl: 'https://example.com/releases/view-layers/resguardos.epsg9377.cog.tif',
            rendering: { ...gradientRendering, renderMode: 'mask', valueType: 'binary' },
          }),
        ]),
      ],
      groups: [group('group-cultural-ethnic', [])],
      overlays: [],
      ports,
    });

    expect(result.groups[0].rows.map((row) => row.mapSync)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layerId: 'layer-comunidades',
          displayUrl: expect.stringMatching(/view-layers\/comunidades\.epsg9377\.cog\.tif$/),
        }),
        expect.objectContaining({
          layerId: 'layer-resguardos',
          displayUrl: expect.stringMatching(/view-layers\/resguardos\.epsg9377\.cog\.tif$/),
        }),
      ]),
    );
  });

  it('routes Batch 4 richness parent and taxon rows to aligned gradient COGs', () => {
    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('species_and_biodiversity', [
          manifestRow('species_richness', 'species_and_biodiversity', {
            displayUrl: 'https://example.com/inputs/features/species_richness/riqueza_especies.tif',
            displayCogUrl:
              'https://example.com/releases/view-layers/riqueza_especies.epsg9377.cog.tif',
            rendering: {
              ...gradientRendering,
              minValue: 815,
              maxValue: 3562,
              startColor: '#fef3c7',
              endColor: '#854d0e',
            },
          }),
          ...['mammals', 'birds', 'amphibians', 'reptiles', 'plants'].map((taxonId) =>
            manifestRow(`species_richness_${taxonId}`, 'species_and_biodiversity', {
              displayUrl: `https://example.com/inputs/features/species_richness/riqueza_especies_${taxonId}.tif`,
              displayCogUrl: `https://example.com/releases/view-layers/riqueza_especies_${taxonId}.epsg9377.cog.tif`,
            }),
          ),
        ]),
      ],
      groups: [group('group-species-biodiversity', [])],
      overlays: [],
      ports,
    });

    expect(result.groups[0].rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'layer-species_richness',
          mapSync: expect.objectContaining({
            displayUrl: expect.stringMatching(/view-layers\/riqueza_especies\.epsg9377\.cog\.tif$/),
          }),
        }),
        ...['mammals', 'birds', 'amphibians', 'reptiles', 'plants'].map((taxonId) =>
          expect.objectContaining({
            id: `layer-species_richness_${taxonId}`,
            mapSync: expect.objectContaining({
              displayUrl: expect.stringMatching(
                new RegExp(`view-layers/riqueza_especies_${taxonId}\\.epsg9377\\.cog\\.tif$`),
              ),
              rendering: expect.objectContaining({ renderMode: 'gradient' }),
            }),
          }),
        ),
      ]),
    );
  });

  it('binds display-only GeoJSON references to existing sidebar categories', () => {
    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('cultural_and_ethnic_territories', [
          manifestRow('zonas_reserva_campesina_constituida', 'cultural_and_ethnic_territories', {
            dataRole: 'reference_layer',
            displayUrl: '/inputs/reference/zonas_reserva_campesina_constituida/layer.geojson',
          }),
        ]),
        manifestGroup('ecosystems', [
          manifestRow('ramsar', 'ecosystems', {
            dataRole: 'reference_layer',
            displayUrl: '/inputs/reference/ramsar/ramsar.geojson',
          }),
          manifestRow('biosphere_reserves', 'ecosystems', {
            dataRole: 'reference_layer',
            displayUrl: '/inputs/reference/biosphere_reserves/biosphere_reserves.geojson',
          }),
          manifestRow('reservas_forestales_ley_2_1959', 'ecosystems', {
            dataRole: 'reference_layer',
            displayUrl:
              '/inputs/reference/reservas_forestales_ley_2_1959/reservas_forestales_ley_2_1959.geojson',
          }),
        ]),
        manifestGroup('species_and_biodiversity', [
          manifestRow('kba_aica', 'species_and_biodiversity', {
            dataRole: 'reference_layer',
            displayUrl: '/inputs/reference/kba_aica/kba_aica.geojson',
          }),
        ]),
      ],
      groups: [
        group('group-cultural-ethnic', []),
        group('group-ecosystems', []),
        group('group-species-biodiversity', []),
      ],
      overlays: [],
      ports,
    });

    expect(result.groups.map(({ id, rows }) => [id, rows.map(({ id }) => id)])).toEqual([
      ['group-cultural-ethnic', ['layer-zonas_reserva_campesina_constituida']],
      [
        'group-ecosystems',
        ['layer-ramsar', 'layer-biosphere_reserves', 'layer-reservas_forestales_ley_2_1959'],
      ],
      ['group-species-biodiversity', ['layer-kba_aica']],
    ]);
    expect(result.groups.flatMap(({ rows }) => rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'layer-ramsar',
          mapUnavailable: false,
          mapSync: expect.objectContaining({
            type: 'manifest-raster',
            displayUrl: '/inputs/reference/ramsar/ramsar.geojson',
          }),
        }),
      ]),
    );
  });

  it('uses Campesina Reserve Zones for the English sidebar label', () => {
    const campesinaPorts: ManifestReconcilePorts = {
      ...ports,
      manifestRowName: (row) =>
        row.id === 'zonas_reserva_campesina_constituida'
          ? 'Campesina Reserve Zones'
          : ports.manifestRowName(row),
    };

    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('cultural_and_ethnic_territories', [
          manifestRow('zonas_reserva_campesina_constituida', 'cultural_and_ethnic_territories', {
            englishLabel: 'Constituted Peasant Reserve Zones',
            spanishLabel: 'Zonas de Reserva Campesina Constituida',
            dataRole: 'reference_layer',
            displayUrl: '/inputs/reference/zonas_reserva_campesina_constituida/layer.geojson',
          }),
        ]),
      ],
      groups: [group('group-cultural-ethnic', [])],
      overlays: [],
      ports: campesinaPorts,
    });

    expect(result.groups[0]?.rows[0]).toMatchObject({
      id: 'layer-zonas_reserva_campesina_constituida',
      name: 'Campesina Reserve Zones',
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

  it('keeps separate SIRAP layers and cannot reconcile the disabled merged row back', () => {
    const existingSirapRows = [
      ['siraps', 'boundary-siraps'],
      ['siraps_territorial', 'boundary-siraps_territorial'],
      ['siraps_territorial_updated', 'boundary-siraps_territorial_updated'],
      ['siraps_thematic', 'boundary-siraps_thematic'],
    ].map(([boundaryLayerKey, id]) =>
      row({
        id,
        mapSync: {
          type: 'admin-boundary',
          boundaryType: 'sirap',
          boundaryLayerKey: boundaryLayerKey as
            | 'siraps'
            | 'siraps_territorial'
            | 'siraps_territorial_updated'
            | 'siraps_thematic',
        },
      }),
    );

    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('administrative_boundaries', [
          manifestRow('siraps', 'administrative_boundaries'),
          manifestRow('siraps_territorial', 'administrative_boundaries'),
          manifestRow('siraps_territorial_updated', 'administrative_boundaries'),
          manifestRow('siraps_thematic', 'administrative_boundaries'),
        ]),
      ],
      groups: [group('group-admin-boundaries', existingSirapRows)],
      overlays: [],
      ports,
    });

    expect(enabledSirapBoundaryLayerKeys()).toEqual([
      'siraps_territorial_updated',
      'siraps_thematic',
    ]);
    expect(result.groups[0].rows.map((item) => item.id)).toEqual([
      'boundary-siraps_territorial_updated',
      'boundary-siraps_thematic',
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

  it('places the classified marine ecosystem layer in its own collection', () => {
    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('ecosystems', [
          manifestRow('ecosistemas', 'ecosystems'),
          manifestRow('marine_ecosystems', 'ecosystems'),
        ]),
      ],
      groups: [group('group-ecosystems', []), group(MARINE_ECOSYSTEMS_GROUP_ID, [])],
      overlays: [],
      ports,
    });

    expect(result.groups[0].rows.map(({ id }) => id)).toEqual(['layer-ecosistemas']);
    expect(result.groups[1]).toMatchObject({
      id: MARINE_ECOSYSTEMS_GROUP_ID,
      title: MARINE_ECOSYSTEMS_GROUP_ID,
      countLabel: '1 layers',
    });
    expect(result.groups[1].rows.map(({ id }) => id)).toEqual(['layer-marine_ecosystems']);
  });

  it('keeps the HHM reference row until a renderable manifest asset is available', () => {
    const hhm = row({ id: MARINE_HHM_LAYER_ID, mapUnavailable: true });
    const result = reconcileMapLayersManifest({
      manifestGroups: [
        manifestGroup('socioeconomic', [manifestRow('human_footprint_2022', 'socioeconomic')]),
      ],
      groups: [group('group-socio-economic', [hhm])],
      overlays: [],
      ports,
    });

    expect(result.groups[0].rows.map(({ id }) => id)).toEqual([
      'layer-human_footprint_2022',
      MARINE_HHM_LAYER_ID,
    ]);
    expect(result.groups[0].rows.at(-1)).toBe(hhm);
  });

  it('replaces the HHM reference row with the renderable manifest layer', () => {
    const hhm = row({ id: MARINE_HHM_LAYER_ID, mapUnavailable: true });
    const result = reconcileMapLayersManifest({
      manifestGroups: [manifestGroup('socioeconomic', [manifestRow('hhm', 'socioeconomic')])],
      groups: [group('group-socio-economic', [hhm])],
      overlays: [],
      ports,
    });

    expect(result.groups[0].rows).toHaveLength(1);
    expect(result.groups[0].rows[0]).toMatchObject({
      id: MARINE_HHM_LAYER_ID,
      mapUnavailable: false,
      mapSync: {
        type: 'manifest-raster',
        layerId: MARINE_HHM_LAYER_ID,
        displayUrl: '/hhm.tif',
      },
    });
  });
});
