// Signed sessions include the account session version. A password reset, a log-out and a confirmed email change revoke every earlier cookie.
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { data } from '@/data';
import type { Id, User } from '@/data/ports';
import { sessionKey } from './secret';
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from './token';

export { SESSION_COOKIE };
const DEFAULT_NEXT = '/gallery';

/**
 * The signed-in user, or null when there is no valid cookie (none, the old bare-id format, forged, tampered, expired), the id is unknown,
 * or the user is blocked.
 * React `cache`: one lookup per server render, however many layouts, headers and pages ask. Outside a render (a server action,
 * a route handler) `cache` keeps nothing, so an action that has just started or ended a session reads the cookie as it is now.
 */
export type SessionState = { kind: 'anonymous' | 'expired' } | { kind: 'blocked' | 'active'; user: User };

/** Verify signature before reading identity, then compare the stored revocation counter. */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return { kind: 'anonymous' };
  const identity = verifySession(value, sessionKey(), Date.now());
  if (!identity) return { kind: 'expired' };
  const match = /^(.*)~v([0-9]+)$/.exec(identity);
  const id = match ? match[1]! : identity;
  const version = match ? Number(match[2]) : 0;
  const user = await data.auth.getUser(id);
  if (!user) return { kind: 'expired' };
  // A block revokes the session version, so this cookie no longer matches: still, the person is told they are blocked rather than that the session expired.
  if (user.blocked) return { kind: 'blocked', user };
  if ((user.sessionVersion ?? 0) !== version) return { kind: 'expired' };
  return { kind: 'active', user };
});

export const getSessionUser = cache(async (): Promise<User | null> => {
  const state = await getSessionState();
  return state.kind === 'active' ? state.user : null;
});

/** Did this request come over https? The proxy in front (Tailscale serve, a tunnel) says so in `x-forwarded-proto`; a same-origin POST names it in `Origin`. */
async function overHttps(): Promise<boolean> {
  try {
    const sent = await headers();
    const forwarded = sent.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    if (forwarded) return forwarded === 'https';
    return sent.get('origin')?.toLowerCase().startsWith('https:') ?? false;
  } catch {
    return false; // not inside a request
  }
}

/** Server Actions / Route Handlers only (cookies cannot be set while rendering). */
export async function startSession(userId: Id): Promise<void> {
  const user = await data.auth.getUser(userId);
  if (!user || user.blocked) throw new Error('session-user-unavailable');
  const version = user.sessionVersion ?? 0;
  const identity = version === 0 ? userId : `${userId}~v${version}`;
  (await cookies()).set(SESSION_COOKIE, signSession(identity, sessionKey(), Date.now()), sessionCookieOptions(await overHttps()));
}

/** Log-out, everywhere: this browser loses its cookie, and every other cookie of the account (a copied one too) stops working. */
export async function endSession(): Promise<void> {
  const state = await getSessionState();
  if (state.kind === 'active' || state.kind === 'blocked') await data.auth.endSessions(state.user.id);
  (await cookies()).delete(SESSION_COOKIE);
}

const AUTH_PATHS = ['/login', '/signup'];

/** The route of the verification link in the email. */
export const VERIFY_LINK_PATH = '/verify-email/confirm';

/** Is this (already safe) `next` a verification link? The one place an account that is not verified yet may be sent after logging in. */
export function isVerifyLink(next: string): boolean {
  return next.startsWith(`${VERIFY_LINK_PATH}?token=`);
}

/**
 * Only same-site paths; anything else (and the auth pages themselves) falls back to the gallery.
 * Parsed, not pattern-matched: browsers strip tab/CR/LF, so such characters are rejected outright.
 * The result is returned as-is (e.g. "/%2F%2Fevil.com" stays a literal path): callers must not decode it again before redirecting.
 */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || /[\u0000-\u001f\u007f\s]/.test(next)) return DEFAULT_NEXT;
  let url: URL;
  try {
    url = new URL(next, 'http://x');
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== 'http://x') return DEFAULT_NEXT;
  // Validate the normalised result: dot segments collapse ("/.//x" becomes "//x").
  const out = url.pathname + url.search + url.hash;
  if (!out.startsWith('/') || out.startsWith('//') || out.startsWith('/\\')) return DEFAULT_NEXT;
  if (AUTH_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return DEFAULT_NEXT;
  return out;
}
