// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../engine/fake';
import { data } from '../index';
import { getStore, launchLimits, resetStore } from './store';
import { START, generateInput as input, resumeConfirmed, startConfirmed } from './test-helpers';

/** One more verified account that still has its free video. */
function freeUser(id: string): string {
  const base = getStore().users.find((user) => user.id === 'usr-demo');
  if (!base) throw new Error('no usr-demo');
  getStore().users.push({ ...structuredClone(base), id, email: `${id}@example.com`, emailVerified: true, freeVideoAvailable: true });
  return id;
}
/** The job the free video covers: no talking, fast, one variant. */
const startFree = (userId: string, templateId = 'tpl-layering') => startConfirmed(userId, input(templateId), `key-${userId}`);
const hasFreeVideo = async (userId: string) => (await data.auth.getUser(userId))?.freeVideoAvailable;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the free videos the whole site starts in a day (K1)', () => {
  it('a fresh store allows 10: the 11th account is refused', async () => {
    expect(launchLimits().freeVideosPerDay).toBe(10);
    for (let n = 1; n <= 10; n += 1) expect((await startFree(freeUser(`usr-free-${n}`))).freeVideo).toBe(true);
    await expect(startFree(freeUser('usr-free-11'))).rejects.toThrow(/^free-video-cap$/);
  });

  it('a refused start changes nothing: no job, the free video is still there, no ledger entry, the engine is not asked', async () => {
    getStore().limits.freeVideosPerDay = 1;
    await startFree('usr-new');
    const late = freeUser('usr-late');
    const before = structuredClone({ jobs: getStore().jobs, ledger: getStore().ledger, keys: [...getStore().keys], templates: getStore().templates });
    const start = vi.spyOn(fakeEngine, 'start');
    await expect(startFree(late)).rejects.toThrow(/^free-video-cap$/);
    expect(start).not.toHaveBeenCalled();
    expect(await hasFreeVideo(late)).toBe(true);
    expect(structuredClone({ jobs: getStore().jobs, ledger: getStore().ledger, keys: [...getStore().keys], templates: getStore().templates })).toEqual(before);
    expect(await data.jobs.listFor(late)).toEqual([]);
  });

  it('a paid job starts as before while the free videos of the day are used up', async () => {
    getStore().limits.freeVideosPerDay = 0;
    expect(await startConfirmed('usr-demo', input('tpl-layering'), 'paid')).toMatchObject({ credits: 2, freeVideo: false });
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    // An account that still has its free video pays for a job the free video does not cover.
    const owner = getStore().users.find((user) => user.id === 'usr-demo');
    if (owner) owner.freeVideoAvailable = true;
    expect(await startConfirmed('usr-demo', input('tpl-layering', { quality: 'best' }), 'best')).toMatchObject({ credits: 5, freeVideo: false });
    expect(await data.ledger.balance('usr-demo')).toBe(12);
    expect(await hasFreeVideo('usr-demo')).toBe(true);
  });

  it('B1: an account with credits and its free video is shown the price and pays while the free videos of the day are used up; its free video stays', async () => {
    getStore().limits.freeVideosPerDay = 0;
    const owner = getStore().users.find((user) => user.id === 'usr-demo');
    if (owner) owner.freeVideoAvailable = true;
    const freeEntries = getStore().ledger.filter((entry) => entry.type === 'free-video').length;
    expect(await data.jobs.estimate('usr-demo', input('tpl-layering'))).toMatchObject({ credits: 2, coveredByFreeVideo: false, balance: 19, enough: true });
    expect(await startConfirmed('usr-demo', input('tpl-layering'), 'default')).toMatchObject({ credits: 2, freeVideo: false, status: 'running' });
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    expect(await hasFreeVideo('usr-demo')).toBe(true);
    expect(getStore().ledger.filter((entry) => entry.type === 'free-video')).toHaveLength(freeEntries);
    // The free video is there again when the day has a place: the same form costs nothing.
    getStore().limits.freeVideosPerDay = 1;
    expect(await data.jobs.estimate('usr-demo', input('tpl-layering'))).toMatchObject({ credits: 0, coveredByFreeVideo: true });
  });

  it('B1: an account without credits is shown the price it cannot pay while the free videos of the day are used up, and its start is refused', async () => {
    getStore().limits.freeVideosPerDay = 0;
    const late = freeUser('usr-late');
    expect(await data.jobs.estimate(late, input('tpl-layering'))).toMatchObject({ credits: 2, coveredByFreeVideo: false, balance: 0, enough: false });
    const before = structuredClone({ jobs: getStore().jobs, ledger: getStore().ledger, keys: [...getStore().keys] });
    // Whatever the form confirmed (the price of now, or a free video it was shown before the day filled up): the same answer.
    await expect(startFree(late)).rejects.toThrow(/^free-video-cap$/);
    await expect(data.jobs.start(late, input('tpl-layering'), 'stale', { credits: 0, coveredByFreeVideo: true })).rejects.toThrow(/^free-video-cap$/);
    expect(structuredClone({ jobs: getStore().jobs, ledger: getStore().ledger, keys: [...getStore().keys] })).toEqual(before);
    expect(await hasFreeVideo(late)).toBe(true);
  });

  it('the day is the UTC day, as for the provider budget: used up at 23:59:59Z, open again at 00:00:00Z', async () => {
    getStore().limits.freeVideosPerDay = 1;
    vi.setSystemTime(new Date('2026-10-04T23:59:58Z'));
    await startFree('usr-new');
    vi.setSystemTime(new Date('2026-10-04T23:59:59Z'));
    await expect(startFree(freeUser('usr-a'))).rejects.toThrow(/^free-video-cap$/);
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    expect((await startFree('usr-a')).freeVideo).toBe(true);
    await expect(startFree(freeUser('usr-b'))).rejects.toThrow(/^free-video-cap$/);
  });

  it('two starts at the same moment take the one place that is left, not two', async () => {
    getStore().limits.freeVideosPerDay = 1;
    const answers = await Promise.allSettled([startFree('usr-new'), startFree(freeUser('usr-twin'))]);
    expect(answers.map((answer) => answer.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(getStore().ledger.filter((entry) => entry.type === 'free-video' && entry.at.startsWith('2026-10-04'))).toHaveLength(1);
  });

  it('a free job that stopped and goes on with its free video is one free video of the day, not two', async () => {
    getStore().limits.freeVideosPerDay = 2;
    const job = await startFree('usr-new', 'tpl-stop');
    vi.advanceTimersByTime(60_000);
    expect((await data.jobs.get(job.id, 'usr-new'))?.status).toBe('stopped');
    expect((await resumeConfirmed(job.id, 'usr-new')).status).toBe('running');
    expect(getStore().ledger.filter((entry) => entry.type === 'free-video' && entry.relatedJobId === job.id)).toHaveLength(2);
    expect((await startFree(freeUser('usr-second'))).freeVideo).toBe(true);
    await expect(startFree(freeUser('usr-third'))).rejects.toThrow(/^free-video-cap$/);
  });

  it('the admin sets the number: a whole number from 0 on, applied at once; anything else is refused and nothing is saved', async () => {
    for (const bad of [-1, 2.5, Number.NaN, '3' as unknown as number]) {
      await expect(data.admin.saveLimits('usr-admin', { freeVideosPerDay: bad })).rejects.toThrow('invalid-limit');
    }
    expect((await data.admin.limits()).freeVideosPerDay).toBe(10);
    expect(await data.admin.saveLimits('usr-admin', { freeVideosPerDay: 1 })).toMatchObject({ freeVideosPerDay: 1 });
    await startFree('usr-new');
    await expect(startFree(freeUser('usr-late'))).rejects.toThrow(/^free-video-cap$/);
  });

  it('deleting the account that used a free video does not give its place back', async () => {
    getStore().limits.freeVideosPerDay = 1;
    await startFree('usr-new');
    vi.advanceTimersByTime(60_000); // the job is done: an account with a running job cannot be deleted
    await data.jobs.listFor('usr-new');
    await data.auth.deleteAccount('usr-new');
    await expect(startFree(freeUser('usr-next'))).rejects.toThrow(/^free-video-cap$/);
  });
});
