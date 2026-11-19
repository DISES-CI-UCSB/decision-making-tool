import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';
import type { CatalogTest, TestCatalog } from '../catalog/test-catalog.ts';
import { redactCredentials } from './credential-redaction.ts';

/**
 * Read from disk because Playwright loads specs as native ES modules, where the JSON import inside
 * test-catalog.ts would need a `with { type: 'json' }` attribute. The type-only import above is erased.
 */
const catalogPath = new URL('../catalog/test-catalog.json', import.meta.url);

export const narrationAnnotationType = 'What this proves';
export const narrationAttachmentName = 'What this test proves';

/** UI mode shows text attachments in a code viewer that does not wrap lines. */
const attachmentLineWidth = 76;

const partLabels = '(?:Files? requested|What it checks|Real|Test-only|Not checked)';
/** A labeled methodology part such as `Real:` starts a new paragraph. */
const labeledPartStart = new RegExp(` (?=${partLabels}: )`);
/** Methodologies name their file keys, then say which environment variables override them, then describe the checks. */
const keyOverrideSentence = /(can override the keys?\.) /;

/** The methodology's opening claim, before its `File requested:` or `Files requested:` part. */
export function methodologySummary(methodology: string): string {
  return methodology.split(labeledPartStart)[0].trim();
}

/** The full methodology as plain text: the identifier and name, then one wrapped paragraph per labeled part. */
export function methodologyText(catalogTest: Pick<CatalogTest, 'id' | 'name' | 'methodology'>): string {
  const paragraphs = catalogTest.methodology
    .replace(keyOverrideSentence, '$1 What it checks: ')
    .split(labeledPartStart);
  return [`${catalogTest.id}: ${catalogTest.name}`, ...paragraphs]
    .map((paragraph) => wrapWords(paragraph.trim(), attachmentLineWidth))
    .join('\n\n');
}

function wrapWords(paragraph: string, width: number): string {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * Shows a catalog test's methodology in Playwright UI mode, the trace viewer, and reports.
 * The catalog stays the only copy of the text. Call it inside the test body.
 */
export async function narrateCatalogTest(testId: string): Promise<void> {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as TestCatalog;
  const catalogTest = catalog.tests.find(({ id }) => id === testId);
  if (!catalogTest) throw new Error(`${testId} is not in tests/support/catalog/test-catalog.json.`);
  test.info().annotations.push({
    type: narrationAnnotationType,
    description: redactCredentials(methodologySummary(catalogTest.methodology)),
  });
  await test.info().attach(narrationAttachmentName, {
    body: redactCredentials(methodologyText(catalogTest)),
    contentType: 'text/plain',
  });
}
