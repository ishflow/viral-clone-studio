// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-demo';
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { resetStore } from '@/data/mock/store';
import OverviewPage from './page';
import EmailsPage from './emails/page';
import UsersPage from './users/page';
import UserDetailPage from './users/[id]/page';
import { GET as exportUsers } from './users/export/route';
import RevenuePage from './revenue/page';
import CreditsPage from './revenue/credits/page';
import { GET as exportPurchases } from './revenue/export/route';
import JobsPage from './jobs/page';
import ReviewPage from './jobs/review/page';
import NewSwapPage from './templates/new-swap/page';
import { GET as swapPhoto } from './jobs/review/[job]/[slot]/[kind]/route';

const search = Promise.resolve({});
const routes: [string, () => Promise<unknown>][] = [
  ['/admin', () => OverviewPage({ searchParams: search })],
  ['/admin/emails', () => EmailsPage()],
  ['/admin/users', () => UsersPage({ searchParams: search })],
  ['/admin/users/[id]', () => UserDetailPage({ params: Promise.resolve({ id: 'usr-demo' }) })],
  ['/admin/users/export', async () => exportUsers(new Request('http://x/admin/users/export'))],
  ['/admin/revenue', () => RevenuePage({ searchParams: search })],
  ['/admin/revenue/credits', () => CreditsPage({ searchParams: search })],
  ['/admin/revenue/export', async () => exportPurchases(new Request('http://x/admin/revenue/export'))],
  ['/admin/jobs', () => JobsPage({ searchParams: search })],
  ['/admin/jobs/review', () => ReviewPage()],
  ['/admin/templates/new-swap', () => NewSwapPage()],
  ['/admin/jobs/review/[job]/[slot]/[kind]', async () => swapPhoto(new Request('http://x/admin/jobs/review/job-1/1/body'), { params: Promise.resolve({ job: 'job-1', slot: '1', kind: 'body' }) })],
];

beforeEach(() => resetStore());

describe.each(routes)('%s', (_path, call) => {
  it('is a 403 for a customer and for a signed-out visitor', async () => {
    sessionId = 'usr-demo';
    await expect(call()).rejects.toThrow('NEXT_FORBIDDEN');
    sessionId = null;
    await expect(call()).rejects.toThrow('NEXT_FORBIDDEN');
  });
  it('answers the admin', async () => {
    sessionId = 'usr-admin';
    await expect(call()).resolves.toBeDefined();
  });
});
