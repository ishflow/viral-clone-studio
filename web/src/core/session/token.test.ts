// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.unmock('./token'); // the shared test setup swaps in an identity signer for the other suites

import { SESSION_MAX_AGE_SECONDS, refreshSession, signSession, verifySession } from './token';

const KEY = Buffer.from('k'.repeat(32));
const OTHER_KEY = Buffer.from('o'.repeat(32));
const NOW = Date.parse('2026-10-05T12:00:00Z');
const DAY = 86_400_000;
/** The value the site signed before the log-in time was part of it: `<userId>.<expiry>.<hmac of "userId.expiry">`. */
const oldFormat = (id: string, expiry: number) => `${id}.${expiry}.${createHmac('sha256', KEY).update(`${id}.${expiry}`).digest('base64url')}`;

describe('signed session value', () => {
  it('is <userId>.<log-in time>.<expiry>.<hmac> and verifies to the user id', () => {
    const value = signSession('usr-demo', KEY, NOW);
    const [id, issued, expiry, mac] = value.split('.');
    expect(id).toBe('usr-demo');
    expect(Number(issued)).toBe(Math.floor(NOW / 1000));
    expect(Number(expiry)).toBe(Math.floor(NOW / 1000) + SESSION_MAX_AGE_SECONDS);
    expect(mac).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifySession(value, KEY, NOW)).toBe('usr-demo');
  });

  it('lasts 30 days', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 86_400);
    const value = signSession('usr-demo', KEY, NOW);
    expect(verifySession(value, KEY, NOW + 30 * DAY - 1000)).toBe('usr-demo');
    expect(verifySession(value, KEY, NOW + 30 * DAY + 1000)).toBeNull();
  });

  it('rejects the old format (the bare user id) and other forgeries', () => {
    for (const bad of ['usr-admin', 'usr-admin.', 'usr-admin..', '.', '..', '', 'usr-admin.9999999999.', 'usr-admin.9999999999.AAAA', undefined]) {
      expect(verifySession(bad, KEY, NOW), String(bad)).toBeNull();
    }
  });

  it('a cookie of the format before the log-in time is refused like any bad value: no crash, the person logs in again', () => {
    const future = Math.floor(NOW / 1000) + 1000;
    for (const old of [oldFormat('usr-demo', future), oldFormat('usr-demo~v3', future), oldFormat('usr-demo.1759000000', future)]) {
      expect(verifySession(old, KEY, NOW), old).toBeNull();
      expect(refreshSession(old, KEY, NOW), old).toBeNull();
    }
  });

  it('rejects a tampered user id, expiry or mac', () => {
    const value = signSession('usr-demo', KEY, NOW);
    const [, issued, expiry, mac] = value.split('.');
    expect(verifySession(`usr-demo.${issued}.${expiry}.${mac}`, KEY, NOW)).toBe('usr-demo');
    expect(verifySession(`usr-admin.${issued}.${expiry}.${mac}`, KEY, NOW)).toBeNull();
    expect(verifySession(`usr-demo.${Number(issued) + 99_999}.${expiry}.${mac}`, KEY, NOW)).toBeNull();
    expect(verifySession(`usr-demo.${issued}.${Number(expiry) + 99_999}.${mac}`, KEY, NOW)).toBeNull();
    expect(verifySession(`usr-demo.${issued}.${expiry}.${mac!.slice(0, -1)}${mac!.endsWith('A') ? 'B' : 'A'}`, KEY, NOW)).toBeNull();
    expect(verifySession(`${value}x`, KEY, NOW)).toBeNull();
  });

  it('rejects a value signed with another key', () => {
    expect(verifySession(signSession('usr-demo', OTHER_KEY, NOW), KEY, NOW)).toBeNull();
  });

  it('rejects an expired value even when the signature is right', () => {
    const value = signSession('usr-demo', KEY, NOW - 31 * DAY);
    expect(verifySession(value, KEY, NOW)).toBeNull();
  });

  it('rejects a mac made over a different message layout', () => {
    const expiry = Math.floor(NOW / 1000) + 1000;
    const mac = createHmac('sha256', KEY).update(`usr-admin.${expiry - 1000}.${expiry}`).digest('base64url');
    expect(verifySession(`usr-admin.${expiry - 1000}.${expiry}.${mac}`, KEY, NOW)).toBeNull();
  });

  it('a user id with a dot still round-trips (the mac is read from the right)', () => {
    expect(verifySession(signSession('a.b', KEY, NOW), KEY, NOW)).toBe('a.b');
  });
});

describe('sliding expiry', () => {
  it('gives a fresh value, good for 30 more days, once the value is more than a day old, not before', () => {
    const value = signSession('usr-demo', KEY, NOW);
    expect(refreshSession(value, KEY, NOW + DAY - 1000)).toBeNull();
    const fresh = refreshSession(value, KEY, NOW + DAY + 1000);
    expect(verifySession(fresh ?? undefined, KEY, NOW + 31 * DAY)).toBe('usr-demo');
    expect(verifySession(fresh ?? undefined, KEY, NOW + 31 * DAY + 2000)).toBeNull();
  });
  it('never refreshes a value that does not verify', () => {
    expect(refreshSession('usr-demo', KEY, NOW)).toBeNull();
    expect(refreshSession(signSession('usr-demo', KEY, NOW - 40 * DAY), KEY, NOW)).toBeNull();
  });
  it('a copied cookie cannot be kept alive for ever: refreshed every day, it ends 90 days after its log-in (SEC B6)', () => {
    let value = signSession('usr-demo', KEY, NOW);
    for (let day = 1; day < 90; day += 1) value = refreshSession(value, KEY, NOW + day * DAY) ?? value;
    expect(verifySession(value, KEY, NOW + 90 * DAY - 1000)).toBe('usr-demo');
    expect(verifySession(value, KEY, NOW + 90 * DAY + 1000)).toBeNull();
    expect(refreshSession(value, KEY, NOW + 90 * DAY - 1000)).toBeNull();
  });
  it('the log-in time is signed: moving it later does not buy more days', () => {
    const [id, issued, expiry, mac] = signSession('usr-demo', KEY, NOW - 80 * DAY, NOW - 80 * DAY).split('.');
    expect(refreshSession(`${id}.${Number(issued) + 80 * 86_400}.${expiry}.${mac}`, KEY, NOW - 78 * DAY)).toBeNull();
  });
});
