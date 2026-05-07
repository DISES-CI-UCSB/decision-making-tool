import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  buildManifestSidebarLayerGroups,
  groupManifestLayersBySidebarCategory,
  type ManifestSidebarLayerGroup,
  type ManifestSidebarLayersByCategory,
  type RuntimeLayerManifest,
} from '@core/models/layer-manifest.model';
import { map, shareReplay, type Observable } from 'rxjs';

const LAYER_MANIFEST_URL = '/data/layer-manifest/manifest.json';

@Injectable({ providedIn: 'root' })
export class LayerManifestService {
  private readonly http = inject(HttpClient);
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
}
