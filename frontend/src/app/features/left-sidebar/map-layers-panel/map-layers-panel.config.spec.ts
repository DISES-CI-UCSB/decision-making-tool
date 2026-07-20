import {
  IAVH_BIOME_REGION_CLASS_COUNT,
  IAVH_ECOSYSTEM_BIOME_GROUPS,
} from './map-layers-panel-ecosystem.config';
import {
  MANIFEST_LAYER_ID_BY_OVERLAY_ROW_ID,
  MANIFEST_OVERLAY_ROW_BY_LAYER_ID,
  SPECIES_RICHNESS_LAYER_ID_BY_TAXON_ROW_ID,
  SPECIES_RICHNESS_TAXON_LAYER_DEFINITIONS,
} from './map-layers-panel.config';

describe('map layer catalog invariants', () => {
  it('keeps manifest overlay IDs reversible', () => {
    for (const [manifestLayerId, overlayRowId] of Object.entries(
      MANIFEST_OVERLAY_ROW_BY_LAYER_ID,
    )) {
      expect(MANIFEST_LAYER_ID_BY_OVERLAY_ROW_ID[overlayRowId]).toBe(manifestLayerId);
    }
  });

  it('maps every species-richness taxon row to its layer definition', () => {
    expect([...SPECIES_RICHNESS_LAYER_ID_BY_TAXON_ROW_ID.entries()]).toEqual(
      SPECIES_RICHNESS_TAXON_LAYER_DEFINITIONS.map(({ rowId, taxonId }) => [
        `taxon-${taxonId}`,
        rowId,
      ]),
    );
  });

  it('assigns each IAVH biome region ID exactly once', () => {
    const regionIds = IAVH_ECOSYSTEM_BIOME_GROUPS.flatMap((group) => [...group.values]);

    expect(regionIds).toHaveLength(IAVH_BIOME_REGION_CLASS_COUNT);
    expect([...new Set(regionIds)].sort((left, right) => left - right)).toEqual(
      Array.from({ length: IAVH_BIOME_REGION_CLASS_COUNT }, (_, index) => index + 1),
    );
  });
});
