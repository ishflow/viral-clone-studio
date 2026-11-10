// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../engine/fake';
import { data } from '../index';
import { getStore, resetStore } from './store';
import { START, generateInput as input, startConfirmed } from './test-helpers';

/** What deleteAccount writes in the site's own records. */
function written() {
  const store = getStore();
  return structuredClone({ users: store.users, jobs: store.jobs, checkouts: store.checkouts, keys: [...store.keys] });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
  getStore().jobs.forEach((job) => { if (job.id === 'job-demo-running') job.pinnedElapsed = 3_600; }); // finished (B23)
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('deleteAccount when the engine fails', () => {
  it('the account is not deleted by half: the user, the jobs, the open checkout and the keys are all still there', async () => {
    await startConfirmed('usr-demo', input('tpl-eye'), 'key-1');
    await data.payments.startCheckout('usr-demo', 'pack-starter', '/gallery');
    vi.advanceTimersByTime(60_000); // the job is done: an account with a running job cannot be deleted (B23)
    await data.jobs.listFor('usr-demo');
    const before = written();
    vi.spyOn(fakeEngine, 'removeTemplate').mockImplementation(() => {
      throw new Error('engine-down');
    });

    await expect(data.auth.deleteAccount('usr-demo')).rejects.toThrow('engine-down');
    expect(written()).toEqual(before);
    expect((await data.auth.getUser('usr-demo'))?.email).toBe('demo@viralclone.app');
    expect(await data.jobs.listFor('usr-demo')).toHaveLength(6);
  });

  it('the same when the engine cannot list the templates', async () => {
    await data.jobs.listFor('usr-demo');
    const before = written();
    vi.spyOn(fakeEngine, 'templates').mockImplementation(() => {
      throw new Error('engine-down');
    });
    await expect(data.auth.deleteAccount('usr-demo')).rejects.toThrow('engine-down');
    expect(written()).toEqual(before);
  });

  it('B23: not while a job of the account is queued or running; nothing is removed', async () => {
    await startConfirmed('usr-demo', input('tpl-eye'), 'key-1');
    const before = written();
    await expect(data.auth.deleteAccount('usr-demo')).rejects.toThrow('job-running');
    expect(written()).toEqual(before);
  });

  it('a second try, when the engine answers again, deletes the account and its private templates', async () => {
    vi.spyOn(fakeEngine, 'removeTemplate').mockImplementationOnce(() => {
      throw new Error('engine-down');
    });
    await expect(data.auth.deleteAccount('usr-demo')).rejects.toThrow('engine-down');
    await data.auth.deleteAccount('usr-demo');
    expect(await data.auth.getUser('usr-demo')).toBeNull();
    expect((await data.admin.templates({ status: 'private' }))).toEqual([]);
    expect(getStore().jobs.some((job) => job.userId === 'usr-demo')).toBe(false);
  });
});
