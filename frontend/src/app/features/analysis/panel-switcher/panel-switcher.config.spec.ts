import { describe, expect, it } from 'vitest';
import {
  AOI_LAND_USE_OF_AOI_METRIC_IDS,
  COMPARISON_METRIC_BLUEPRINTS,
  COMPARISON_SECTION_META,
  COMPARISON_SECTION_ORDER,
  CUSTOM_AOI_FAST_METRIC_IDS,
  CUSTOM_AOI_METRIC_DEFINITIONS,
  CUSTOM_AOI_SPECIES_METRIC_IDS,
  OVERVIEW_METRIC_BLUEPRINTS,
  OVERVIEW_SECTION_ORDER,
  overviewBlueprintVisibleForDomain,
} from './panel-switcher.config';

describe('panel switcher metric configuration', () => {
  it('keeps metric blueprint IDs unique and in display order', () => {
    expectBlueprintIds(OVERVIEW_METRIC_BLUEPRINTS, [
      'metric-62-marine-mangrove-coverage',
      'metric-01-conservation-goals-met',
      'metric-02-species-groups-protected',
      'metric-03-threatened-species-secured',
      'metric-18-priority-area-total',
      'metric-59-indigenous-reservations',
      'metric-60-community-councils',
      'metric-05-carbon-storage-capacity',
      'metric-06-water-regulation-services',
      'metric-09-affected-agricultural-area',
    ]);
    expectBlueprintIds(COMPARISON_METRIC_BLUEPRINTS, [
      'comp-priority-area',
      'comp-pre-existing-area',
      'comp-new-selected-area',
      'comp-national-target',
      'comp-carbon',
      'comp-water-regulation',
      'comp-protected-overlap',
      'comp-indigenous-overlap',
    ]);
  });

  it('keeps expected overview and comparison section coverage', () => {
    expect(OVERVIEW_SECTION_ORDER).toEqual(['ecology', 'climate', 'finance']);
    expect(new Set(OVERVIEW_METRIC_BLUEPRINTS.map(({ section }) => section))).toEqual(
      new Set(['gains', 'ecosystemServices', 'costs']),
    );

    expect(COMPARISON_SECTION_ORDER).toEqual(['general', 'ecosystems', 'protection']);
    expect(Object.keys(COMPARISON_SECTION_META)).toEqual(COMPARISON_SECTION_ORDER);
    expect(new Set(COMPARISON_METRIC_BLUEPRINTS.map(({ section }) => section))).toEqual(
      new Set(COMPARISON_SECTION_ORDER),
    );
  });

  it('keeps marine overview cards to mangroves and candidate area', () => {
    const marineIds = OVERVIEW_METRIC_BLUEPRINTS.filter((blueprint) =>
      overviewBlueprintVisibleForDomain(blueprint, 'marine'),
    ).map((blueprint) => blueprint.id);
    const landIds = OVERVIEW_METRIC_BLUEPRINTS.filter((blueprint) =>
      overviewBlueprintVisibleForDomain(blueprint, 'land'),
    ).map((blueprint) => blueprint.id);

    expect(marineIds).toEqual([
      'metric-62-marine-mangrove-coverage',
      'metric-18-priority-area-total',
    ]);
    expect(marineIds).not.toContain('metric-01-conservation-goals-met');
    expect(marineIds).not.toContain('metric-02-species-groups-protected');
    expect(marineIds).not.toContain('metric-05-carbon-storage-capacity');
    expect(landIds).not.toContain('metric-62-marine-mangrove-coverage');
    expect(landIds).toContain('metric-01-conservation-goals-met');
    expect(landIds).toContain('metric-02-species-groups-protected');
    expect(landIds).toContain('metric-05-carbon-storage-capacity');
  });

  it('defines every requested custom AOI metric under its own ID', () => {
    for (const metricId of [...CUSTOM_AOI_FAST_METRIC_IDS, ...CUSTOM_AOI_SPECIES_METRIC_IDS]) {
      expect(CUSTOM_AOI_METRIC_DEFINITIONS[metricId]?.metricId).toBe(metricId);
    }
  });

  it('requests the five CORINE Level 1 land-cover percentages', () => {
    expect(CUSTOM_AOI_FAST_METRIC_IDS).toEqual(
      expect.arrayContaining([
        'land_use_artificial_surfaces_pct',
        'land_use_agricultural_areas_pct',
        'land_use_forests_and_semi_natural_areas_pct',
        'land_use_wetlands_pct',
        'land_use_water_bodies_pct',
      ]),
    );
    expect(CUSTOM_AOI_FAST_METRIC_IDS).not.toContain('land_use_other_pct');
  });

  it('requests whole-AOI land-use percents from the custom-polygon job', () => {
    expect(AOI_LAND_USE_OF_AOI_METRIC_IDS).toEqual([
      'land_use_artificial_surfaces_pct_of_aoi',
      'land_use_agricultural_areas_pct_of_aoi',
      'land_use_forests_and_semi_natural_areas_pct_of_aoi',
      'land_use_wetlands_pct_of_aoi',
      'land_use_water_bodies_pct_of_aoi',
    ]);
    for (const metricId of AOI_LAND_USE_OF_AOI_METRIC_IDS) {
      expect(CUSTOM_AOI_METRIC_DEFINITIONS[metricId]?.metricId).toBe(metricId);
      expect(CUSTOM_AOI_METRIC_DEFINITIONS[metricId]?.unit).toBe('%');
      expect(CUSTOM_AOI_FAST_METRIC_IDS).toContain(metricId);
    }
  });
});

function expectBlueprintIds(
  blueprints: readonly { id: string }[],
  expectedIds: readonly string[],
): void {
  const ids = blueprints.map(({ id }) => id);
  expect(ids).toEqual(expectedIds);
  expect(new Set(ids).size).toBe(ids.length);
}
