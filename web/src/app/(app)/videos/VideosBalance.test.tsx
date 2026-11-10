import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const user = { id: 'u1', freeVideoAvailable: false } as User;
const getUser = vi.fn();
vi.mock('@/data', () => ({ data: { auth: { getUser: (...a: unknown[]) => getUser(...a) } } }));
const getBalanceLabel = vi.fn();
vi.mock('@/core/session/balance', () => ({ getBalanceLabel: (...a: unknown[]) => getBalanceLabel(...a) }));
vi.mock('@/core/i18n/server', () => ({ getI18n: async () => ({ t: (k: string) => k }) }));

import type { User } from '@/data/ports';
import { ShownBalance } from '@/features/jobs';
import { VideosBalance } from './VideosBalance';

beforeEach(() => {
  refresh.mockReset();
  getUser.mockReset().mockResolvedValue(user);
  getBalanceLabel.mockReset().mockResolvedValue('19 credits');
});
afterEach(cleanup);

describe('VideosBalance', () => {
  it('listing the videos can return credits of a stopped one: the header that shows the balance from before catches up', async () => {
    render(<ShownBalance label="17 credits">{await VideosBalance({ user })}</ShownBalance>);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the header already shows that balance', async () => {
    render(<ShownBalance label="19 credits">{await VideosBalance({ user })}</ShownBalance>);
    expect(refresh).not.toHaveBeenCalled();
  });
});
