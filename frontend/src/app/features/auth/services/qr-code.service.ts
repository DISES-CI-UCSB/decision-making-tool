import { Injectable } from '@angular/core';
import encodeQR from 'qr';

@Injectable({ providedIn: 'root' })
export class QrCodeService {
  toDataUrl(otpauthUri: string): string {
    return encodeQR(otpauthUri, 'data-url', { scale: 4, ecc: 'medium' });
  }
}
