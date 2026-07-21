import type { LayerConfig, RuntimeLayerManifestRenderingConfig } from '@core/models';
import {
  OMEC_OVERLAY_LAYER_ID,
  OMEC_VECTOR_OVERLAY_ARCGIS_LAYER_ID,
} from '@features/map/services/manifest-raster-layer.service';
import {
  applyRowColorToRendering,
  MapLayersPanelMapSync,
  type MapSyncPorts,
  type MapSyncRow,
} from './map-layers-panel-map-sync';

describe('MapLayersPanelMapSync', () => {
  const solutionLayers = {
    setBaselineVisibility: vi.fn(),
    setBaselineOpacity: vi.fn(),
    setBaselineColor: vi.fn(),
    setCandidateVisibility: vi.fn(),
    setCandidateOpacity: vi.fn(),
    setCandidateColor: vi.fn(),
    setOverlapVisibility: vi.fn(),
    setOverlapOpacity: vi.fn(),
    setOverlapColor: vi.fn(),
    resolveLayerForSidebarType: vi.fn(),
    reorderLayersByIds: vi.fn(),
  };
  const adminBoundaries = {
    setLayerStyle: vi.fn(),
    setLayerVisibility: vi.fn(),
    getLayerIdsByBoundaryKey: vi.fn(),
  };
  const manifestRasters = { syncLayer: vi.fn() };
  let layers: LayerConfig[];
  let frames: Map<number, FrameRequestCallback>;
  let tasks: Map<ReturnType<typeof setTimeout>, () => void>;
  let nextFrameId: number;
  let nextTaskId: number;
  let sync: MapLayersPanelMapSync;

  beforeEach(() => {
    vi.clearAllMocks();
    layers = [];
    frames = new Map();
    tasks = new Map();
    nextFrameId = 1;
    nextTaskId = 1;
    const ports: MapSyncPorts = {
      solutionLayers,
      adminBoundaries,
      manifestRasters,
      appStateLayers: {
        get: () => layers,
        set: (nextLayers) => {
          layers = nextLayers;
        },
      },
    };
    sync = new MapLayersPanelMapSync(
      ports,
      (callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      },
      (frameId) => {
        frames.delete(frameId);
      },
      (callback) => {
        const taskId = nextTaskId++ as unknown as ReturnType<typeof setTimeout>;
        tasks.set(taskId, callback);
        return taskId;
      },
      (taskId) => {
        tasks.delete(taskId);
      },
    );
  });

  it.each([
    ['solution-baseline', 'Baseline'],
    ['solution-candidate', 'Candidate'],
    ['solution-overlap', 'Overlap'],
  ] as const)('synchronously dispatches %s rows', (type, methodName) => {
    sync.syncRow(row({ visible: false, opacity: 65, color: '#123456', mapSync: { type } }));

    expect(solutionLayers[`set${methodName}Visibility`]).toHaveBeenCalledWith(false);
    expect(solutionLayers[`set${methodName}Opacity`]).toHaveBeenCalledWith(0.65);
    expect(solutionLayers[`set${methodName}Color`]).toHaveBeenCalledWith('#123456');
    expect(frames).toHaveLength(0);
  });

  it.each([
    ['none', 'none'],
    ['solid', 'solid'],
    ['dashed', 'long-dash'],
    ['dotted', 'dot'],
  ] as const)('maps admin style %s to %s', (borderStyle, expectedStyle) => {
    sync.syncRow(
      row({
        visible: false,
        borderColor: '#abcdef',
        borderStyle,
        borderWidth: 2,
        mapSync: {
          type: 'admin-boundary',
          boundaryType: 'department',
          boundaryLayerKey: 'admin_departments',
        },
      }),
    );

    expect(adminBoundaries.setLayerStyle).toHaveBeenCalledWith('admin_departments', {
      color: '#abcdef',
      style: expectedStyle,
      width: 2,
    });
    expect(adminBoundaries.setLayerVisibility).toHaveBeenCalledWith('admin_departments', false);
  });

  it('uses defaults and forwards explicit manifest-raster styling', () => {
    sync.syncRow(
      row({
        mapSync: {
          type: 'admin-boundary',
          boundaryType: 'sirap',
          boundaryLayerKey: 'siraps',
        },
      }),
    );
    sync.syncRow(
      row({
        selected: true,
        opacity: 42,
        fillStyle: 'hatch',
        fillDensity: 5,
        borderColor: '#654321',
        borderStyle: 'dotted',
        borderWidth: 3,
        mapSync: {
          type: 'manifest-raster',
          layerId: 'raster',
          displayUrl: '/raster.tif',
          rendering: rendering('mask'),
        },
      }),
    );

    expect(adminBoundaries.setLayerStyle).toHaveBeenCalledWith('siraps', {
      color: '#112233',
      style: 'solid',
      width: 1,
    });
    expect(manifestRasters.syncLayer).toHaveBeenCalledWith(
      'raster',
      expect.objectContaining({
        opacity: 0.42,
        fillStyle: 'hatch',
        fillDensity: 5,
        borderColor: '#654321',
        borderStyle: 'dotted',
        borderWidth: 3,
        rendering: expect.objectContaining({ selectedColor: '#112233' }),
      }),
      { selected: true },
    );
  });

  it('uses manifest-raster fill and border defaults', () => {
    sync.syncRow(
      row({
        mapSync: {
          type: 'manifest-raster',
          layerId: 'defaulted',
          displayUrl: '/defaulted.tif',
          rendering: rendering('categorical'),
        },
      }),
    );

    expect(manifestRasters.syncLayer.mock.calls[0][1]).toMatchObject({
      fillStyle: 'solid',
      fillDensity: 3,
      borderColor: '#112233',
      borderStyle: 'solid',
      borderWidth: 1,
    });
  });

  it('patches only valid mask and gradient colors', () => {
    const mask = rendering('mask');
    const gradient = rendering('gradient');
    const categorical = rendering('categorical');

    expect(applyRowColorToRendering(mask, '#Aa12fF')).toEqual({
      ...mask,
      selectedColor: '#Aa12fF',
    });
    expect(applyRowColorToRendering(gradient, '#123456')).toEqual({
      ...gradient,
      endColor: '#123456',
    });
    expect(applyRowColorToRendering(categorical, '#123456')).toBe(categorical);
    expect(applyRowColorToRendering(mask, 'invalid')).toBe(mask);
  });

  it('immutably updates app state and ignores no-op rows', () => {
    const original = layer('target', false, 1);
    const untouched = layer('other', true, 0.5);
    const originalArray = [original, untouched];
    layers = originalArray;

    sync.syncRow(row());
    sync.syncRow(row({ mapSync: { type: 'app-state-layer', layerId: 'missing' } }));
    expect(layers).toBe(originalArray);

    sync.syncRow(
      row({
        visible: true,
        opacity: 25,
        mapSync: { type: 'app-state-layer', layerId: 'target' },
      }),
    );
    expect(layers).not.toBe(originalArray);
    expect(layers[0]).not.toBe(original);
    expect(layers[0]).toMatchObject({ visible: true, opacity: 0.25 });
    expect(layers[1]).toBe(untouched);
  });

  it('syncs bulk row lists', () => {
    sync.syncRows([
      solutionRow('baseline', 'solution-baseline'),
      solutionRow('candidate', 'solution-candidate'),
    ]);

    expect(solutionLayers.setBaselineVisibility).toHaveBeenCalledOnce();
    expect(solutionLayers.setCandidateVisibility).toHaveBeenCalledOnce();
  });

  it('lets the browser paint before synchronizing selection changes', () => {
    sync.scheduleAfterPaintSync('selected', () => solutionRow('selected', 'solution-baseline'));

    expect(solutionLayers.setBaselineVisibility).not.toHaveBeenCalled();
    runFrames();
    expect(solutionLayers.setBaselineVisibility).not.toHaveBeenCalled();
    runTasks();
    expect(solutionLayers.setBaselineVisibility).toHaveBeenCalledWith(true);
  });

  it('coalesces scheduled live row lookups independently', () => {
    let liveRow = solutionRow('live', 'solution-baseline', { opacity: 10 });
    const lookup = vi.fn(() => liveRow);
    sync.scheduleOpacitySync('live', lookup);
    liveRow = solutionRow('live', 'solution-baseline', { opacity: 75 });
    sync.scheduleOpacitySync('live', lookup);
    sync.scheduleColorSync('live', () =>
      solutionRow('live', 'solution-candidate', { color: '#fedcba' }),
    );

    expect(frames).toHaveLength(2);
    runFrames();
    expect(lookup).toHaveBeenCalledOnce();
    expect(solutionLayers.setBaselineOpacity).toHaveBeenCalledWith(0.75);
    expect(solutionLayers.setCandidateColor).toHaveBeenCalledWith('#fedcba');
  });

  it('resolves selected aliases, admin IDs, solutions, taxa, and priority order', () => {
    solutionLayers.resolveLayerForSidebarType.mockReturnValue({ id: 'solution-layer' });
    adminBoundaries.getLayerIdsByBoundaryKey.mockReturnValue(['admin-a', 'admin-b']);
    const overlays = [
      row({
        id: 'vector',
        selected: true,
        mapSync: {
          type: 'manifest-raster',
          layerId: OMEC_OVERLAY_LAYER_ID,
          displayUrl: '/omec.tif',
          rendering: rendering('mask'),
        },
      }),
      solutionRow('solution', 'solution-baseline'),
    ];
    const groups = [
      {
        rows: [
          row({
            id: 'admin',
            selected: true,
            mapSync: {
              type: 'admin-boundary',
              boundaryType: 'department',
              boundaryLayerKey: 'admin_departments',
            },
          }),
        ],
      },
    ];
    const taxa = [
      {
        ...row({ id: 'taxon' }),
        species: [
          row({
            id: 'species',
            selected: true,
            mapSync: { type: 'app-state-layer', layerId: 'species-layer' },
          }),
        ],
      },
    ];

    sync.scheduleStackingSync(['vector', 'admin', 'solution', 'species'], overlays, groups, taxa, [
      'species',
      'vector',
      'admin',
      'solution',
    ]);

    expect(solutionLayers.reorderLayersByIds).not.toHaveBeenCalled();
    runFrames();
    expect(solutionLayers.reorderLayersByIds).not.toHaveBeenCalled();
    runTasks();
    expect(solutionLayers.reorderLayersByIds).toHaveBeenCalledWith([
      'species-layer',
      OMEC_VECTOR_OVERLAY_ARCGIS_LAYER_ID,
      'admin-a',
      'admin-b',
      'solution-layer',
    ]);
    expect(solutionLayers.reorderLayersByIds).toHaveBeenCalledOnce();
  });

  it('cancels prior stacking frames and all pending work on dispose', () => {
    const selectedRows = [
      row({
        id: 'selected',
        selected: true,
        mapSync: { type: 'app-state-layer', layerId: 'selected-layer' },
      }),
    ];
    sync.scheduleStackingSync(['selected'], selectedRows, [], []);
    sync.scheduleStackingSync(['selected'], selectedRows, [], []);
    expect(solutionLayers.reorderLayersByIds).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);

    sync.scheduleOpacitySync('opacity', () => solutionRow('opacity', 'solution-baseline'));
    sync.scheduleColorSync('color', () => null);
    sync.scheduleAfterPaintSync('selection', () => solutionRow('selection', 'solution-candidate'));
    sync.dispose();
    expect(frames).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  function row(overrides: Partial<MapSyncRow> = {}): MapSyncRow {
    return {
      id: 'row',
      selected: false,
      visible: true,
      opacity: 80,
      color: '#112233',
      ...overrides,
    };
  }

  function solutionRow(
    id: string,
    type: 'solution-baseline' | 'solution-candidate' | 'solution-overlap',
    overrides: Partial<MapSyncRow> = {},
  ): MapSyncRow {
    return row({ id, selected: true, mapSync: { type }, ...overrides });
  }

  function rendering(
    renderMode: RuntimeLayerManifestRenderingConfig['renderMode'],
  ): RuntimeLayerManifestRenderingConfig {
    return { valueType: 'categorical', renderMode };
  }

  function layer(id: string, visible: boolean, opacity: number): LayerConfig {
    return { id, name: id, category: 'test', arcgisType: 'feature', visible, opacity };
  }

  function runFrames(): void {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  }

  function runTasks(): void {
    const callbacks = [...tasks.values()];
    tasks.clear();
    callbacks.forEach((callback) => callback());
  }
});
