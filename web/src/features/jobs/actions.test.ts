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
import { SWAP_TEMPLATE_ID } from '@/data/mock/demo-values';
import { getStore, resetStore } from '@/data/mock/store';
import { RULES } from '@/data/ports';
import { closeJob, resumeJob } from './actions';
import { loadJob } from './load';
import { START, startConfirmed } from '@/data/mock/test-helpers';

beforeEach(() => {
  resetStore();
  sessionId = 'usr-demo';
  revalidatePath.mockClear();
});

describe('resumeJob', () => {
  it('charges the confirmed cost, resumes the stopped job and refreshes the shell', async () => {
    const cost = await data.jobs.resumeCost('job-demo-stopped', 'usr-demo');
    const before = await data.ledger.balance('usr-demo');
    expect(cost).toBeGreaterThan(0);
    expect(await resumeJob('job-demo-stopped', cost)).toEqual({ status: 'ok' });
    expect(await data.ledger.balance('usr-demo')).toBe(before - cost);
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('running');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('charges nothing without a confirmed cost: no number, a negative one, a fraction', async () => {
    const before = await data.ledger.balance('usr-demo');
    for (const bad of [undefined, null, '2', -1, 1.5, Number.NaN]) {
      expect(await (resumeJob as (id: string, cost: unknown) => Promise<unknown>)('job-demo-stopped', bad)).toEqual({ status: 'error' });
    }
    expect(await data.ledger.balance('usr-demo')).toBe(before);
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('stopped');
  });

  it('the cost changed after the dialog opened: says the new cost and the balance, charges nothing', async () => {
    const confirmed = 2; // what an older dialog showed (D0: the cost is now the credits returned at the stop, K6)
    const balance = await data.ledger.balance('usr-demo');
    const now = await data.jobs.resumeCost('job-demo-stopped', 'usr-demo');
    expect(now).not.toBe(confirmed);
    expect(await resumeJob('job-demo-stopped', confirmed)).toEqual({ status: 'price-changed', cost: now, balance });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('stopped');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a second confirm (double click, another tab) charges nothing more', async () => {
    const cost = await data.jobs.resumeCost('job-demo-stopped', 'usr-demo');
    await resumeJob('job-demo-stopped', cost);
    const balance = await data.ledger.balance('usr-demo');
    expect(await resumeJob('job-demo-stopped', cost)).toEqual({ status: 'ok' });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
  });

  it('says the cost and the balance when the balance is too low, and spends nothing', async () => {
    const cost = await data.jobs.resumeCost('job-demo-stopped', 'usr-demo');
    const balance = await data.ledger.balance('usr-demo');
    // spend the balance down to cost - 1 with a real job
    const start = { templateId: 'tpl-layering', products: [{ name: 'a', description: '', images: ['a.jpg'] }, { name: 'b', description: '', images: ['a.jpg'] }, { name: 'c', description: '', images: ['a.jpg'] }, { name: 'd', description: '', images: ['a.jpg'] }], quality: 'best' as const, variants: 1 as const, language: 'en' };
    let left = balance;
    for (let n = 0; left >= cost; n++) {
      // fast, 1 variant costs 2: drop to fast when the best price no longer fits
      const quality = left >= 5 ? ('best' as const) : ('fast' as const);
      await startConfirmed('usr-demo', { ...start, quality }, `k${n}`);
      left = await data.ledger.balance('usr-demo');
    }
    const out = await resumeJob('job-demo-stopped', cost);
    expect(out).toEqual({ status: 'insufficient', cost, balance: left });
    expect(await data.ledger.balance('usr-demo')).toBe(left);
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('stopped');
  });

  it('is a 404 for another user\'s job', async () => {
    sessionId = 'usr-paying';
    await expect(resumeJob('job-demo-stopped', 2)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends a signed-out visitor to the login page', async () => {
    sessionId = null;
    await expect(resumeJob('job-demo-stopped', 2)).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('sends a user whose email is not verified to /verify-email', async () => {
    sessionId = 'usr-unverified';
    await expect(resumeJob('job-demo-stopped', 2)).rejects.toThrow('NEXT_REDIRECT:/verify-email');
  });
});

describe('resumeJob, content rule and the free video', () => {
  it('a job stopped by the content rules cannot be continued, at any price: nothing is charged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const job = await startConfirmed('usr-demo', {
      templateId: 'tpl-layering', products: [{ name: 'Oil', description: 'content-rule-test', images: ['a.jpg'] }], quality: 'fast', variants: 1, language: 'en',
    }, 'rule-1');
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();
    const stopped = await data.jobs.get(job.id, 'usr-demo');
    const balance = await data.ledger.balance('usr-demo');
    expect(stopped).toMatchObject({ status: 'stopped', stoppedReason: 'content-rule' });
    expect((await data.jobs.resumeQuote(job.id, 'usr-demo')).resumable).toBe(false);
    expect(await resumeJob(job.id, 0)).toEqual({ status: 'error' });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
  });
});

describe('resumeJob, a person swap while person swap is switched off', () => {
  it('is refused in its own name: nothing is charged, the job stays stopped, and the page is read again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    vi.stubEnv('VC_FAKE_SWAP', '1');
    resetStore();
    const sent = { templateId: SWAP_TEMPLATE_ID, quality: 'fast' as const, people: [{ slot: 1, body: 'swap-stop-test.jpg', face: null }] };
    const consent = { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion };
    const job = await data.swap.start('usr-demo', sent, 'swap-1', await data.swap.estimate('usr-demo', sent), consent);
    vi.advanceTimersByTime(30_000);
    expect(await data.jobs.get(job.id, 'usr-demo')).toMatchObject({ status: 'stopped', creditsReturned: 3 });
    vi.useRealTimers();
    vi.unstubAllEnvs();
    const balance = await data.ledger.balance('usr-demo');
    getStore().limits.personSwap = false;
    expect(await resumeJob(job.id, 3)).toEqual({ status: 'error', swapClosed: true });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect((await data.jobs.get(job.id, 'usr-demo'))!.status).toBe('stopped');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    getStore().limits.personSwap = true;
    expect(await resumeJob(job.id, 3)).toEqual({ status: 'ok' });
    expect(await data.ledger.balance('usr-demo')).toBe(balance - 3);
  });
});

describe('closeJob', () => {
  it('closes the stopped job of the owner: closed, nothing charged, the returned credits stay, the shell refreshes', async () => {
    const balance = await data.ledger.balance('usr-demo');
    expect(await closeJob('job-demo-stopped')).toEqual({ status: 'ok' });
    const job = await data.jobs.get('job-demo-stopped', 'usr-demo');
    expect(job).toMatchObject({ status: 'closed', closedReason: 'customer' });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('a second click (double click, another tab) changes nothing', async () => {
    await closeJob('job-demo-stopped');
    const balance = await data.ledger.balance('usr-demo');
    expect(await closeJob('job-demo-stopped')).toEqual({ status: 'ok' });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
  });

  it('a running job cannot be closed', async () => {
    expect(await closeJob('job-demo-running')).toEqual({ status: 'error' });
    expect((await data.jobs.get('job-demo-running', 'usr-demo'))?.status).toBe('running');
  });

  it('is a 404 for another user\'s job; a signed-out visitor goes to the login page', async () => {
    sessionId = 'usr-paying';
    await expect(closeJob('job-demo-stopped')).rejects.toThrow('NEXT_NOT_FOUND');
    sessionId = null;
    await expect(closeJob('job-demo-stopped')).rejects.toThrow('NEXT_REDIRECT:/login');
  });
});

describe('loadJob', () => {
  it('returns the job and its template for the owner', async () => {
    const out = await loadJob('job-demo-story');
    expect(out.job.id).toBe('job-demo-story');
    expect(out.template?.id).toBe('tpl-story');
  });
  it('is a 404 for another user\'s job and for an unknown id', async () => {
    sessionId = 'usr-paying';
    await expect(loadJob('job-demo-story')).rejects.toThrow('NEXT_NOT_FOUND');
    sessionId = 'usr-demo';
    await expect(loadJob('nope')).rejects.toThrow('NEXT_NOT_FOUND');
  });
  it('sends a signed-out visitor to the login page with the way back', async () => {
    sessionId = null;
    await expect(loadJob('job-demo-story')).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fjobs%2Fjob-demo-story');
  });
});
