// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-admin';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({
  forbidden: () => { throw new Error('NEXT_FORBIDDEN'); },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { getStore, resetStore } from '@/data/mock/store';
import { loadUserDetail, loadUsers } from './load';
import { parseUsersQuery } from './query';

beforeEach(() => {
  resetStore();
  sessionId = 'usr-admin';
});

describe('parseUsersQuery', () => {
  it('unknown filter → all; q is trimmed', () => {
    expect(parseUsersQuery({ filter: 'zzz', q: '  ann ' })).toEqual({ filter: 'all', q: 'ann' });
    expect(parseUsersQuery({ filter: ['blocked'] })).toEqual({ filter: 'blocked', q: '' });
  });
});

describe('loadUsers', () => {
  it('filters and searches; total is everyone', async () => {
    const blocked = await loadUsers({ filter: 'blocked' });
    expect(blocked.list.map((u) => u.id)).toEqual(['usr-blocked']);
    expect(blocked.total).toBeGreaterThan(1);
    expect((await loadUsers({ q: 'demo' })).list.map((u) => u.id)).toEqual(['usr-demo']);
    expect((await loadUsers({ q: 'zzzz-nobody' })).list).toEqual([]);
  });
  it('is a 404 for a customer', async () => {
    sessionId = 'usr-demo';
    await expect(loadUsers({})).rejects.toThrow('NEXT_FORBIDDEN');
  });
});

describe('loadUserDetail', () => {
  it('unknown id → 404', async () => {
    await expect(loadUserDetail('usr-nobody')).rejects.toThrow('NEXT_NOT_FOUND');
  });
  it('knows when the admin looks at their own account', async () => {
    expect((await loadUserDetail('usr-admin')).isSelf).toBe(true);
    expect((await loadUserDetail('usr-demo')).isSelf).toBe(false);
  });
  it('a purchase carries the provider\'s own invoice address where the payment has one, and none otherwise', async () => {
    const [first, second] = getStore().purchases.filter((p) => p.userId === 'usr-paying' && p.invoiceId);
    first!.invoiceUrl = 'https://test.dodopayments.com/invoices/payments/pay_A';
    const detail = await loadUserDetail('usr-paying');
    expect(detail.purchases.find((p) => p.id === first!.id)!.invoiceUrl).toBe('https://test.dodopayments.com/invoices/payments/pay_A');
    expect(detail.purchases.find((p) => p.id === second!.id)!.invoiceUrl).toBeNull();
  });
  it('joins invoice numbers and template formats', async () => {
    const detail = await loadUserDetail('usr-paying');
    expect(detail.purchases.some((p) => p.invoiceId && p.invoiceNumber)).toBe(true);
    expect(detail.jobs.every((j) => j.format !== null)).toBe(true);
  });
});
