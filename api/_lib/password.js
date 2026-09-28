import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

function isHex(value, bytes) {
  return typeof value === 'string'
    && value.length === bytes * 2
    && /^[0-9a-f]+$/i.test(value);
}

export async function verifyTeacherPassword(candidate, saltHex, expectedHashHex) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 1024) return false;
  if (!isHex(saltHex, 16) || !isHex(expectedHashHex, 64)) return false;

  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(expectedHashHex, 'hex');
    const derived = Buffer.from(await scrypt(candidate, salt, expected.length));
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
