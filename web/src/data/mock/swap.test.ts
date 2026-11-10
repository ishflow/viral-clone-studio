// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../engine/fake';
import { data } from '../index';
import { EstimateChangedError, InsufficientCreditsError, NotFoundError, RULES, swapCredits } from '../ports';
import type { Job, SwapConsent, SwapInput } from '../ports';
import { SWAP_TEMPLATE_ID } from './demo-values';
import { getStore, resetStore } from './store';
import { START, generateInput, startConfirmed, storedJob } from './test-helpers';

// Person swap on the site's own records, next to the fake engine: the price, the one charge, the consent, the refund of a stop,
// the admin's look, the two switches, and what is kept of the photographs and of the video.

/** The answer of an admin to the look, as the job reads after it: the admin's port is the only way an answer is given. */
const reviewSwap = async (jobId: string, verdict: 'approved' | 'rejected') => (await data.admin.reviewSwap('usr-admin', jobId, verdict)).value;
const DAY = 86_400_000;
const consent = (over: Partial<SwapConsent> = {}): SwapConsent => ({ ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion, ...over });
const input = (over: Partial<SwapInput> = {}): SwapInput => ({ templateId: SWAP_TEMPLATE_ID, quality: 'fast', people: [{ slot: 1, body: 'me.jpg', face: 'my-face.jpg', side: 'my-side.jpg' }], ...over });
const start = async (userId: string, key: string, sent = input(), given = consent()): Promise<Job> =>
  data.swap.start(userId, sent, key, await data.swap.estimate(userId, sent), given);
const balance = (userId = 'usr-demo') => data.ledger.balance(userId);
const charges = () => getStore().ledger.filter((entry) => entry.type === 'generation' && entry.note === 'Walk to the camera');
const read = async (job: Job) => (await data.jobs.get(job.id, job.userId))!;
/** What a start writes: a job, its charge, its key (the fixture jobs move on with the clock: only their ids are compared). */
const written = () => { const { jobs, ledger, keys } = getStore(); return structuredClone({ jobs: jobs.map((job) => job.id), ledger, keys: [...keys] }); };
const limits = () => getStore().limits;
const HOUR = 3_600_000;
/** What came back for a job: the `returned` entries of the ledger that name it. */
const returnsOf = (job: Job) => getStore().ledger.filter((entry) => entry.type === 'returned' && entry.relatedJobId === job.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv('VC_FAKE_SWAP', '1');                                           // the fixtures with a person-swap video, the switch on, no look of an admin
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the fixtures without VC_FAKE_SWAP', () => {
  it('hold no person-swap video and leave the feature off', async () => {
    vi.unstubAllEnvs();
    resetStore();
    expect(getStore().templates.some((template) => template.swap)).toBe(false);
    expect(limits()).not.toHaveProperty('personSwap');
    expect(await data.swap.templates()).toEqual([]);
    await expect(data.swap.estimate('usr-demo', input())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('the price of a person swap', () => {
  it('is the rate of the quality for every started 5 seconds of the video', async () => {
    expect(await data.swap.estimate('usr-demo', input())).toMatchObject({ credits: 3, balance: 19, enough: true });   // 12 s: 3 blocks × 1
    expect(await data.swap.estimate('usr-demo', input({ quality: 'best' }))).toMatchObject({ credits: 6 });           // 3 blocks × 2
    getStore().templates.find((template) => template.id === SWAP_TEMPLATE_ID)!.seconds = 30;
    expect(await data.swap.estimate('usr-demo', input({ quality: 'best' }))).toMatchObject({ credits: 12 });
  });

  it('is charged by the rates the site shows, for every quality: one number, not two', async () => {
    const { swap } = await data.payments.rates();
    expect(swap).toEqual({ fast: 1, best: 2 });
    const { seconds } = (await data.swap.template(SWAP_TEMPLATE_ID))!;
    for (const quality of ['fast', 'best'] as const) {
      expect((await data.swap.estimate('usr-demo', input({ quality }))).credits).toBe(swapCredits(seconds, swap![quality]));
    }
  });

  it('is in no rate the site shows while the switch is off', async () => {
    const shown = await data.payments.rates();
    limits().personSwap = false;
    expect(await data.payments.rates()).not.toHaveProperty('swap');
    delete limits().personSwap;                                              // a store written before the feature has no switch: off
    expect(await data.payments.rates()).not.toHaveProperty('swap');
    expect(await data.payments.rates()).toEqual({ perVideo: shown.perVideo, ownTemplate: shown.ownTemplate });
  });

  it('shows one paid request for each part of the video and nothing else', async () => {
    expect(await data.swap.estimate('usr-demo', input())).toMatchObject({ images: 0, clips: 2, clipSeconds: 12, musicTracks: 0 });
  });

  it('is never covered by the free video', async () => {
    expect(await data.swap.estimate('usr-new', input())).toMatchObject({ credits: 3, coveredByFreeVideo: false, enough: false });
  });

  it('is not given for a video whose length is outside the rules: it would be priced by a length nobody sells', async () => {
    getStore().templates.find((template) => template.id === SWAP_TEMPLATE_ID)!.seconds = 0;
    await expect(data.swap.estimate('usr-demo', input())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is given for a video of the 30 seconds the rules end at, and not for one a second longer: no job starts from it and no page lists it', async () => {
    const template = getStore().templates.find((item) => item.id === SWAP_TEMPLATE_ID)!;
    template.seconds = RULES.swapSecondsMax;
    expect(RULES.swapSecondsMax).toBe(30);
    const confirmed = await data.swap.estimate('usr-demo', input());
    expect(confirmed).toMatchObject({ credits: 6 });
    expect((await data.swap.templates()).map((item) => item.id)).toEqual([SWAP_TEMPLATE_ID]);
    template.seconds = RULES.swapSecondsMax + 1;
    const before = written();
    await expect(data.swap.estimate('usr-demo', input())).rejects.toBeInstanceOf(NotFoundError);
    await expect(data.swap.start('usr-demo', input(), 'key-1', confirmed, consent())).rejects.toBeInstanceOf(NotFoundError);
    expect(await data.swap.templates()).toEqual([]);
    expect(await data.swap.template(SWAP_TEMPLATE_ID)).toBeNull();
    expect(written()).toEqual(before);
  });
});

describe('starting a person swap', () => {
  it('charges once: the same key gives the same job', async () => {
    const first = await start('usr-demo', 'key-1');
    const again = await start('usr-demo', 'key-1');
    expect(again.id).toBe(first.id);
    expect(await balance()).toBe(16);
    expect(charges()).toHaveLength(1);
    expect(getStore().jobs.filter((job) => job.swap)).toHaveLength(1);
  });

  it('starts a job of one variant without products, with the three steps of a swap and the photographs of each slot', async () => {
    const job = await start('usr-demo', 'key-1');
    expect(job).toMatchObject({ status: 'running', credits: 3, freeVideo: false, input: { products: [], variants: 1, quality: 'fast' },
      swap: { people: [{ slot: 1, body: 'me.jpg', face: 'my-face.jpg' }], review: null } });
    expect(job.steps.map((step) => [step.key, step.total])).toEqual([['clips', 2], ['edit', 1], ['render', 1]]);
    expect(await data.jobs.findByKey('usr-demo', 'key-1')).toMatchObject({ id: job.id });
  });

  it('keeps the side photograph with the job when one was given, for the same price; left out or sent as none, the job has none', async () => {
    const withSide = await start('usr-demo', 'key-1');
    expect(withSide.swap!.people).toStrictEqual([{ slot: 1, body: 'me.jpg', face: 'my-face.jpg', side: 'my-side.jpg' }]);
    const sentAsNone = await start('usr-demo', 'key-2', input({ people: [{ slot: 1, body: 'me.jpg', face: null, side: null }] }));
    expect(sentAsNone.swap!.people).toStrictEqual([{ slot: 1, body: 'me.jpg', face: null }]);
    expect((await start('usr-demo', 'key-3', input({ people: [{ slot: 1, body: 'me.jpg', face: 'my-face.jpg' }] }))).swap!.people).toStrictEqual([{ slot: 1, body: 'me.jpg', face: 'my-face.jpg' }]);
    expect([withSide.credits, sentAsNone.credits]).toEqual([3, 3]);
  });

  it('keeps the clothes it was asked for with the job: the video\'s unless the photograph\'s was asked for', async () => {
    expect((await start('usr-demo', 'key-1')).swap!.outfit).toBe('keep');
    expect((await start('usr-demo', 'key-2', input({ outfit: 'keep' }))).swap!.outfit).toBe('keep');
    expect((await start('usr-demo', 'key-3', input({ outfit: 'photo' }))).swap!.outfit).toBe('photo');
  });

  it('delivers the video when its fake time has passed', async () => {
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(30_000);
    expect(await read(job)).toMatchObject({ status: 'done', creditsReturned: 0, variants: [{ status: 'done' }] });
    expect(await balance()).toBe(16);
  });

  it.each([
    ['a box left open', consent({ adults: false })],
    ['another version of the text', consent({ version: 'v0' })],
  ])('is refused without the whole consent (%s), and nothing is charged', async (_name, given) => {
    const before = written();
    await expect(start('usr-demo', 'key-1', input(), given)).rejects.toThrow('consent-required');
    expect(written()).toEqual(before);
  });

  it('keeps the consent with the job: when, and which version of the text', async () => {
    const job = await start('usr-demo', 'key-1');
    expect(storedJob(job.id).swapConsent).toEqual({ at: START.toISOString(), version: RULES.swapConsentVersion });
  });

  it.each([
    ['nobody', []],
    ['another slot', [{ slot: 2, body: 'me.jpg', face: null }]],
    ['a slot twice', [{ slot: 1, body: 'me.jpg', face: null }, { slot: 1, body: 'you.jpg', face: null }]],
    ['no photograph of the body', [{ slot: 1, body: ' ', face: 'my-face.jpg' }]],
    ['a side photograph that names nothing', [{ slot: 1, body: 'me.jpg', face: null, side: ' ' }]],
  ])('is refused when the people are not one per slot of the video (%s), and nothing is charged', async (_name, people) => {
    const before = written();
    await expect(start('usr-demo', 'key-1', input({ people }))).rejects.toThrow('swap-people');
    expect(written()).toEqual(before);
  });

  it('is refused while the switch is off, and nothing changes', async () => {
    const confirmed = await data.swap.estimate('usr-demo', input());
    limits().personSwap = false;
    const before = written();
    await expect(data.swap.start('usr-demo', input(), 'key-1', confirmed, consent())).rejects.toBeInstanceOf(NotFoundError);
    await expect(data.swap.estimate('usr-demo', input())).rejects.toBeInstanceOf(NotFoundError);
    expect(written()).toEqual(before);
    delete limits().personSwap;                                              // a store written before the feature has no switch: off
    await expect(data.swap.start('usr-demo', input(), 'key-1', confirmed, consent())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is refused for a template that is not a published person-swap video', async () => {
    await expect(data.swap.estimate('usr-demo', input({ templateId: 'tpl-layering' }))).rejects.toBeInstanceOf(NotFoundError);
    getStore().templates.find((template) => template.id === SWAP_TEMPLATE_ID)!.status = 'hidden';
    await expect(data.swap.estimate('usr-demo', input())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is refused when the price is not the confirmed one, or the balance does not reach it', async () => {
    await expect(data.swap.start('usr-demo', input(), 'key-1', { credits: 2, coveredByFreeVideo: false }, consent())).rejects.toBeInstanceOf(EstimateChangedError);
    await expect(data.swap.start('usr-demo', input(), 'key-1', { credits: 3, coveredByFreeVideo: true }, consent())).rejects.toBeInstanceOf(EstimateChangedError);
    const before = written();
    await expect(start('usr-new', 'key-2')).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(written()).toEqual(before);
    expect(getStore().users.find((user) => user.id === 'usr-new')!.freeVideoAvailable).toBe(true);
  });

  it.each([['a place is free', 3], ['every place is taken', 0]])('is refused before the engine is asked for anything when the balance does not reach the price (%s)', async (_name, jobsAtOnce) => {
    limits().jobsAtOnce = jobsAtOnce;
    const begin = vi.spyOn(fakeEngine, 'start');
    const reserve = vi.fn();
    fakeEngine.reserveQueued = reserve;
    try {
      await expect(start('usr-new', 'key-1')).rejects.toBeInstanceOf(InsufficientCreditsError);
    } finally {
      delete fakeEngine.reserveQueued;
    }
    expect(begin).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(await balance('usr-new')).toBe(0);
  });
});

describe('a person swap that stops', () => {
  it('returns everything it was charged, and going on charges it again', async () => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'swap-stop-test.jpg', face: null }] }));
    vi.advanceTimersByTime(30_000);
    expect(await read(job)).toMatchObject({ status: 'stopped', stoppedReason: 'clips-failed', stoppedDetail: null, credits: 3, creditsReturned: 3 });
    expect(await balance()).toBe(19);
    expect(await data.jobs.resumeQuote(job.id, 'usr-demo')).toMatchObject({ resumable: true, cost: 3 });
    await data.jobs.resume(job.id, 'usr-demo', 3);
    expect(await balance()).toBe(16);
    vi.advanceTimersByTime(30_000);
    expect(await read(job)).toMatchObject({ status: 'done', creditsReturned: 0 });
  });

  it.each([[false, '1'], [true, undefined]] as const)('with person swap switched on = %s at the moment it stops, its stopped mail carries swapClosed = %s', async (on, mark) => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'swap-stop-test.jpg', face: null }] }));
    limits().personSwap = on;
    vi.advanceTimersByTime(30_000);
    await read(job);
    const mail = (await data.mailer.outbox()).find((entry) => entry.kind === 'stopped' && entry.data.jobId === job.id)!;
    expect(mail.data.swapClosed).toBe(mark);
  });

  it.each(['photo-refused', 'person-missing'] as const)('with %s, its stopped mail says which of the two it was, while person swap is on', async (detail) => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: `${detail}-test.jpg`, face: null }] }));
    vi.advanceTimersByTime(30_000);
    await read(job);
    const mail = () => data.mailer.outbox().then((box) => box.find((entry) => entry.kind === 'stopped' && entry.data.jobId === job.id)!);
    expect((await mail()).data).toMatchObject({ swapStop: detail });
    expect((await mail()).data).not.toHaveProperty('swapClosed');
  });

  it.each(['photo-refused', 'person-missing'] as const)('with %s that stops after person swap was switched off, its stopped mail is the closed one and names no cause of its own', async (detail) => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: `${detail}-test.jpg`, face: null }] }));
    limits().personSwap = false;
    vi.advanceTimersByTime(30_000);
    await read(job);
    const mail = (await data.mailer.outbox()).find((entry) => entry.kind === 'stopped' && entry.data.jobId === job.id)!;
    expect(mail.data).toMatchObject({ swapClosed: '1' });
    expect(mail.data).not.toHaveProperty('swapStop');
  });

  it('with any other reason, its stopped mail carries no such mark', async () => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'swap-stop-test.jpg', face: null }] }));
    vi.advanceTimersByTime(30_000);
    await read(job);
    const mail = (await data.mailer.outbox()).find((entry) => entry.kind === 'stopped' && entry.data.jobId === job.id)!;
    expect(mail.data).not.toHaveProperty('swapStop');
  });

  it.each(['photo-refused', 'person-missing'] as const)('with %s returns everything and cannot be continued by its owner', async (detail) => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: `${detail}-test.jpg`, face: null }] }));
    vi.advanceTimersByTime(30_000);
    expect(await read(job)).toMatchObject({ status: 'stopped', stoppedDetail: detail, creditsReturned: 3 });
    expect(await balance()).toBe(19);
    expect(await data.jobs.resumeQuote(job.id, 'usr-demo')).toMatchObject({ resumable: false, cost: 0 });
    await expect(data.jobs.resume(job.id, 'usr-demo', 0)).rejects.toThrow('not-resumable');
    expect(await balance()).toBe(19);
  });

  it('is not continued by its owner while person swap is switched off: nothing is charged and the engine is not asked; switched on again, it goes on', async () => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'swap-stop-test.jpg', face: null }] }));
    vi.advanceTimersByTime(30_000);
    await read(job);
    const resume = vi.spyOn(fakeEngine, 'resume');
    for (const off of [false, undefined]) {                                  // a store written before the feature has no switch: off
      if (off === undefined) delete limits().personSwap; else limits().personSwap = off;
      expect(await data.jobs.resumeQuote(job.id, 'usr-demo')).toMatchObject({ resumable: false, cost: 0 });
      expect(await data.jobs.resumeCost(job.id, 'usr-demo')).toBe(0);
      await expect(data.jobs.resume(job.id, 'usr-demo', 3)).rejects.toThrow('swap-closed');
      await expect(data.jobs.resume(job.id, 'usr-demo', 0)).rejects.toThrow('swap-closed');
    }
    expect(resume).not.toHaveBeenCalled();
    expect(await read(job)).toMatchObject({ status: 'stopped', creditsReturned: 3 });
    expect([await balance(), charges()]).toEqual([19, [expect.objectContaining({ change: -3 })]]);
    limits().personSwap = true;
    expect(await data.jobs.resumeQuote(job.id, 'usr-demo')).toMatchObject({ resumable: true, cost: 3 });
    expect(await data.jobs.resume(job.id, 'usr-demo', 3)).toMatchObject({ status: 'running' });
    expect(await balance()).toBe(16);
  });

  it('is still started again by the free retry of an admin while person swap is switched off, and nothing is charged', async () => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'swap-stop-test.jpg', face: null }] }));
    vi.advanceTimersByTime(30_000);
    await read(job);
    limits().personSwap = false;
    expect(await data.admin.retryJob(job.id)).toMatchObject({ status: 'running' });
    expect(await balance()).toBe(19);
  });

  it('delivered with a part that stopped: that part is not generated again while person swap is switched off, and nothing is charged', async () => {
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(60_000);
    const done = await read(job);
    expect(done.status).toBe('done');
    const variant = storedJob(job.id).variants[0]!;
    variant.status = 'stopped';                                             // no engine leaves a person swap so today: the gate is held all the same
    const cost = await data.jobs.variantCost(job.id, 'usr-demo', variant.id);
    const regenerate = vi.spyOn(fakeEngine, 'regenerateVariant');
    limits().personSwap = false;
    const before = await balance();
    await expect(data.jobs.regenerateVariant(job.id, 'usr-demo', variant.id, cost)).rejects.toThrow('swap-closed');
    expect(regenerate).not.toHaveBeenCalled();
    expect(await balance()).toBe(before);
  });

  it('a product video that stopped is continued as before while person swap is switched off', async () => {
    limits().personSwap = false;
    const cost = await data.jobs.resumeCost('job-demo-stopped', 'usr-demo');
    expect(cost).toBeGreaterThan(0);
    expect(await data.jobs.resumeQuote('job-demo-stopped', 'usr-demo')).toMatchObject({ resumable: true, cost });
    expect(await data.jobs.resume('job-demo-stopped', 'usr-demo', cost)).toMatchObject({ status: 'running' });
  });

  it('with photo-refused is not started again by the free retry of an admin either: the photograph would be refused again', async () => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'photo-refused-test.jpg', face: null }] }));
    vi.advanceTimersByTime(30_000);
    await read(job);
    const resume = vi.spyOn(fakeEngine, 'resume');
    await expect(data.admin.retryJob(job.id)).rejects.toThrow('not-resumable');
    await expect(data.admin.retryStoppedJob('usr-admin', job.id, 'the customer asked')).rejects.toThrow('not-resumable');
    expect(resume).not.toHaveBeenCalled();
    expect(await read(job)).toMatchObject({ status: 'stopped', stoppedDetail: 'photo-refused', creditsReturned: 3 });
    expect(await balance()).toBe(19);
  });

  it('with person-missing is started again by the free retry of an admin once the template is mended, and nothing is charged', async () => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'person-missing-test.jpg', face: null }] }));
    vi.advanceTimersByTime(30_000);
    await read(job);
    expect(await data.admin.retryJob(job.id)).toMatchObject({ status: 'running' });
    expect(await balance()).toBe(19);
  });

  it('closes itself, and its photographs go, 7 days after it stopped', async () => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'swap-stop-test.jpg', face: null }] }));
    vi.advanceTimersByTime(30_000);
    const stopped = await read(job);
    expect(stopped.continueUntil).toBe(new Date(Date.parse(stopped.stoppedAt!) + RULES.swapStoppedPhotosKeptDays * DAY).toISOString());
    vi.advanceTimersByTime(RULES.swapStoppedPhotosKeptDays * DAY - 60_000);
    expect(await read(job)).toMatchObject({ status: 'stopped', swap: { people: [{ slot: 1 }] } });
    vi.advanceTimersByTime(60_000);
    expect(await read(job)).toMatchObject({ status: 'closed', closedReason: 'expired', swap: { people: [] } });
  });

  it('loses its photographs at once when its owner closes it', async () => {
    const job = await start('usr-demo', 'key-1', input({ people: [{ slot: 1, body: 'swap-stop-test.jpg', face: null }] }));
    vi.advanceTimersByTime(30_000);
    await read(job);
    expect(await data.jobs.close(job.id, 'usr-demo')).toMatchObject({ status: 'closed', swap: { people: [] } });
  });
});

describe('the look of an admin at the photographs', () => {
  beforeEach(() => { delete limits().swapReview; });                         // no switch: an admin looks first

  it('holds the job: charged and queued, and nothing is generated however long it waits', async () => {
    const begin = vi.spyOn(fakeEngine, 'start');
    const job = await start('usr-demo', 'key-1');
    expect(job).toMatchObject({ status: 'queued', queuePosition: null, swap: { review: 'waiting' } });
    expect(await balance()).toBe(16);
    vi.advanceTimersByTime(DAY);
    expect(await read(job)).toMatchObject({ status: 'queued', swap: { review: 'waiting' } });
    expect(begin).not.toHaveBeenCalled();
  });

  it('does not stand in the line of the jobs that wait for a place', async () => {
    limits().jobsAtOnce = 1;                                                 // the running job of the fixtures has the one place
    await start('usr-demo', 'key-1');
    const waiting = await startConfirmed('usr-demo', generateInput('tpl-layering'), 'key-2');
    expect(waiting).toMatchObject({ status: 'queued', queuePosition: 1 });
  });

  it('approved twice starts the job once', async () => {
    const begin = vi.spyOn(fakeEngine, 'start');
    const job = await start('usr-demo', 'key-1');
    expect(await reviewSwap(job.id, 'approved')).toMatchObject({ status: 'running', swap: { review: 'approved' } });
    expect(await reviewSwap(job.id, 'approved')).toMatchObject({ status: 'running', swap: { review: 'approved' } });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(charges()).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(await read(job)).toMatchObject({ status: 'done' });
  });

  it('approved after a long wait is done when its work is, not a day earlier: its photographs are kept from then', async () => {
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(DAY);
    const approvedAt = Date.now();
    await reviewSwap(job.id, 'approved');
    vi.advanceTimersByTime(30_000);
    const done = await read(job);
    expect(Date.parse(done.finishedAt!)).toBeGreaterThan(approvedAt);
    expect(done).toMatchObject({ status: 'done', swap: { people: [{ slot: 1 }] } });
  });

  it('rejected closes the job, returns everything and drops the photographs at once', async () => {
    const begin = vi.spyOn(fakeEngine, 'start');
    const job = await start('usr-demo', 'key-1');
    expect(await reviewSwap(job.id, 'rejected')).toMatchObject({ status: 'closed', creditsReturned: 3, swap: { people: [], review: 'rejected' } });
    expect(await balance()).toBe(19);
    expect(await reviewSwap(job.id, 'approved')).toMatchObject({ status: 'closed', swap: { review: 'rejected' } });   // a rejected job never starts
    expect(await reviewSwap(job.id, 'rejected')).toMatchObject({ creditsReturned: 3 });
    expect(await balance()).toBe(19);
    expect(begin).not.toHaveBeenCalled();
  });

  it('can be given up by the owner of the job: everything comes back, the photographs go, and the job never starts', async () => {
    const begin = vi.spyOn(fakeEngine, 'start');
    const job = await start('usr-demo', 'key-1');
    await expect(data.jobs.close(job.id, 'usr-new')).rejects.toBeInstanceOf(NotFoundError);      // only its owner
    expect(await data.jobs.close(job.id, 'usr-demo')).toMatchObject({
      status: 'closed', closedReason: 'customer', closedAt: new Date().toISOString(), credits: 3, creditsReturned: 3, swap: { people: [], review: 'rejected' },
    });
    expect(await balance()).toBe(19);
    expect(await data.jobs.close(job.id, 'usr-demo')).toMatchObject({ status: 'closed', creditsReturned: 3 });
    expect(await reviewSwap(job.id, 'approved')).toMatchObject({ status: 'closed' });                    // a job its owner gave up never starts
    expect(await reviewSwap(job.id, 'rejected')).toMatchObject({ closedReason: 'customer' });
    expect(returnsOf(job).map((entry) => entry.change)).toEqual([3]);
    expect(await balance()).toBe(19);
    expect(begin).not.toHaveBeenCalled();
  });

  it('is the only wait its owner can give up: a job that waits for a place, approved or of a product, is closed by nobody', async () => {
    limits().jobsAtOnce = 1;                                                 // the running job of the fixtures has the one place
    const approved = await start('usr-demo', 'key-1');
    await reviewSwap(approved.id, 'approved');
    const product = await startConfirmed('usr-demo', generateInput('tpl-layering'), 'key-2');
    for (const job of [approved, product]) {
      await expect(data.jobs.close(job.id, 'usr-demo')).rejects.toThrow('not-stopped');
      expect(await read(job)).toMatchObject({ status: 'queued', creditsReturned: 0 });
    }
  });

  it('ends by itself after 48 hours: the job is refused, everything comes back and the photographs go', async () => {
    expect(RULES.swapReviewHours).toBe(48);
    const begin = vi.spyOn(fakeEngine, 'start');
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(RULES.swapReviewHours * HOUR - 1);
    expect(await read(job)).toMatchObject({ status: 'queued', creditsReturned: 0, swap: { people: [{ slot: 1 }], review: 'waiting' } });
    vi.advanceTimersByTime(1);
    expect(await read(job)).toMatchObject({
      status: 'closed', closedReason: 'expired', closedAt: new Date(START.getTime() + RULES.swapReviewHours * HOUR).toISOString(),
      creditsReturned: 3, swap: { people: [], review: 'rejected' },
    });
    expect(await balance()).toBe(19);
    vi.advanceTimersByTime(DAY);
    await read(job);
    expect(returnsOf(job)).toHaveLength(1);
    expect(begin).not.toHaveBeenCalled();
  });

  it('refused by its time is closed at the end of its 48 hours, whenever somebody first reads it; refused by the admin, at that moment', async () => {
    const left = await start('usr-demo', 'key-1');
    const refused = await start('usr-demo', 'key-2');
    vi.advanceTimersByTime(HOUR);
    expect(await reviewSwap(refused.id, 'rejected')).toMatchObject({ closedReason: null, closedAt: new Date(START.getTime() + HOUR).toISOString() });
    vi.advanceTimersByTime(60 * DAY);
    expect(await read(left)).toMatchObject({ closedReason: 'expired', closedAt: new Date(START.getTime() + RULES.swapReviewHours * HOUR).toISOString() });
  });

  it('cannot end with a yes after its 48 hours, though nobody read the job in between: it is refused, not started', async () => {
    const begin = vi.spyOn(fakeEngine, 'start');
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(RULES.swapReviewHours * HOUR);
    expect(await reviewSwap(job.id, 'approved')).toMatchObject({ status: 'closed', closedReason: 'expired', creditsReturned: 3, swap: { people: [], review: 'rejected' } });
    expect(await balance()).toBe(19);
    expect(begin).not.toHaveBeenCalled();
  });

  it.each([
    ['its owner gives it up in the moment its time is over, twice, while the admin refuses it', RULES.swapReviewHours * HOUR],
    ['its owner gives it up twice while the admin refuses it', HOUR],
  ])('returns once whoever ends it, and however many at once (%s)', async (_name, after) => {
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(after);
    const closing = [data.jobs.close(job.id, 'usr-demo'), data.jobs.close(job.id, 'usr-demo'), data.jobs.listFor('usr-demo')];
    await reviewSwap(job.id, 'rejected');
    await Promise.all(closing);
    vi.advanceTimersByTime(3 * DAY);
    await read(job);
    expect(returnsOf(job).map((entry) => entry.change)).toEqual([3]);
    expect(await balance()).toBe(19);
    expect(storedJob(job.id)).toMatchObject({ status: 'closed', returnedCredits: 3 });
  });

  it('is not asked for while its switch is off', async () => {
    limits().swapReview = false;
    expect(await start('usr-demo', 'key-1')).toMatchObject({ status: 'running', swap: { review: null } });
  });
});

describe('where a person-swap video is shown', () => {
  it('never in the gallery of the product templates, and no product video is made from it', async () => {
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).map((template) => template.id)).not.toContain(SWAP_TEMPLATE_ID);
    expect(await data.catalog.get(SWAP_TEMPLATE_ID, 'usr-demo')).toBeNull();
    expect(await data.catalog.categories()).not.toContain('Person swap');
    await expect(data.jobs.estimate('usr-demo', generateInput(SWAP_TEMPLATE_ID))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('on the person-swap pages, without the words the model finds a person by', async () => {
    const [template] = await data.swap.templates();
    expect(template).toMatchObject({ id: SWAP_TEMPLATE_ID, swap: { people: 1, persons: [{ slot: 1, hint: '' }] } });
    expect(await data.swap.template(SWAP_TEMPLATE_ID)).toEqual(template);
    expect(await data.swap.template('tpl-layering')).toBeNull();
  });

  it('nowhere while the switch is off', async () => {
    limits().personSwap = false;
    expect(await data.swap.templates()).toEqual([]);
    expect(await data.swap.template(SWAP_TEMPLATE_ID)).toBeNull();
  });
});

describe('how many times a person-swap video was used', () => {
  const stopper = (name: string) => input({ people: [{ slot: 1, body: `${name}.jpg`, face: null }] });

  it('is nothing before a swap is done, and nothing while one is only started or running', async () => {
    expect(await data.swap.uses()).toEqual({});
    const job = await start('usr-demo', 'key-1');
    expect(await data.swap.uses()).toEqual({});
    vi.advanceTimersByTime(30_000);
    await read(job);
    expect(await data.swap.uses()).toEqual({ [SWAP_TEMPLATE_ID]: 1 });
  });

  it('adds the finished swaps of every customer into one number per video', async () => {
    const done = [await start('usr-demo', 'key-1'), await start('usr-demo', 'key-2'), await start('usr-paying', 'key-3')];
    for (let minute = 0; minute < 3; minute += 1) {                          // two of one customer wait for a place in turn
      vi.advanceTimersByTime(30_000);
      for (const job of done) await read(job);
    }
    expect(await data.swap.uses()).toEqual({ [SWAP_TEMPLATE_ID]: 3 });
  });

  it('leaves out a swap that stopped (its credits went back), and counts it once when it goes on and is done', async () => {
    const job = await start('usr-demo', 'key-1', stopper('swap-stop-test'));
    vi.advanceTimersByTime(30_000);
    expect(await read(job)).toMatchObject({ status: 'stopped' });
    expect(await data.swap.uses()).toEqual({});
    await data.jobs.resume(job.id, 'usr-demo', 3);
    vi.advanceTimersByTime(30_000);
    expect(await read(job)).toMatchObject({ status: 'done' });
    expect(await data.swap.uses()).toEqual({ [SWAP_TEMPLATE_ID]: 1 });
  });

  it('leaves out a swap an admin refused, and one its owner gave up', async () => {
    limits().swapReview = true;
    const refused = await start('usr-demo', 'key-1');
    await reviewSwap(refused.id, 'rejected');
    const given = await start('usr-paying', 'key-2');
    await data.jobs.close(given.id, 'usr-paying');
    vi.advanceTimersByTime(30_000);
    expect(await data.swap.uses()).toEqual({});
  });

  it('still counts a video its owner deleted afterwards', async () => {
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(30_000);
    await read(job);
    await data.jobs.deleteVideo(job.id, 'usr-demo');
    expect(await data.swap.uses()).toEqual({ [SWAP_TEMPLATE_ID]: 1 });
  });

  it('says nothing while the switch is off', async () => {
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(30_000);
    await read(job);
    limits().personSwap = false;
    expect(await data.swap.uses()).toEqual({});
  });
});

describe('what is kept of a finished person swap', () => {
  it('the photographs for 24 hours', async () => {
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(30_000);
    const done = await read(job);
    vi.setSystemTime(Date.parse(done.finishedAt!) + RULES.swapPhotosKeptHours * 3_600_000 - 1);
    expect(await read(job)).toMatchObject({ swap: { people: [{ body: 'me.jpg' }] } });
    vi.setSystemTime(Date.parse(done.finishedAt!) + RULES.swapPhotosKeptHours * 3_600_000);
    expect(await read(job)).toMatchObject({ status: 'done', swap: { people: [] } });
  });

  it('the video for 30 days, then its files are deleted, once', async () => {
    const remove = vi.spyOn(fakeEngine, 'deleteMedia');
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(30_000);
    const done = await read(job);
    const expires = Date.parse(done.finishedAt!) + RULES.swapVideosKeptDays * DAY;
    expect(done).toMatchObject({ videoExpiresAt: new Date(expires).toISOString(), videoStored: true });
    vi.setSystemTime(expires - 1);
    expect(await read(job)).toMatchObject({ videoStored: true });
    expect(remove).not.toHaveBeenCalled();
    vi.setSystemTime(expires);
    expect(await read(job)).toMatchObject({ status: 'done', videoStored: false });
    await read(job);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('nothing of the photographs once its owner deletes the video', async () => {
    const job = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(30_000);
    await read(job);
    await data.jobs.deleteVideo(job.id, 'usr-demo');
    expect(storedJob(job.id)).toMatchObject({ swap: { people: [] } });
  });

  it('a product video keeps its own times', async () => {
    const job = await startConfirmed('usr-demo', generateInput('tpl-layering'), 'key-1');
    vi.advanceTimersByTime(60_000);
    const done = await read(job);
    expect(Date.parse(done.videoExpiresAt!) - Date.parse(done.finishedAt!)).toBeGreaterThan(300 * DAY);
    expect(done.swap).toBeUndefined();
  });
});
