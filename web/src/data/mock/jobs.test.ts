// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { EstimateChangedError, InsufficientCreditsError, NotFoundError } from '../ports';
import type { Job } from '../ports';
import { getStore, resetStore } from './store';
import { START, generateInput as input, startConfirmed } from './test-helpers';

const LINK = 'https://www.tiktok.com/@someone/video/1';
const statuses = (job: Job | null) => Object.fromEntries((job?.steps ?? []).map((step) => [step.key, step.status]));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('estimate', () => {
  it('returns credits = cost × variants and enough: false when balance is lower', async () => {
    const tooMuch = await data.jobs.estimate('usr-demo', input('tpl-story', { quality: 'best', variants: 3 }));
    expect(tooMuch).toMatchObject({ credits: 24, balance: 19, enough: false, coveredByFreeVideo: false });
    const fine = await data.jobs.estimate('usr-demo', input('tpl-layering', { quality: 'best', variants: 2 }));
    expect(fine).toMatchObject({ credits: 10, balance: 19, enough: true });
    // B9: talking is 4 / 8 credits per variant
    expect(await data.jobs.estimate('usr-demo', input('tpl-story', { quality: 'best' }))).toMatchObject({ credits: 8, enough: true });
    expect(await data.jobs.estimate('usr-demo', input('tpl-story'))).toMatchObject({ credits: 4 });
  });

  it('counts images, clips and music from the shot list and the variants', async () => {
    const one = await data.jobs.estimate('usr-demo', input('tpl-layering'));
    expect(one).toMatchObject({ images: 5, clips: 5, clipSeconds: 20, musicTracks: 1, minutes: 7, credits: 2 });
    const three = await data.jobs.estimate('usr-demo', input('tpl-layering', { variants: 3 }));
    expect(three).toMatchObject({ images: 15, clips: 15, clipSeconds: 60, musicTracks: 1, minutes: 21, credits: 6 });
  });

  it('coveredByFreeVideo is true for a verified user with a free video, no-talking, fast, 1 variant, and then credits is 0', async () => {
    const estimate = await data.jobs.estimate('usr-new', input('tpl-layering'));
    expect(estimate).toMatchObject({ coveredByFreeVideo: true, credits: 0, balance: 0, enough: true });
  });

  it.each([
    ['best quality', 'usr-new', input('tpl-layering', { quality: 'best' })],
    ['2 variants', 'usr-new', input('tpl-layering', { variants: 2 })],
    ['a talking template', 'usr-new', input('tpl-story')],
    ['a user who used the free video', 'usr-demo', input('tpl-layering')],
  ])('coveredByFreeVideo is false for %s', async (_case, userId, generateInput) => {
    const estimate = await data.jobs.estimate(userId, generateInput);
    expect(estimate.coveredByFreeVideo).toBe(false);
    expect(estimate.credits).toBeGreaterThan(0);
  });

  it('coveredByFreeVideo is false while the email is not verified', async () => {
    const user = getStore().users.find((item) => item.id === 'usr-new');
    if (user) user.emailVerified = false;
    const estimate = await data.jobs.estimate('usr-new', input('tpl-layering'));
    expect(estimate).toMatchObject({ coveredByFreeVideo: false, credits: 2, enough: false });
  });

  it('writes nothing', async () => {
    const before = getStore().ledger.length;
    await data.jobs.estimate('usr-demo', input('tpl-layering'));
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.jobs.listFor('usr-demo')).toHaveLength(5);
  });

  it('throws NotFoundError for a template the user cannot see or an unknown user', async () => {
    await data.admin.updateTemplate('tpl-eye', { status: 'hidden' });
    await expect(data.jobs.estimate('usr-demo', input('tpl-eye'))).rejects.toThrow(NotFoundError);
    await expect(data.jobs.estimate('usr-demo', input('tpl-missing'))).rejects.toThrow(NotFoundError);
    await expect(data.jobs.estimate('usr-paying', input('tpl-own-ready'))).rejects.toThrow(NotFoundError);
    await expect(data.jobs.estimate('nobody', input('tpl-layering'))).rejects.toThrow(NotFoundError);
  });

  it('refuses a template of the user that is still being prepared or did not fit', async () => {
    const ledgerBefore = getStore().ledger.length;
    const added = await data.catalog.addFromLink('usr-demo', LINK);
    await expect(data.jobs.estimate('usr-demo', input(added.id))).rejects.toThrow('template-not-ready');
    await expect(data.jobs.estimate('usr-demo', input('tpl-own-failed'))).rejects.toThrow('template-not-ready');
    await expect(startConfirmed('usr-demo', input('tpl-own-failed'), 'key-1')).rejects.toThrow('template-not-ready');
    expect(getStore().ledger).toHaveLength(ledgerBefore);

    expect(await data.jobs.estimate('usr-demo', input('tpl-own-ready'))).toMatchObject({ credits: 2, images: 5 });
    vi.advanceTimersByTime(20_000);
    expect(await data.jobs.estimate('usr-demo', input(added.id))).toMatchObject({ credits: 2, images: 5 });
  });
});

describe('start', () => {
  it('writes one negative generation ledger entry and returns a running job', async () => {
    const before = await data.ledger.entries('usr-demo');
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    const after = await data.ledger.entries('usr-demo');
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({ type: 'generation', change: -2, note: 'Fragrance layering recipe', balanceAfter: 17, by: { kind: 'customer' }, relatedJobId: job.id });
    expect(job).toMatchObject({
      userId: 'usr-demo', templateId: 'tpl-layering', templateTitle: 'Fragrance layering recipe', credits: 2,
      status: 'running', stoppedReason: null, startedAt: START.toISOString(), finishedAt: null,
    });
    expect(job.variants.map((variant) => variant.status)).toEqual(['generating']);
    expect(statuses(job)).toEqual({ adaptation: 'running', images: 'waiting', clips: 'waiting', music: 'waiting', edit: 'waiting', render: 'waiting' });
    expect(await data.ledger.balance('usr-demo')).toBe(17);
  });

  it('with the same idempotencyKey twice returns the same job and writes one entry', async () => {
    const before = getStore().ledger.length;
    const first = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    vi.advanceTimersByTime(3_000);
    const second = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    expect(second.id).toBe(first.id);
    expect(getStore().ledger).toHaveLength(before + 1);
    expect(await data.jobs.listFor('usr-demo')).toHaveLength(6);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
  });

  it('with the same idempotencyKey at the same moment (double click) creates one job', async () => {
    const before = getStore().ledger.length;
    const [first, second] = await Promise.all([
      startConfirmed('usr-demo', input('tpl-layering'), 'key-1'),
      startConfirmed('usr-demo', input('tpl-layering'), 'key-1'),
    ]);
    expect(second.id).toBe(first.id);
    expect(getStore().ledger).toHaveLength(before + 1);
  });

  it('keeps idempotency keys apart per user', async () => {
    const mine = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    const theirs = await startConfirmed('usr-paying', input('tpl-layering'), 'key-1');
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.userId).toBe('usr-paying');
  });

  it.each(['', '   '])('refuses a blank idempotency key (%j) and writes nothing', async (key) => {
    const before = getStore().ledger.length;
    await expect(startConfirmed('usr-demo', input('tpl-layering'), key)).rejects.toThrow('idempotency-key-required');
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.jobs.listFor('usr-demo')).toHaveLength(5);
  });

  it('with a low balance throws InsufficientCreditsError and writes nothing', async () => {
    const ledgerBefore = getStore().ledger.length;
    const generatedBefore = getStore().templates.find((template) => template.id === 'tpl-layering')?.timesGenerated;
    const attempt = startConfirmed('usr-demo', input('tpl-story', { quality: 'best', variants: 3 }), 'key-1');
    await expect(attempt).rejects.toThrow(InsufficientCreditsError);
    await expect(attempt).rejects.toMatchObject({ needed: 24, balance: 19 });
    expect(getStore().ledger).toHaveLength(ledgerBefore);
    expect(await data.jobs.listFor('usr-demo')).toHaveLength(5);
    expect(getStore().templates.find((template) => template.id === 'tpl-layering')?.timesGenerated).toBe(generatedBefore);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('a key that failed for a low balance works once the balance is enough', async () => {
    const generateInput = input('tpl-story', { quality: 'best', variants: 3 });
    await expect(startConfirmed('usr-demo', generateInput, 'key-1')).rejects.toThrow(InsufficientCreditsError);
    await data.admin.addCredits('usr-admin', 'usr-demo', 10, 'Test top-up', 'top-up-1');
    const job = await startConfirmed('usr-demo', generateInput, 'key-1');
    expect(job.credits).toBe(24);
    expect(await data.ledger.balance('usr-demo')).toBe(5);
  });

  it('uses the free video: a free-video entry of 0 credits, and the free video is gone', async () => {
    const job = await startConfirmed('usr-new', input('tpl-layering'), 'key-1');
    expect(job).toMatchObject({ credits: 0, status: 'running' });
    expect(await data.ledger.entries('usr-new')).toMatchObject([{ type: 'free-video', change: 0, note: 'Fragrance layering recipe', balanceAfter: 0 }]);
    expect((await data.auth.getUser('usr-new'))?.freeVideoAvailable).toBe(false);
    await expect(startConfirmed('usr-new', input('tpl-layering'), 'key-2')).rejects.toThrow(InsufficientCreditsError);
    expect(await data.jobs.listFor('usr-new')).toHaveLength(1);
  });

  it('refuses a variant count outside 1–3 and writes nothing', async () => {
    const before = getStore().ledger.length;
    for (const variants of [0, -1, 4, 1.5]) {
      const bad = input('tpl-layering', { variants: variants as 1 });
      await expect(startConfirmed('usr-demo', bad, `key-${variants}`)).rejects.toThrow(RangeError);
    }
    expect(getStore().ledger).toHaveLength(before);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('counts the job on the template', async () => {
    const before = (await data.admin.template('tpl-layering'))?.timesGenerated ?? 0;
    await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    expect((await data.admin.template('tpl-layering'))?.timesGenerated).toBe(before + 1);
  });
});

describe('start with the amount the customer confirmed', () => {
  it('the port takes no start and no resume without the confirmed amount (a type check: `pnpm typecheck` fails otherwise)', () => {
    // @ts-expect-error start needs what the confirmation showed
    void (() => data.jobs.start('usr-demo', input('tpl-layering'), 'key-1'));
    // @ts-expect-error resume needs the cost the confirmation showed
    void (() => data.jobs.resume('job-demo-stopped', 'usr-demo'));
  });

  it('charges when the charge of now is the confirmed one', async () => {
    const job = await data.jobs.start('usr-demo', input('tpl-layering'), 'key-1', { credits: 2, coveredByFreeVideo: false });
    expect(job.credits).toBe(2);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
  });

  it('the free video was used in another tab: the dialog said 0, the charge would be 2 → EstimateChangedError, nothing written', async () => {
    await data.admin.addCredits('usr-admin', 'usr-new', 5, 'test', 'k');
    const confirmed = await data.jobs.estimate('usr-new', input('tpl-layering'));
    expect(confirmed).toMatchObject({ credits: 0, coveredByFreeVideo: true });
    await startConfirmed('usr-new', input('tpl-eye'), 'other-tab');
    const ledger = getStore().ledger.length;

    const refused = data.jobs.start('usr-new', input('tpl-layering'), 'key-1', confirmed);
    await expect(refused).rejects.toThrow(EstimateChangedError);
    await expect(refused).rejects.toMatchObject({ estimate: { credits: 2, coveredByFreeVideo: false, balance: 5, enough: true } });
    expect(getStore().ledger).toHaveLength(ledger);
    expect(await data.ledger.balance('usr-new')).toBe(5);
    expect(await data.jobs.listFor('usr-new')).toHaveLength(1);
  });

  it('a price that changed is refused the same way, also when the balance would not cover it', async () => {
    const refused = data.jobs.start('usr-demo', input('tpl-story', { quality: 'best', variants: 3 }), 'key-1', { credits: 2, coveredByFreeVideo: false });
    await expect(refused).rejects.toThrow(EstimateChangedError);
    await expect(refused).rejects.toMatchObject({ estimate: { credits: 24, enough: false } });
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('the same key twice still returns the first job, although the estimate of now differs (the first call used the free video)', async () => {
    const confirmed = { credits: 0, coveredByFreeVideo: true };
    const first = await data.jobs.start('usr-new', input('tpl-layering'), 'key-1', confirmed);
    const second = await data.jobs.start('usr-new', input('tpl-layering'), 'key-1', confirmed);
    expect(second.id).toBe(first.id);
    expect(await data.jobs.listFor('usr-new')).toHaveLength(1);
  });
});

describe('reading jobs', () => {
  it('get with another user\'s id returns null', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    expect(await data.jobs.get(job.id, 'usr-paying')).toBeNull();
    expect(await data.jobs.get(job.id, 'usr-admin')).toBeNull();
    expect(await data.jobs.get(job.id, 'nobody')).toBeNull();
    expect(await data.jobs.get('job-missing', 'usr-demo')).toBeNull();
    expect((await data.jobs.get(job.id, 'usr-demo'))?.id).toBe(job.id);
  });

  it('listFor returns only that user\'s jobs, newest first', async () => {
    const jobs = await data.jobs.listFor('usr-demo');
    expect(jobs.every((job) => job.userId === 'usr-demo')).toBe(true);
    expect(jobs.map((job) => job.status)).toEqual(['running', 'stopped', 'done', 'done', 'done']);
    const times = jobs.map((job) => job.startedAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(await data.jobs.listFor('usr-new')).toEqual([]);
  });

  it('the stopped job of the fixtures carries the reason as a code', async () => {
    const job = await data.jobs.get('job-demo-stopped', 'usr-demo');
    expect(job).toMatchObject({ status: 'stopped', templateId: 'tpl-stop', stoppedReason: 'clips-failed' });
    expect(job?.steps.find((step) => step.key === 'clips')).toEqual({ key: 'clips', status: 'stopped', done: 3, total: 5 });
  });

  it('hands out copies without the internal fields', async () => {
    const job = await data.jobs.get('job-demo-running', 'usr-demo');
    expect(Object.keys(job ?? {}).sort()).toEqual([
      'closedAt', 'closedReason', 'continueUntil', 'credits', 'creditsReturned', 'delayed', 'deletedAt', 'engineQueue', 'finishedAt', 'freeVideo', 'id',
      'imagesExpireAt', 'imagesStored', 'input', 'made', 'paused', 'queuePosition', 'shots', 'startedAt', 'status', 'steps', 'stoppedAt', 'stoppedDetail', 'stoppedReason',
      'templateId', 'templateTitle', 'userId', 'variants', 'videoExpiresAt', 'videoStored',
    ]);
    if (job) job.status = 'done';
    expect((await data.jobs.get('job-demo-running', 'usr-demo'))?.status).toBe('running');
  });

  it('a frame of a shot is shown while the job\'s pictures are kept; once the job is closed it is not (its file is refused), so no address is handed out', async () => {
    const record = getStore().jobs.find((job) => job.id === 'job-demo-running')!;
    Object.assign(record, { status: 'done', finishedAt: START.toISOString(), shots: [{ variant: 1, n: 1, image: '/media/jobs/r/paid/v1/image-s1.png', clip: false }] });
    expect((await data.jobs.get('job-demo-running', 'usr-demo'))?.shots?.[0]?.image).toBe('/media/jobs/r/paid/v1/image-s1.png');
    Object.assign(record, { status: 'closed', closedAt: START.toISOString(), closedReason: 'customer' });
    expect((await data.jobs.get('job-demo-running', 'usr-demo'))?.shots).toEqual([{ variant: 1, n: 1, image: null, clip: false }]);
  });
});
