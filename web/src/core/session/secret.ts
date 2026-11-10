import { randomBytes } from 'node:crypto';
import { paidMode } from '@/data/real/paid-mode';

const MIN_SECRET_LENGTH = 32;
const holder = globalThis as typeof globalThis & { __vcSessionKey?: Buffer };

/**
 * The key that signs the session cookie: `VC_SESSION_SECRET` (at least 32 characters).
 * Without it, outside paid mode, a random key lives as long as the process (every restart ends all sessions) and a warning says so once.
 * In paid mode (`VC_PROVIDER=magnific`) a missing secret throws: the site must not run with money behind it and a key nobody chose.
 * The random key sits on `globalThis`: a dev hot reload and the proxy bundle must see the same one.
 */
export function sessionKey(): Buffer {
  const secret = process.env.VC_SESSION_SECRET;
  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) throw new Error(`session-secret-too-short: VC_SESSION_SECRET needs at least ${MIN_SECRET_LENGTH} characters`);
    return Buffer.from(secret);
  }
  if (paidMode()) throw new Error('session-secret-required: set VC_SESSION_SECRET (VC_PROVIDER=magnific runs with real money)');
  if (!holder.__vcSessionKey) {
    holder.__vcSessionKey = randomBytes(32);
    console.warn('VC_SESSION_SECRET is not set: sessions are signed with a random key that ends with this process.');
  }
  return holder.__vcSessionKey;
}
