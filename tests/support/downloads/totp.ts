import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(value: string): Buffer {
  const normalized = value.replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('Authenticator secret is not base32.');
  }
  let bits = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    bits = (bits << 5) | BASE32_ALPHABET.indexOf(character);
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bits >> bitCount) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export interface TotpParameters {
  algorithm: string;
  digits: number;
  periodSeconds: number;
}

/** Time-based One-Time Password (RFC 6238) code, computed the way an authenticator app does. */
export function totpCode(secretKey: string, parameters: TotpParameters, timestampMs: number): string {
  const counter = Math.floor(timestampMs / 1000 / parameters.periodSeconds);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const algorithm = parameters.algorithm.toLowerCase().replace(/-/g, '');
  const digest = createHmac(algorithm, decodeBase32(secretKey)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** parameters.digits).padStart(parameters.digits, '0');
}

/** Milliseconds until the next code window starts, plus a one-second margin. Firebase rejects a replayed code. */
export function millisUntilFreshCode(nowMs: number, usedAtMs: number, periodSeconds: number): number {
  const windowMs = periodSeconds * 1000;
  const nextWindowStart = (Math.floor(usedAtMs / windowMs) + 1) * windowMs;
  return Math.max(0, nextWindowStart + 1000 - nowMs);
}
