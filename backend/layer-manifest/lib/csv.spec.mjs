import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseCsv, parseCsvRow, rowsToObjects, toCsv } from './csv.mjs';

describe('CSV helpers', () => {
  it('parses quoted commas, escaped quotes, multiline cells, and CRLF rows', () => {
    assert.deepStrictEqual(parseCsv('name,notes\r\n"Layer, one","line 1\r\nline ""2"""\r\n'), [
      ['name', 'notes'],
      ['Layer, one', 'line 1\r\nline "2"'],
    ]);
  });

  it('maps aliased headers and normalizes cells', () => {
    const rows = rowsToObjects(
      [
        ['Layer Name / Nombre', 'Other Header'],
        ['  Uno\rDos  ', ' value '],
      ],
      { layer_name: ['layer name'] },
    );
    assert.deepStrictEqual(rows, [{ layer_name: 'Uno\nDos', other_header: 'value' }]);
  });

  it('supports the trimmed single-row parser used by taxonomy lookup', () => {
    assert.deepStrictEqual(parseCsvRow(' "Panthera, onca" , Mammalia '), [
      'Panthera, onca',
      'Mammalia',
    ]);
  });

  it('serializes values that require CSV escaping', () => {
    assert.strictEqual(toCsv([{ id: 'one', note: 'a, "quote"' }]), 'id,note\none,"a, ""quote"""\n');
  });
});
