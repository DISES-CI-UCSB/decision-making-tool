import type { LoadedSolution, RasterMetadata } from '@core/models/solution-catalog.model';

export const NEW_COVERAGE_VALUE = 1;
export const EXISTING_PROTECTED_VALUE = 2;

export const EARTH_RADIUS_KM = 6371.0088;
export const COLOMBIA_REFERENCE_AREA_KM2 = 1_141_748;
export const GRID_ABSOLUTE_TOLERANCE = 1e-7;

export interface LiveComparisonMetrics {
  agreementAreaKm2: number | null;
  uniqueToBaselineKm2: number | null;
  uniqueToCandidateKm2: number | null;
  baselineSelectedAreaKm2: number | null;
  candidateSelectedAreaKm2: number | null;
  newAgreementAreaKm2: number | null;
  newUniqueToBaselineKm2: number | null;
  newUniqueToCandidateKm2: number | null;
  baselineTotalSelectedAreaKm2: number | null;
  candidateTotalSelectedAreaKm2: number | null;
  baselinePreExistingAreaKm2: number | null;
  candidatePreExistingAreaKm2: number | null;
  baselineNewAreaKm2: number | null;
  candidateNewAreaKm2: number | null;
  baselineNationalContributionPct: number | null;
  candidateNationalContributionPct: number | null;
  status: 'ready' | 'unavailable';
  notes: string | null;
}

export interface LiveSolutionMetrics {
  selectedAreaKm2: number | null;
  validAreaKm2: number | null;
  nationalContributionPct: number | null;
  priorityZoneCount: number | null;
  status: 'ready' | 'unavailable';
  notes: string | null;
}

export function isValidSolutionCell(value: number, noDataValue: number | null): boolean {
  return Number.isFinite(value) && !(typeof noDataValue === 'number' && value === noDataValue);
}

export function isSelectedSolutionCell(value: number, noDataValue: number | null): boolean {
  return (
    isValidSolutionCell(value, noDataValue) &&
    (value === NEW_COVERAGE_VALUE || value === EXISTING_PROTECTED_VALUE)
  );
}

export function isNewSolutionCell(value: number, noDataValue: number | null): boolean {
  return isValidSolutionCell(value, noDataValue) && value === NEW_COVERAGE_VALUE;
}

export function isPreExistingSolutionCell(value: number, noDataValue: number | null): boolean {
  return isValidSolutionCell(value, noDataValue) && value === EXISTING_PROTECTED_VALUE;
}

export function buildOverlapRasterData(
  baseline: LoadedSolution,
  candidate: LoadedSolution,
): Float64Array | null {
  if (!hasSameRasterGrid(baseline, candidate)) {
    return null;
  }

  const length = baseline.rasterMeta.width * baseline.rasterMeta.height;
  if (baseline.rasterData.length !== length || candidate.rasterData.length !== length) {
    return null;
  }

  const overlapRaster = new Float64Array(length);

  for (let index = 0; index < length; index++) {
    overlapRaster[index] =
      isSelectedSolutionCell(baseline.rasterData[index], baseline.rasterMeta.noDataValue) &&
      isSelectedSolutionCell(candidate.rasterData[index], candidate.rasterMeta.noDataValue)
        ? NEW_COVERAGE_VALUE
        : 0;
  }

  return overlapRaster;
}

export function hasSameRasterGrid(baseline: LoadedSolution, candidate: LoadedSolution): boolean {
  const a = baseline.rasterMeta;
  const b = candidate.rasterMeta;
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.crs === b.crs &&
    numberArraysClose(a.bbox, b.bbox) &&
    numberArraysClose(a.resolution, b.resolution)
  );
}

export function getPixelAreaKm2PerRow(rasterMeta: RasterMetadata): Float64Array | null {
  const [pixelWidth, pixelHeight] = rasterMeta.resolution.map((value) => Math.abs(value));
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight)) {
    return null;
  }

  if (isGeographicRaster(rasterMeta)) {
    const kmPerDegreeLatitude = (Math.PI / 180) * EARTH_RADIUS_KM;
    const areaByRow = new Float64Array(rasterMeta.height);
    const [, , , ymax] = rasterMeta.bbox;
    const yResolution = rasterMeta.resolution[1];

    for (let row = 0; row < rasterMeta.height; row++) {
      const latitudeCenterDegrees = ymax + yResolution * (row + 0.5);
      const latitudeRadians = (latitudeCenterDegrees * Math.PI) / 180;
      const kmPerDegreeLongitude = kmPerDegreeLatitude * Math.cos(latitudeRadians);
      areaByRow[row] = pixelWidth * kmPerDegreeLongitude * pixelHeight * kmPerDegreeLatitude;
    }

    return areaByRow;
  }

  const projectedAreaKm2 = (pixelWidth * pixelHeight) / 1_000_000;
  return new Float64Array(rasterMeta.height).fill(projectedAreaKm2);
}

export function calculateLiveSolutionMetrics(loaded: LoadedSolution): LiveSolutionMetrics {
  const expectedLength = loaded.rasterMeta.width * loaded.rasterMeta.height;
  if (loaded.rasterData.length < expectedLength) {
    return unavailableSolutionMetrics(
      'Scenario raster does not contain the expected number of cells.',
    );
  }

  const pixelAreaByRow = getPixelAreaKm2PerRow(loaded.rasterMeta);
  if (!pixelAreaByRow) {
    return unavailableSolutionMetrics('Unable to derive pixel area from scenario raster metadata.');
  }

  let selectedAreaKm2 = 0;
  let validAreaKm2 = 0;
  const width = loaded.rasterMeta.width;

  for (let index = 0; index < expectedLength; index++) {
    const cellAreaKm2 = pixelAreaByRow[Math.floor(index / width)] ?? 0;
    const value = loaded.rasterData[index];

    if (isValidSolutionCell(value, loaded.rasterMeta.noDataValue)) {
      validAreaKm2 += cellAreaKm2;
    }
    if (isSelectedSolutionCell(value, loaded.rasterMeta.noDataValue)) {
      selectedAreaKm2 += cellAreaKm2;
    }
  }

  const nationalContributionPct =
    validAreaKm2 > 0 ? (selectedAreaKm2 / validAreaKm2) * 100 : null;

  return {
    selectedAreaKm2,
    validAreaKm2,
    nationalContributionPct,
    priorityZoneCount: countSelectedPriorityZones(loaded, expectedLength),
    status: 'ready',
    notes: null,
  };
}

export function calculateLiveComparisonMetrics(
  baseline: LoadedSolution,
  candidate: LoadedSolution,
): LiveComparisonMetrics {
  if (!hasSameRasterGrid(baseline, candidate)) {
    return unavailableComparisonMetrics(
      'Comparison rasters must share the same grid, CRS, and transform.',
    );
  }

  const expectedLength = baseline.rasterMeta.width * baseline.rasterMeta.height;
  if (
    baseline.rasterData.length !== expectedLength ||
    candidate.rasterData.length !== expectedLength
  ) {
    return unavailableComparisonMetrics(
      'Comparison rasters do not contain the expected number of cells.',
    );
  }

  const pixelAreaByRow = getPixelAreaKm2PerRow(baseline.rasterMeta);
  if (!pixelAreaByRow) {
    return unavailableComparisonMetrics(
      'Unable to derive pixel area from scenario raster metadata.',
    );
  }

  let agreementAreaKm2 = 0;
  let uniqueToBaselineKm2 = 0;
  let uniqueToCandidateKm2 = 0;
  let newAgreementAreaKm2 = 0;
  let newUniqueToBaselineKm2 = 0;
  let newUniqueToCandidateKm2 = 0;
  let baselinePreExistingAreaKm2 = 0;
  let candidatePreExistingAreaKm2 = 0;
  let baselineNewAreaKm2 = 0;
  let candidateNewAreaKm2 = 0;
  let baselineValidAreaKm2 = 0;
  let candidateValidAreaKm2 = 0;
  const width = baseline.rasterMeta.width;

  for (let index = 0; index < expectedLength; index++) {
    const cellAreaKm2 = pixelAreaByRow[Math.floor(index / width)] ?? 0;
    const baselineValue = baseline.rasterData[index];
    const candidateValue = candidate.rasterData[index];
    const selectedBaseline = isSelectedSolutionCell(baselineValue, baseline.rasterMeta.noDataValue);
    const selectedCandidate = isSelectedSolutionCell(
      candidateValue,
      candidate.rasterMeta.noDataValue,
    );
    const newBaseline = isNewSolutionCell(baselineValue, baseline.rasterMeta.noDataValue);
    const newCandidate = isNewSolutionCell(candidateValue, candidate.rasterMeta.noDataValue);

    if (isValidSolutionCell(baselineValue, baseline.rasterMeta.noDataValue)) {
      baselineValidAreaKm2 += cellAreaKm2;
    }
    if (isValidSolutionCell(candidateValue, candidate.rasterMeta.noDataValue)) {
      candidateValidAreaKm2 += cellAreaKm2;
    }
    if (isPreExistingSolutionCell(baselineValue, baseline.rasterMeta.noDataValue)) {
      baselinePreExistingAreaKm2 += cellAreaKm2;
    }
    if (isPreExistingSolutionCell(candidateValue, candidate.rasterMeta.noDataValue)) {
      candidatePreExistingAreaKm2 += cellAreaKm2;
    }
    if (newBaseline) baselineNewAreaKm2 += cellAreaKm2;
    if (newCandidate) candidateNewAreaKm2 += cellAreaKm2;

    if (selectedBaseline && selectedCandidate) {
      agreementAreaKm2 += cellAreaKm2;
    } else if (selectedBaseline) {
      uniqueToBaselineKm2 += cellAreaKm2;
    } else if (selectedCandidate) {
      uniqueToCandidateKm2 += cellAreaKm2;
    }

    if (newBaseline && newCandidate) {
      newAgreementAreaKm2 += cellAreaKm2;
    } else if (newBaseline) {
      newUniqueToBaselineKm2 += cellAreaKm2;
    } else if (newCandidate) {
      newUniqueToCandidateKm2 += cellAreaKm2;
    }
  }

  const baselineSelectedAreaKm2 = agreementAreaKm2 + uniqueToBaselineKm2;
  const candidateSelectedAreaKm2 = agreementAreaKm2 + uniqueToCandidateKm2;

  return {
    agreementAreaKm2,
    uniqueToBaselineKm2,
    uniqueToCandidateKm2,
    baselineSelectedAreaKm2,
    candidateSelectedAreaKm2,
    newAgreementAreaKm2,
    newUniqueToBaselineKm2,
    newUniqueToCandidateKm2,
    baselineTotalSelectedAreaKm2: baselineSelectedAreaKm2,
    candidateTotalSelectedAreaKm2: candidateSelectedAreaKm2,
    baselinePreExistingAreaKm2,
    candidatePreExistingAreaKm2,
    baselineNewAreaKm2,
    candidateNewAreaKm2,
    baselineNationalContributionPct:
      baselineValidAreaKm2 > 0 ? (baselineSelectedAreaKm2 / baselineValidAreaKm2) * 100 : null,
    candidateNationalContributionPct:
      candidateValidAreaKm2 > 0 ? (candidateSelectedAreaKm2 / candidateValidAreaKm2) * 100 : null,
    status: 'ready',
    notes: null,
  };
}

function countSelectedPriorityZones(loaded: LoadedSolution, expectedLength: number): number {
  const { width, height, noDataValue } = loaded.rasterMeta;
  const visited = new Uint8Array(expectedLength);
  const queue = new Int32Array(expectedLength);
  let zoneCount = 0;

  for (let index = 0; index < expectedLength; index++) {
    if (visited[index] || !isSelectedSolutionCell(loaded.rasterData[index], noDataValue)) {
      continue;
    }

    zoneCount++;
    visited[index] = 1;
    let queueStart = 0;
    let queueEnd = 1;
    queue[0] = index;

    while (queueStart < queueEnd) {
      const current = queue[queueStart++] ?? 0;
      const row = Math.floor(current / width);
      const col = current % width;

      for (let rowDelta = -1; rowDelta <= 1; rowDelta++) {
        for (let colDelta = -1; colDelta <= 1; colDelta++) {
          if (rowDelta === 0 && colDelta === 0) continue;

          const neighborRow = row + rowDelta;
          const neighborCol = col + colDelta;
          if (neighborRow < 0 || neighborRow >= height || neighborCol < 0 || neighborCol >= width) {
            continue;
          }

          const neighborIndex = neighborRow * width + neighborCol;
          if (
            visited[neighborIndex] ||
            !isSelectedSolutionCell(loaded.rasterData[neighborIndex], noDataValue)
          ) {
            continue;
          }

          visited[neighborIndex] = 1;
          queue[queueEnd++] = neighborIndex;
        }
      }
    }
  }

  return zoneCount;
}

function numberArraysClose(a: readonly number[], b: readonly number[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (value, index) =>
        Math.abs(value - (b[index] ?? Number.POSITIVE_INFINITY)) <= GRID_ABSOLUTE_TOLERANCE,
    )
  );
}

function isGeographicRaster(rasterMeta: RasterMetadata): boolean {
  if (rasterMeta.crs.toUpperCase().includes('EPSG:4326')) return true;

  const [xmin, ymin, xmax, ymax] = rasterMeta.bbox;
  const [xResolution, yResolution] = rasterMeta.resolution.map((value) => Math.abs(value));
  return (
    xmin >= -180 && xmax <= 180 && ymin >= -90 && ymax <= 90 && xResolution <= 1 && yResolution <= 1
  );
}

function unavailableSolutionMetrics(notes: string): LiveSolutionMetrics {
  return {
    selectedAreaKm2: null,
    validAreaKm2: null,
    nationalContributionPct: null,
    priorityZoneCount: null,
    status: 'unavailable',
    notes,
  };
}

function unavailableComparisonMetrics(notes: string): LiveComparisonMetrics {
  return {
    agreementAreaKm2: null,
    uniqueToBaselineKm2: null,
    uniqueToCandidateKm2: null,
    baselineSelectedAreaKm2: null,
    candidateSelectedAreaKm2: null,
    newAgreementAreaKm2: null,
    newUniqueToBaselineKm2: null,
    newUniqueToCandidateKm2: null,
    baselineTotalSelectedAreaKm2: null,
    candidateTotalSelectedAreaKm2: null,
    baselinePreExistingAreaKm2: null,
    candidatePreExistingAreaKm2: null,
    baselineNewAreaKm2: null,
    candidateNewAreaKm2: null,
    baselineNationalContributionPct: null,
    candidateNationalContributionPct: null,
    status: 'unavailable',
    notes,
  };
}
