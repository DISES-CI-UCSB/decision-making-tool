import {
  ECOSYSTEM_CLASSIFICATION_VIEW_OPTIONS,
  ECOSYSTEMS_COPY,
  IAVH_ECOSYSTEM_BIOME_GROUPS,
  IAVH_ECOSYSTEM_NO_DATA_VALUE,
} from './map-layers-panel-ecosystem.config';
import {
  buildIavhBiomeRegionClassColors,
  buildIavhBiomeRegionRendering,
  buildIavhEcosystemGroupedRendering,
  buildIavhEcosystemRendering,
  colorForIavhBiomeRegion,
  fallbackIavhBiomeRegionClasses,
  hslToHex,
  parseCsvLine,
  parseIavhBiomeRegionCsv,
} from './map-layers-panel-iavh-ecosystem.utils';

describe('IAVH CSV parsing', () => {
  it('parses quoted commas and escaped quotes', () => {
    expect(parseCsvLine('1,"Orobioma, húmedo","A ""quoted"" value"')).toEqual([
      '1',
      'Orobioma, húmedo',
      'A "quoted" value',
    ]);
  });

  it('requires headers and drops empty or invalid rows before numeric sorting', () => {
    expect(parseIavhBiomeRegionCsv('')).toEqual([]);
    expect(parseIavhBiomeRegionCsv('biome_id,name\n1,Orobioma')).toEqual([]);
    expect(parseIavhBiomeRegionCsv('biome,label\nOrobioma,Example')).toEqual([]);
    const csv = [
      'notes,biome_id,biome',
      'later,12,"Orobioma, húmedo"',
      '',
      'bad,nope,Zonobioma',
      'missing,8,',
      'first,2,"Helobioma ""especial"""',
      'decimal,3.5,Hidrobioma',
    ].join('\r\n');

    expect(parseIavhBiomeRegionCsv(csv)).toEqual([
      { value: 2, label: 'Helobioma "especial"' },
      { value: 12, label: 'Orobioma, húmedo' },
    ]);
  });
});

describe('IAVH classes and colors', () => {
  it('builds fallback values 1 through 430', () => {
    const classes = fallbackIavhBiomeRegionClasses();

    expect(classes).toHaveLength(430);
    expect(classes[0]).toEqual({ value: 1, label: 'IAvH class 1' });
    expect(classes[429]).toEqual({ value: 430, label: 'IAvH class 430' });
    expect(classes.map(({ value }) => value)).toEqual(
      Array.from({ length: 430 }, (_, index) => index + 1),
    );
  });

  it('converts HSL and assigns known deterministic colors', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
    expect(colorForIavhBiomeRegion('Orobioma test', 1)).toBe('#66a527');
    expect(colorForIavhBiomeRegion('Zonobioma test', 2)).toBe('#31b965');
    expect(colorForIavhBiomeRegion('Hidrobioma test', 3)).toBe('#2fadda');
    expect(colorForIavhBiomeRegion('Unknown', 430)).toBe('#929eaa');
  });

  it('builds colors from parsed or fallback classes', () => {
    const parsed = [{ value: 2, label: 'Zonobioma example' }];

    expect(buildIavhBiomeRegionClassColors(parsed)).toEqual([
      {
        value: 2,
        color: '#31b965',
        label: 'Zonobioma example',
        englishLabel: 'Zonobioma example',
        spanishLabel: 'Zonobioma example',
      },
    ]);
    expect(buildIavhBiomeRegionClassColors(null)).toHaveLength(430);
  });
});

describe('IAVH rendering', () => {
  it.each(['en', 'es'] as const)('renders all 430 localized family entries in %s', (language) => {
    const rendering = buildIavhEcosystemGroupedRendering(language);
    const colors = rendering.classColors ?? [];

    expect(rendering.noDataValue).toBe(IAVH_ECOSYSTEM_NO_DATA_VALUE);
    expect(colors).toHaveLength(430);
    expect(new Set(colors.map(({ value }) => value)).size).toBe(430);
    for (const group of IAVH_ECOSYSTEM_BIOME_GROUPS) {
      for (const value of group.values) {
        expect(colors.find((entry) => entry.value === value)).toEqual({
          value,
          color: group.color,
          label: group.label[language],
        });
      }
    }
    expect(colors.find(({ value }) => value === 70)?.label).toBe(
      ECOSYSTEMS_COPY[language].otherBiomeFamily,
    );
  });

  it('renders parsed and fallback region classes with the no-data value', () => {
    const parsed = [{ value: 5, label: 'Peinobioma example' }];

    expect(buildIavhBiomeRegionRendering(parsed)).toEqual({
      valueType: 'categorical',
      renderMode: 'categorical',
      noDataValue: IAVH_ECOSYSTEM_NO_DATA_VALUE,
      classColors: buildIavhBiomeRegionClassColors(parsed),
    });
    expect(buildIavhBiomeRegionRendering(null).classColors).toHaveLength(430);
  });

  it('dispatches only biomeRegion away from family rendering', () => {
    const classes = [{ value: 11, label: 'Hidrobioma example' }];

    expect(buildIavhEcosystemRendering('biomeRegion', 'es', classes)).toEqual(
      buildIavhBiomeRegionRendering(classes),
    );
    for (const { value } of ECOSYSTEM_CLASSIFICATION_VIEW_OPTIONS) {
      if (value !== 'biomeRegion') {
        expect(buildIavhEcosystemRendering(value, 'es', classes)).toEqual(
          buildIavhEcosystemGroupedRendering('es'),
        );
      }
    }
  });
});
