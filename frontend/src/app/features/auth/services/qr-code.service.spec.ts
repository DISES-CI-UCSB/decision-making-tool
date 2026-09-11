import { TestBed } from '@angular/core/testing';
import { QrCodeService } from './qr-code.service';

const SAMPLE_OTPAUTH_URI =
  'otpauth://totp/EcoPlan:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=EcoPlan&algorithm=SHA1&digits=6';

describe('QrCodeService', () => {
  let service: QrCodeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(QrCodeService);
  });

  it('encodes an otpauth URI to a GIF data URL', () => {
    const dataUrl = service.toDataUrl(SAMPLE_OTPAUTH_URI);

    expect(dataUrl.startsWith('data:image/gif;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan('data:image/gif;base64,'.length);
  });

  it('produces a different data URL when the otpauth URI changes', () => {
    const first = service.toDataUrl(SAMPLE_OTPAUTH_URI);
    const second = service.toDataUrl(
      'otpauth://totp/EcoPlan:other@example.com?secret=GEZDGNBVGY3TQOJQ&issuer=EcoPlan&algorithm=SHA1&digits=6',
    );

    expect(second.startsWith('data:image/gif;base64,')).toBe(true);
    expect(second).not.toBe(first);
  });
});
