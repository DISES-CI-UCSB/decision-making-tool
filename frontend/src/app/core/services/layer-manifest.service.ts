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
import { EMPTY, catchError, map, shareReplay, take, type Observable } from 'rxjs';

const LAYER_MANIFEST_URL = '/data/layer-manifest/manifest.json';

@Injectable({ providedIn: 'root' })
export class LayerManifestService {
  private readonly http = inject(HttpClient);
  private readonly speciesManifestCache = new Map<string, Observable<RuntimeSpeciesManifest>>();
  private readonly prefetchedSpeciesManifestUrls = new Set<string>();
  private readonly manifest$ = this.http
    .get<RuntimeLayerManifest>(LAYER_MANIFEST_URL)
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  getManifest(): Observable<RuntimeLayerManifest> {
    return this.manifest$;
  }

  getSidebarLayerGroups(): Observable<ManifestSidebarLayerGroup[]> {
    return this.manifest$.pipe(map((manifest) => buildManifestSidebarLayerGroups(manifest)));
  }

  getLayersBySidebarCategory(): Observable<ManifestSidebarLayersByCategory> {
    return this.manifest$.pipe(map((manifest) => groupManifestLayersBySidebarCategory(manifest)));
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
}
