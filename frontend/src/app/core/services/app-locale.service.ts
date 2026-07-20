import { Injectable, signal } from '@angular/core';

import type { LayerLocale } from '@core/models';

import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AppLocaleService {
  readonly locale = signal<LayerLocale>(environment.defaultLanguage);

  setLocale(locale: LayerLocale): void {
    this.locale.set(locale);
  }
}
