// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError, RULES } from '../ports';
import type { Job, SwapConsent, SwapInput } from '../ports';
import { SWAP_TEMPLATE_ID } from './demo-values';
import { getStore, resetStore } from './store';
import { START, storedJob } from './test-helpers';

// The admin's side of person swap on the site's own records, next to the fake engine: who may answer the look and see a photograph,
// the line of the jobs that wait, the answer, the two switches, and the mail of a refusal.

const ADMIN = 'usr-admin';
const HOUR = 3_600_000;
const consent: SwapConsent = { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion };
const input: SwapInput = { templateId: SWAP_TEMPLATE_ID, quality: 'fast', people: [{ slot: 1, body: 'me.jpg', face: 'my-face.jpg', side: 'my-side.jpg' }] };
const start = async (userId = 'usr-demo', key = 'key-1'): Promise<Job> =>
  data.swap.start(userId, input, key, await data.swap.estimate(userId, input), consent);
const read = async (job: Job) => (await data.jobs.get(job.id, job.userId))!;
const balance = (userId = 'usr-demo') => data.ledger.balance(userId);
const returnsOf = (job: Job) => getStore().ledger.filter((entry) => entry.type === 'returned' && entry.relatedJobId === job.id);
const actions = () => getStore().adminActions.map(({ action, target, by }) => ({ action, target, by: by.kind === 'admin' ? by.id : by.kind }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv('VC_FAKE_SWAP', '1');
  resetStore();
  delete getStore().limits.swapReview;                                       // the launch default: an admin looks first
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('who may answer the look and see a photograph', () => {
  it('only an admin answers: a customer, the owner of the job and nobody are refused, and the job waits on with its charge', async () => {
    const job = await start();
    for (const who of ['usr-new', 'usr-demo', '', 'usr-nobody']) {
      await expect(data.admin.reviewSwap(who, job.id, 'approved')).rejects.toThrow('forbidden');
      await expect(data.admin.reviewSwap(who, job.id, 'rejected')).rejects.toThrow('forbidden');
    }
    expect(await read(job)).toMatchObject({ status: 'queued', creditsReturned: 0, swap: { review: 'waiting', people: input.people } });
    expect(await balance()).toBe(16);
    expect(actions()).toEqual([]);
  });

  it('only an admin is given a photograph: a customer, the owner of the job and nobody are refused', async () => {
    const job = await start();
    for (const who of ['usr-new', 'usr-demo', '', 'usr-nobody']) await expect(data.admin.swapPhoto(who, job.id, 1, 'body')).rejects.toThrow('forbidden');
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'body')).toEqual({ state: 'shown', name: 'me.jpg', file: null });
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'face')).toEqual({ state: 'shown', name: 'my-face.jpg', file: null });
  });

  it('only an admin reads the line of the jobs that wait', async () => {
    await start();
    for (const who of ['usr-new', 'usr-demo', '', 'usr-nobody']) await expect(data.admin.swapQueue(who)).rejects.toThrow('forbidden');
  });

  it('refuses an answer that is neither a yes nor a no, and a job that is no person swap', async () => {
    const job = await start();
    await expect(data.admin.reviewSwap(ADMIN, job.id, 'maybe' as 'approved')).rejects.toThrow('invalid-verdict');
    await expect(data.admin.reviewSwap(ADMIN, 'job-demo-stopped', 'approved')).rejects.toBeInstanceOf(NotFoundError);
    await expect(data.admin.swapPhoto(ADMIN, 'job-demo-stopped', 1, 'body')).rejects.toBeInstanceOf(NotFoundError);
    expect((await read(job)).swap!.review).toBe('waiting');
  });
});

describe('the line of the jobs that wait for the look', () => {
  it('names who waits, with which video, since when, and until when the answer counts: oldest first', async () => {
    const first = await start('usr-demo', 'key-1');
    vi.advanceTimersByTime(2 * HOUR);
    const second = await start('usr-paying', 'key-2');
    const line = await data.admin.swapQueue(ADMIN);
    expect(line.map((row) => [row.job.id, row.email, row.template?.id, row.decideBy])).toEqual([
      [first.id, 'demo@viralclone.app', SWAP_TEMPLATE_ID, new Date(Date.parse(first.startedAt) + RULES.swapReviewHours * HOUR).toISOString()],
      [second.id, 'paying@example.com', SWAP_TEMPLATE_ID, new Date(Date.parse(second.startedAt) + RULES.swapReviewHours * HOUR).toISOString()],
    ]);
    expect(line[0]!.template!.swap!.persons[0]!.hint).not.toBe('');           // the admin's copy keeps the words the model finds the person by
  });

  it('holds no job that has its answer, none whose time ran out, and none that never waited', async () => {
    const yes = await start('usr-demo', 'key-1');
    const no = await start('usr-demo', 'key-2');
    const late = await start('usr-paying', 'key-3');
    await data.admin.reviewSwap(ADMIN, yes.id, 'approved');
    await data.admin.reviewSwap(ADMIN, no.id, 'rejected');
    vi.advanceTimersByTime(HOUR);
    const kept = await start('usr-paying', 'key-4');
    vi.setSystemTime(Date.parse(late.startedAt) + RULES.swapReviewHours * HOUR);
    expect((await data.admin.swapQueue(ADMIN)).map((row) => row.job.id)).toEqual([kept.id]);
    expect(await read(late)).toMatchObject({ status: 'closed', closedReason: 'expired' });
  });
});

describe('the answer of an admin', () => {
  it('yes, given twice, starts the job once: the second answer says it was given already', async () => {
    const job = await start();
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'approved')).toMatchObject({ outcome: 'done', value: { status: 'running', swap: { review: 'approved' } } });
    const again = await data.admin.reviewSwap(ADMIN, job.id, 'approved');
    expect(again).toMatchObject({ outcome: 'already-done', value: { status: 'running' } });
    expect(getStore().jobs.filter((item) => item.id === job.id)).toHaveLength(1);
    expect(await balance()).toBe(16);
    expect(actions()).toEqual([{ action: 'swap-approve', target: job.id, by: ADMIN }]);
  });

  it('no closes the job, returns everything once and drops the photographs at once; a second no, and a late yes, change nothing', async () => {
    const job = await start();
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'rejected')).toMatchObject({
      outcome: 'done', value: { status: 'closed', closedReason: null, creditsReturned: 3, swap: { review: 'rejected', people: [] } },
    });
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'rejected')).toMatchObject({ outcome: 'already-done', value: { status: 'closed' } });
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'approved')).toMatchObject({ outcome: 'already-done', value: { status: 'closed', swap: { review: 'rejected' } } });
    expect(returnsOf(job).map((entry) => entry.change)).toEqual([3]);
    expect(await balance()).toBe(19);
    expect(actions()).toEqual([{ action: 'swap-reject', target: job.id, by: ADMIN }]);
  });

  it('that comes after the 48 hours is no answer: the job was refused by its time, and the admin is told it was decided already', async () => {
    const job = await start();
    vi.setSystemTime(Date.parse(job.startedAt) + RULES.swapReviewHours * HOUR);
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'approved')).toMatchObject({ outcome: 'already-done', value: { status: 'closed', closedReason: 'expired', creditsReturned: 3 } });
    expect(actions()).toEqual([]);
  });
});

describe('a photograph, for the look of an admin', () => {
  it('is shown only while the job waits: after a yes it is shown no more, after a no it is deleted', async () => {
    const yes = await start('usr-demo', 'key-1');
    const no = await start('usr-demo', 'key-2');
    await data.admin.reviewSwap(ADMIN, yes.id, 'approved');
    await data.admin.reviewSwap(ADMIN, no.id, 'rejected');
    expect(await data.admin.swapPhoto(ADMIN, yes.id, 1, 'body')).toEqual({ state: 'decided' });
    expect(await data.admin.swapPhoto(ADMIN, no.id, 1, 'body')).toEqual({ state: 'deleted' });
  });

  it('from the side is one of them: shown by its name while the job waits, no more after a yes, deleted after a no', async () => {
    const yes = await start('usr-demo', 'key-1');
    const no = await start('usr-demo', 'key-2');
    expect(await data.admin.swapPhoto(ADMIN, yes.id, 1, 'side')).toEqual({ state: 'shown', name: 'my-side.jpg', file: null });
    await data.admin.reviewSwap(ADMIN, yes.id, 'approved');
    await data.admin.reviewSwap(ADMIN, no.id, 'rejected');
    expect(await data.admin.swapPhoto(ADMIN, yes.id, 1, 'side')).toEqual({ state: 'decided' });
    expect(await data.admin.swapPhoto(ADMIN, no.id, 1, 'side')).toEqual({ state: 'deleted' });
    expect(storedJob(no.id).swap!.people).toEqual([]);
  });

  it('from the side that the job was not given (also a job written before there was one) is not found', async () => {
    const two: SwapInput = { ...input, people: [{ slot: 1, body: 'me.jpg', face: 'my-face.jpg' }] };
    const job = await data.swap.start('usr-demo', two, 'key-1', await data.swap.estimate('usr-demo', two), consent);
    await expect(data.admin.swapPhoto(ADMIN, job.id, 1, 'side')).rejects.toBeInstanceOf(NotFoundError);
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'face')).toMatchObject({ state: 'shown', name: 'my-face.jpg' });
  });

  it('of a job whose 48 hours ran out is deleted, though nobody read the job in between', async () => {
    const job = await start();
    vi.setSystemTime(Date.parse(job.startedAt) + RULES.swapReviewHours * HOUR);
    expect(await data.admin.swapPhoto(ADMIN, job.id, 1, 'body')).toEqual({ state: 'deleted' });
  });

  it('that the job has none of (no such slot) is not found', async () => {
    const job = await start();
    await expect(data.admin.swapPhoto(ADMIN, job.id, 2, 'body')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('a person-swap video an admin adds, next to the fake engine', () => {
  it('is a catalog template that waits for the admin, with its one person to describe; no gallery and no person-swap page shows it before it is published', async () => {
    const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: 'https://www.tiktok.com/@a/video/1' });
    expect(made).toMatchObject({ status: 'waiting', ownerId: null, shots: [], products: 0, swap: { people: 1, persons: [{ slot: 1 }] } });
    expect(made.id).not.toBe(SWAP_TEMPLATE_ID);
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).map((template) => template.id)).not.toContain(made.id);
    expect((await data.swap.templates()).map((template) => template.id)).toEqual([SWAP_TEMPLATE_ID]);
    await data.admin.updateTemplate(made.id, { status: 'published' });
    expect((await data.swap.templates()).map((template) => template.id)).toContain(made.id);
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).map((template) => template.id)).not.toContain(made.id);
  });

  it('is an admin\'s alone to add', async () => {
    const before = getStore().templates.length;
    for (const who of ['usr-demo', '', 'usr-nobody']) await expect(data.admin.addSwapTemplate(who, { kind: 'link', url: 'https://www.tiktok.com/@a/video/1' })).rejects.toThrow('forbidden');
    expect(getStore().templates).toHaveLength(before);
  });
});

describe('the two switches of person swap, in the admin\'s limits', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetStore();                                                            // the launch store: no switch was ever saved
  });

  it('read off and on in a store that never saved them: person swap closed, the look of an admin asked for', async () => {
    expect(getStore().limits).not.toHaveProperty('personSwap');
    expect(await data.admin.limits()).toMatchObject({ personSwap: false, swapReview: true });
  });

  it('are an admin\'s to save, each a yes or a no: anything else, and anyone else, saves nothing', async () => {
    await expect(data.admin.saveLimits('usr-demo', { personSwap: true })).rejects.toThrow('forbidden');
    await expect(data.admin.saveLimits(ADMIN, { personSwap: 'yes' as unknown as boolean })).rejects.toThrow('invalid-limit');
    await expect(data.admin.saveLimits(ADMIN, { swapReview: 0 as unknown as boolean, personSwap: true })).rejects.toThrow('invalid-limit');
    expect(await data.admin.limits()).toMatchObject({ personSwap: false, swapReview: true });
    expect(await data.admin.saveLimits(ADMIN, { personSwap: true })).toMatchObject({ personSwap: true, swapReview: true });
    expect(await data.admin.saveLimits(ADMIN, { swapReview: false })).toMatchObject({ personSwap: true, swapReview: false, jobsAtOnce: 2 });
  });

  it('open and close person swap at once for the customer: closed, no page, no price and no start names it', async () => {
    const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: 'https://www.tiktok.com/@a/video/1' });
    await data.admin.updateTemplate(made.id, { status: 'published' });
    const sent: SwapInput = { ...input, templateId: made.id };
    expect([await data.swap.enabled(), (await data.swap.templates()).length, (await data.payments.rates()).swap]).toEqual([false, 0, undefined]);
    await expect(data.swap.estimate('usr-demo', sent)).rejects.toBeInstanceOf(NotFoundError);
    await data.admin.saveLimits(ADMIN, { personSwap: true });
    expect([await data.swap.enabled(), (await data.swap.templates()).map((template) => template.id)]).toEqual([true, [made.id]]);
    expect(await data.swap.start('usr-demo', sent, 'key-1', await data.swap.estimate('usr-demo', sent), consent)).toMatchObject({ status: 'queued', swap: { review: 'waiting' } });
    await data.admin.saveLimits(ADMIN, { personSwap: false });
    expect([await data.swap.enabled(), await data.swap.templates()]).toEqual([false, []]);
    await expect(data.swap.estimate('usr-demo', sent)).rejects.toBeInstanceOf(NotFoundError);
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).map((template) => template.id)).not.toContain(made.id);
  });

  it('closed, the admin still has the line and the answer: a job that waited when person swap was closed is not left with its charge', async () => {
    await data.admin.saveLimits(ADMIN, { personSwap: true });
    const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: 'https://www.tiktok.com/@a/video/1' });
    await data.admin.updateTemplate(made.id, { status: 'published' });
    const sent: SwapInput = { ...input, templateId: made.id };
    const job = await data.swap.start('usr-demo', sent, 'key-1', await data.swap.estimate('usr-demo', sent), consent);
    await data.admin.saveLimits(ADMIN, { personSwap: false, swapReview: false });
    expect((await data.admin.swapQueue(ADMIN)).map((row) => row.job.id)).toEqual([job.id]);
    expect(await data.admin.reviewSwap(ADMIN, job.id, 'rejected')).toMatchObject({ outcome: 'done', value: { status: 'closed', creditsReturned: job.credits } });
  });

  it('the look switched off: the next job starts without it, and one that waits already still waits for its answer', async () => {
    vi.stubEnv('VC_FAKE_SWAP', '1');
    resetStore();
    await data.admin.saveLimits(ADMIN, { swapReview: true });
    const waiting = await start('usr-demo', 'key-1');
    await data.admin.saveLimits(ADMIN, { swapReview: false });
    expect(await start('usr-demo', 'key-2')).toMatchObject({ status: 'running', swap: { review: null } });
    expect(await read(waiting)).toMatchObject({ status: 'queued', swap: { review: 'waiting' } });
  });
});

describe('the mail of a refusal', () => {
  const mails = () => getStore().outbox.filter((mail) => mail.kind === 'refused');

  it('goes to the owner once when an admin says no: what came back, and the job it is about; a second answer sends nothing', async () => {
    const job = await start();
    await data.admin.reviewSwap(ADMIN, job.id, 'rejected');
    await data.admin.reviewSwap(ADMIN, job.id, 'rejected');
    await data.admin.reviewSwap(ADMIN, job.id, 'approved');
    await read(job);
    expect(mails().map(({ to, data: sent }) => ({ to, ...sent }))).toEqual([
      { to: 'demo@viralclone.app', jobId: job.id, templateTitle: 'Walk to the camera', returned: '3', returnTo: `/jobs/${job.id}` },
    ]);
  });

  it('goes once when the 48 hours end without an answer, however often the job is read or swept afterwards', async () => {
    const job = await start();
    vi.setSystemTime(Date.parse(job.startedAt) + RULES.swapReviewHours * HOUR);
    await read(job);
    await data.admin.swapQueue(ADMIN);
    await data.admin.reviewSwap(ADMIN, job.id, 'rejected');
    vi.advanceTimersByTime(HOUR);
    await read(job);
    expect(mails().map((mail) => [mail.to, mail.data.jobId, mail.data.returned])).toEqual([['demo@viralclone.app', job.id, '3']]);
  });

  it('is not sent for a yes, nor to an owner who gave the wait up themselves', async () => {
    const yes = await start('usr-demo', 'key-1');
    const own = await start('usr-demo', 'key-2');
    await data.admin.reviewSwap(ADMIN, yes.id, 'approved');
    await data.jobs.close(own.id, 'usr-demo');
    expect(mails()).toEqual([]);
  });
});
