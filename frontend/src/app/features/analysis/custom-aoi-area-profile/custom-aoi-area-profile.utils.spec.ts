import { describe, expect, it } from 'vitest';
import { parseEcosystemsSection, parseSpeciesSection } from './custom-aoi-area-profile.utils';

describe('custom AOI area profile parsing', () => {
  it('parses species records from the v1 contract', () => {
    const section = parseSpeciesSection({
      format: 'custom-aoi-area-profile-v1',
      status: 'complete',
      selection: { status: 'complete', selected_cell_count: 2, area_km2: 3 },
      sections: {
        species: {
          status: 'complete',
          records: [
            {
              id: 'oso',
              scientific_name: 'Tremarctos ornatus',
              group: 'Mammals',
              iucn_status: 'VU',
            },
          ],
        },
      },
    });

    expect(section.records[0].scientific_name).toBe('Tremarctos ornatus');
  });

  it('fills missing ecosystem views without inventing rows', () => {
    const section = parseEcosystemsSection({
      format: 'custom-aoi-area-profile-v1',
      status: 'complete',
      selection: { status: 'complete', selected_cell_count: 2, area_km2: 3 },
      sections: {
        ecosystems: {
          status: 'complete',
          views: [
            {
              id: 'broadEcosystem',
              label: 'Broad ecosystem',
              records: [
                {
                  id: 'forest',
                  label: 'Forest',
                  area_km2: 2,
                  national_area_km2: 20,
                  share_of_classified_pct: 100,
                  share_of_national_class_pct: 10,
                  solution_covered_area_km2: null,
                  solution_covered_pct_of_aoi: null,
                  pre_existing_covered_area_km2: null,
                  pre_existing_covered_pct_of_aoi: null,
                  new_covered_area_km2: null,
                  new_covered_pct_of_aoi: null,
                },
              ],
            },
          ],
        },
      },
    });

    expect(section.views.broadEcosystem).toHaveLength(1);
    expect(section.views.detailedEcosystem).toEqual([]);
    expect(section.views.broadEcosystem[0].solution_covered_area_km2).toBeNull();
  });

  it('rejects responses with the wrong format', () => {
    expect(() => parseSpeciesSection({ format: 'other', sections: {} })).toThrow(
      'Invalid custom AOI area profile response',
    );
  });
});
