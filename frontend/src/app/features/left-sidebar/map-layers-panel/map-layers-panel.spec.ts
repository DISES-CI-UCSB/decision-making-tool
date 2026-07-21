import type { RuntimeLayerManifest } from '@core/models';
import { resolveSpeciesTaxonomyLookupUrl } from './map-layers-panel';

const FALLBACK_SPECIES_LOOKUP_URL =
  'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/species/biomod_spp_ranges_updatedIUCN.csv';

describe('resolveSpeciesTaxonomyLookupUrl', () => {
  it('prefers the species lookup URL from the loaded manifest', () => {
    const manifest = {
      referenceData: {
        speciesLookup: {
          url: 'https://example.com/species-lookup.csv',
        },
      },
    } as RuntimeLayerManifest;

    expect(resolveSpeciesTaxonomyLookupUrl(manifest)).toBe(
      'https://example.com/species-lookup.csv',
    );
  });

  it('retains the existing species lookup URL as a fallback', () => {
    expect(resolveSpeciesTaxonomyLookupUrl(null)).toBe(FALLBACK_SPECIES_LOOKUP_URL);
  });
});
