const CATEGORY_PATH_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)?$/;
const STYLE_DEFAULT_FIELDS = ['selectedColor', 'startColor', 'endColor'];

export function applyStyleRequestToManifest(manifest, request) {
  const styleChanges = request?.styleChanges;
  if (!styleChanges || typeof styleChanges !== 'object') {
    throw new Error('Style request is missing styleChanges.');
  }

  assertManifestShape(manifest);
  assertLayerCategoryPaths(manifest);

  const categoryDefaults = Array.isArray(styleChanges.categoryDefaults)
    ? styleChanges.categoryDefaults
    : [];
  const subcategoryDefaults = Array.isArray(styleChanges.subcategoryDefaults)
    ? styleChanges.subcategoryDefaults
    : [];
  const layerStyles = Array.isArray(styleChanges.layerStyles) ? styleChanges.layerStyles : [];

  const categoryIds = new Set(manifest.categories.map((category) => category.id));
  const layerIds = new Set(manifest.layers.map((layer) => layer.id));

  for (const change of categoryDefaults) {
    if (!categoryIds.has(change?.categoryId)) {
      throw new Error(`Style request references unknown category "${change?.categoryId}".`);
    }
  }

  for (const change of subcategoryDefaults) {
    const category = manifest.categories.find((entry) => entry.id === change?.categoryId);
    const subcategory = category?.subcategories?.find(
      (entry) => entry.id === change?.subcategoryId,
    );
    if (!category || !subcategory) {
      throw new Error(
        `Style request references unknown subcategory "${change?.categoryId}.${change?.subcategoryId}".`,
      );
    }
  }

  for (const change of layerStyles) {
    if (!layerIds.has(change?.layerId)) {
      throw new Error(`Style request references unknown layer "${change?.layerId}".`);
    }
  }

  return {
    ...manifest,
    categories: applyDefaultChanges(manifest.categories, categoryDefaults, subcategoryDefaults),
    layers: applyLayerStyleChanges(manifest.layers, layerStyles),
    manualEdit: {
      editorName: request.editorName ?? 'unknown-editor',
      editedAt: new Date().toISOString(),
      source: 'manifest-style-request',
    },
  };
}

export function findLatestPendingStyleRequest(requests) {
  return (
    requests
      .filter((request) => request?.status === 'pending')
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))[0] ?? null
  );
}

export function assertLayerCategoryPaths(manifest) {
  const categoryIds = new Set(manifest.categories.map((category) => category.id));
  const subcategoryIdsByCategory = new Map(
    manifest.categories.map((category) => [
      category.id,
      new Set((category.subcategories ?? []).map((subcategory) => subcategory.id)),
    ]),
  );

  for (const layer of manifest.layers) {
    const { categoryId, subcategoryId } = parseCategoryPath(layer.category);
    if (!categoryIds.has(categoryId)) {
      throw new Error(`Layer "${layer.id}" references unknown category "${categoryId}".`);
    }
    if (subcategoryId && !subcategoryIdsByCategory.get(categoryId)?.has(subcategoryId)) {
      throw new Error(
        `Layer "${layer.id}" references unknown subcategory "${categoryId}.${subcategoryId}".`,
      );
    }
  }
}

function applyDefaultChanges(categories, categoryDefaults, subcategoryDefaults) {
  const categoryDefaultsById = new Map(
    categoryDefaults.map((change) => [change.categoryId, pruneStyleDefaults(change.styleDefaults)]),
  );
  const subcategoryDefaultsByPath = new Map(
    subcategoryDefaults.map((change) => [
      `${change.categoryId}.${change.subcategoryId}`,
      pruneStyleDefaults(change.styleDefaults),
    ]),
  );

  return categories.map((category) => {
    const nextCategory = categoryDefaultsById.has(category.id)
      ? { ...category, styleDefaults: categoryDefaultsById.get(category.id) }
      : category;
    if (!nextCategory.subcategories?.length) {
      return nextCategory;
    }

    return {
      ...nextCategory,
      subcategories: nextCategory.subcategories.map((subcategory) => {
        const key = `${nextCategory.id}.${subcategory.id}`;
        return subcategoryDefaultsByPath.has(key)
          ? { ...subcategory, styleDefaults: subcategoryDefaultsByPath.get(key) }
          : subcategory;
      }),
    };
  });
}

function applyLayerStyleChanges(layers, layerStyles) {
  const layerStylesById = new Map(layerStyles.map((change) => [change.layerId, change]));
  return layers.map((layer) => {
    const change = layerStylesById.get(layer.id);
    if (!change) {
      return layer;
    }

    return {
      ...layer,
      rendering: change.rendering ?? layer.rendering,
      styleOverride: change.styleOverride ?? null,
    };
  });
}

function pruneStyleDefaults(defaults) {
  return Object.fromEntries(
    STYLE_DEFAULT_FIELDS.map((fieldName) => [fieldName, defaults?.[fieldName] ?? null]).filter(
      ([, value]) => value != null && value !== '',
    ),
  );
}

function parseCategoryPath(category) {
  if (typeof category !== 'string' || !CATEGORY_PATH_PATTERN.test(category)) {
    throw new Error(`layer.category "${category}" must match ^[a-z0-9_]+(\\.[a-z0-9_]+)?$`);
  }
  const [categoryId, subcategoryId = null] = category.split('.');
  return { categoryId, subcategoryId };
}

function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be an object.');
  }
  if (!Array.isArray(manifest.categories) || !Array.isArray(manifest.layers)) {
    throw new Error('Manifest must include categories and layers arrays.');
  }
  if (!Array.isArray(manifest.solutions)) {
    throw new Error('Manifest must include a solutions array.');
  }
}

function toMillis(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1_000_000);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}
