import { Injectable, signal } from '@angular/core';

export type SupportedBasemap = 'topo-vector' | 'satellite';

@Injectable({
  providedIn: 'root',
})
export class MapBasemapService {
  private readonly basemapSignal = signal<SupportedBasemap>('topo-vector');

  readonly basemap = this.basemapSignal.asReadonly();

  setBasemap(basemap: SupportedBasemap): void {
    this.basemapSignal.set(basemap);
  }
}
