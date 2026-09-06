import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  GeographyLevel,
  HydratedSpeciesGoalsRecord,
  SpeciesGoalsCatalog,
  SpeciesGoalsCompactDocument,
  SpeciesTargetOverlaysDocument,
} from '@core/models';
import {
  hydrateSpeciesGoals,
  isSpeciesGoalsCatalog,
  isSpeciesGoalsCompactDocument,
  isSpeciesTargetOverlaysDocument,
  selectSpeciesTargetOverlay,
} from '@core/models';
import { Observable, catchError, forkJoin, from, map, of, shareReplay, switchMap } from 'rxjs';

import { SolutionCatalogService } from './solution-catalog.service';

@Injectable({ providedIn: 'root' })
export class SpeciesGoalsLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);
  private readonly targetOverlayCache = new Map<
    string,
    Observable<SpeciesTargetOverlaysDocument>
  >();

  load(
    solutionId: string,
    geographyLevel: GeographyLevel,
    scopeId: string,
  ): Observable<HydratedSpeciesGoalsRecord[] | null> {
    const solution = this.catalog.getById(solutionId);
    const urls = solution?.precomputedMetricUrls;
    const catalogUrl = urls?.speciesGoalsCatalog;
    const partitionUrl = urls?.speciesGoalsByGeography?.[geographyLevel];
    const targetOverlayUrl = urls?.speciesGoalsTargetOverlay;
    if (!catalogUrl || !partitionUrl) {
      return of(null);
    }
    const releaseId = releaseIdFromUrl(partitionUrl);
    if (!releaseId || (targetOverlayUrl && releaseIdFromUrl(targetOverlayUrl) !== releaseId)) {
      return of(null);
    }

    return forkJoin({
      catalogCompletion: this.http.get<Record<string, unknown>>(`${catalogUrl}.complete.json`),
      compactCompletion: this.http.get<Record<string, unknown>>(`${partitionUrl}.complete.json`),
    }).pipe(
      switchMap(({ catalogCompletion, compactCompletion }) => {
        if (
          !isValidCompletionPair(
            catalogCompletion,
            compactCompletion,
            releaseId,
            solutionId,
            geographyLevel,
          )
        ) {
          throw new Error('Species goals completion metadata failed validation.');
        }
        return forkJoin({
          catalogText: this.http.get(catalogUrl, { responseType: 'text' }),
          compactText: this.http.get(partitionUrl, { responseType: 'text' }),
          targetOverlay: targetOverlayUrl
            ? this.loadTargetOverlay(targetOverlayUrl, releaseId, catalogUrl)
            : of(undefined),
        }).pipe(
          switchMap(({ catalogText, compactText, targetOverlay }) =>
            from(Promise.all([sha256Text(catalogText), sha256Text(compactText)])).pipe(
              map(([catalogArtifactSha256, compactArtifactSha256]) => ({
                catalog: JSON.parse(catalogText) as SpeciesGoalsCatalog,
                compact: JSON.parse(compactText) as SpeciesGoalsCompactDocument,
                targetOverlay,
                catalogArtifactSha256,
                compactArtifactSha256,
                catalogCompletion,
                compactCompletion,
              })),
            ),
          ),
        );
      }),
      map(
        ({
          catalog,
          compact,
          targetOverlay,
          catalogArtifactSha256,
          compactArtifactSha256,
          catalogCompletion,
          compactCompletion,
        }) => {
          if (
            !isSpeciesGoalsCatalog(catalog) ||
            !isSpeciesGoalsCompactDocument(compact) ||
            compact.solutionId !== solutionId ||
            compact.geographyLevel !== geographyLevel ||
            compact.provenance.releaseId !== releaseId ||
            catalogCompletion['format'] !== 'species-goals-catalog-completion-v1' ||
            catalogCompletion['status'] !== 'complete' ||
            catalogCompletion['releaseId'] !== releaseId ||
            catalogCompletion['catalogSha256'] !== catalog.catalogSha256 ||
            catalogCompletion['artifactSha256'] !== catalogArtifactSha256 ||
            compactCompletion['format'] !== 'species-goals-completion-v1' ||
            compactCompletion['status'] !== 'complete' ||
            compactCompletion['solutionId'] !== solutionId ||
            compactCompletion['geographyLevel'] !== geographyLevel ||
            compactCompletion['catalogSha256'] !== catalog.catalogSha256 ||
            compactCompletion['artifactSha256'] !== compactArtifactSha256 ||
            (targetOverlay !== undefined &&
              (targetOverlay.releaseId !== releaseId ||
                targetOverlay.catalogSha256 !== catalog.catalogSha256))
          ) {
            throw new Error('Species goals artifacts failed validation.');
          }
          const targetMap =
            targetOverlay === undefined
              ? undefined
              : selectSpeciesTargetOverlay(targetOverlay, solutionId);
          return hydrateSpeciesGoals(catalog, compact, scopeId, targetMap);
        },
      ),
      catchError(() => of(null)),
    );
  }

  private loadTargetOverlay(
    url: string,
    releaseId: string,
    catalogUrl: string,
  ): Observable<SpeciesTargetOverlaysDocument> {
    const cacheKey = `${releaseId}|${catalogUrl}|${url}`;
    const cached = this.targetOverlayCache.get(cacheKey);
    if (cached) return cached;
    const request = this.http.get(url, { responseType: 'text' }).pipe(
      switchMap((text) => from(parseAndValidateTargetOverlay(text, releaseId))),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.targetOverlayCache.set(cacheKey, request);
    return request;
  }
}

function releaseIdFromUrl(value: string): string | null {
  try {
    return (
      new URL(value, 'http://runtime.local').pathname.match(/^\/releases\/([^/]+)\//)?.[1] ?? null
    );
  } catch {
    return null;
  }
}

function isValidCompletionPair(
  catalog: Record<string, unknown>,
  compact: Record<string, unknown>,
  releaseId: string,
  solutionId: string,
  geographyLevel: GeographyLevel,
): boolean {
  const compactProvenance = compact['provenance'];
  const sha256Pattern = /^[0-9a-f]{64}$/;
  return (
    catalog['format'] === 'species-goals-catalog-completion-v1' &&
    catalog['status'] === 'complete' &&
    catalog['releaseId'] === releaseId &&
    sha256Pattern.test(String(catalog['catalogSha256'])) &&
    sha256Pattern.test(String(catalog['artifactSha256'])) &&
    compact['format'] === 'species-goals-completion-v1' &&
    compact['status'] === 'complete' &&
    compact['solutionId'] === solutionId &&
    compact['geographyLevel'] === geographyLevel &&
    compact['catalogSha256'] === catalog['catalogSha256'] &&
    sha256Pattern.test(String(compact['artifactSha256'])) &&
    compactProvenance !== null &&
    typeof compactProvenance === 'object' &&
    (compactProvenance as Record<string, unknown>)['releaseId'] === releaseId
  );
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseAndValidateTargetOverlay(
  text: string,
  releaseId: string,
): Promise<SpeciesTargetOverlaysDocument> {
  const document = JSON.parse(text) as unknown;
  if (!isSpeciesTargetOverlaysDocument(document) || document.releaseId !== releaseId) {
    throw new Error('Species target overlay failed contract validation.');
  }
  const body = Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'completion'));
  if ((await sha256Text(canonicalJson(body))) !== document.completion.payloadSha256) {
    throw new Error('Species target overlay checksum is invalid.');
  }
  for (const targetMap of Object.values(document.targetMaps)) {
    const canonical = canonicalJson({
      rows: targetMap.rows,
      unavailableRows: targetMap.unavailableRows,
    });
    if ((await sha256Text(canonical)) !== targetMap.canonicalSha256) {
      throw new Error('Species target map checksum is invalid.');
    }
  }
  return document;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
