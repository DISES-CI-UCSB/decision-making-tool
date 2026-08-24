import { describe, expect, it } from 'vitest';
import {
  AOI_ALIGNED_METRIC_BLUEPRINTS,
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
      'metric-17-national-contribution',
      'metric-18-priority-area-total',
      'metric-30-paramo-coverage',
      'metric-31-dry-forest-coverage',
      'metric-32-wetlands-coverage',
      'metric-36-mangrove-coverage',
      'metric-59-indigenous-reservations',
      'metric-60-community-councils',
      'metric-05-carbon-storage-capacity',
      'metric-06-water-regulation-services',
      'metric-09-affected-agricultural-area',
      'metric-08-agricultural-opportunity-cost',
    ]);
    expectBlueprintIds(AOI_ALIGNED_METRIC_BLUEPRINTS, [
      'aoi-summary-priority-area',
      'aoi-summary-national-contribution',
      'aoi-summary-threatened-species',
      'aoi-summary-paramo',
      'aoi-summary-dry-forest',
      'aoi-summary-wetlands',
      'aoi-summary-carbon',
      'aoi-summary-water',
      'aoi-summary-agriculture',
      'aoi-summary-indigenous-reservations',
      'aoi-summary-community-councils',
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
});

function expectBlueprintIds(
  blueprints: readonly { id: string }[],
  expectedIds: readonly string[],
): void {
  const ids = blueprints.map(({ id }) => id);
  expect(ids).toEqual(expectedIds);
  expect(new Set(ids).size).toBe(ids.length);
}
