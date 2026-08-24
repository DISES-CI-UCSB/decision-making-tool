const TERRITORIAL_SIRAP_SEMANTICS = {
  siraps_territorial: {
    spanishLabel: 'SIRAP territoriales (desactualizados)',
    englishLabel: 'Territorial SIRAPs (outdated)',
    description: 'Outdated Territorial SIRAP boundaries retained as a view-only comparison layer.',
    tooltip: 'Outdated Territorial SIRAP boundaries retained as a view-only comparison layer.',
    dataRole: 'reference_layer',
    category: 'administrative_boundaries',
    roleInMetricCalculation: 'none',
    requiredForSolution: false,
    selectableInFinder: false,
    visibleInMapLayers: true,
  },
  siraps_territorial_updated: {
    spanishLabel: 'SIRAP territoriales',
    englishLabel: 'Territorial SIRAPs',
    description:
      'Authoritative six-feature Territorial SIRAP boundaries used for AOI selection and metric lookup.',
    tooltip:
      'Authoritative six-feature Territorial SIRAP boundaries used for AOI selection and metric lookup.',
    dataRole: 'administrative_boundary',
    category: 'administrative_boundaries',
    roleInMetricCalculation: 'boundary_used_for_precomputed_metric_lookup',
  },
};

const OPTIONAL_SELECTION_FIELDS = [
  'requiredForSolution',
  'selectableInFinder',
  'visibleInMapLayers',
];

export function applyAuthoritativeLayerSemantics(layer) {
  const semantics = TERRITORIAL_SIRAP_SEMANTICS[layer.id];
  if (!semantics) {
    return structuredClone(layer);
  }

  const updated = { ...structuredClone(layer), ...semantics };
  for (const field of OPTIONAL_SELECTION_FIELDS) {
    if (!(field in semantics)) {
      delete updated[field];
    }
  }
  return updated;
}
