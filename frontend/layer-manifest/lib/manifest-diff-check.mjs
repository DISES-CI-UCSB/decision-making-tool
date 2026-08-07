/**
 * Prove a rebuilt runtime manifest differs from its predecessor in one field only.
 *
 * Run as:
 *   node frontend/layer-manifest/lib/manifest-diff-check.mjs <baseline.json> <rebuilt.json> <field>
 */
import { promises as fs } from 'node:fs';

function collectDifferences(baseline, rebuilt, path = '$', differences = []) {
  if (baseline === rebuilt) return differences;

  const bothObjects =
    baseline && rebuilt && typeof baseline === 'object' && typeof rebuilt === 'object';
  if (!bothObjects || Array.isArray(baseline) !== Array.isArray(rebuilt)) {
    differences.push({ path, baseline, rebuilt });
    return differences;
  }

  if (Array.isArray(baseline)) {
    if (baseline.length !== rebuilt.length) {
      differences.push({ path: `${path}.length`, baseline: baseline.length, rebuilt: rebuilt.length });
      return differences;
    }
    baseline.forEach((value, index) =>
      collectDifferences(value, rebuilt[index], `${path}[${index}]`, differences),
    );
    return differences;
  }

  for (const key of new Set([...Object.keys(baseline), ...Object.keys(rebuilt)])) {
    collectDifferences(baseline[key], rebuilt[key], `${path}.${key}`, differences);
  }
  return differences;
}

function stripField(value, field) {
  if (Array.isArray(value)) return value.map((item) => stripField(item, field));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== field)
      .map(([key, nested]) => [key, stripField(nested, field)]),
  );
}

async function main() {
  const [baselinePath, rebuiltPath, field = 'displayCogUrl'] = process.argv.slice(2);
  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf-8'));
  const rebuilt = JSON.parse(await fs.readFile(rebuiltPath, 'utf-8'));

  const differences = collectDifferences(baseline, rebuilt);
  const offending = differences.filter((difference) => !difference.path.endsWith(`.${field}`));
  const added = differences.filter(
    (difference) => difference.baseline === undefined && typeof difference.rebuilt === 'string',
  );

  console.log(`total differing paths: ${differences.length}`);
  console.log(`paths ending in .${field}: ${differences.length - offending.length}`);
  console.log(`of those, pure additions (undefined -> string): ${added.length}`);

  if (offending.length > 0) {
    console.error(`\nUNEXPECTED differences outside ${field}:`);
    for (const difference of offending.slice(0, 20)) {
      console.error(`  ${difference.path}`);
    }
    process.exit(1);
  }

  // Strongest form of the claim: removing the field restores the original bytes.
  const strippedMatches =
    JSON.stringify(stripField(rebuilt, field)) === JSON.stringify(stripField(baseline, field));
  console.log(`rebuilt manifest with ${field} removed is byte-identical to baseline: ${strippedMatches}`);
  if (!strippedMatches) {
    console.error(`removing ${field} did not restore the baseline bytes`);
    process.exit(1);
  }

  console.log(`\nOK: the only change is ${field} on ${differences.length} solution(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
