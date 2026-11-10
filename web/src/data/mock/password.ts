// Password hashes: node:crypto scrypt, a random salt per hash. Stored as `scrypt$N$r$p$<salt>$<hash>` (base64url), so the cost can grow later.
// Node's `crypto` is looked up when needed, not imported (a Node module cannot be in the browser bundle; see browser-safe.test.ts).
import type * as Crypto from 'node:crypto';

const crypto = (): typeof Crypto => process.getBuiltinModule('node:crypto');

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto().scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N: n, r, p, maxmem: 128 * n * r * 2 }, (error, key) => (error ? reject(error) : resolve(key)));
  });

const encode = (salt: Buffer, key: Buffer): string => `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto().randomBytes(SALT_LENGTH);
  return encode(salt, await derive(password, salt, N, R, P));
}

/** The same hash, blocking: only for seeding the fixture accounts when a store is made. */
export function hashPasswordSync(password: string): string {
  const salt = crypto().randomBytes(SALT_LENGTH);
  return encode(salt, crypto().scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 128 * N * R * 2 }));
}

/** Constant-time compare. A stored value that is not a hash of this shape verifies nothing. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const [cost, block, parallel] = [Number(n), Number(r), Number(p)];
  if (![cost, block, parallel].every((value) => Number.isInteger(value) && value > 0) || cost > 1 << 20) return false;
  const wanted = Buffer.from(key, 'base64url');
  if (wanted.length !== KEY_LENGTH) return false;
  const given = await derive(password, Buffer.from(salt, 'base64url'), cost, block, parallel);
  return crypto().timingSafeEqual(given, wanted);
}
