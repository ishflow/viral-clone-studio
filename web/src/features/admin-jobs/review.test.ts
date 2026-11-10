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
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { data } from '@/data';
import { SWAP_TEMPLATE_ID } from '@/data/mock/demo-values';
import { getStore, resetStore } from '@/data/mock/store';
import { START } from '@/data/mock/test-helpers';
import { RULES, type Job, type SwapConsent, type SwapInput } from '@/data/ports';
import { answerSwap } from './review-actions';
import { countSwapQueue, loadSwapQueue, photoHref } from './review-load';

const HOUR = 3_600_000;
const consent: SwapConsent = { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion };
const input = (face: string | null = 'my-face.jpg', side?: string): SwapInput => ({ templateId: SWAP_TEMPLATE_ID, quality: 'fast', people: [{ slot: 1, body: 'me.jpg', face, side }] });
const start = async (userId: string, key: string, face?: string | null, side?: string): Promise<Job> =>
  data.swap.start(userId, input(face, side), key, await data.swap.estimate(userId, input(face, side)), consent);
const read = async (job: Job) => (await data.jobs.get(job.id, job.userId))!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv('VC_FAKE_SWAP', '1');
  resetStore();
  getStore().limits.personSwap = true;
  delete getStore().limits.swapReview;
  sessionId = 'usr-admin';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the line of the look', () => {
  it('names who waits, with which video, since when and how long is left, the one that waits longest first', async () => {
    const first = await start('usr-demo', 'key-1');
    vi.setSystemTime(START.getTime() + 2 * HOUR);
    const second = await start('usr-demo', 'key-2');
    vi.setSystemTime(START.getTime() + 3 * HOUR + 60_000);
    const { rows, lookOn } = await loadSwapQueue();
    expect(lookOn).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
    const owner = (await data.auth.getUser('usr-demo'))!;
    const template = (await data.admin.swapQueue('usr-admin'))[0]!.template!;
    expect(rows[0]).toMatchObject({
      userId: 'usr-demo', email: owner.email, templateTitle: first.templateTitle, since: first.startedAt, credits: first.credits,
      decideBy: new Date(Date.parse(first.startedAt) + RULES.swapReviewHours * HOUR).toISOString(),
      minutesLeft: (RULES.swapReviewHours - 3) * 60 - 1, frame: template.image,
    });
    expect(rows[1]!.minutesLeft).toBe((RULES.swapReviewHours - 1) * 60 - 1);
    expect(await countSwapQueue()).toBe(2);
  });

  it('gives each photograph the job has, by the admin route alone, and in fake mode (no file) only its name', async () => {
    const both = await start('usr-demo', 'key-1');
    const bodyOnly = await start('usr-demo', 'key-2', null);
    const { rows } = await loadSwapQueue();
    expect(rows[0]!.photos).toEqual([
      { slot: 1, kind: 'body', state: 'shown', name: 'me.jpg', src: null },
      { slot: 1, kind: 'face', state: 'shown', name: 'my-face.jpg', src: null },
    ]);
    expect(rows[1]!.photos).toEqual([{ slot: 1, kind: 'body', state: 'shown', name: 'me.jpg', src: null }]);
    expect([both.id, bodyOnly.id]).toEqual(rows.map((row) => row.id));
  });

  it('gives the side photograph too when the job has one, after the other two', async () => {
    await start('usr-demo', 'key-1', 'my-face.jpg', 'my-side.jpg');
    await start('usr-demo', 'key-2', null, 'my-side.jpg');
    const { rows } = await loadSwapQueue();
    expect(rows[0]!.photos).toEqual([
      { slot: 1, kind: 'body', state: 'shown', name: 'me.jpg', src: null },
      { slot: 1, kind: 'face', state: 'shown', name: 'my-face.jpg', src: null },
      { slot: 1, kind: 'side', state: 'shown', name: 'my-side.jpg', src: null },
    ]);
    expect(rows[1]!.photos.map((photo) => photo.kind)).toEqual(['body', 'side']);
    expect(photoHref('job-1', 1, 'side')).toBe('/admin/jobs/review/job-1/1/side');
  });

  it('a photograph with a stored file is addressed by the admin route, and where the file is on the disk is never sent to the page', async () => {
    const job = await start('usr-demo', 'key-1', null);
    vi.spyOn(data.admin, 'swapPhoto').mockResolvedValue({ state: 'shown', name: 'body.jpg', file: { path: '/data/uploads/usr-demo/body.jpg', type: 'image/jpeg', size: 9 } });
    const { rows } = await loadSwapQueue();
    expect(rows[0]!.photos).toEqual([{ slot: 1, kind: 'body', state: 'shown', name: 'body.jpg', src: photoHref(job.id, 1, 'body') }]);
    expect(photoHref('job/1', 1, 'face')).toBe('/admin/jobs/review/job%2F1/1/face');
    expect(JSON.stringify(rows)).not.toContain('/data/uploads');
  });

  it('is empty, and says whether the look is switched on, when nothing waits', async () => {
    expect(await loadSwapQueue()).toEqual({ rows: [], lookOn: true });
    getStore().limits.swapReview = false;
    expect(await loadSwapQueue()).toEqual({ rows: [], lookOn: false });
    expect(await countSwapQueue()).toBe(0);
  });
});

describe('who gets the line and the answer', () => {
  it.each([['usr-demo'], [null]])('a visitor (%s) gets the 403 page from the line, the count and the answer, and the job waits on', async (who) => {
    const job = await start('usr-demo', 'key-1');
    sessionId = who;
    await expect(loadSwapQueue()).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(countSwapQueue()).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(answerSwap({ jobId: job.id, verdict: 'approved' })).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(answerSwap({ jobId: job.id, verdict: 'rejected' })).rejects.toThrow('NEXT_FORBIDDEN');
    expect((await read(job)).swap!.review).toBe('waiting');
  });

  it('the no of the data layer is the 403 page too: it is not an empty line, and not a "try again"', async () => {
    const job = await start('usr-demo', 'key-1');
    vi.spyOn(data.admin, 'swapQueue').mockRejectedValue(new Error('forbidden'));
    vi.spyOn(data.admin, 'reviewSwap').mockRejectedValue(new Error('forbidden'));
    await expect(loadSwapQueue()).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(countSwapQueue()).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(answerSwap({ jobId: job.id, verdict: 'approved' })).rejects.toThrow('NEXT_FORBIDDEN');
  });

  it('the admin named to the data layer is the one of the session, never one the page sent', async () => {
    const job = await start('usr-demo', 'key-1');
    const review = vi.spyOn(data.admin, 'reviewSwap');
    await answerSwap({ jobId: job.id, verdict: 'approved', adminId: 'usr-other' } as never);
    expect(review).toHaveBeenCalledWith('usr-admin', job.id, 'approved');
  });
});

describe('the answer', () => {
  it('yes starts the job once and takes it off the line; the second yes is told it was already answered', async () => {
    const job = await start('usr-demo', 'key-1');
    expect(await answerSwap({ jobId: job.id, verdict: 'approved' })).toMatchObject({ status: 'done' });
    expect((await read(job)).swap!.review).toBe('approved');
    expect((await loadSwapQueue()).rows).toEqual([]);
    expect(await answerSwap({ jobId: job.id, verdict: 'approved' })).toMatchObject({ status: 'already' });
    expect(await answerSwap({ jobId: job.id, verdict: 'rejected' })).toMatchObject({ status: 'already' });
    expect((await read(job)).swap!.review).toBe('approved');
  });

  it('no closes the job with everything returned and takes it off the line; a yes after it changes nothing', async () => {
    const job = await start('usr-demo', 'key-1');
    expect(await answerSwap({ jobId: job.id, verdict: 'rejected' })).toMatchObject({ status: 'done' });
    expect(await read(job)).toMatchObject({ status: 'closed', creditsReturned: job.credits, swap: { review: 'rejected', people: [] } });
    expect((await loadSwapQueue()).rows).toEqual([]);
    expect(await answerSwap({ jobId: job.id, verdict: 'approved' })).toMatchObject({ status: 'already' });
    expect((await read(job)).status).toBe('closed');
  });

  it.each([
    ['an unknown job', { jobId: 'job-nobody', verdict: 'approved' }],
    ['a verdict that is neither', { jobId: 'JOB', verdict: 'maybe' }],
    ['no job', { jobId: '  ', verdict: 'rejected' }],
  ])('%s is a failure that changes nothing', async (_name, sent) => {
    const job = await start('usr-demo', 'key-1');
    const answer = { ...sent, jobId: sent.jobId === 'JOB' ? job.id : sent.jobId };
    expect(await answerSwap(answer as never)).toEqual({ status: 'failed' });
    expect((await read(job)).swap!.review).toBe('waiting');
  });
});

describe('the pages', () => {
  it('the jobs page is given how many jobs wait, and the review page its line', async () => {
    const { AdminJobs, AdminSwapQueue } = await import('./index');
    await start('usr-demo', 'key-1');
    expect((await AdminJobs({ searchParams: Promise.resolve({}) })).props).toMatchObject({ reviewWaiting: 1 });
    expect((await AdminSwapQueue()).props).toMatchObject({ lookOn: true, rows: [{ email: (await data.auth.getUser('usr-demo'))!.email }] });
    sessionId = 'usr-demo';
    await expect(AdminSwapQueue()).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(AdminJobs({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_FORBIDDEN');
  });
});
