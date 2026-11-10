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
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { loadVideoRows } from './queries';
import { deleteVideo } from './actions';

beforeEach(() => {
  resetStore();
  sessionId = 'usr-demo';
  revalidatePath.mockClear();
});

describe('deleteVideo', () => {
  it('removes a finished video of the owner from the list, returns no credits, and refreshes the shell', async () => {
    const balance = await data.ledger.balance('usr-demo');
    expect((await loadVideoRows('usr-demo')).some((row) => row.id === 'job-demo-story')).toBe(true);
    expect(await deleteVideo('job-demo-story')).toEqual({ status: 'ok' });
    expect((await loadVideoRows('usr-demo')).some((row) => row.id === 'job-demo-story')).toBe(false);
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('a running or stopped job is not deleted', async () => {
    expect(await deleteVideo('job-demo-running')).toEqual({ status: 'error' });
    expect(await deleteVideo('job-demo-stopped')).toEqual({ status: 'error' });
    const ids = (await loadVideoRows('usr-demo')).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(['job-demo-running', 'job-demo-stopped']));
  });

  it("is a 404 for another user's job; a signed-out visitor goes to the login page", async () => {
    sessionId = 'usr-paying';
    await expect(deleteVideo('job-demo-story')).rejects.toThrow('NEXT_NOT_FOUND');
    sessionId = null;
    await expect(deleteVideo('job-demo-story')).rejects.toThrow('NEXT_REDIRECT:/login');
  });
});

describe('loadVideoRows, person swap', () => {
  it('marks the rows of person swaps while person swap is switched off, and not while it is open', async () => {
    vi.stubEnv('VC_FAKE_SWAP', '1');
    resetStore();
    const { SWAP_TEMPLATE_ID } = await import('@/data/mock/demo-values');
    const { getStore } = await import('@/data/mock/store');
    const { RULES } = await import('@/data/ports');
    const sent = { templateId: SWAP_TEMPLATE_ID, quality: 'fast' as const, people: [{ slot: 1, body: 'me.jpg', face: null }] };
    const job = await data.swap.start('usr-demo', sent, 'swap-1', await data.swap.estimate('usr-demo', sent),
      { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion });
    vi.unstubAllEnvs();
    const closedRows = async () => (await loadVideoRows('usr-demo')).filter((row) => row.swapClosed).map((row) => row.id);
    expect(await closedRows()).toEqual([]);
    getStore().limits.personSwap = false;
    expect(await closedRows()).toEqual([job.id]);
  });
});
