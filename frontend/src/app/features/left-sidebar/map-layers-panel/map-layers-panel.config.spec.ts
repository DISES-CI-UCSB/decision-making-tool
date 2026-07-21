import {
  IAVH_BIOME_REGION_CLASS_COUNT,
  IAVH_ECOSYSTEM_BIOME_GROUPS,
} from './map-layers-panel-ecosystem.config';
import {
  MANIFEST_LAYER_ID_BY_OVERLAY_ROW_ID,
  MANIFEST_OVERLAY_ROW_BY_LAYER_ID,
  SIDEBAR_MANIFEST_CATEGORY_BINDINGS,
  SPECIES_RICHNESS_LAYER_ID_BY_TAXON_ROW_ID,
  SPECIES_RICHNESS_TAXON_LAYER_DEFINITIONS,
  sidebarCategoryBindingForGroup,
  sidebarCategoryBindingForManifest,
} from './map-layers-panel.config';

describe('map layer catalog invariants', () => {
  it('keeps sidebar and manifest category bindings unique and reversible', () => {
    const sidebarGroupIds = SIDEBAR_MANIFEST_CATEGORY_BINDINGS.map(
      (binding) => binding.sidebarGroupId,
    );
    const manifestCategoryIds = SIDEBAR_MANIFEST_CATEGORY_BINDINGS.map(
      (binding) => binding.manifestCategoryId,
    );

    expect(new Set(sidebarGroupIds).size).toBe(sidebarGroupIds.length);
    expect(new Set(manifestCategoryIds).size).toBe(manifestCategoryIds.length);
    for (const binding of SIDEBAR_MANIFEST_CATEGORY_BINDINGS) {
      expect(sidebarCategoryBindingForGroup(binding.sidebarGroupId)).toBe(binding);
      expect(sidebarCategoryBindingForManifest(binding.manifestCategoryId)).toBe(binding);
    }
  });

  it('defines live rendering, initial state, and a usable palette policy per category', () => {
    expect(
      SIDEBAR_MANIFEST_CATEGORY_BINDINGS.map(
        ({
          sidebarGroupId,
          rowSource,
          supportsLiveRendering,
          defaultCollapsed,
          defaultComingSoon,
        }) => ({
          sidebarGroupId,
          rowSource,
          supportsLiveRendering,
          defaultCollapsed,
          defaultComingSoon,
        }),
      ),
    ).toEqual([
      {
        sidebarGroupId: 'group-admin-boundaries',
        rowSource: 'dedicated-service',
        supportsLiveRendering: false,
        defaultCollapsed: false,
        defaultComingSoon: false,
      },
      ...[
        'group-species-biodiversity',
        'group-ecosystems',
        'group-cultural-ethnic',
        'group-socio-economic',
      ].map((sidebarGroupId) => ({
        sidebarGroupId,
        rowSource: 'generic-manifest',
        supportsLiveRendering: true,
        defaultCollapsed: true,
        defaultComingSoon: false,
      })),
    ]);

    for (const binding of SIDEBAR_MANIFEST_CATEGORY_BINDINGS) {
      expect(binding.palette.fallbackColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(binding.palette.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    }
  });

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
