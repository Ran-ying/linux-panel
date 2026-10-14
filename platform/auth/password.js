import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const options = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

export function validPassword(password) {
  return typeof password === 'string' &&
    Buffer.byteLength(password, 'utf8') >= 12 &&
    Buffer.byteLength(password, 'utf8') <= 256;
}

export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Password must be 12–256 UTF-8 bytes');
  const salt = randomBytes(24);
  const hash = await scrypt(password, salt, KEY_LENGTH, options);
  return `scrypt-v1:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || !encoded?.startsWith('scrypt-v1:')) return false;
  const parts = encoded.split(':');
  if (parts.length !== 3) return false;
  try {
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    if (salt.length !== 24 || expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(password, salt, KEY_LENGTH, options);
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}
