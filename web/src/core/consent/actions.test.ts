import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCookieConsent, setCookieConsent } from './actions';

const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));
const refreshShell = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('@/core/session/refresh', () => ({ refreshShell }));

beforeEach(() => vi.clearAllMocks());

describe('cookie consent actions', () => {
  it('stores a valid choice and refreshes the shell', async () => {
    const form = new FormData();
    form.set('choice', 'necessary');
    await setCookieConsent(form);
    expect(jar.set).toHaveBeenCalledWith('vc_cookies', 'necessary', expect.objectContaining({ path: '/' }));
    expect(refreshShell).toHaveBeenCalledTimes(1);
  });
  it('clearing the answer deletes the cookie and refreshes the shell, so the notice asks again', async () => {
    await clearCookieConsent();
    expect(jar.delete).toHaveBeenCalledWith('vc_cookies');
    expect(refreshShell).toHaveBeenCalledTimes(1);
  });
});
