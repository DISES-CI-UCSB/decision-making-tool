import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templatePath = path.resolve(__dirname, './manifest.template.json');
const generatedManifestPath = path.resolve(__dirname, '../public/data/layer-manifest/manifest.json');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertString(value, label) {
  assert(
    typeof value === 'string' && value.trim().length > 0,
    `${label} must be a non-empty string`,
  );
}

function assertBoolean(value, label) {
  assert(typeof value === 'boolean', `${label} must be a boolean`);
}

function assertUnique(values, label) {
  const seen = new Set();
  const duplicates = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  assert(
    duplicates.size === 0,
    `${label} contains duplicate values: ${Array.from(duplicates).join(', ')}`,
  );
}

function assertAsset(asset, label) {
  assert(asset && typeof asset === 'object' && !Array.isArray(asset), `${label} must be an object`);
  assertString(asset.kind, `${label}.kind`);

  if (asset.kind === 'blob') {
    assertString(asset.url, `${label}.url`);
    assertString(asset.blobPath, `${label}.blobPath`);
  }

  if (asset.url) {
    assert(
      asset.url.startsWith('https://') || asset.url.startsWith('/'),
      `${label}.url must be an HTTPS URL or local public path`,
    );
  }
}

function validateManifest(manifest, manifestPath) {
  assert(
    manifest && typeof manifest === 'object' && !Array.isArray(manifest),
    'Manifest root must be an object',
  );
  assertString(manifest.version, 'version');
  assertString(manifest.publicBlobHost, 'publicBlobHost');
  assert(Array.isArray(manifest.categories), 'categories must be an array');
  assert(Array.isArray(manifest.layers), 'layers must be an array');

  const categoryIds = manifest.categories.map((category, index) => {
    assert(category && typeof category === 'object', `categories[${index}] must be an object`);
    assertString(category.id, `categories[${index}].id`);
    assertString(category.title, `categories[${index}].title`);
    return category.id;
  });

  assertUnique(categoryIds, 'categories.id');
  const knownCategoryIds = new Set(categoryIds);

  const layerIds = manifest.layers.map((layer, index) => {
    assert(layer && typeof layer === 'object', `layers[${index}] must be an object`);
    assertString(layer.id, `layers[${index}].id`);
    assertString(layer.displayName, `layers[${index}].displayName`);
    assertString(layer.category, `layers[${index}].category`);
    assert(
      knownCategoryIds.has(layer.category),
      `layers[${index}].category is not listed in categories: ${layer.category}`,
    );

    assert(
      layer.visibility && typeof layer.visibility === 'object',
      `layers[${index}].visibility must be an object`,
    );
    assertBoolean(layer.visibility.sidebar, `layers[${index}].visibility.sidebar`);

    assert(
      layer.assets && typeof layer.assets === 'object',
      `layers[${index}].assets must be an object`,
    );
    const assetEntries = Object.entries(layer.assets);
    assert(assetEntries.length > 0, `layers[${index}].assets must include at least one asset`);

    for (const [assetName, asset] of assetEntries) {
      assertAsset(asset, `layers[${index}].assets.${assetName}`);
    }

    return layer.id;
  });

  assertUnique(layerIds, 'layers.id');

  return {
    manifestPath,
    categoryCount: manifest.categories.length,
    layerCount: manifest.layers.length,
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function getTargetPaths() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    return args.map((arg) => path.resolve(process.cwd(), arg));
  }

  const paths = [templatePath];

  if (await exists(generatedManifestPath)) {
    paths.push(generatedManifestPath);
  }

  return paths;
}

async function main() {
  const targetPaths = await getTargetPaths();

  for (const targetPath of targetPaths) {
    const manifest = await readJson(targetPath);
    const result = validateManifest(manifest, targetPath);
    console.log(
      `[validate:layer-manifest] ${path.relative(process.cwd(), result.manifestPath)} passed (${result.layerCount} layer(s), ${result.categoryCount} categories)`,
    );
  }
}

main().catch((error) => {
  console.error(`[validate:layer-manifest] ${error.message}`);
  process.exit(1);
});
