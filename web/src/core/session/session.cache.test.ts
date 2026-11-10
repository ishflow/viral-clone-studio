// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// React's `cache` keeps one result per server request. Outside a request (as here) it does nothing, so this stand-in plays "one request":
// it remembers the first result until `newRequest()`.
const request = vi.hoisted(() => ({ resets: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <R>(fn: () => R) => {
    let hit: { value: R } | null = null;
    request.resets.push(() => {
      hit = null;
    });
    return () => (hit ??= { value: fn() }).value;
  },
}));
const newRequest = () => request.resets.forEach((reset) => reset());

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));

import { data } from '@/data';
import { SESSION_COOKIE, getSessionUser } from './session';

beforeEach(() => {
  jar.clear();
  newRequest();
  vi.restoreAllMocks();
});

describe('getSessionUser within one request', () => {
  it('looks the user up once, however many layouts, headers and pages ask', async () => {
    jar.set(SESSION_COOKIE, 'usr-demo');
    const lookup = vi.spyOn(data.auth, 'getUser');
    const [layout, header, page] = await Promise.all([getSessionUser(), getSessionUser(), getSessionUser()]);
    expect(layout?.id).toBe('usr-demo');
    expect(header).toBe(layout);
    expect(page).toBe(layout);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('the next request looks again', async () => {
    jar.set(SESSION_COOKIE, 'usr-demo');
    expect((await getSessionUser())?.id).toBe('usr-demo');
    newRequest();
    jar.set(SESSION_COOKIE, 'usr-paying');
    expect((await getSessionUser())?.id).toBe('usr-paying');
  });
});
