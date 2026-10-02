import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const routePath = path.resolve(import.meta.dirname, '../../api/dev/manifest-style-publish.ts');
const source = readFileSync(routePath, 'utf8');
const start = source.indexOf('export function hasManifestStylePublishAccess');
if (start < 0) {
  throw new Error('hasManifestStylePublishAccess was not found in the publish route.');
}
let depth = 0;
let end = start;
let seenBrace = false;
for (; end < source.length; end += 1) {
  const char = source[end];
  if (char === '{') {
    depth += 1;
    seenBrace = true;
  } else if (char === '}') {
    depth -= 1;
    if (seenBrace && depth === 0) {
      end += 1;
      break;
    }
  }
}
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const hasManifestStylePublishAccess = new Function(
  `${compiled.replace(/^export /m, '')}\nreturn hasManifestStylePublishAccess;`,
)();

describe('manifest style publish access', () => {
  it('allows explicit super-admin and legacy admin flags only', () => {
    assert.equal(hasManifestStylePublishAccess({ status: 'active', role: 'super-admin' }), true);
    assert.equal(hasManifestStylePublishAccess({ status: 'active', role: 'admin' }), true);
    assert.equal(hasManifestStylePublishAccess({ status: 'active', isAdmin: true }), true);
    assert.equal(hasManifestStylePublishAccess({ status: 'active', isSuperAdmin: true }), true);
  });

  it('does not allow publisher tier or an inactive account', () => {
    assert.equal(
      hasManifestStylePublishAccess({ status: 'active', role: 'science_publisher', tier: 3 }),
      false,
    );
    assert.equal(hasManifestStylePublishAccess({ status: 'active', tier: 3 }), false);
    assert.equal(hasManifestStylePublishAccess({ status: 'denied', role: 'super-admin' }), false);
    assert.equal(hasManifestStylePublishAccess(undefined), false);
  });
});
