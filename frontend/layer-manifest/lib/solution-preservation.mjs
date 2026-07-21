import { createSolutionPrecomputedMetricUrls } from './metric-urls.mjs';

export function selectManifestSolutions({
  publishedManifestIndex,
  generatedSolutions,
  existingManifestIndex,
}) {
  const preservedPublishedSolutions = publishedSolutions(publishedManifestIndex);
  const rawSolutions =
    preservedPublishedSolutions.length > 0
      ? preservedPublishedSolutions
      : generatedSolutions.length > 0
        ? preserveSolutionUrls(generatedSolutions, existingManifestIndex)
        : (existingManifestIndex?.manifest?.solutions ?? []);
  const solutions = rawSolutions.map(refreshSolutionMetricUrls);
  const preservedExistingSolutions =
    preservedPublishedSolutions.length === 0 &&
    generatedSolutions.length === 0 &&
    solutions.length > 0
      ? solutions
      : [];

  return { solutions, preservedPublishedSolutions, preservedExistingSolutions };
}

function preserveSolutionUrls(solutions, existingManifestIndex) {
  const existingSolutions = new Map(
    (existingManifestIndex?.manifest?.solutions ?? [])
      .filter((solution) => solution && typeof solution.id === 'string')
      .map((solution) => [solution.id, solution]),
  );

  return solutions.map((solution) => {
    const existingSolution = existingSolutions.get(solution.id);
    const displayCogUrl = existingSolution?.displayCogUrl;
    return {
      ...solution,
      ...(typeof displayCogUrl === 'string' && displayCogUrl.length > 0 ? { displayCogUrl } : {}),
      precomputedMetricUrls: createSolutionPrecomputedMetricUrls(
        solution.id,
        existingSolution?.precomputedMetricUrls ?? solution.precomputedMetricUrls ?? {},
        solution.displayUrl,
      ),
    };
  });
}

function publishedSolutions(existingManifestIndex) {
  const solutions = existingManifestIndex?.manifest?.solutions;
  if (!Array.isArray(solutions) || solutions.length === 0) {
    return [];
  }
  return structuredClone(solutions).map(refreshSolutionMetricUrls);
}

function refreshSolutionMetricUrls(solution) {
  return {
    ...solution,
    precomputedMetricUrls: createSolutionPrecomputedMetricUrls(
      solution.id,
      solution.precomputedMetricUrls ?? {},
      solution.displayUrl,
    ),
  };
}
