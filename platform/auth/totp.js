import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(bytes) {
  let bits = 0, buffer = 0, result = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += ALPHABET[(buffer >>> bits) & 31]; }
  }
  if (bits) result += ALPHABET[(buffer << (5 - bits)) & 31];
  return result;
}
export function base32Decode(secret) {
  if (typeof secret !== 'string' || !/^[A-Z2-7]{16,128}$/.test(secret)) return null;
  let buffer = 0, bits = 0;
  const out = [];
  for (const char of secret) {
    buffer = (buffer << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((buffer >>> bits) & 255); }
  }
  return Buffer.from(out);
}
export function newTotpSecret() { return base32Encode(randomBytes(20)); }
export function totp(secret, counter) {
  const key = base32Decode(secret);
  if (!key || !Number.isSafeInteger(counter) || counter < 0) return null;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(msg).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function verifyTotp(secret, input, now = Date.now(), lastCounter = -1) {
  if (typeof input !== 'string' || !/^\d{6}$/.test(input)) return -1;
  const current = Math.floor(now / 30000);
  for (const offset of [-1, 0, 1]) {
    const c = current + offset;
    if (c <= lastCounter || c < 0) continue;
    const expected = totp(secret, c);
    if (expected && timingSafeEqual(Buffer.from(expected), Buffer.from(input))) return c;
  }
  return -1;
}
export const recoveryDigest = value => createHash('sha256').update(value).digest('hex');
export function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const x = randomBytes(8).toString('hex');
    return x.slice(0,8) + '-' + x.slice(8);
  });
}
