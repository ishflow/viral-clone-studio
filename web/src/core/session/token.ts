import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'vc_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 86_400;
/** However often it is refreshed, a session ends this long after its log-in: a copied cookie cannot be kept alive for ever. */
const SESSION_LIFETIME_SECONDS = 90 * 86_400;
const REFRESH_AFTER_SECONDS = 86_400;

// Joined by line breaks, not by the dots of the value: the mac of a value of the format before the log-in time never fits.
const mac = (userId: string, issued: number, expiry: number, key: Buffer): Buffer => createHmac('sha256', key).update(`${userId}\n${issued}\n${expiry}`).digest();

/**
 * `<userId>.<log-in time>.<expiry>.<hmac-sha256, base64url>` (unix seconds): the value of the session cookie.
 * `issuedMs` is the log-in this value continues (a refresh passes it on); the expiry never goes past the lifetime of that log-in.
 */
export function signSession(userId: string, key: Buffer, nowMs: number, issuedMs: number = nowMs): string {
  const issued = Math.floor(issuedMs / 1000);
  const expiry = Math.min(Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS, issued + SESSION_LIFETIME_SECONDS);
  return `${userId}.${issued}.${expiry}.${mac(userId, issued, expiry, key).toString('base64url')}`;
}

/** The fields of a value that is well formed, correctly signed and not expired; else null. The three last fields are read from the right. */
function check(value: string | undefined, key: Buffer, nowMs: number): { userId: string; issued: number; expiry: number } | null {
  const parts = /^(.+)\.(\d{1,12})\.(\d{1,12})\.([^.]*)$/.exec(value ?? '');
  if (!parts) return null;
  const [userId, issued, expiry] = [parts[1]!, Number(parts[2]), Number(parts[3])];
  const given = Buffer.from(parts[4]!, 'base64url');
  const wanted = mac(userId, issued, expiry, key);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  return expiry * 1000 > nowMs ? { userId, issued, expiry } : null;
}

/** The user id of a good value; null for anything else (the bare-id cookie, the format before the log-in time, a forgery, a changed field, an expired value). */
export function verifySession(value: string | undefined, key: Buffer, nowMs: number): string | null {
  return check(value, key, nowMs)?.userId ?? null;
}

/**
 * Sliding expiry: the fresh value for a good one more than a day old (the proxy, which may set cookies, hands it out); else null.
 * It keeps the log-in time, so at the end of the lifetime there is nothing fresh to give.
 */
export function refreshSession(value: string | undefined, key: Buffer, nowMs: number): string | null {
  const good = check(value, key, nowMs);
  if (!good || good.expiry - Math.floor(nowMs / 1000) >= SESSION_MAX_AGE_SECONDS - REFRESH_AFTER_SECONDS) return null;
  const fresh = signSession(good.userId, key, nowMs, good.issued * 1000);
  return fresh === value ? null : fresh;
}

/** HttpOnly, SameSite=Lax, the whole site, 30 days; `Secure` only when the request came over https (a plain-http tailnet address would drop it). */
export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_SECONDS, secure } as const;
}
