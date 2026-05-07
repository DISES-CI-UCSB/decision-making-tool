import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  buildManifestSidebarLayerGroups,
  groupManifestLayersBySidebarCategory,
  type ManifestSidebarLayerGroup,
  type ManifestSidebarLayersByCategory,
  type RuntimeLayerManifest,
} from '@core/models/layer-manifest.model';
import { environment } from '../../../environments/environment';
import { catchError, map, of, shareReplay, throwError, type Observable } from 'rxjs';

const LOCAL_LAYER_MANIFEST_URL = '/data/layer-manifest/manifest.json';
const EXAMPLE_LAYER_MANIFEST_URL = '/data/layer-manifest/manifest.example.json';

interface RuntimeManifestWindow {
  __MANIFEST_BLOB_URL__?: string;
}

@Injectable({ providedIn: 'root' })
export class LayerManifestService {
  private readonly http = inject(HttpClient);
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

  private resolveManifestUrl(): string {
    const runtimeBlobUrl = this.readRuntimeBlobUrl();
    if (runtimeBlobUrl) {
      return runtimeBlobUrl;
    }

    const configuredBlobUrl = environment.manifestBlobUrl?.trim();
    if (configuredBlobUrl) {
      return configuredBlobUrl;
    }

    return LOCAL_LAYER_MANIFEST_URL;
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

    return this.http.get<RuntimeLayerManifest>(primaryUrl).pipe(
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
}
