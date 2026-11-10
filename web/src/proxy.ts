import { NextResponse, type NextRequest } from 'next/server';
import { pathFromRequest } from '@/core/session/path';
import { sessionKey } from '@/core/session/secret';
import { SESSION_COOKIE, refreshSession, sessionCookieOptions } from '@/core/session/token';

const overHttps = (request: NextRequest): boolean => {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return (forwarded ?? request.nextUrl.protocol.replace(':', '')) === 'https';
};

/**
 * Passes the request path to server components as the `x-path` header (layouts cannot see it).
 * And keeps the session sliding: a good session cookie more than a day old is replaced by a fresh one (30 days from now, never past
 * 90 days after its log-in). Pages cannot set cookies while they render, the proxy can. A cookie that is missing, forged, in an old
 * format or expired is left alone (nothing is issued).
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-path', pathFromRequest(request.url));
  const response = NextResponse.next({ request: { headers } });
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  const fresh = value ? refreshSession(value, sessionKey(), Date.now()) : null;
  if (fresh) response.cookies.set(SESSION_COOKIE, fresh, sessionCookieOptions(overHttps(request)));
  return response;
}

export const config = {
  matcher: ['/((?!_next/|api/uploads/|samples/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
