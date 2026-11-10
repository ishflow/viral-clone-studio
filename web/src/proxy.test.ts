import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionKey } from '@/core/session/secret';
import { SESSION_COOKIE, signSession, verifySession } from '@/core/session/token';
import { proxy } from './proxy';

vi.unmock('@/core/session/token'); // the shared test setup swaps in an identity signer; this suite checks the real signed value

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-05T12:00:00Z');
beforeEach(() => {
  vi.stubEnv('VC_SESSION_SECRET', 'a-session-secret-of-at-least-32-characters');
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('proxy', () => {
  it('overwrites a client-sent x-path with the real path', () => {
    const req = new NextRequest('http://localhost:3100/account?tab=1', { headers: { 'x-path': '/admin' } });
    const res = proxy(req);
    // NextResponse.next({ request: { headers } }) exposes the overridden request headers as x-middleware-request-*
    expect(res.headers.get('x-middleware-request-x-path')).toBe('/account?tab=1');
  });
});

describe('proxy: sliding session', () => {
  const request = (cookie: string | undefined, url = 'http://localhost:3000/gallery', headers: Record<string, string> = {}) =>
    new NextRequest(url, { headers: { ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...headers } });
  const issued = (daysAgo: number, id = 'usr-demo') => signSession(id, sessionKey(), NOW - daysAgo * DAY);

  it('hands out a fresh cookie, with a new 30 days, when the good one is more than a day old', () => {
    const response = proxy(request(issued(2)));
    const set = response.cookies.get(SESSION_COOKIE);
    expect(verifySession(set?.value, sessionKey(), NOW)).toBe('usr-demo');
    expect(set).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86_400 });
    expect(set?.secure).toBeFalsy();
    expect(verifySession(set?.value, sessionKey(), NOW + 29 * DAY)).toBe('usr-demo');
  });

  it('the fresh cookie is Secure when the request came over https', () => {
    expect(proxy(request(issued(2), 'https://viral.example/gallery')).cookies.get(SESSION_COOKIE)?.secure).toBe(true);
    expect(proxy(request(issued(2), 'http://localhost:3000/gallery', { 'x-forwarded-proto': 'https' })).cookies.get(SESSION_COOKIE)?.secure).toBe(true);
  });

  it('leaves a young cookie alone', () => {
    expect(proxy(request(issued(0))).cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('keeps the log-in time: 61 days after the log-in the fresh cookie ends on day 90, and then there is no fresh one (SEC B6)', () => {
    const response = proxy(request(signSession('usr-demo', sessionKey(), NOW - 2 * DAY, NOW - 61 * DAY)));
    const fresh = response.cookies.get(SESSION_COOKIE)?.value;
    expect(verifySession(fresh, sessionKey(), NOW + 29 * DAY - 1000)).toBe('usr-demo');
    expect(verifySession(fresh, sessionKey(), NOW + 29 * DAY + 1000)).toBeNull();
    vi.setSystemTime(NOW + 5 * DAY);
    expect(proxy(request(fresh)).cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('never refreshes a forged, old-format, expired or missing cookie', () => {
    for (const value of ['usr-admin', 'usr-admin.9999999999.AAAA', issued(31), undefined]) {
      expect(proxy(request(value)).cookies.get(SESSION_COOKIE), String(value)).toBeUndefined();
    }
  });
});

