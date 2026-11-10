// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => data.auth.getUser('usr-admin');
  return { getSessionUser: readUser, getSessionState: async () => ({ kind: 'active', user: await readUser() }) };
});
vi.mock('next/navigation', () => ({
  forbidden: () => { throw new Error('NEXT_FORBIDDEN'); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { loadOverview } from './load';

beforeEach(() => resetStore());

describe('loadOverview', () => {
  it('the latest purchases leave out a payment that was not completed, even when it is the newest', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
    const unpaid = await data.payments.complete(checkoutId, 'declined');
    expect(unpaid.status).toBe('not-completed');

    const { purchases } = await loadOverview('all');
    expect(purchases.map((p) => p.id)).not.toContain(unpaid.id);
    const unpaidIds = (await data.admin.purchases('all')).filter((p) => p.status === 'not-completed').map((p) => p.id);
    expect(purchases.filter((p) => unpaidIds.includes(p.id))).toEqual([]);
  });

  it('a refunded purchase and one whose refund was sent stay in the latest purchases, marked; a paid one is not', async () => {
    const { checkoutId } = await data.payments.startCheckout('usr-demo', 'pack-starter', '/credits');
    const bought = await data.payments.complete(checkoutId, 'paid');
    await data.payments.requestRefund('usr-demo', bought.id);
    await data.admin.refundPurchase('usr-admin', bought.id, 'Unused pack', 'key-1');

    const { purchases } = await loadOverview('all');
    expect(purchases.find((p) => p.id === bought.id)?.refunded).toBe(true);
    const paidIds = (await data.admin.purchases('all')).filter((p) => p.status === 'paid').map((p) => p.id);
    expect(purchases.filter((p) => paidIds.includes(p.id)).map((p) => p.refunded)).not.toContain(true);
  });
});
