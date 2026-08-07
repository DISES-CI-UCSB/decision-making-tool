import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  CATALOG_KEYS,
  SOLUTION_ENTRY_KEYS,
  SPECIES_EXCEPTION_KEYS,
  canonicalSolutionCatalogDocument,
  solutionCatalogSha256,
  validateSolutionCatalog,
} from './solution-catalog.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE_PATH = path.join(repoRoot, 'data/metrics/fixtures/solution-catalog-hash-parity.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

function caseByName(name) {
  const found = FIXTURE.cases.find((entry) => entry.name === name);
  assert.ok(found, `parity fixture is missing the "${name}" case`);
  return found;
}

describe('solution catalog identity digest parity with Python', () => {
  it('loads a parity fixture covering every catalog shape', () => {
    assert.equal(FIXTURE.format, 'solution-catalog-hash-parity-v1');
    assert.deepEqual(
      FIXTURE.cases.map((entry) => entry.name).sort(),
      [
        'null-species-exception',
        'reversed-key-insertion-order',
        'unicode-strings',
        'with-species-exception',
        'without-species-exception',
      ],
      'the parity fixture case list changed; regenerate digests from Python before editing',
    );
  });

  for (const parityCase of FIXTURE.cases) {
    it(`matches the Python digest for ${parityCase.name}`, () => {
      assert.equal(
        solutionCatalogSha256(structuredClone(parityCase.catalog)),
        parityCase.expectedSha256,
        `${parityCase.name}: JavaScript digest diverged from Python SolutionCatalog.sha256`,
      );
    });
  }

  it('treats an explicitly null speciesException as absent, exactly as Python does', () => {
    assert.equal(
      caseByName('null-species-exception').expectedSha256,
      caseByName('without-species-exception').expectedSha256,
    );
  });

  it('ignores key insertion order because both runtimes sort keys', () => {
    assert.equal(
      caseByName('reversed-key-insertion-order').expectedSha256,
      caseByName('with-species-exception').expectedSha256,
    );
    const reversedKeys = Object.keys(caseByName('reversed-key-insertion-order').catalog);
    assert.notDeepEqual(
      reversedKeys,
      [...reversedKeys].sort(),
      'the insertion-order case must not be pre-sorted or it proves nothing',
    );
  });

  it('emits raw UTF-8 for non-ASCII strings rather than escaping them', () => {
    const unicodeCase = caseByName('unicode-strings');
    const basenames = unicodeCase.catalog.solutions.map((entry) => entry.solutionBasename);
    assert.ok(
      basenames.some((basename) => /[^\u0000-\u007f]/.test(basename)),
      'the unicode case must contain non-ASCII characters',
    );
    assert.notEqual(
      solutionCatalogSha256(structuredClone(unicodeCase.catalog)),
      caseByName('with-species-exception').expectedSha256,
    );
  });

  it('hashes exactly the keys Python to_dict() produces', () => {
    assert.deepEqual([...CATALOG_KEYS].sort(), FIXTURE.contract.catalogKeys);
    assert.deepEqual([...SOLUTION_ENTRY_KEYS].sort(), FIXTURE.contract.solutionEntryKeys);
    assert.deepEqual([...SPECIES_EXCEPTION_KEYS].sort(), FIXTURE.contract.speciesExceptionKeys);

    const document = canonicalSolutionCatalogDocument(
      structuredClone(caseByName('with-species-exception').catalog),
    );
    assert.deepEqual(Object.keys(document).sort(), FIXTURE.contract.catalogKeys);
    assert.deepEqual(Object.keys(document.solutions[0]).sort(), FIXTURE.contract.solutionEntryKeys);
    assert.deepEqual(
      Object.keys(document.speciesException).sort(),
      FIXTURE.contract.speciesExceptionKeys,
    );
  });

  it('rejects catalog keys that would silently drop out of the digest', () => {
    const catalog = structuredClone(caseByName('with-species-exception').catalog);
    catalog.someFutureContractField = { totals: 1 };
    assert.throws(
      () => validateSolutionCatalog(catalog),
      /catalog contains unknown keys not covered by the catalog identity digest: someFutureContractField/,
    );
  });

  it('rejects unknown keys inside solution entries and the species exception', () => {
    const withEntryKey = structuredClone(caseByName('with-species-exception').catalog);
    withEntryKey.solutions[0].rasterBytes = 12;
    assert.throws(
      () => validateSolutionCatalog(withEntryKey),
      /catalog\.solutions\[0\] contains unknown keys[^:]*: rasterBytes/,
    );

    const withExceptionKey = structuredClone(caseByName('with-species-exception').catalog);
    withExceptionKey.speciesException.excludedIds = ['a', 'b'];
    assert.throws(
      () => validateSolutionCatalog(withExceptionKey),
      /catalog\.speciesException contains unknown keys[^:]*: excludedIds/,
    );
  });

  it('requires a structurally complete species exception binding', () => {
    const missingField = structuredClone(caseByName('with-species-exception').catalog);
    delete missingField.speciesException.policySha256;
    assert.throws(
      () => validateSolutionCatalog(missingField),
      /catalog\.speciesException\.policySha256 is required/,
    );

    const inconsistentCounts = structuredClone(caseByName('with-species-exception').catalog);
    inconsistentCounts.speciesException.excluded = 3;
    assert.throws(
      () => validateSolutionCatalog(inconsistentCounts),
      /catalogTotal must equal availableExpected \+ excluded/,
    );
  });
});
