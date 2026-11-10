import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  set: vi.fn((...args: [name: string, value: string, options?: unknown]) => void jar.set(args[0], args[1])),
  delete: vi.fn((name: string) => void jar.delete(name)),
};
let requestHeaders: Record<string, string> = {};
vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers(requestHeaders),
}));
// The shared test setup lets the other suites keep a bare user id in the cookie; this suite checks the real signed value.
vi.unmock('./token');

import { resetStore } from '@/data/mock/store';
import { SESSION_COOKIE, endSession, getSessionState, getSessionUser, safeNext, startSession } from './session';
import { signSession, verifySession } from './token';
import { sessionKey } from './secret';

const SECRET = 'a-session-secret-of-at-least-32-characters';
const DAY = 86_400_000;

beforeEach(() => {
  resetStore();
  jar.clear();
  vi.clearAllMocks();
  requestHeaders = {};
  vi.stubEnv('VC_SESSION_SECRET', SECRET);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/jobs/1')).toBe('/jobs/1');
    expect(safeNext('/videos?page=2')).toBe('/videos?page=2');
    expect(safeNext('/jobs/1?tab=a#x')).toBe('/jobs/1?tab=a#x');
  });
  it('returns an encoded double slash as a literal path (callers must not decode it again)', () => {
    expect(safeNext('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
  });
  it('rejects control characters and whitespace that browsers strip', () => {
    for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/ //evil.com', 'javascript:alert(1)', 'data:text/html,x']) {
      expect(safeNext(bad)).toBe('/gallery');
    }
  });
  it('rejects paths that normalise to a protocol-relative URL', () => {
    for (const bad of ['/.//evil.com', '/..//evil.com', '/%2e%2e//evil.com', '/./\\evil.com', '/a/../..//evil.com']) {
      expect(safeNext(bad)).toBe('/gallery');
    }
  });
  it('keeps a double slash in the query', () => {
    expect(safeNext('/x?next=//evil.com')).toBe('/x?next=//evil.com');
  });
  it('never bounces back to the auth pages', () => {
    for (const bad of ['/login', '/login?next=/x', '/signup']) expect(safeNext(bad)).toBe('/gallery');
  });
  it('rejects anything else', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'jobs/1', '', undefined]) {
      expect(safeNext(bad)).toBe('/gallery');
    }
  });
});

describe('getSessionUser', () => {
  const sign = (id: string, at = Date.now()) => signSession(id, sessionKey(), at);

  it('is null without a cookie or with an unknown id', async () => {
    expect(await getSessionUser()).toBeNull();
    jar.set(SESSION_COOKIE, sign('usr-nobody'));
    expect(await getSessionUser()).toBeNull();
  });
  it('returns the user for a valid signed cookie', async () => {
    jar.set(SESSION_COOKIE, sign('usr-demo'));
    expect((await getSessionUser())?.id).toBe('usr-demo');
  });
  it('is null for a blocked user even with a valid cookie', async () => {
    jar.set(SESSION_COOKIE, sign('usr-blocked'));
    expect(await getSessionUser()).toBeNull();
  });
  it('is null for the old cookie format: the bare user id of the admin', async () => {
    jar.set(SESSION_COOKIE, 'usr-admin');
    expect(await getSessionUser()).toBeNull();
    jar.set(SESSION_COOKIE, 'usr-admin.9999999999.forged');
    expect(await getSessionUser()).toBeNull();
  });
  it('is null for a tampered cookie: another user id under the demo user\'s signature', async () => {
    const [, issued, expiry, mac] = sign('usr-demo').split('.');
    jar.set(SESSION_COOKIE, `usr-admin.${issued}.${expiry}.${mac}`);
    expect(await getSessionUser()).toBeNull();
  });
  it('is null for an expired cookie', async () => {
    jar.set(SESSION_COOKIE, sign('usr-demo', Date.now() - 31 * DAY));
    expect(await getSessionUser()).toBeNull();
  });
  it('is null for a cookie signed with another secret', async () => {
    jar.set(SESSION_COOKIE, sign('usr-demo'));
    vi.stubEnv('VC_SESSION_SECRET', `${SECRET}-rotated`);
    expect(await getSessionUser()).toBeNull();
  });
});

describe('startSession / endSession', () => {
  it('sets a signed value, httpOnly, lax, path /, 30 days; not Secure over plain http', async () => {
    await startSession('usr-demo');
    const [name, value, options] = cookieStore.set.mock.calls[0]!;
    expect(name).toBe(SESSION_COOKIE);
    expect(verifySession(value, sessionKey(), Date.now())).toBe('usr-demo');
    expect(options).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86_400, secure: false });
  });
  it('is Secure when the request came over https (forwarded by the proxy in front, or the Origin)', async () => {
    requestHeaders = { 'x-forwarded-proto': 'https' };
    await startSession('usr-demo');
    expect(cookieStore.set.mock.calls[0]![2]).toMatchObject({ secure: true });
    requestHeaders = { origin: 'https://viral.example' };
    await startSession('usr-demo');
    expect(cookieStore.set.mock.calls[1]![2]).toMatchObject({ secure: true });
    requestHeaders = { 'x-forwarded-proto': 'http', origin: 'http://localhost:3000' };
    await startSession('usr-demo');
    expect(cookieStore.set.mock.calls[2]![2]).toMatchObject({ secure: false });
  });
  it('deletes the cookie on end', async () => {
    await startSession('usr-demo');
    await endSession();
    expect(cookieStore.delete).toHaveBeenCalledWith(SESSION_COOKIE);
    expect(await getSessionUser()).toBeNull();
  });
  it('log-out ends the session on the server: a copy of the cookie stops working, a new log-in works (SEC B6)', async () => {
    await startSession('usr-demo');
    const copy = jar.get(SESSION_COOKIE)!;
    await endSession();
    jar.set(SESSION_COOKIE, copy);
    expect(await getSessionUser()).toBeNull();
    await startSession('usr-demo');
    expect((await getSessionUser())?.id).toBe('usr-demo');
  });
  it('log-out ends the sessions of that account only, and without a good cookie it ends nobody\'s', async () => {
    await startSession('usr-admin');
    const admin = jar.get(SESSION_COOKIE)!;
    await startSession('usr-demo');
    await endSession();
    for (const none of [undefined, 'usr-admin', 'usr-admin.1.9999999999.forged']) {
      if (none) jar.set(SESSION_COOKIE, none);
      await endSession();
    }
    jar.set(SESSION_COOKIE, admin);
    expect((await getSessionUser())?.id).toBe('usr-admin');
  });
});

describe('password-reset revocation', () => {
  it('revokes cookies in every browser and admits a new login', async () => {
    const { data } = await import('@/data');
    const { getStore, resetStore } = await import('@/data/mock/store');
    resetStore();
    await startSession('usr-demo');
    const old = jar.get(SESSION_COOKIE)!;
    const user = (await data.auth.getUser('usr-demo'))!;
    await data.auth.requestPasswordReset(user.email);
    const token = getStore().tokens.find((entry) => entry.purpose === 'reset')!.token;
    expect(await data.auth.resetPasswordWithLink(token, 'new-password')).toMatchObject({ ok: true });
    jar.set(SESSION_COOKIE, old);
    expect(await getSessionUser()).toBeNull();
    await startSession(user.id);
    expect((await getSessionUser())?.id).toBe(user.id);
    jar.set(SESSION_COOKIE, old);
    expect(await getSessionUser()).toBeNull();
    resetStore();
  });
});

describe('a block by an admin ends the open session', () => {
  it('the cookie the user already holds shows the blocked page, not the account; it does not come back with the unblock, a new log-in does', async () => {
    const { data } = await import('@/data');
    await startSession('usr-demo');
    const open = jar.get(SESSION_COOKIE)!;
    expect(await getSessionState()).toMatchObject({ kind: 'active' });

    await data.admin.setAccess('usr-admin', 'usr-demo', true, 'Chargeback');
    expect(await getSessionState()).toMatchObject({ kind: 'blocked' });
    expect(await getSessionUser()).toBeNull();

    await data.admin.setAccess('usr-admin', 'usr-demo', false, 'Resolved');
    jar.set(SESSION_COOKIE, open);
    expect(await getSessionState()).toEqual({ kind: 'expired' });
    await startSession('usr-demo');
    expect((await getSessionUser())?.id).toBe('usr-demo');
  });
  it('a block that was already in place ends nothing again', async () => {
    const { data } = await import('@/data');
    await data.admin.setAccess('usr-admin', 'usr-demo', true, 'Chargeback');
    const before = (await data.auth.getUser('usr-demo'))!.sessionVersion;
    await data.admin.setAccess('usr-admin', 'usr-demo', true, 'Again');
    expect((await data.auth.getUser('usr-demo'))!.sessionVersion).toBe(before);
  });
});
