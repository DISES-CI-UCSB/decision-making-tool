import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { toBlobPath, toLayerId } from './layer-normalization.mjs';

describe('layer normalization', () => {
  it('normalizes accents, punctuation, and whitespace in layer IDs', () => {
    assert.strictEqual(toLayerId('  Recarga de Água / Alta  '), 'recarga_de_agua_alta');
  });

  it('normalizes data paths and appends filenames to directory locations', () => {
    assert.strictEqual(
      toBlobPath('\\data\\inputs\\features\\ecosystems', 'ecosistemas.tif'),
      'inputs/features/ecosystems/ecosistemas.tif',
    );
    assert.strictEqual(
      toBlobPath('notes\ndata/boundaries/admin/', 'ignored.tif'),
      'boundaries/admin/',
    );
  });

  it('leaves remote and unrelated storage locations unresolved', () => {
    assert.strictEqual(toBlobPath('https://example.com/layer.tif', 'layer.tif'), null);
    assert.strictEqual(toBlobPath('local/cache', 'layer.tif'), null);
  });
});
