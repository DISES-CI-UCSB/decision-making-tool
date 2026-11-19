import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assertHydrationPackage, buildHydrationPackage } from './hydration-package.mjs';

describe('hydration package', () => {
  it('defaults future hydrate to the EPSG:9377 land-solution grid', () => {
    const packageDocument = buildHydrationPackage();

    assert.equal(packageDocument.format, 'dmt-hydration-package/v1');
    assert.equal(packageDocument.defaultReferenceGrid, 'land-solution');
    assert.equal(packageDocument.referenceGrids['land-solution'].crs, 'EPSG:9377');
    assert.match(
      packageDocument.referenceGrids['land-solution'].referenceRaster.url,
      /land-solution-9377\/ecosistemas_IDEAM_MEC_2024\.tif$/,
    );
    assert.equal(packageDocument.sirap.releaseId, 'sirap-2026-09-02-v6');
    assertHydrationPackage(packageDocument);
  });
});
