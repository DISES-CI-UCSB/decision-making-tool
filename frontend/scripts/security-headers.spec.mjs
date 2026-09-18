import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function readFrontendFile(relativePath) {
  return readFileSync(path.join(frontendRoot, relativePath), 'utf8');
}

function vercelHeaderMap(vercelConfig) {
  const globalRule = vercelConfig.headers?.find((rule) => rule.source === '/(.*)');
  assert.ok(globalRule, 'vercel.json must set headers for source "/(.*)"');

  const headers = {};
  for (const header of globalRule.headers ?? []) {
    headers[header.key] = header.value;
  }
  return headers;
}

describe('baseline HTTP security headers (SEC-06)', () => {
  it('sets X-Frame-Options, nosniff, and Referrer-Policy on Vercel without a CSP', () => {
    const vercelConfig = JSON.parse(readFrontendFile('vercel.json'));
    const headers = vercelHeaderMap(vercelConfig);

    for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
      assert.equal(headers[name], value, `vercel.json is missing ${name}: ${value}`);
    }

    assert.equal(
      headers['Content-Security-Policy'],
      undefined,
      'strict Content-Security-Policy stays deferred so ArcGIS, Firebase, and Blob keep working',
    );
  });

  it('sets the same baseline headers on the Docker Nginx template without a CSP', () => {
    const nginxConfig = readFrontendFile('docker/nginx/default.conf.template');

    for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
      assert.match(
        nginxConfig,
        new RegExp(`add_header ${name} "${value}" always;`),
        `Nginx template is missing ${name}: ${value}`,
      );
    }

    assert.doesNotMatch(
      nginxConfig,
      /add_header Content-Security-Policy/,
      'strict Content-Security-Policy stays deferred so ArcGIS, Firebase, and Blob keep working',
    );
  });
});
