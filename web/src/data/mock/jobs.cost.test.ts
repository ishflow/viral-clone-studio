// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../engine/fake';
import { data } from '../index';
import { InsufficientCreditsError, PriceChangedError } from '../ports';
import { getStore, resetStore } from './store';
import { START, generateInput, startConfirmed, storedJob } from './test-helpers';

// The credit rule of a stopped job (flow contract §6, K6, K19–K21; B1, B12, B15, B17).
const STOPPED = 'job-demo-stopped'; // Best, 5 credits, stopped with 3 of 5 clips ready; its 5 credits came back when it stopped
const missing = (clips: number) => ({ images: 0, clips, clipSeconds: clips * 4, music: 0, voice: 0 });
const DAY_MS = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A one-variant job on the stop template, stopped (it stops 24.4 s in). */
async function stoppedJob(userId: string, over: Parameters<typeof generateInput>[1] = {}) {
  const job = await startConfirmed(userId, generateInput('tpl-stop', over), `stop-${userId}-${Math.random()}`);
  vi.advanceTimersByTime(60_000);
  return (await data.jobs.get(job.id, userId)) ?? job;
}

describe('B1: a job that stops gives its credits back at once; continuing costs the same amount (K6)', () => {
  it('the fixture job: 5 charged, 5 returned by the system, and continuing costs 5 whatever is missing', async () => {
    const job = await data.jobs.get(STOPPED, 'usr-demo');
    expect(job).toMatchObject({ status: 'stopped', credits: 5, creditsReturned: 5, freeVideo: false });
    const returned = getStore().ledger.find((entry) => entry.relatedJobId === STOPPED && entry.type === 'returned');
    expect(returned).toMatchObject({ change: 5, by: { kind: 'system' } });
    const asked = vi.spyOn(fakeEngine, 'missing').mockReturnValue(missing(4));
    expect(await data.jobs.resumeCost(STOPPED, 'usr-demo')).toBe(5);
    asked.mockReturnValue(missing(1));
    expect(await data.jobs.resumeQuote(STOPPED, 'usr-demo')).toMatchObject({
      resumable: true, cost: 5, charged: 5, returned: 5, free: false, coveredByFreeVideo: false, freeUsedElsewhere: false,
      balance: 19, enough: true, missing: missing(1),
    });
  });

  it('continuing charges the returned amount once, tells the engine what is missing, and the job then finishes', async () => {
    const resume = vi.spyOn(fakeEngine, 'resume');
    const resumed = await data.jobs.resume(STOPPED, 'usr-demo', 5);
    expect(resume).toHaveBeenCalledWith(storedJob(STOPPED), missing(2));
    expect(resumed).toMatchObject({ status: 'running', credits: 5, creditsReturned: 0, stoppedAt: null, continueUntil: null });
    expect((await data.ledger.entries('usr-demo'))[0]).toMatchObject({ type: 'generation', change: -5, balanceAfter: 14, relatedJobId: STOPPED });
    await data.jobs.resume(STOPPED, 'usr-demo', 5);
    expect(resume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(await data.jobs.get(STOPPED, 'usr-demo')).toMatchObject({ status: 'done' });
    expect(await data.ledger.balance('usr-demo')).toBe(14);
  });

  it('a cost that is not the confirmed one is refused with the cost of now; nothing is written', async () => {
    const before = getStore().ledger.length;
    await expect(data.jobs.resume(STOPPED, 'usr-demo', 2)).rejects.toThrow(PriceChangedError);
    expect(getStore().ledger).toHaveLength(before);
  });

  it('a job that stops while it runs: the credits come back as a returned entry, and the email says so', async () => {
    const job = await stoppedJob('usr-demo');
    expect(job).toMatchObject({ status: 'stopped', credits: 2, creditsReturned: 2, stoppedAt: '2026-10-04T12:00:24.400Z' });
    expect(job.continueUntil).toBe(new Date(Date.parse('2026-10-04T12:00:24.400Z') + 30 * DAY_MS).toISOString());
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    const email = (await data.mailer.outbox())[0];
    expect(email).toMatchObject({ kind: 'stopped', data: { jobId: job.id, returned: '2', free: '0' } });
  });

  it('an admin retry does not charge the customer; the credits stay returned', async () => {
    await data.admin.retryJob(STOPPED);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(await data.jobs.get(STOPPED, 'usr-demo')).toMatchObject({ status: 'running', creditsReturned: 5 });
  });

  it('too few credits to continue: InsufficientCreditsError, the job waits (K20)', async () => {
    storedJob(STOPPED).returnedCredits = 50;
    await expect(data.jobs.resume(STOPPED, 'usr-demo', 50)).rejects.toThrow(InsufficientCreditsError);
    expect(storedJob(STOPPED).status).toBe('stopped');
  });
});

describe('B15: a free job that stops gives the free video back (K19)', () => {
  it('the free video comes back; continuing uses it again for 0 credits', async () => {
    const job = await stoppedJob('usr-new');
    expect(job).toMatchObject({ status: 'stopped', credits: 0, freeVideo: true, creditsReturned: 0 });
    expect((await data.auth.getUser('usr-new'))?.freeVideoAvailable).toBe(true);
    expect((await data.mailer.outbox())[0]).toMatchObject({ kind: 'stopped', data: { free: '1' } });
    expect(await data.jobs.resumeQuote(job.id, 'usr-new')).toMatchObject({ cost: 0, free: true, coveredByFreeVideo: true, freeUsedElsewhere: false });
    await data.jobs.resume(job.id, 'usr-new', 0);
    expect((await data.auth.getUser('usr-new'))?.freeVideoAvailable).toBe(false);
    expect((await data.ledger.entries('usr-new'))[0]).toMatchObject({ type: 'free-video', change: 0, relatedJobId: job.id });
  });

  it('the free video was used on another job since: continuing costs the price, and needs the credits', async () => {
    const job = await stoppedJob('usr-new');
    await startConfirmed('usr-new', generateInput('tpl-layering'), 'free-elsewhere');
    expect(await data.jobs.resumeQuote(job.id, 'usr-new')).toMatchObject({ cost: 2, coveredByFreeVideo: false, freeUsedElsewhere: true, balance: 0, enough: false });
    await expect(data.jobs.resume(job.id, 'usr-new', 2)).rejects.toThrow(InsufficientCreditsError);
    await data.admin.addCredits('usr-admin', 'usr-new', 2, 'test', 'k');
    const resumed = await data.jobs.resume(job.id, 'usr-new', 2);
    expect(resumed).toMatchObject({ status: 'running', credits: 2, freeVideo: false });
  });
});

describe('B12: the content rules stop a job for good', () => {
  it('stopped with content-rule, credits back, not resumable', async () => {
    const job = await startConfirmed('usr-demo', generateInput('tpl-layering', {
      products: [{ name: 'Oil', description: 'content-rule-test', images: ['/samples/a.jpg'] }],
    }), 'rule');
    vi.advanceTimersByTime(10_000);
    expect(await data.jobs.get(job.id, 'usr-demo')).toMatchObject({ status: 'stopped', stoppedReason: 'content-rule', creditsReturned: 2 });
    expect(await data.jobs.resumeQuote(job.id, 'usr-demo')).toMatchObject({ resumable: false, cost: 0 });
    await expect(data.jobs.resume(job.id, 'usr-demo', 0)).rejects.toThrow('not-resumable');
  });
});

describe('B17: a stopped job closes', () => {
  it('Stop the job here: closed by the customer, nothing charged; again → as it is; a running job → not-stopped', async () => {
    const before = getStore().ledger.length;
    const closed = await data.jobs.close(STOPPED, 'usr-demo');
    expect(closed).toMatchObject({ status: 'closed', closedReason: 'customer', closedAt: START.toISOString(), creditsReturned: 5, continueUntil: null });
    expect(await data.jobs.close(STOPPED, 'usr-demo')).toEqual(closed);
    expect(getStore().ledger).toHaveLength(before);
    await expect(data.jobs.close('job-demo-running', 'usr-demo')).rejects.toThrow('not-stopped');
    await expect(data.jobs.resume(STOPPED, 'usr-demo', 5)).resolves.toMatchObject({ status: 'closed' });
  });

  it('closes itself 30 days after it stopped, on any read; the last day is the day before', async () => {
    const stoppedAt = storedJob(STOPPED).stoppedAt ?? '';
    const until = new Date(Date.parse(stoppedAt) + 30 * DAY_MS);
    vi.setSystemTime(new Date(until.getTime() - 1));
    expect(await data.jobs.get(STOPPED, 'usr-demo')).toMatchObject({ status: 'stopped', continueUntil: until.toISOString() });
    vi.setSystemTime(until);
    expect(await data.jobs.get(STOPPED, 'usr-demo')).toMatchObject({ status: 'closed', closedReason: 'expired', closedAt: until.toISOString() });
  });
});
