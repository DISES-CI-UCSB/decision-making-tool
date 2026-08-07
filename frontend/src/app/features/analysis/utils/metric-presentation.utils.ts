import type { MetricComparisonValue, MetricValue } from '@core/models';

export type AreaDisplayUnit = 'km2' | 'hectares';
export type MetricNumberFormatMode = 'compact' | 'full';

export interface MetricFormatOptions {
  areaUnit: AreaDisplayUnit;
  locale: string;
  mode: MetricNumberFormatMode;
}

const KM2_TO_HECTARES = 100;
const AREA_METRIC_IDS = new Set([
  'area',
  'priority_area_in_region',
  'ecosystem_coverage',
  'ecosystem_coverage_paramo',
  'ecosystem_coverage_dry_forest',
  'ecosystem_coverage_wetlands',
  'mangrove_coverage',
  'coral_reef_coverage',
  'marine_mangrove_coverage',
  'seagrass_coverage',
  'indigenous_reservations_area',
  'community_councils_area',
  'protected_area_runap_km2',
  'agricultural_area',
]);

export function isDisplayableMetricValue(
  metric: MetricValue | null | undefined,
): metric is MetricValue & { value: number } {
  return (
    metric !== null &&
    metric !== undefined &&
    (metric.status === 'ready' || metric.status === 'partial') &&
    metric.value !== null &&
    Number.isFinite(metric.value)
  );
}

/**
 * Reads the metric's numeric value when it is displayable, otherwise null. Callers that need a
 * number should use this instead of re-deriving displayability from `status`, so that `partial`
 * metrics carrying real values stay visible everywhere.
 */
export function displayableMetricValue(metric: MetricValue | null | undefined): number | null {
  return isDisplayableMetricValue(metric) ? metric.value : null;
}

/**
 * Translation descriptor for the caveat shown alongside a `partial` metric. Counts are returned
 * raw so the caller can apply its own locale-aware number formatting.
 */
export interface MetricAvailabilityNote {
  key: string;
  counts: Record<string, number>;
}

export function metricAvailabilityNote(
  metric: MetricValue | null | undefined,
): MetricAvailabilityNote | null {
  if (!metric || metric.status !== 'partial') {
    return null;
  }

  const exception = asRecord(metric.details?.['speciesException']);
  const available = readCount(exception?.['availableExpected']);
  const total = readCount(exception?.['catalogTotal']);
  if (available !== null && total !== null) {
    return { key: 'analysis.common.partialSpeciesCoverage', counts: { available, total } };
  }

  const excluded = readCount(exception?.['excluded']);
  if (excluded !== null) {
    return { key: 'analysis.common.partialSpeciesSources', counts: { excluded } };
  }

  return { key: 'analysis.common.partialSources', counts: {} };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function formatMetricValue(
  metric: MetricValue,
  options: MetricFormatOptions,
  unavailableValue: string,
): string {
  if (metric.value === null) {
    return unavailableValue;
  }

  return formatMetricNumberAndUnit(metric, metric.value, options);
}

export function formatMetricDelta(
  metric: MetricComparisonValue,
  options: MetricFormatOptions,
  unavailableValue: string,
): string {
  if (metric.delta === null) {
    return unavailableValue;
  }

  const sign = metric.delta > 0 ? '+' : '';
  return `${sign}${formatMetricNumberAndUnit(
    { ...metric.candidate, formatHint: metric.formatHint },
    metric.delta,
    options,
  )}`;
}

export function formatPanelMetric(metric: MetricValue, options: MetricFormatOptions): string {
  return formatMetricNumberAndUnit(metric, metric.value ?? 0, options);
}

export function formatAreaValue(valueKm2: number, options: MetricFormatOptions): string {
  return appendUnit(
    formatNumber(convertAreaValue(valueKm2, options.areaUnit), options, 0, 2),
    areaUnitLabel(options.areaUnit),
  );
}

export function formatNumber(
  value: number,
  options: Pick<MetricFormatOptions, 'locale' | 'mode'>,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): string {
  const locale = resolveNumberLocale(options.locale);
  if (options.mode === 'compact') {
    const absoluteValue = Math.abs(value);
    const compactScale =
      absoluteValue >= 1_000_000 ? 1_000_000 : absoluteValue >= 1_000 ? 1_000 : 1;
    const formattedValue = new Intl.NumberFormat(locale, {
      minimumFractionDigits,
      maximumFractionDigits: compactScale === 1 ? maximumFractionDigits : 1,
    }).format(value / compactScale);

    if (compactScale === 1_000_000) {
      return `${formattedValue}M`;
    }
    if (compactScale === 1_000) {
      return options.locale === 'es' ? `${formattedValue} mil` : `${formattedValue}K`;
    }
    return formattedValue;
  }

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

export function appendUnit(value: string, unit: string | null): string {
  if (unit === '%') {
    return `${value}%`;
  }
  if (unit === 'count') {
    return value;
  }
  return unit ? `${value} ${unit}` : value;
}

export function areaUnitLabel(unit: AreaDisplayUnit): string {
  return unit === 'hectares' ? 'ha' : 'km²';
}

function formatMetricNumberAndUnit(
  metric: MetricValue,
  value: number,
  options: MetricFormatOptions,
): string {
  const displayValue = isAreaMetric(metric) ? convertAreaValue(value, options.areaUnit) : value;
  const displayUnit = getMetricDisplayUnit(metric, options.areaUnit);
  const fractionDigits =
    metric.formatHint === 'currency'
      ? { minimum: 1, maximum: 1 }
      : { minimum: 0, maximum: metric.formatHint === 'percent' ? 1 : 2 };
  const number = formatNumber(
    displayValue,
    options,
    fractionDigits.minimum,
    fractionDigits.maximum,
  );

  return metric.formatHint === 'percent' ? `${number}%` : appendUnit(number, displayUnit);
}

function convertAreaValue(valueKm2: number, unit: AreaDisplayUnit): number {
  return unit === 'hectares' ? valueKm2 * KM2_TO_HECTARES : valueKm2;
}

function isAreaMetric(metric: Pick<MetricValue, 'metricId'>): boolean {
  return AREA_METRIC_IDS.has(metric.metricId);
}

export function getMetricDisplayUnit(
  metric: MetricValue,
  areaUnit: AreaDisplayUnit,
): string | null {
  if (isAreaMetric(metric)) {
    return areaUnitLabel(areaUnit);
  }
  if (
    metric.metricId === 'carbon_biomass_total' ||
    metric.metricId === 'soil_organic_carbon' ||
    metric.metricId === 'carbon_storage_biomass'
  ) {
    return 'Mg·km²';
  }
  if (!metric.unit || metric.unit === 'count') {
    return null;
  }

  return metric.unit.replace(/Mg\s*[-·x*/]\s*km\^?2\b/g, 'Mg/km²').replace(/km\^?2\b/g, 'km²');
}

function resolveNumberLocale(locale: string): string {
  return locale === 'es' ? 'es-CO' : 'en-US';
}
