import { Injectable, signal } from '@angular/core';

import { DEFAULT_LOCALE, type LayerLocale } from '@core/models';

@Injectable({ providedIn: 'root' })
export class AppLocaleService {
  readonly locale = signal<LayerLocale>(DEFAULT_LOCALE);

  setLocale(locale: LayerLocale): void {
    this.locale.set(locale);
  }
}
