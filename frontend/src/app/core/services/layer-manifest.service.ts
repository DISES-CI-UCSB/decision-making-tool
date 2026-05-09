import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  buildManifestSidebarLayerGroups,
  groupManifestLayersBySidebarCategory,
  type ManifestSidebarLayerGroup,
  type ManifestSidebarLayersByCategory,
  type RuntimeLayerManifest,
  type RuntimeSpeciesManifest,
} from '@core/models/layer-manifest.model';
import { environment } from '../../../environments/environment';
import { EMPTY, catchError, map, of, shareReplay, take, throwError, type Observable } from 'rxjs';

const LOCAL_LAYER_MANIFEST_URL = '/data/layer-manifest/manifest.json';
const EXAMPLE_LAYER_MANIFEST_URL = '/data/layer-manifest/manifest.example.json';
const PUBLISHED_LAYER_MANIFEST_URL =
  'https://aagibolq28slyfof.public.blob.vercel-storage.com/manifest/manifest.json';

interface RuntimeManifestWindow {
  __MANIFEST_BLOB_URL__?: string;
}

@Injectable({ providedIn: 'root' })
export class LayerManifestService {
  private readonly http = inject(HttpClient);
  private readonly speciesManifestCache = new Map<string, Observable<RuntimeSpeciesManifest>>();
  private readonly prefetchedSpeciesManifestUrls = new Set<string>();
  private readonly resolvedManifestUrl = this.resolveManifestUrl();
  private readonly manifest$ = this.loadManifestWithFallback(
    this.buildManifestUrlCandidates(),
  ).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  getManifest(): Observable<RuntimeLayerManifest> {
    return this.manifest$;
  }

  getSidebarLayerGroups(): Observable<ManifestSidebarLayerGroup[]> {
    return this.manifest$.pipe(map((manifest) => buildManifestSidebarLayerGroups(manifest)));
  }

  getLayersBySidebarCategory(): Observable<ManifestSidebarLayersByCategory> {
    return this.manifest$.pipe(map((manifest) => groupManifestLayersBySidebarCategory(manifest)));
  }

  getResolvedManifestUrl(): Observable<string> {
    return of(this.resolvedManifestUrl);
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

    return PUBLISHED_LAYER_MANIFEST_URL;
  }

  private buildManifestUrlCandidates(): string[] {
    return Array.from(
      new Set([this.resolvedManifestUrl, LOCAL_LAYER_MANIFEST_URL, EXAMPLE_LAYER_MANIFEST_URL]),
    );
  }

  private loadManifestWithFallback(manifestUrls: string[]): Observable<RuntimeLayerManifest> {
    const [primaryUrl, ...fallbackUrls] = manifestUrls;
    if (!primaryUrl) {
      return throwError(() => new Error('No manifest URL candidates configured'));
    }

    return this.http.get<RuntimeLayerManifest>(this.toUncachedManifestUrl(primaryUrl)).pipe(
      catchError((error) => {
        if (fallbackUrls.length === 0) {
          return throwError(() => error);
        }
        return this.loadManifestWithFallback(fallbackUrls);
      }),
    );
  }

  private readRuntimeBlobUrl(): string | null {
    const runtimeWindow = globalThis as RuntimeManifestWindow;
    const runtimeBlobUrl = runtimeWindow.__MANIFEST_BLOB_URL__?.trim();
    return runtimeBlobUrl || null;
  }

  private toUncachedManifestUrl(manifestUrl: string): string {
    const cacheBust = Date.now().toString();
    const separator = manifestUrl.includes('?') ? '&' : '?';
    return `${manifestUrl}${separator}v=${cacheBust}`;
  }
}
