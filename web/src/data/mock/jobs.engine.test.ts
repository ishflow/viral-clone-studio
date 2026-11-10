// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../engine/fake';
import { data } from '../index';
import { getStore, resetStore } from './store';
import { START, generateInput as input, startConfirmed, storedJob } from './test-helpers';

const STOPPED = 'job-demo-stopped'; // 5 credits, stopped with 3 of 5 clips ready
const PAID = { images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 };
const PRODUCTS = [1, 2, 3, 4, 5].map((n) => ({ name: `Serum ${n}`, description: '', images: [`uploads/sample/${n}.jpg`] }));
const missing = (clips: number) => ({ images: 0, clips, clipSeconds: clips * 4, music: 0, voice: 0 });
const refuse = () => {
  throw new Error('engine-down');
};

/** Everything of the site a start or a resume writes: it must be the same after a call the engine refused. */
function written() {
  const store = getStore();
  return structuredClone({ ledger: store.ledger, jobs: store.jobs, keys: [...store.keys], users: store.users });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the engine refuses a start', () => {
  it('nothing is charged and nothing is written: no ledger entry, no job, no key', async () => {
    vi.spyOn(fakeEngine, 'start').mockImplementation(refuse);
    await data.jobs.listFor('usr-demo'); // a read brings every job of the user up to now, as a start or a resume does
    const before = written();
    await expect(startConfirmed('usr-demo', input('tpl-layering'), 'key-1')).rejects.toThrow('engine-down');
    expect(written()).toEqual(before);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('the free video is not used up', async () => {
    vi.spyOn(fakeEngine, 'start').mockImplementation(refuse);
    await data.jobs.listFor('usr-demo'); // a read brings every job of the user up to now, as a start or a resume does
    const before = written();
    await expect(startConfirmed('usr-new', input('tpl-layering'), 'key-1')).rejects.toThrow('engine-down');
    expect(written()).toEqual(before);
    expect((await data.auth.getUser('usr-new'))?.freeVideoAvailable).toBe(true);
  });

  it('the same key works once the engine takes the job', async () => {
    const start = vi.spyOn(fakeEngine, 'start').mockImplementationOnce(refuse);
    await expect(startConfirmed('usr-demo', input('tpl-layering'), 'key-1')).rejects.toThrow('engine-down');
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    expect(job).toMatchObject({ status: 'running', credits: 2 });
    expect(start).toHaveBeenCalledTimes(2);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
  });

  it('a sample the engine refuses leaves no job', async () => {
    vi.spyOn(fakeEngine, 'start').mockImplementation(refuse);
    await data.jobs.listFor('usr-demo'); // a read brings every job of the user up to now, as a start or a resume does
    const before = written();
    await expect(data.admin.generateSample('tpl-eye', 'usr-admin', PAID, PRODUCTS)).rejects.toThrow('engine-down');
    expect(written()).toEqual(before);
  });
});

describe('the engine cannot say how far a job is, right after it took it', () => {
  it('the start is not an error: the job is returned as it was recorded, charged once, and the key returns it again', async () => {
    vi.spyOn(fakeEngine, 'refresh').mockImplementation(refuse);
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    expect(job).toMatchObject({ userId: 'usr-demo', templateId: 'tpl-layering', status: 'running', credits: 2 });
    expect(storedJob(job.id).id).toBe(job.id);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    expect((await startConfirmed('usr-demo', input('tpl-layering'), 'key-1')).id).toBe(job.id);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
  });

  it('a sample is returned as it was recorded too', async () => {
    vi.spyOn(fakeEngine, 'refresh').mockImplementation(refuse);
    const before = getStore().jobs.length;
    const job = await data.admin.generateSample('tpl-eye', 'usr-admin', PAID, PRODUCTS);
    expect(job).toMatchObject({ userId: 'usr-admin', status: 'running', credits: 0 });
    expect(getStore().jobs).toHaveLength(before + 1);
  });
});

describe('the engine refuses a resume', () => {
  it('nothing is charged and the job stays stopped', async () => {
    vi.spyOn(fakeEngine, 'resume').mockImplementation(refuse);
    await data.jobs.listFor('usr-demo'); // a read brings every job of the user up to now, as a start or a resume does
    const before = written();
    await expect(data.jobs.resume(STOPPED, 'usr-demo', 5)).rejects.toThrow('engine-down');
    expect(written()).toEqual(before);
    expect(storedJob(STOPPED)).toMatchObject({ status: 'stopped', credits: 5, returnedCredits: 5 });
  });

  it('a refunded job keeps its refund: it is not paid again', async () => {
    const refund = await data.admin.refundJob(STOPPED);
    vi.spyOn(fakeEngine, 'resume').mockImplementation(refuse);
    await data.jobs.listFor('usr-demo'); // a read brings every job of the user up to now, as a start or a resume does
    const before = written();
    await expect(data.jobs.resume(STOPPED, 'usr-demo', 5)).rejects.toThrow('engine-down');
    expect(written()).toEqual(before);
    expect(storedJob(STOPPED).refundEntryId).toBe(refund.id);
  });

  it('an admin\'s retry the engine refuses changes nothing', async () => {
    vi.spyOn(fakeEngine, 'resume').mockImplementation(refuse);
    await data.admin.jobs({}); // a read brings the running job of the fixtures up to now; the retry reads every job too
    await data.jobs.listFor('usr-demo'); // a read brings every job of the user up to now, as a start or a resume does
    const before = written();
    await expect(data.admin.retryJob(STOPPED)).rejects.toThrow('engine-down');
    expect(written()).toEqual(before);
  });
});

describe('a resume is charged once because the engine leaves the job running', () => {
  it('an engine that does not leave it running is an engine error: nothing is charged, so a second click cannot charge twice', async () => {
    vi.spyOn(fakeEngine, 'resume').mockImplementation(() => undefined);
    await data.jobs.listFor('usr-demo'); // a read brings every job of the user up to now, as a start or a resume does
    const before = written();
    await expect(data.jobs.resume(STOPPED, 'usr-demo', 5)).rejects.toThrow('engine-error');
    await expect(data.jobs.resume(STOPPED, 'usr-demo', 5)).rejects.toThrow('engine-error');
    expect(written()).toEqual(before);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('the same for a retry by the admin', async () => {
    vi.spyOn(fakeEngine, 'resume').mockImplementation(() => undefined);
    await expect(data.admin.retryJob(STOPPED)).rejects.toThrow('engine-error');
  });
});

describe('what is approved for a resume is what was priced', () => {
  it('the engine is asked once what is missing, and that answer is priced and handed back to it', async () => {
    // An engine whose second answer differs: with two questions the price (2 clips) and the approval (4 clips) would not match.
    const asked = vi.spyOn(fakeEngine, 'missing').mockReturnValueOnce(missing(2)).mockReturnValue(missing(4));
    const resume = vi.spyOn(fakeEngine, 'resume');
    const resumed = await data.jobs.resume(STOPPED, 'usr-demo', 5);
    expect(resumed).toMatchObject({ status: 'running', credits: 5 });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(storedJob(STOPPED), missing(2));
  });

  it('a retry by the admin asks once too', async () => {
    const asked = vi.spyOn(fakeEngine, 'missing');
    const resume = vi.spyOn(fakeEngine, 'resume');
    await data.admin.retryJob(STOPPED);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(storedJob(STOPPED), missing(2));
  });
});

describe('a job the engine has not begun', () => {
  const RUNNING = 'job-demo-running';
  const behind = (line: { ahead: number; waitMinutes: number } | null) =>
    vi.spyOn(fakeEngine, 'refresh').mockImplementation((job) => Object.assign(job, { engineQueue: line }));

  it('tells how many videos are in front of it and the minutes to wait, to its owner and to the admin', async () => {
    behind({ ahead: 2, waitMinutes: 14 });
    expect(await data.jobs.get(RUNNING, 'usr-demo')).toMatchObject({ status: 'running', engineQueue: { ahead: 2, waitMinutes: 14 } });
    expect((await data.admin.jobs({})).find((job) => job.id === RUNNING)?.engineQueue).toEqual({ ahead: 2, waitMinutes: 14 });
  });

  it('has no line once the engine works on it, and an engine that cannot tell leaves the line empty', async () => {
    behind(null);
    expect((await data.jobs.get(RUNNING, 'usr-demo'))?.engineQueue).toBeNull();
    vi.restoreAllMocks();
    expect((await data.jobs.get(RUNNING, 'usr-demo'))?.engineQueue).toBeNull();
  });

  it('a job that is not running has no line, whatever the record still holds', async () => {
    behind({ ahead: 1, waitMinutes: 7 });
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.engineQueue).toBeNull();
    expect((await data.jobs.get('job-demo-free', 'usr-demo'))?.engineQueue).toBeNull();
  });
});
