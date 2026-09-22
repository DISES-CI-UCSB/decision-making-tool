import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
  TranslateService,
} from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { USER_GUIDE_ASSETS } from '@core/config/user-guide-assets';
import { UserGuidePageComponent } from './user-guide-page';

describe('UserGuidePageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserGuidePageComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();

    TestBed.inject(TranslateService).setTranslation('en', {
      header: { appTitle: 'Prioritizing Nature' },
      about: { backToMap: 'Return to map' },
      guide: {
        kicker: 'User guide',
        title: 'Learn how to use the tool',
        description: 'Watch a walkthrough.',
        videoTitle: 'Watch the walkthrough',
        videoDescription: 'A long-form tour.',
        videoCaption: 'English · 720p · {{duration}}',
        captionsNote: 'Captions will be added when available.',
        videoLoading: 'Loading video…',
        videoError: 'The video could not be loaded.',
        manualTitle: 'Download the manual',
        manualDescription: 'A printable companion.',
        manualMeta: 'English · PDF · about 1 MB',
        manualDownload: 'Download PDF',
        manualOtherLanguage: 'Spanish manual also available',
      },
    });
    TestBed.inject(TranslateService).setTranslation('es', {
      header: { appTitle: 'Priorizando la Naturaleza' },
      about: { backToMap: 'Volver al mapa' },
      guide: {
        kicker: 'Guía de uso',
        title: 'Aprenda a usar la herramienta',
        description: 'Vea un recorrido.',
        videoTitle: 'Vea el recorrido',
        videoDescription: 'Un recorrido completo.',
        videoCaption: 'Español · 720p · {{duration}}',
        captionsNote: 'Los subtítulos se agregarán cuando estén disponibles.',
        videoLoading: 'Cargando el video…',
        videoError: 'No se pudo cargar el video.',
        manualTitle: 'Descargue el manual',
        manualDescription: 'Un documento imprimible.',
        manualMeta: 'Español · PDF · aproximadamente 1 MB',
        manualDownload: 'Descargar PDF',
        manualOtherLanguage: 'También está disponible el manual en inglés',
      },
    });
  });

  it('renders the English walkthrough and PDF takeaway', () => {
    const fixture = TestBed.createComponent(UserGuidePageComponent);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const video = page.querySelector('#user-guide-page-video-player') as HTMLVideoElement;
    const pdfLink = page.querySelector(
      '#user-guide-page-manual-download-link',
    ) as HTMLAnchorElement;

    expect(page.querySelector('#user-guide-page-title')?.textContent).toContain(
      'Learn how to use the tool',
    );
    expect(page.querySelector('#user-guide-page-back-to-map-link')?.getAttribute('href')).toBe('/');
    expect(video.getAttribute('src')).toBe(USER_GUIDE_ASSETS.en.videoUrl);
    expect(video.getAttribute('poster')).toBe(USER_GUIDE_ASSETS.en.posterUrl);
    expect(video.autoplay).toBe(false);
    expect(video.preload).toBe('metadata');
    expect(pdfLink.getAttribute('href')).toBe(`${USER_GUIDE_ASSETS.en.pdfUrl}?download=1`);
    expect(page.querySelector('#user-guide-page-manual-other-language-link')?.getAttribute('href')).toBe(
      `${USER_GUIDE_ASSETS.es.pdfUrl}?download=1`,
    );
  });

  it('swaps video and PDF assets when the header language changes', async () => {
    const fixture = TestBed.createComponent(UserGuidePageComponent);
    const translate = TestBed.inject(TranslateService);
    fixture.detectChanges();

    await firstValueFrom(translate.use('es'));
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const video = page.querySelector('#user-guide-page-video-player') as HTMLVideoElement;
    expect(page.querySelector('#user-guide-page-title')?.textContent).toContain(
      'Aprenda a usar la herramienta',
    );
    expect(video.getAttribute('src')).toBe(USER_GUIDE_ASSETS.es.videoUrl);
    expect(
      page.querySelector('#user-guide-page-manual-download-link')?.getAttribute('href'),
    ).toBe(`${USER_GUIDE_ASSETS.es.pdfUrl}?download=1`);
  });

  it('keeps the PDF takeaway when the video fails to load', () => {
    const fixture = TestBed.createComponent(UserGuidePageComponent);
    fixture.detectChanges();

    const video = fixture.nativeElement.querySelector(
      '#user-guide-page-video-player',
    ) as HTMLVideoElement;
    video.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('#user-guide-page-video-player')).toBeNull();
    expect(page.querySelector('#user-guide-page-video-error')).not.toBeNull();
    expect(page.querySelector('#user-guide-page-manual-download-link')).not.toBeNull();
  });
});
