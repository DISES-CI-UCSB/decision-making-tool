import type {
  CustomAoiAreaProfileResponse,
  CustomAoiEcosystemRecord,
  CustomAoiEcosystemView,
  CustomAoiProfileSectionStatus,
  CustomAoiSpeciesRecord,
  CustomAoiSpeciesSection,
} from '@core/models';

export const CUSTOM_AOI_ECOSYSTEM_VIEWS: readonly CustomAoiEcosystemView[] = [
  'biomeFamily',
  'broadBiomeContext',
  'biomeRegion',
  'broadEcosystem',
  'detailedEcosystem',
];

export interface ParsedCustomAoiEcosystemsSection {
  status: CustomAoiProfileSectionStatus;
  views: Record<CustomAoiEcosystemView, CustomAoiEcosystemRecord[]>;
}

const SECTION_STATUSES = new Set<CustomAoiProfileSectionStatus>([
  'complete',
  'empty',
  'zero_cells',
  'unavailable',
  'failed',
]);

export function parseSpeciesSection(response: unknown): CustomAoiSpeciesSection {
  const document = parseDocument(response);
  const section = document.sections.species;
  if (!section || !SECTION_STATUSES.has(section.status)) {
    throw new Error('Invalid species section');
  }

  return {
    status: section.status,
    records: section.records.filter(isSpeciesRecord),
  };
}

export function parseEcosystemsSection(response: unknown): ParsedCustomAoiEcosystemsSection {
  const document = parseDocument(response);
  const section = document.sections.ecosystems;
  if (!section || !SECTION_STATUSES.has(section.status)) {
    throw new Error('Invalid ecosystems section');
  }

  const recordsByView = new Map<CustomAoiEcosystemView, unknown>();
  const rawViews = section.views as unknown;
  if (Array.isArray(rawViews)) {
    for (const view of rawViews) {
      if (view && typeof view === 'object' && 'id' in view && 'records' in view) {
        recordsByView.set(view.id as CustomAoiEcosystemView, view.records);
      }
    }
  } else if (rawViews && typeof rawViews === 'object') {
    for (const [view, records] of Object.entries(rawViews)) {
      recordsByView.set(view as CustomAoiEcosystemView, records);
    }
  }

  return {
    status: section.status,
    views: Object.fromEntries(
      CUSTOM_AOI_ECOSYSTEM_VIEWS.map((view) => [
        view,
        Array.isArray(recordsByView.get(view))
          ? (recordsByView.get(view) as unknown[]).filter(isEcosystemRecord)
          : [],
      ]),
    ) as Record<CustomAoiEcosystemView, CustomAoiEcosystemRecord[]>,
  };
}

function parseDocument(response: unknown): CustomAoiAreaProfileResponse {
  if (
    !response ||
    typeof response !== 'object' ||
    (response as CustomAoiAreaProfileResponse).format !== 'custom-aoi-area-profile-v1' ||
    !(response as CustomAoiAreaProfileResponse).sections
  ) {
    throw new Error('Invalid custom AOI area profile response');
  }
  return response as CustomAoiAreaProfileResponse;
}

function isSpeciesRecord(value: unknown): value is CustomAoiSpeciesRecord {
  const record = value as CustomAoiSpeciesRecord;
  return (
    Boolean(record) &&
    typeof record.id === 'string' &&
    typeof record.scientific_name === 'string' &&
    typeof record.group === 'string' &&
    (record.iucn_status === null || typeof record.iucn_status === 'string')
  );
}

function isEcosystemRecord(value: unknown): value is CustomAoiEcosystemRecord {
  const record = value as CustomAoiEcosystemRecord;
  return (
    Boolean(record) &&
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    Number.isFinite(record.area_km2) &&
    (record.share_of_classified_pct === null || Number.isFinite(record.share_of_classified_pct))
  );
}
