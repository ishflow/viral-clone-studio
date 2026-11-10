import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sessionUser = vi.hoisted(() => ({ current: null as { role: 'admin' | 'customer' } | null }));
vi.mock('@/core/session/session', () => ({ getSessionUser: async () => sessionUser.current }));

import { OwnerTestBanner } from './OwnerTestBanner';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  sessionUser.current = null;
});

const shown = async (ownerTest: boolean, user: typeof sessionUser.current) => {
  vi.stubEnv('VC_OWNER_TEST', ownerTest ? '1' : '');
  sessionUser.current = user;
  render(<>{await OwnerTestBanner()}</>);
  return screen.queryByRole('alert');
};

describe('the OWNER TEST band', () => {
  it('is for the admin: it says real money is spent, in both languages', async () => {
    expect(await shown(true, { role: 'admin' })).toHaveTextContent('OWNER TEST: real Magnific money is spent / gerçek Magnific parası harcanır');
  });
  it('a visitor who is not signed in does not see it', async () => {
    expect(await shown(true, null)).toBeNull();
  });
  it('a customer does not see it', async () => {
    expect(await shown(true, { role: 'customer' })).toBeNull();
  });
  it('outside the owner test nobody sees it, the admin included', async () => {
    expect(await shown(false, { role: 'admin' })).toBeNull();
  });
});
