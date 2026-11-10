// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine, progress } from '../engine/fake';
import { data } from '../index';
import { InsufficientCreditsError, NotFoundError, PriceChangedError } from '../ports';
import { getStore, resetStore } from './store';
import { START, generateInput as input, storedJob, startConfirmed, resumeConfirmed } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('resumeCost', () => {
  it('is the credits that came back when the job stopped (K6), whatever is missing', async () => {
    const before = getStore().ledger.length;
    expect(await data.jobs.resumeCost('job-demo-stopped', 'usr-demo')).toBe(5);
    expect(getStore().ledger).toHaveLength(before);
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('stopped');
  });

  it('is 0 for a job that is not stopped: resume would charge nothing', async () => {
    expect(await data.jobs.resumeCost('job-demo-running', 'usr-demo')).toBe(0);
    expect(await data.jobs.resumeCost('job-demo-story', 'usr-demo')).toBe(0);
  });

  it('is for the owner only: NotFoundError for another customer, an admin or an unknown job', async () => {
    await expect(data.jobs.resumeCost('job-demo-stopped', 'usr-paying')).rejects.toThrow(NotFoundError);
    await expect(data.jobs.resumeCost('job-demo-stopped', 'usr-admin')).rejects.toThrow(NotFoundError);
    await expect(data.jobs.resumeCost('job-missing', 'usr-demo')).rejects.toThrow(NotFoundError);
  });
});

describe('resume', () => {
  it('resume charges the returned credits again and the job then finishes', async () => {
    const started = await startConfirmed('usr-demo', input('tpl-stop', { quality: 'best' }), 'key-1');
    expect(await data.ledger.balance('usr-demo')).toBe(14);
    vi.advanceTimersByTime(60_000);
    expect((await data.jobs.get(started.id, 'usr-demo'))?.status).toBe('stopped');
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(await data.jobs.resumeCost(started.id, 'usr-demo')).toBe(5);

    const resumed = await resumeConfirmed(started.id, 'usr-demo');
    expect(resumed).toMatchObject({ status: 'running', stoppedReason: null, credits: 5 });
    expect(resumed.steps.find((step) => step.key === 'clips')).toEqual({ key: 'clips', status: 'running', done: 3, total: 5 });
    expect((await data.ledger.entries('usr-demo'))[0]).toMatchObject({ type: 'generation', change: -5, note: 'Dupe comparison', balanceAfter: 14 });

    vi.advanceTimersByTime(15_000);
    expect((await data.jobs.get(started.id, 'usr-demo'))?.status).toBe('running');
    vi.advanceTimersByTime(1_000);
    const done = await data.jobs.get(started.id, 'usr-demo');
    expect(done).toMatchObject({ status: 'done', finishedAt: '2026-10-04T12:01:15.600Z' });
    expect(done?.variants).toHaveLength(1);
    expect(await data.ledger.balance('usr-demo')).toBe(14);
  });

  it('a resumed job goes on from the stopped step and does not stop again', async () => {
    await resumeConfirmed('job-demo-stopped', 'usr-demo');
    const at = (milliseconds: number) => progress(storedJob('job-demo-stopped'), new Date(START.getTime() + milliseconds)).map((step) => step.status);
    expect(at(0)).toEqual(['done', 'done', 'running', 'done', 'waiting', 'waiting']);
    expect(at(5_600)).toEqual(['done', 'done', 'done', 'done', 'running', 'waiting']);
    expect(at(15_599)).toEqual(['done', 'done', 'done', 'done', 'done', 'running']);
    expect(at(15_600)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
  });

  it('resume twice charges once', async () => {
    const before = getStore().ledger.length;
    await resumeConfirmed('job-demo-stopped', 'usr-demo');
    await resumeConfirmed('job-demo-stopped', 'usr-demo');
    expect(getStore().ledger).toHaveLength(before + 1);
    expect(await data.ledger.balance('usr-demo')).toBe(14);
  });

  it('resume of a job that is not stopped changes nothing', async () => {
    const before = getStore().ledger.length;
    const job = await resumeConfirmed('job-demo-running', 'usr-demo');
    expect(job.status).toBe('running');
    expect(getStore().ledger).toHaveLength(before);
  });

  it('resume with a balance below the cost throws and leaves the job stopped', async () => {
    await startConfirmed('usr-demo', input('tpl-story', { quality: 'best', variants: 2 }), 'spend-all');
    expect(await data.ledger.balance('usr-demo')).toBe(3);
    const before = getStore().ledger.length;
    await expect(resumeConfirmed('job-demo-stopped', 'usr-demo')).rejects.toThrow(InsufficientCreditsError);
    expect(getStore().ledger).toHaveLength(before);
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('stopped');
  });

  it('resume by another customer throws NotFoundError and charges nobody', async () => {
    const before = getStore().ledger.length;
    await expect(resumeConfirmed('job-demo-stopped', 'usr-paying')).rejects.toThrow(NotFoundError);
    await expect(resumeConfirmed('job-missing', 'usr-demo')).rejects.toThrow(NotFoundError);
    expect(getStore().ledger).toHaveLength(before);
  });
});

describe('resume with the cost the customer confirmed', () => {
  it('charges when the cost of now is the confirmed one', async () => {
    const resumed = await data.jobs.resume('job-demo-stopped', 'usr-demo', 5);
    expect(resumed.status).toBe('running');
    expect(await data.ledger.balance('usr-demo')).toBe(14);
  });

  it('a cost that is not the one of now: PriceChangedError with the cost of now, nothing written, still stopped', async () => {
    const before = getStore().ledger.length;
    const refused = data.jobs.resume('job-demo-stopped', 'usr-demo', 2);
    await expect(refused).rejects.toThrow(PriceChangedError);
    await expect(refused).rejects.toMatchObject({ cost: 5 });
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('stopped');
  });

  it('a job that is not stopped any more is returned as it is, whatever was confirmed: a double click charges once', async () => {
    await data.jobs.resume('job-demo-stopped', 'usr-demo', 5);
    const again = await data.jobs.resume('job-demo-stopped', 'usr-demo', 5);
    expect(again.status).toBe('running');
    expect(await data.ledger.balance('usr-demo')).toBe(14);
  });
});

describe('a job stopped on a request the provider gave no clear answer to (submission-unknown)', () => {
  const ID = 'job-demo-stopped';
  /** The demo's stopped job, as the real engine leaves one whose request may or may not exist at the provider. */
  const stuck = () => Object.assign(storedJob(ID), { stoppedReason: 'submission-unknown' as const });

  it('a job stopped with submission-unknown is not resumable: the quote says so, a resume throws not-resumable, nothing is charged, the engine is not asked', async () => {
    stuck();
    const asked = vi.spyOn(fakeEngine, 'resume');
    const before = getStore().ledger.length;
    expect(await data.jobs.resumeQuote(ID, 'usr-demo')).toMatchObject({ resumable: false, cost: 0, returned: 5, balance: 19 });
    expect(await data.jobs.resumeCost(ID, 'usr-demo')).toBe(0);
    await expect(data.jobs.resume(ID, 'usr-demo', 5)).rejects.toThrow('not-resumable');   // the price the page showed before
    await expect(data.jobs.resume(ID, 'usr-demo', 0)).rejects.toThrow('not-resumable');   // the price of now
    expect(asked).not.toHaveBeenCalled();
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(await data.jobs.get(ID, 'usr-demo')).toMatchObject({ status: 'stopped', stoppedReason: 'submission-unknown', creditsReturned: 5 });
  });

  it('a retry by the admin is not refused: it is free, the engine is asked once (it sends no unknown request again), and the admin action is kept', async () => {
    stuck();
    const asked = vi.spyOn(fakeEngine, 'resume');
    const actions = getStore().adminActions.length;
    const entries = getStore().ledger.length;
    expect(await data.admin.retryStoppedJob('usr-admin', ID, 'The provider has the task')).toMatchObject({ outcome: 'done', value: { status: 'running', stoppedReason: null } });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(getStore().adminActions).toHaveLength(actions + 1);
    expect(getStore().ledger).toHaveLength(entries);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('after the admin settled it (engine-error) it resumes as before', async () => {
    stuck();
    // The fake engine has no unknown requests: it gets the method of the real one, which leaves the job as an ordinary stop.
    const engine = fakeEngine as { settleUnknown?: (job: { stoppedReason: string | null }, by: string) => void };
    engine.settleUnknown = (job) => { job.stoppedReason = 'engine-error'; };
    try {
      expect(await data.admin.settleUnknownRequest?.('usr-admin', ID, 'No task in the provider list')).toMatchObject({ outcome: 'done' });
    } finally {
      delete engine.settleUnknown;
    }
    expect(await data.jobs.resumeQuote(ID, 'usr-demo')).toMatchObject({ resumable: true, cost: 5 });
    const before = getStore().ledger.length;
    expect(await resumeConfirmed(ID, 'usr-demo')).toMatchObject({ status: 'running', stoppedReason: null });
    expect(getStore().ledger).toHaveLength(before + 1);
    expect(await data.ledger.balance('usr-demo')).toBe(14);
  });

  /** A delivered job of two variants whose second one stopped for `reason`. */
  const withStoppedVariant = async (reason: 'submission-unknown' | 'content-rule') => {
    const job = await startConfirmed('usr-demo', input('tpl-stop', { variants: 2 }), 'two');
    vi.advanceTimersByTime(60_000);
    expect((await data.jobs.get(job.id, 'usr-demo'))?.variants.map((variant) => variant.status)).toEqual(['done', 'stopped']);
    storedJob(job.id).variants[1]!.reason = reason;
    return { id: job.id, variantId: `${job.id}-v2` };
  };

  it('a variant that stopped with submission-unknown is generated again like any other stopped variant (a new run, a new request): its price, charged once, the engine asked once', async () => {
    const { id, variantId } = await withStoppedVariant('submission-unknown');
    const asked = vi.spyOn(fakeEngine, 'regenerateVariant');
    const before = getStore().ledger.length;
    expect(await data.jobs.variantCost(id, 'usr-demo', variantId)).toBe(2);
    const again = await data.jobs.regenerateVariant(id, 'usr-demo', variantId, 2);
    expect(again.variants.map((variant) => variant.status)).toEqual(['done', 'generating']);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(getStore().ledger).toHaveLength(before + 1);
    expect(await data.ledger.balance('usr-demo')).toBe(15);
  });

  it('a variant that stopped with content-rule is still not generated again: no price, a try throws not-resumable, nothing is charged, the engine is not asked', async () => {
    const { id, variantId } = await withStoppedVariant('content-rule');
    const asked = vi.spyOn(fakeEngine, 'regenerateVariant');
    const before = getStore().ledger.length;
    await expect(data.jobs.variantCost(id, 'usr-demo', variantId)).rejects.toThrow('not-resumable');
    await expect(data.jobs.regenerateVariant(id, 'usr-demo', variantId, 2)).rejects.toThrow('not-resumable');
    expect(asked).not.toHaveBeenCalled();
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
  });

  it('the email of such a stop carries the reason (it says what the job page says) and no price of its own: what the quote says, 0', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'unclear');
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    // The real engine stops a job this way (the fake never does); the customer's other jobs stay as they are.
    vi.spyOn(fakeEngine, 'refresh').mockImplementation((record) => (record.id === job.id ? Object.assign(record, { status: 'stopped', stoppedReason: 'submission-unknown' }) : record));
    expect(await data.jobs.get(job.id, 'usr-demo')).toMatchObject({ status: 'stopped', stoppedReason: 'submission-unknown', creditsReturned: 2 });
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    expect(await data.jobs.resumeQuote(job.id, 'usr-demo')).toMatchObject({ resumable: false, cost: 0 });
    expect(getStore().outbox.at(-1)).toMatchObject({ kind: 'stopped', data: { jobId: job.id, reason: 'submission-unknown', returned: '2', resumeCost: '0' } });
  });
});

describe('the credits of a stopped job were already returned when it stopped (B1)', () => {
  it('refundJob of a stopped job answers with the entry of the stop, and writes nothing', async () => {
    const before = getStore().ledger.length;
    const entry = await data.admin.refundJob('job-demo-stopped');
    expect(entry).toMatchObject({ type: 'returned', change: 5, relatedJobId: 'job-demo-stopped', by: { kind: 'system' } });
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('throws when the balance does not cover the cost, and writes nothing', async () => {
    await startConfirmed('usr-demo', input('tpl-layering', { quality: 'best', variants: 3 }), 'spend');
    expect(await data.ledger.balance('usr-demo')).toBe(4);
    const before = getStore().ledger.length;
    await expect(resumeConfirmed('job-demo-stopped', 'usr-demo')).rejects.toMatchObject({ needed: 5, balance: 4 });
    expect(getStore().ledger).toHaveLength(before);
  });

  it('a job that was paid again can be given back again, once', async () => {
    const first = await data.admin.refundJob('job-demo-stopped');
    await resumeConfirmed('job-demo-stopped', 'usr-demo');
    const second = await data.admin.refundJob('job-demo-stopped');
    const third = await data.admin.refundJob('job-demo-stopped');
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ type: 'returned', change: 5, balanceAfter: 19 });
    expect(third).toEqual(second);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('a retry by the admin stays free', async () => {
    await data.admin.refundJob('job-demo-stopped');
    const before = getStore().ledger.length;
    expect((await data.admin.retryJob('job-demo-stopped')).status).toBe('running');
    expect(getStore().ledger).toHaveLength(before);
  });
});
