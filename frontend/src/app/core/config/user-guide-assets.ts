import type { LayerLocale } from '@core/models';
import { PUBLIC_BLOB_HOST } from '@core/config/runtime-manifest.constants';

export interface UserGuideLocaleAssets {
  locale: LayerLocale;
  videoUrl: string;
  posterUrl: string;
  pdfUrl: string;
  pdfFileName: string;
  durationLabel: string;
}

const USER_GUIDE_PREFIX = `${PUBLIC_BLOB_HOST}/docs/user-guides`;

export const USER_GUIDE_ASSETS: Record<LayerLocale, UserGuideLocaleAssets> = {
  en: {
    locale: 'en',
    videoUrl: `${USER_GUIDE_PREFIX}/en/user-guide.mp4`,
    posterUrl: `${USER_GUIDE_PREFIX}/en/poster.jpg`,
    pdfUrl: `${USER_GUIDE_PREFIX}/en/user-guide.pdf`,
    pdfFileName: 'prioritizing-nature-user-guide-en.pdf',
    durationLabel: '9:25',
  },
  es: {
    locale: 'es',
    videoUrl: `${USER_GUIDE_PREFIX}/es/user-guide.mp4`,
    posterUrl: `${USER_GUIDE_PREFIX}/es/poster.jpg`,
    pdfUrl: `${USER_GUIDE_PREFIX}/es/user-guide.pdf`,
    pdfFileName: 'prioritizing-nature-user-guide-es.pdf',
    durationLabel: '10:31',
  },
};

export function resolveUserGuideLocale(locale: string | null | undefined): LayerLocale {
  return locale === 'es' ? 'es' : 'en';
}

export function resolveUserGuideAssets(locale: string | null | undefined): UserGuideLocaleAssets {
  return USER_GUIDE_ASSETS[resolveUserGuideLocale(locale)];
}

export function otherUserGuideLocale(locale: LayerLocale): LayerLocale {
  return locale === 'es' ? 'en' : 'es';
}

export function withBlobDownloadQuery(url: string): string {
  return `${url}?download=1`;
}
