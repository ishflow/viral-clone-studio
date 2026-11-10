import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  forbidden: vi.fn(() => {
    throw new Error('FORBIDDEN');
  }),
}));

vi.unmock('./token');
import { signSession } from './token';
import { sessionKey } from './secret';
const sign = (id: string, now = Date.now()) => signSession(id, sessionKey(), now);

import { forbidden, redirect } from 'next/navigation';
import { requireAdmin, requireUser } from './guards';
import { SESSION_COOKIE } from './session';

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
});

describe('requireUser', () => {
  it('redirects to /login with the encoded path when signed out', async () => {
    await expect(requireUser('/videos')).rejects.toThrow('REDIRECT:/login?next=%2Fvideos');
    expect(redirect).toHaveBeenCalledWith('/login?next=%2Fvideos');
  });
  it('redirects a blocked user too', async () => {
    jar.set(SESSION_COOKIE, sign('usr-blocked'));
    await expect(requireUser('/gallery')).rejects.toThrow('REDIRECT:/blocked');
  });
  it('returns the user when signed in', async () => {
    jar.set(SESSION_COOKIE, sign('usr-demo'));
    expect((await requireUser('/videos')).id).toBe('usr-demo');
  });
  it('sends a signed-in user whose email is not verified to /verify-email (spec §2: verification is mandatory)', async () => {
    jar.set(SESSION_COOKIE, sign('usr-unverified'));
    await expect(requireUser('/videos')).rejects.toThrow('REDIRECT:/verify-email');
    expect(redirect).toHaveBeenCalledWith('/verify-email');
  });
  it('without a path (a server action) sends a signed-out visitor to /login and an unverified user to /verify-email', async () => {
    await expect(requireUser()).rejects.toThrow('REDIRECT:/login');
    expect(redirect).toHaveBeenLastCalledWith('/login');
    jar.set(SESSION_COOKIE, sign('usr-unverified'));
    await expect(requireUser()).rejects.toThrow('REDIRECT:/verify-email');
    jar.set(SESSION_COOKIE, sign('usr-demo'));
    expect((await requireUser()).id).toBe('usr-demo');
  });
});

describe('requireAdmin', () => {
  it('calls forbidden for a customer', async () => {
    jar.set(SESSION_COOKIE, sign('usr-demo'));
    await expect(requireAdmin()).rejects.toThrow('FORBIDDEN');
    expect(forbidden).toHaveBeenCalled();
  });
  it('calls forbidden when signed out', async () => {
    await expect(requireAdmin()).rejects.toThrow('FORBIDDEN');
  });
  it('returns an admin', async () => {
    jar.set(SESSION_COOKIE, sign('usr-admin'));
    expect((await requireAdmin()).role).toBe('admin');
  });
});

 it('expired, unsigned or unknown sessions use the expiry recovery route', async () => {
  jar.set(SESSION_COOKIE, 'unknown-id');
  await expect(requireUser('/account')).rejects.toThrow('REDIRECT:/login?reason=expired&next=%2Faccount');
  await expect(requireAdmin()).rejects.toThrow('REDIRECT:/login?reason=expired');
});
it('a signed blocked admin cannot pass the admin guard', async () => {
  jar.set(SESSION_COOKIE, sign('usr-blocked'));
  await expect(requireAdmin()).rejects.toThrow('REDIRECT:/blocked');
});

it('an expired signed cookie cannot pass either guard', async () => {
  jar.set(SESSION_COOKIE, sign('usr-admin', Date.now() - 31 * 86_400_000));
  await expect(requireUser()).rejects.toThrow('REDIRECT:/login?reason=expired');
  await expect(requireAdmin()).rejects.toThrow('REDIRECT:/login?reason=expired');
});
