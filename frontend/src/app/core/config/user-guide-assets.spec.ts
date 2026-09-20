import { PUBLIC_BLOB_HOST } from '@core/config/runtime-manifest.constants';
import {
  otherUserGuideLocale,
  resolveUserGuideAssets,
  resolveUserGuideLocale,
  withBlobDownloadQuery,
} from './user-guide-assets';

describe('user-guide-assets', () => {
  it('resolves English as the default locale', () => {
    expect(resolveUserGuideLocale(undefined)).toBe('en');
    expect(resolveUserGuideLocale('fr')).toBe('en');
    expect(resolveUserGuideLocale('es')).toBe('es');
  });

  it('returns locale-matched Blob URLs', () => {
    const english = resolveUserGuideAssets('en');
    const spanish = resolveUserGuideAssets('es');

    expect(english.videoUrl).toBe(`${PUBLIC_BLOB_HOST}/docs/user-guides/en/user-guide.mp4`);
    expect(spanish.pdfUrl).toBe(`${PUBLIC_BLOB_HOST}/docs/user-guides/es/user-guide.pdf`);
    expect(otherUserGuideLocale(english.locale)).toBe('es');
    expect(otherUserGuideLocale(spanish.locale)).toBe('en');
  });

  it('adds the Blob download query', () => {
    expect(withBlobDownloadQuery('https://example.test/manual.pdf')).toBe(
      'https://example.test/manual.pdf?download=1',
    );
  });
});
