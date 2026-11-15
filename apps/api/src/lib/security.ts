/**
 * Password hashing and token handling.
 *
 * Passwords use scrypt (memory-hard, available in Node core, no native build) with
 * a per-password salt. Session tokens are opaque random values stored hashed, so a
 * database leak cannot be replayed. JWTs are used only for short-lived access
 * tokens within the server, never placed in localStorage.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const KEY_LENGTH = 64;
/** N=2^15, r=8, p=1 — ~100ms on a modest server, well inside OWASP guidance. */
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  // Cost parameters are encoded in the stored hash so they can be raised later
  // without invalidating existing passwords.
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return [
    'scrypt',
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  if (!saltB64 || !hashB64) return false;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n) || SCRYPT_OPTIONS.N,
      r: Number(r) || SCRYPT_OPTIONS.r,
      p: Number(p) || SCRYPT_OPTIONS.p,
      maxmem: 64 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Opaque session token: 32 random bytes, returned once, stored hashed. */
export function createSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Random URL-safe id for request correlation. */
export function requestId(): string {
  return randomBytes(8).toString('hex');
}

/** Timing-safe string comparison for opaque values. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
