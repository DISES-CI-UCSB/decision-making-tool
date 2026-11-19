import { createSolutionPrecomputedMetricUrls } from './metric-urls.mjs';

export function selectManifestSolutions({
  publishedManifestIndex,
  generatedSolutions,
  existingManifestIndex,
  registeredSolutionBlobPrefixes = [],
  releaseId = null,
}) {
  const preservedPublishedSolutions = releaseId
    ? []
    : publishedSolutions(publishedManifestIndex);
  const registeredGeneratedSolutions = generatedSolutions.filter((solution) =>
    registeredSolutionBlobPrefixes.some((prefix) => solution.blobPath?.startsWith(prefix)),
  );
  const rawSolutions =
    preservedPublishedSolutions.length > 0
      ? mergeSolutions(
          preservedPublishedSolutions,
          preserveSolutionUrls(registeredGeneratedSolutions, publishedManifestIndex, releaseId),
        )
      : generatedSolutions.length > 0
        ? preserveSolutionUrls(generatedSolutions, existingManifestIndex, releaseId)
        : (existingManifestIndex?.manifest?.solutions ?? []);
  const solutions = rawSolutions.map((solution) => refreshSolutionMetricUrls(solution, releaseId));
  const preservedExistingSolutions =
    preservedPublishedSolutions.length === 0 &&
    generatedSolutions.length === 0 &&
    solutions.length > 0
      ? solutions
      : [];

  return { solutions, preservedPublishedSolutions, preservedExistingSolutions };
}

function mergeSolutions(published, registered) {
  const mergedById = new Map(published.map((solution) => [solution.id, solution]));
  for (const solution of registered) {
    mergedById.set(solution.id, solution);
  }
  return [...mergedById.values()];
}

function preserveSolutionUrls(solutions, existingManifestIndex, releaseId = null) {
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
        solutionDomain(solution),
        { releaseId },
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

function refreshSolutionMetricUrls(solution, releaseId = null) {
  return {
    ...solution,
    precomputedMetricUrls: createSolutionPrecomputedMetricUrls(
      solution.id,
      solution.precomputedMetricUrls ?? {},
      solutionDomain(solution),
      { releaseId },
    ),
  };
}

function solutionDomain(solution) {
  if (
    solution.domain === 'marine' ||
    solution.finderInputs?.domain === 'marine' ||
    solution.scope === 'marine' ||
    solution.blobPath?.startsWith('solutions/marine/')
  ) {
    return 'marine';
  }
  return 'land';
}
