import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import {
  buildManifestSidebarLayerGroups,
  groupManifestLayersBySidebarCategory,
  type LayerLocale,
  type RuntimeCatalogReleaseIndex,
  type ManifestSidebarLayerGroup,
  type ManifestSidebarLayersByCategory,
  type RuntimeLayerManifest,
  type RuntimeSirapManifest,
  type RuntimeSolutionManifestEntry,
  type RuntimeSpeciesManifest,
} from '@core/models/layer-manifest.model';
import {
  LOCAL_RUNTIME_MANIFEST_PUBLIC_PATH,
  RUNTIME_MANIFEST_BLOB_URL,
} from '@core/config/runtime-manifest.constants';
import { environment } from '../../../environments/environment';
import {
  EMPTY,
  catchError,
  forkJoin,
  map,
  of,
  shareReplay,
  switchMap,
  take,
  throwError,
  type Observable,
} from 'rxjs';

interface RuntimeManifestWindow {
  __MANIFEST_BLOB_URL__?: string;
  __CATALOG_RELEASE_INDEX_BLOB_URL__?: string;
  __SIRAP_MANIFEST_BLOB_URL__?: string;
}

export function validateCatalogReleaseIndex(value: unknown): RuntimeCatalogReleaseIndex {
  if (!value || typeof value !== 'object') {
    throw new Error('Catalog release index must be an object');
  }

  const index = value as Partial<RuntimeCatalogReleaseIndex>;
  if (index.format !== 'runtime-catalog-release-v1') {
    throw new Error('Catalog release index format must be runtime-catalog-release-v1');
  }
  if (!isSemVer(index.catalogVersion)) {
    throw new Error('Catalog release index catalogVersion must be a semantic version');
  }
  if (!isNonEmptyString(index.releaseId) || !isNonEmptyString(index.generatedAt)) {
    throw new Error('Catalog release index releaseId and generatedAt are required');
  }
  if (!Number.isInteger(index.expectedSolutionCount) || (index.expectedSolutionCount ?? 0) < 1) {
    throw new Error('Catalog release index expectedSolutionCount must be a positive integer');
  }
  if (!Array.isArray(index.batches) || index.batches.length === 0) {
    throw new Error('Catalog release index must declare at least one batch');
  }

  const batchIds = new Set<string>();
  for (const batch of index.batches) {
    if (
      !batch ||
      !isNonEmptyString(batch.id) ||
      !isNonEmptyString(batch.manifestUrl) ||
      !Number.isInteger(batch.expectedSolutionCount) ||
      batch.expectedSolutionCount < 1
    ) {
      throw new Error('Catalog release index batches must declare id, manifestUrl, and count');
    }
    if (batchIds.has(batch.id)) {
      throw new Error(`Catalog release index duplicates batch ID: ${batch.id}`);
    }
    batchIds.add(batch.id);
  }

  return index as RuntimeCatalogReleaseIndex;
}

export function mergeCatalogReleaseBatches(
  index: RuntimeCatalogReleaseIndex,
  manifests: (RuntimeLayerManifest | RuntimeSirapManifest)[],
): RuntimeLayerManifest {
  if (manifests.length !== index.batches.length) {
    throw new Error('Catalog release index did not load every declared batch');
  }
  const primaryManifest = manifests[0];
  if (!isRuntimeLayerManifest(primaryManifest)) {
    throw new Error('Catalog release primary batch is not a runtime layer manifest');
  }

  const solutionIds = new Set<string>();
  const solutions: RuntimeSolutionManifestEntry[] = [];
  manifests.forEach((manifest, batchIndex) => {
    if (!Array.isArray(manifest?.solutions)) {
      throw new Error(`Catalog batch "${index.batches[batchIndex].id}" has no solutions array`);
    }
    if (manifest.solutions.length !== index.batches[batchIndex].expectedSolutionCount) {
      throw new Error(`Catalog batch "${index.batches[batchIndex].id}" solution count is invalid`);
    }
    for (const solution of manifest.solutions) {
      if (!isNonEmptyString(solution?.id)) {
        throw new Error(
          `Catalog batch "${index.batches[batchIndex].id}" contains an invalid solution`,
        );
      }
      if (solutionIds.has(solution.id)) {
        throw new Error(`Catalog release duplicates solution ID: ${solution.id}`);
      }
      solutionIds.add(solution.id);
      solutions.push(structuredClone(solution));
    }
  });

  if (solutions.length !== index.expectedSolutionCount) {
    throw new Error('Catalog release index expectedSolutionCount does not match loaded solutions');
  }

  return {
    ...primaryManifest,
    releaseId: index.releaseId,
    catalogVersion: index.catalogVersion,
    solutions,
  };
}

export function mergeRuntimeSolutionBatches(
  nationalManifest: RuntimeLayerManifest,
  sirapManifest: RuntimeSirapManifest | null,
): RuntimeLayerManifest {
  if (!sirapManifest) {
    return nationalManifest;
  }

  const nationalIds = new Set(nationalManifest.solutions.map((solution) => solution.id));
  const duplicateIds = sirapManifest.solutions
    .map((solution) => solution.id)
    .filter((id) => nationalIds.has(id));
  if (duplicateIds.length > 0) {
    throw new Error(
      `SIRAP manifest duplicates primary solution IDs: ${[...new Set(duplicateIds)].join(', ')}`,
    );
  }

  return {
    ...nationalManifest,
    solutions: [
      ...nationalManifest.solutions,
      ...sirapManifest.solutions.map(
        (solution): RuntimeSolutionManifestEntry => structuredClone(solution),
      ),
    ],
  };
}

@Injectable({ providedIn: 'root' })
export class LayerManifestService {
  private readonly http = inject(HttpClient);
  private readonly speciesManifestCache = new Map<string, Observable<RuntimeSpeciesManifest>>();
  private readonly prefetchedSpeciesManifestUrls = new Set<string>();
  readonly stylePreviewManifest$ = signal<RuntimeLayerManifest | null>(null);
  private readonly resolvedManifestUrl = this.resolveManifestUrl();
  private readonly resolvedCatalogReleaseIndexUrl = this.resolveCatalogReleaseIndexUrl();
  private readonly resolvedSirapManifestUrl = this.resolveSirapManifestUrl();
  private readonly manifest$ = this.loadRuntimeManifest().pipe(
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  getManifest(): Observable<RuntimeLayerManifest> {
    return this.manifest$;
  }

  getSidebarLayerGroups(locale: LayerLocale = 'en'): Observable<ManifestSidebarLayerGroup[]> {
    return this.manifest$.pipe(
      map((manifest) => buildManifestSidebarLayerGroups(manifest, locale)),
    );
  }

  getLayersBySidebarCategory(
    locale: LayerLocale = 'en',
  ): Observable<ManifestSidebarLayersByCategory> {
    return this.manifest$.pipe(
      map((manifest) => groupManifestLayersBySidebarCategory(manifest, locale)),
    );
  }

  getResolvedManifestUrl(): Observable<string> {
    return of(this.resolvedManifestUrl);
  }

  setStylePreviewManifest(manifest: RuntimeLayerManifest | null): void {
    this.stylePreviewManifest$.set(manifest ? structuredClone(manifest) : null);
  }

  getSpeciesManifest(speciesManifestUrl: string): Observable<RuntimeSpeciesManifest> {
    const normalizedUrl = speciesManifestUrl.trim();
    const cachedManifest = this.speciesManifestCache.get(normalizedUrl);
    if (cachedManifest) {
      return cachedManifest;
    }

    const request$ = this.http
      .get<RuntimeSpeciesManifest>(normalizedUrl)
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
    this.speciesManifestCache.set(normalizedUrl, request$);
    return request$;
  }

  preloadSpeciesManifest(speciesManifestUrl: string): void {
    const normalizedUrl = speciesManifestUrl.trim();
    if (!normalizedUrl || this.prefetchedSpeciesManifestUrls.has(normalizedUrl)) {
      return;
    }

    this.prefetchedSpeciesManifestUrls.add(normalizedUrl);
    this.getSpeciesManifest(normalizedUrl)
      .pipe(
        take(1),
        catchError(() => {
          this.prefetchedSpeciesManifestUrls.delete(normalizedUrl);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  private resolveManifestUrl(): string {
    const runtimeBlobUrl = this.readRuntimeBlobUrl();
    if (runtimeBlobUrl) {
      return runtimeBlobUrl;
    }

    const configuredBlobUrl = environment.manifestBlobUrl?.trim();
    if (configuredBlobUrl) {
      return configuredBlobUrl;
    }

    return RUNTIME_MANIFEST_BLOB_URL;
  }

  private resolveCatalogReleaseIndexUrl(): string | null {
    const runtimeWindow = globalThis as RuntimeManifestWindow;
    const runtimeBlobUrl = runtimeWindow.__CATALOG_RELEASE_INDEX_BLOB_URL__?.trim();
    return runtimeBlobUrl || environment.catalogReleaseIndexBlobUrl?.trim() || null;
  }

  private resolveSirapManifestUrl(): string | null {
    const runtimeWindow = globalThis as RuntimeManifestWindow;
    const runtimeBlobUrl = runtimeWindow.__SIRAP_MANIFEST_BLOB_URL__?.trim();
    return runtimeBlobUrl || environment.sirapManifestBlobUrl?.trim() || null;
  }

  private buildManifestUrlCandidates(): string[] {
    return Array.from(new Set([this.resolvedManifestUrl, LOCAL_RUNTIME_MANIFEST_PUBLIC_PATH]));
  }

  private loadRuntimeManifest(): Observable<RuntimeLayerManifest> {
    if (this.resolvedCatalogReleaseIndexUrl) {
      return this.loadCatalogRelease(this.resolvedCatalogReleaseIndexUrl);
    }

    return this.loadManifestWithFallback(this.buildManifestUrlCandidates()).pipe(
      switchMap((nationalManifest) =>
        this.loadOptionalSirapManifest(this.resolvedSirapManifestUrl).pipe(
          map((sirapManifest) => mergeRuntimeSolutionBatches(nationalManifest, sirapManifest)),
        ),
      ),
    );
  }

  private loadCatalogRelease(indexUrl: string): Observable<RuntimeLayerManifest> {
    return this.http.get<unknown>(this.toManifestRequestUrl(indexUrl)).pipe(
      map((index) => validateCatalogReleaseIndex(index)),
      switchMap((index) =>
        forkJoin(
          index.batches.map((batch) =>
            this.http
              .get<RuntimeLayerManifest>(this.toManifestRequestUrl(batch.manifestUrl))
              .pipe(map((manifest) => this.withProxiedBlobUrls(manifest))),
          ),
        ).pipe(map((manifests) => mergeCatalogReleaseBatches(index, manifests))),
      ),
    );
  }

  private loadManifestWithFallback(manifestUrls: string[]): Observable<RuntimeLayerManifest> {
    const [primaryUrl, ...fallbackUrls] = manifestUrls;
    if (!primaryUrl) {
      return throwError(() => new Error('No manifest URL candidates configured'));
    }

    return this.http.get<RuntimeLayerManifest>(this.toManifestRequestUrl(primaryUrl)).pipe(
      map((manifest) => this.withProxiedBlobUrls(manifest)),
      catchError((error) => {
        if (fallbackUrls.length === 0) {
          return throwError(() => error);
        }
        return this.loadManifestWithFallback(fallbackUrls);
      }),
    );
  }

  private loadOptionalSirapManifest(url: string | null): Observable<RuntimeSirapManifest | null> {
    if (!url) {
      return of(null);
    }
    return this.http.get<RuntimeSirapManifest>(this.toManifestRequestUrl(url)).pipe(
      catchError((error) => {
        console.error(`Unable to load optional SIRAP manifest from ${url}`, error);
        return of(null);
      }),
    );
  }

  private readRuntimeBlobUrl(): string | null {
    const runtimeWindow = globalThis as RuntimeManifestWindow;
    const runtimeBlobUrl = runtimeWindow.__MANIFEST_BLOB_URL__?.trim();
    return runtimeBlobUrl || null;
  }

  private toManifestRequestUrl(manifestUrl: string): string {
    const cacheBust = Date.now().toString();
    const separator = manifestUrl.includes('?') ? '&' : '?';
    return `${manifestUrl}${separator}v=${cacheBust}`;
  }

  private withProxiedBlobUrls(manifest: RuntimeLayerManifest): RuntimeLayerManifest {
    const proxyPath = environment.blobAssetProxyPath?.trim();
    if (!proxyPath) {
      return manifest;
    }

    return this.rewriteBlobUrls(structuredClone(manifest), manifest.publicBlobHost, proxyPath);
  }

  private rewriteBlobUrls<T>(value: T, publicBlobHost: string, proxyPath: string): T {
    if (typeof value === 'string') {
      return this.toProxiedBlobUrl(value, publicBlobHost, proxyPath) as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.rewriteBlobUrls(item, publicBlobHost, proxyPath)) as T;
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [
          key,
          this.rewriteBlobUrls(entryValue, publicBlobHost, proxyPath),
        ]),
      ) as T;
    }

    return value;
  }

  private toProxiedBlobUrl(value: string, publicBlobHost: string, proxyPath: string): string {
    if (!value.startsWith(`${publicBlobHost}/`)) {
      return value;
    }

    const normalizedProxyPath = proxyPath.endsWith('/') ? proxyPath : `${proxyPath}/`;
    const pathname = value.slice(publicBlobHost.length + 1);
    return `${normalizedProxyPath}${pathname}`;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSemVer(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

function isRuntimeLayerManifest(
  value: RuntimeLayerManifest | RuntimeSirapManifest | undefined,
): value is RuntimeLayerManifest {
  return Boolean(
    value &&
    'version' in value &&
    'sourceCsv' in value &&
    'categories' in value &&
    'layers' in value,
  );
}
