import {
  buildConsideredLayerIdSet,
  buildLegendLayerEntry,
  computeSelectedLayerOrder,
  groupParentChildRows,
  nameMatchesSearch,
  normalizeSelectedLayerOrder,
  reorderRowsByDropTarget,
  reorderRowsById,
  scenarioLayerStatus,
  speciesMatchesSearch,
  taxonMatchesSearch,
} from './map-layers-panel.utils';

describe('selected layer ordering', () => {
  it('builds the initial order by overlay, group row, taxon, and species selection', () => {
    expect(
      computeSelectedLayerOrder(
        [
          { id: 'overlay-a', selected: true },
          { id: 'overlay-b', selected: false },
        ],
        [{ rows: [{ id: 'group-row', selected: true }] }],
        [
          {
            id: 'taxon-a',
            selected: true,
            species: [{ id: 'species-a', selected: true }],
          },
        ],
      ),
    ).toEqual(['overlay-a', 'group-row', 'taxon-a', 'species-a']);
  });

  it('moves rows one position without changing boundary orders', () => {
    const order = ['a', 'b', 'c'];

    expect(reorderRowsById(order, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(reorderRowsById(order, 'a', 'up')).toBe(order);
    expect(reorderRowsById(order, 'c', 'down')).toBe(order);
  });

  it('reorders dragged rows before or after the target', () => {
    const order = ['a', 'b', 'c', 'd'];

    expect(reorderRowsByDropTarget(order, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderRowsByDropTarget(order, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('keeps comparison layers in their fixed priority order when required', () => {
    expect(
      normalizeSelectedLayerOrder(
        ['data', 'candidate', 'baseline', 'overlap'],
        ['baseline', 'candidate', 'overlap'],
        true,
      ),
    ).toEqual(['baseline', 'candidate', 'overlap', 'data']);
  });
});

describe('parent-child row grouping', () => {
  it('replaces scattered children at their first position and assigns parent relationships', () => {
    const rows = [
      { id: 'before', label: 'Before' },
      { id: 'child-b', label: 'Child B' },
      { id: 'middle', label: 'Middle' },
      { id: 'child-a', label: 'Child A' },
      { id: 'after', label: 'After' },
    ];
    const parent = { id: 'parent', label: 'Parent', parentId: 'stale-parent' };
    const children = [rows[3]!, rows[1]!];

    expect(groupParentChildRows(rows, parent, children)).toEqual([
      { id: 'before', label: 'Before' },
      { id: 'parent', label: 'Parent', parentId: undefined },
      { id: 'child-a', label: 'Child A', parentId: 'parent' },
      { id: 'child-b', label: 'Child B', parentId: 'parent' },
      { id: 'middle', label: 'Middle' },
      { id: 'after', label: 'After' },
    ]);
    expect(rows[1]).toEqual({ id: 'child-b', label: 'Child B' });
  });

  it('returns an equivalent ungrouped list when no child is present', () => {
    const rows = [{ id: 'unrelated' }];

    expect(groupParentChildRows(rows, { id: 'parent' }, [{ id: 'missing-child' }])).toEqual(rows);
  });
});

describe('layer search matching', () => {
  const species = { common: 'Andean Bear', latin: 'Tremarctos ornatus' };
  const taxon = { name: 'Mammals', species: [species] };

  it('matches row names case-insensitively', () => {
    expect(nameMatchesSearch('Protected Areas', 'protected')).toBe(true);
    expect(nameMatchesSearch('Protected Areas', 'wetlands')).toBe(false);
  });

  it('matches species common and scientific names', () => {
    expect(speciesMatchesSearch(species, 'andean')).toBe(true);
    expect(speciesMatchesSearch(species, 'ornatus')).toBe(true);
  });

  it('matches a taxon by its name or any species name', () => {
    expect(taxonMatchesSearch(taxon, 'mammals')).toBe(true);
    expect(taxonMatchesSearch(taxon, 'tremarctos')).toBe(true);
    expect(taxonMatchesSearch(taxon, 'birds')).toBe(false);
  });
});

describe('scenario status aliases', () => {
  it('normalizes layer prefixes, separators, and manifest overlay aliases', () => {
    const consideredIds = buildConsideredLayerIdSet(['RUNAP', 'layer-human-footprint']);

    expect(scenarioLayerStatus('overlay-runap-protected-areas', 'runap', consideredIds, true)).toBe(
      'considered',
    );
    expect(scenarioLayerStatus('layer-human_footprint', undefined, consideredIds, true)).toBe(
      'considered',
    );
  });

  it('returns reference or no status when aliases do not match or status is unavailable', () => {
    const consideredIds = buildConsideredLayerIdSet(['runap']);

    expect(scenarioLayerStatus('layer-wetlands', undefined, consideredIds, true)).toBe('reference');
    expect(scenarioLayerStatus('layer-wetlands', undefined, consideredIds, false)).toBeNull();
  });
});

describe('legend view-model mapping', () => {
  it('maps boundary rows to line legends using resolved appearance values', () => {
    expect(
      buildLegendLayerEntry({
        id: 'department-boundaries',
        name: 'Departments',
        color: '#64748b',
        boundaryStyle: { color: '#334155', lineWidth: 2 },
        borderColor: '#0f172a',
        borderStyle: 'none',
        borderWidth: 3,
      }),
    ).toEqual({
      id: 'department-boundaries',
      name: 'Departments',
      swatchType: 'line',
      color: '#0f172a',
      lineStyle: 'dashed',
      lineWidth: 0,
    });
  });

  it('localizes and deduplicates categorical raster legend entries', () => {
    const entry = buildLegendLayerEntry({
      id: 'ecosystems',
      name: 'Ecosystems',
      color: '#64748b',
      language: 'es',
      rendering: {
        valueType: 'categorical',
        renderMode: 'categorical',
        classColors: [
          {
            value: 1,
            color: '#15803d',
            label: 'Forest',
            englishLabel: 'Forest',
            spanishLabel: 'Bosque',
          },
          {
            value: 2,
            color: '#166534',
            label: 'Forest',
            englishLabel: 'Forest',
            spanishLabel: 'Bosque',
          },
        ],
      },
    });

    expect(entry.categories).toEqual([
      {
        id: 'ecosystems-class-bosque',
        label: 'Bosque',
        color: '#15803d',
      },
    ]);
    expect(entry.color).toBe('#15803d');
  });

  it('maps continuous rendering bounds and colors to a gradient legend', () => {
    expect(
      buildLegendLayerEntry({
        id: 'human-footprint',
        name: 'Human Footprint',
        color: '#7f1d1d',
        rendering: {
          valueType: 'continuous',
          renderMode: 'gradient',
          startColor: '#fef2f2',
          endColor: '#991b1b',
          minValue: 0,
          maxValue: 0.75,
        },
      }),
    ).toMatchObject({
      swatchType: 'gradient',
      gradientStartColor: '#fef2f2',
      gradientEndColor: '#991b1b',
      gradientMinLabel: '0',
      gradientMaxLabel: '0.75',
    });
  });
});
