import { describe, expect, it } from 'vitest';
import {
  COMPARISON_METRIC_BLUEPRINTS,
  COMPARISON_SECTION_META,
  COMPARISON_SECTION_ORDER,
  CUSTOM_AOI_FAST_METRIC_IDS,
  CUSTOM_AOI_METRIC_DEFINITIONS,
  CUSTOM_AOI_SPECIES_METRIC_IDS,
  OVERVIEW_METRIC_BLUEPRINTS,
  OVERVIEW_SECTION_ORDER,
} from './panel-switcher.config';

describe('panel switcher metric configuration', () => {
  it('keeps metric blueprint IDs unique and in display order', () => {
    expectBlueprintIds(OVERVIEW_METRIC_BLUEPRINTS, [
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
      'comp-threatened-species',
      'comp-endemic-species',
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

    expect(COMPARISON_SECTION_ORDER).toEqual([
      'general',
      'biodiversity',
      'ecosystems',
      'protection',
    ]);
    expect(Object.keys(COMPARISON_SECTION_META)).toEqual(COMPARISON_SECTION_ORDER);
    expect(new Set(COMPARISON_METRIC_BLUEPRINTS.map(({ section }) => section))).toEqual(
      new Set(COMPARISON_SECTION_ORDER),
    );
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
});

function expectBlueprintIds(
  blueprints: readonly { id: string }[],
  expectedIds: readonly string[],
): void {
  const ids = blueprints.map(({ id }) => id);
  expect(ids).toEqual(expectedIds);
  expect(new Set(ids).size).toBe(ids.length);
}
