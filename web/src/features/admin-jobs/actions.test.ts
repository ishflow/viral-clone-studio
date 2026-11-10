// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { fakeEngine } from '@/data/engine/fake';
import { getStore } from '@/data/mock/store';
import { retryJob, returnCredits, settleUnknown } from './actions';
import { loadJobs } from './load';

const stoppedJob = async () => (await data.admin.jobs({ status: 'stopped' }))[0]!;

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  resetStore();
  sessionId = 'usr-admin';
  revalidatePath.mockClear();
});

describe('guards', () => {
  it.each([['usr-demo'], [null]])('a visitor (%s) gets the 404 page from every action and the loader, and nothing changes', async (who) => {
    sessionId = who;
    const job = await stoppedJob();
    const before = await data.ledger.entries(job.userId);
    await expect(retryJob({ jobId: job.id, reason: 'x' })).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(returnCredits({ jobId: job.id, reason: 'x', key: 'k' })).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(loadJobs({})).rejects.toThrow('NEXT_FORBIDDEN');
    expect(await data.ledger.entries(job.userId)).toHaveLength(before.length);
    expect((await stoppedJob()).id).toBe(job.id);
  });
});

describe('retryJob', () => {
  it('runs a stopped job again without charging the user; a second try says it was already done (no refresh here)', async () => {
    const job = await stoppedJob();
    const balance = await data.ledger.balance(job.userId);
    expect(await retryJob({ jobId: job.id, reason: 'Provider was down' })).toMatchObject({ status: 'done' });
    expect((await data.admin.jobs({})).find((j) => j.id === job.id)?.status).toBe('running');
    expect(await data.ledger.balance(job.userId)).toBe(balance);
    expect(await retryJob({ jobId: job.id, reason: 'Again' })).toMatchObject({ status: 'already' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('needs a reason; an unknown or empty id fails and writes nothing', async () => {
    const job = await stoppedJob();
    expect(await retryJob({ jobId: job.id, reason: '   ' })).toEqual({ status: 'failed' });
    expect((await stoppedJob()).id).toBe(job.id);
    expect(await retryJob({ jobId: 'nope', reason: 'x' })).toEqual({ status: 'failed' });
    expect(await retryJob({ jobId: '', reason: 'x' })).toEqual({ status: 'failed' });
  });
});

describe('settleUnknown (R3)', () => {
  /** The first stopped job, made to read as one that stopped on a request with no clear answer; the fake engine gets the optional method. */
  const stuck = async () => {
    const job = getStore().jobs.find((j) => j.status === 'stopped')!;
    job.stoppedReason = 'submission-unknown';
    return job;
  };
  const settled: string[] = [];
  beforeEach(() => {
    settled.length = 0;
    (fakeEngine as { settleUnknown?: unknown }).settleUnknown = (job: { stoppedReason: string }, by: string) => { settled.push(by); job.stoppedReason = 'engine-error'; };
  });
  afterEach(() => { delete (fakeEngine as { settleUnknown?: unknown }).settleUnknown; });

  it('a visitor gets the 404 page and nothing is settled', async () => {
    const job = await stuck();
    sessionId = 'usr-demo';
    await expect(settleUnknown({ jobId: job.id, reason: 'x' })).rejects.toThrow('NEXT_FORBIDDEN');
    expect(settled).toEqual([]);
  });

  it('the engine is asked once, with the admin\'s name; the reason and the admin are kept; a second try says it was already done', async () => {
    const job = await stuck();
    expect(await settleUnknown({ jobId: job.id, reason: 'No task in the provider list' })).toMatchObject({ status: 'done' });
    expect(settled).toEqual([expect.stringContaining('Admin')]);
    expect(getStore().adminActions.at(-1)).toMatchObject({ action: 'settle-unknown', target: job.id, reason: 'No task in the provider list', by: { kind: 'admin', id: 'usr-admin' } });
    expect(job.stoppedReason).toBe('engine-error');
    expect(await settleUnknown({ jobId: job.id, reason: 'Again' })).toMatchObject({ status: 'already' });
    expect(settled).toHaveLength(1);
  });

  it('a job stopped for any other reason is refused and the engine is not asked', async () => {
    const job = getStore().jobs.find((j) => j.status === 'stopped')!;
    job.stoppedReason = 'clips-failed';
    expect(await settleUnknown({ jobId: job.id, reason: 'x' })).toEqual({ status: 'failed' });
    expect(settled).toEqual([]);
  });

  it('needs a reason and a known job; an engine without the method changes nothing', async () => {
    const job = await stuck();
    expect(await settleUnknown({ jobId: job.id, reason: '  ' })).toEqual({ status: 'failed' });
    expect(await settleUnknown({ jobId: 'nope', reason: 'x' })).toEqual({ status: 'failed' });
    delete (fakeEngine as { settleUnknown?: unknown }).settleUnknown;
    expect(await settleUnknown({ jobId: job.id, reason: 'x' })).toEqual({ status: 'failed' });
    expect(job.stoppedReason).toBe('submission-unknown');
  });
});

describe('returnCredits', () => {
  it('a job that stopped has its credits back already: nothing is returned twice, the dialog is told it was already done or nothing is written', async () => {
    const job = await stoppedJob();
    const before = await data.ledger.balance(job.userId);
    const first = await returnCredits({ jobId: job.id, reason: 'Check', key: 'k-1' });
    const again = await returnCredits({ jobId: job.id, reason: 'Check', key: 'k-1' });
    expect(['done', 'already', 'failed']).toContain(first.status);
    expect(again.status === 'already' || again.status === 'failed').toBe(true);
    expect((await data.ledger.entries(job.userId)).filter((e) => e.type === 'returned' && e.relatedJobId === job.id && e.by.kind === 'admin').length).toBeLessThanOrEqual(1);
    expect(await data.ledger.balance(job.userId)).toBeGreaterThanOrEqual(before);
  });

  it('a finished job charged and never returned gets its credits back once, by the admin, with the reason', async () => {
    const done = (await data.admin.jobs({ status: 'done' })).find((j) => j.credits > j.creditsReturned)!;
    const before = await data.ledger.balance(done.userId);
    const result = await returnCredits({ jobId: done.id, reason: 'Video was unusable', key: 'k-2' });
    expect(result).toMatchObject({ status: 'done', detail: { credits: done.credits - done.creditsReturned, balanceAfter: before + done.credits - done.creditsReturned } });
    const entry = (await data.ledger.entries(done.userId)).find((e) => e.type === 'returned' && e.relatedJobId === done.id && e.by.kind === 'admin');
    expect(entry).toMatchObject({ reason: 'Video was unusable', by: { kind: 'admin', id: 'usr-admin' } });
    expect(await returnCredits({ jobId: done.id, reason: 'Video was unusable', key: 'k-2' })).toMatchObject({ status: 'already' });
    expect(await data.ledger.balance(done.userId)).toBe(before + done.credits - done.creditsReturned);
  });

  it('needs a reason and a known job', async () => {
    const job = await stoppedJob();
    expect(await returnCredits({ jobId: job.id, reason: '', key: 'k' })).toEqual({ status: 'failed' });
    expect(await returnCredits({ jobId: 'nope', reason: 'x', key: 'k' })).toEqual({ status: 'failed' });
  });
});

describe('loadJobs', () => {
  it('filters by status, by search (user or template) and by period, and unknown values fall back', async () => {
    const all = await loadJobs({ period: 'all' });
    expect(all.rows.length).toBeGreaterThan(2);
    const stopped = await loadJobs({ status: 'stopped', period: 'all' });
    expect(stopped.rows.length).toBeGreaterThan(0);
    expect(stopped.rows.every((r) => r.status === 'stopped')).toBe(true);
    const byTitle = await loadJobs({ q: stopped.rows[0]!.templateTitle.slice(0, 5), period: 'all' });
    expect(byTitle.rows.length).toBeGreaterThan(0);
    expect(byTitle.rows.every((r) => r.templateTitle.toLowerCase().includes(stopped.rows[0]!.templateTitle.slice(0, 5).toLowerCase()) || r.email.includes(stopped.rows[0]!.templateTitle.slice(0, 5).toLowerCase()))).toBe(true);
    expect((await loadJobs({ q: 'zzzz-nothing', period: 'all' })).rows).toHaveLength(0);
    const fallback = await loadJobs({ status: 'bogus', period: 'bogus' });
    expect(fallback.status).toBe('all');
    expect(fallback.period).toBe('30d');
    const future = await loadJobs({ period: 'today' }, new Date('2030-01-01T00:00:00Z'));
    expect(future.rows).toHaveLength(0);
    expect(future.total).toBe(all.total);
  });

  it('a job the engine has not begun is In queue with its line, not Running: it is out of the running filter and the running tile', async () => {
    const running = (await loadJobs({ status: 'running', period: 'all' })).rows;
    expect(running.length).toBeGreaterThan(0);
    const line = { ahead: 2, waitMinutes: 14 };
    vi.spyOn(fakeEngine, 'refresh').mockImplementation((job) => Object.assign(job, job.id === running[0]!.id ? { engineQueue: line } : {}));
    const waiting = (await loadJobs({ status: 'queued', period: 'all' })).rows.find((row) => row.id === running[0]!.id);
    expect(waiting).toMatchObject({ status: 'queued', engineQueue: line });
    expect((await loadJobs({ status: 'running', period: 'all' })).rows.map((row) => row.id)).not.toContain(running[0]!.id);
    expect((await loadJobs({ period: 'all' })).tiles.running).toBe(running.length - 1);
  });

  it('"today" is the current day in UTC, not the last 24 hours', async () => {
    const newest = (await loadJobs({ period: 'all' })).rows[0]!;
    const started = new Date(newest.startedAt);
    const justAfterMidnight = new Date(Date.UTC(started.getUTCFullYear(), started.getUTCMonth(), started.getUTCDate() + 1) + 1);
    expect((await loadJobs({ period: 'today' }, started)).rows.map((row) => row.id)).toContain(newest.id);
    expect((await loadJobs({ period: 'today' }, justAfterMidnight)).rows.map((row) => row.id)).not.toContain(newest.id);
  });

  it('shows the first stopped job in the detail card unless ?job= picks another one', async () => {
    const page = await loadJobs({ period: 'all' });
    expect(page.selected?.status).toBe('stopped');
    const running = page.rows.find((r) => r.status === 'running')!;
    expect((await loadJobs({ period: 'all', job: running.id })).selected?.id).toBe(running.id);
    expect((await loadJobs({ period: 'all', job: 'nope' })).selected).toBeNull();
  });
});
