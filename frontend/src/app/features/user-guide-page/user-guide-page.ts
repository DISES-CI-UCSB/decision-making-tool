import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AppLocaleService } from '@core/services/app-locale.service';
import {
  otherUserGuideLocale,
  resolveUserGuideAssets,
  resolveUserGuideLocale,
  withBlobDownloadQuery,
} from '@core/config/user-guide-assets';

@Component({
  selector: 'app-user-guide-page',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './user-guide-page.html',
  styleUrl: './user-guide-page.scss',
})
export class UserGuidePageComponent implements OnInit, OnDestroy {
  private readonly appLocaleService = inject(AppLocaleService);
  private readonly translate = inject(TranslateService);
  private readonly subscriptions = new Subscription();

  protected readonly activeLocale = signal(this.currentLocale());
  protected readonly videoStatus = signal<'loading' | 'ready' | 'error'>('loading');

  protected readonly assets = computed(() => resolveUserGuideAssets(this.activeLocale()));
  protected readonly otherLocale = computed(() => otherUserGuideLocale(this.activeLocale()));
  protected readonly otherAssets = computed(() => resolveUserGuideAssets(this.otherLocale()));
  protected readonly pdfDownloadUrl = computed(() => withBlobDownloadQuery(this.assets().pdfUrl));
  protected readonly otherPdfDownloadUrl = computed(() =>
    withBlobDownloadQuery(this.otherAssets().pdfUrl),
  );
  protected readonly hasManual = computed(() => Boolean(this.assets().pdfUrl));

  ngOnInit(): void {
    this.syncLocale();
    this.syncDocumentTitle();
    this.subscriptions.add(
      this.translate.onLangChange.subscribe(() => {
        this.syncLocale();
        this.syncDocumentTitle();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.translate.get('header.appTitle').subscribe((title) => {
      document.title = title;
    });
  }

  protected onVideoLoadStart(): void {
    this.videoStatus.set('loading');
  }

  protected onVideoReady(): void {
    this.videoStatus.set('ready');
  }

  protected onVideoError(): void {
    this.videoStatus.set('error');
  }

  private currentLocale() {
    return resolveUserGuideLocale(
      this.translate.getCurrentLang() ||
        this.translate.getDefaultLang() ||
        this.appLocaleService.locale(),
    );
  }

  private syncLocale(): void {
    const nextLocale = this.currentLocale();
    if (this.activeLocale() === nextLocale) {
      return;
    }
    this.activeLocale.set(nextLocale);
    this.videoStatus.set('loading');
  }

  private syncDocumentTitle(): void {
    this.translate.get(['guide.title', 'header.appTitle']).subscribe((translations) => {
      document.title = `${translations['guide.title']} · ${translations['header.appTitle']}`;
    });
  }
}
