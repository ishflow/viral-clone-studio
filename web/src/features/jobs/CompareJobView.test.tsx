import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  redirect: (to: string) => { throw new Error(`redirect ${to}`); },
  notFound: () => { throw new Error('notFound'); },
}));
vi.mock('./CompareView', () => ({ CompareView: () => <div>compare</div> }));
const user = { id: 'u1', freeVideoAvailable: false };
const loadJob = vi.fn();
vi.mock('./load', () => ({ loadJob: (...a: unknown[]) => loadJob(...a) }));
const getUser = vi.fn();
vi.mock('@/data', () => ({ data: { auth: { getUser: (...a: unknown[]) => getUser(...a) } } }));
const getBalanceLabel = vi.fn();
vi.mock('@/core/session/balance', () => ({ getBalanceLabel: (...a: unknown[]) => getBalanceLabel(...a) }));
vi.mock('@/core/i18n/server', () => ({ getI18n: async () => ({ t: (k: string) => k }) }));

import { CompareJobView } from './CompareJobView';
import { ShownBalance } from './HeaderBalance';

const variant = { id: 'v1', image: '/y.jpg', video: '/y.mp4' };
const done = {
  user,
  job: { id: 'j1', status: 'done', templateTitle: 'T', variants: [variant] },
  template: { seconds: 8, shots: [], image: '/s.jpg', video: '/s.mp4' },
};

beforeEach(() => {
  refresh.mockReset();
  loadJob.mockReset().mockResolvedValue(done);
  getUser.mockReset().mockResolvedValue(user);
  getBalanceLabel.mockReset().mockResolvedValue('19 credits');
});
afterEach(cleanup);

describe('CompareJobView', () => {
  it('reading the job can return credits: the header that still shows the balance from before catches up', async () => {
    render(<ShownBalance label="17 credits">{await CompareJobView({ id: 'j1' })}</ShownBalance>);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reads the balance after the job was read', async () => {
    const order: string[] = [];
    loadJob.mockImplementation(async () => { order.push('job'); return done; });
    getBalanceLabel.mockImplementation(async () => { order.push('balance'); return '19 credits'; });
    await CompareJobView({ id: 'j1' });
    expect(order).toEqual(['job', 'balance']);
  });

  it('stays quiet when the header already shows that balance', async () => {
    render(<ShownBalance label="19 credits">{await CompareJobView({ id: 'j1' })}</ShownBalance>);
    expect(refresh).not.toHaveBeenCalled();
  });
});
