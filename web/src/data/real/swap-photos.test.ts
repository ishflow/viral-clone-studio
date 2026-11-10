// @vitest-environment node
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '..';
import { operations } from '../mock/admin-operations';
import { getStore, resetStore } from '../mock/store';
import { addDemoCustomers, storedJob } from '../mock/test-helpers';
import { InsufficientCreditsError, NotFoundError, RULES } from '../ports';
import type { Job, SwapConsent, SwapInput } from '../ports';
import { mediaFile } from './media';
import { PERSON_PHOTO } from './photo-test-fixture';
import type { Card } from './rows';
import { closeSqliteEngines, sqliteEngine } from './sqlite-engine';
import { sweepSwapPhotos } from './swap-photos';
import { card, jobRecord, makeDataDir, PAID, putTemplate } from './testing';

// Person swap next to the real engine: what the worker is handed, who may see a photograph, and that the photographs (personal data)
// and the video are really gone from the disk when the rules say so.

let dir: string;
let db: DatabaseSync;
/**
 * The answer of an admin to the look, as the job reads after it: the admin's port is the only way an answer is given. Asked of the
 * port itself, not through `data`: the store is not written and the engine is not told, so a run it hands over stays `held`.
 */
const reviewSwap = async (jobId: string, verdict: 'approved' | 'rejected') => (await operations.reviewSwap('usr-admin', jobId, verdict)).value;
const T0 = new Date('2026-10-04T12:00:00.000Z');
const HOUR = 3_600_000, DAY = 24 * HOUR;
const PNG = PERSON_PHOTO;                                                // a whole, small picture: the one photograph of these tests
const SWAP_PAID = { images: 0, clips: 2, clipSeconds: 12, music: 0, voice: 0 };
const swapCard = (over: object = {}): Card => ({
  ...card({ seconds: 12, shots: [], products: 0 }),
  swap: { people: 1, sound: true, persons: [{ slot: 1, box: { left: 30, top: 10, right: 70, bottom: 95 }, hint: 'the woman on the left' }], parts: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }], ...over },
}) as Card;

const upload = (userId: string) => data.uploads.save(userId, new File([PNG], 'me.png', { type: 'image/png' }));
const consent: SwapConsent = { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion };
const on = (stored: string) => existsSync(join(dir, stored));
const folderOf = (stored: string) => dirname(stored);
const balance = (userId = 'usr-demo') => data.ledger.balance(userId);
const runOf = (jobId: string) => db.prepare('SELECT * FROM runs WHERE ref = ?').get(jobId) as Record<string, string | null> | undefined;
const read = async (job: Job) => (await data.jobs.get(job.id, job.userId))!;
const viewer = (id: string | null) => (id ? getStore().users.find((user) => user.id === id) ?? null : null);
/** What came back for a job, as the credit history holds it: one entry for each return. */
const returned = (jobId: string) => getStore().ledger.filter((entry) => entry.type === 'returned' && entry.relatedJobId === jobId).map((entry) => entry.change);
/** A process that starts: the engine opens, and sweeps. Nobody reads a job. */
const reopen = () => { closeSqliteEngines(); sqliteEngine(dir); };

/** The photographs a customer gives: the full-body and the face one alone, or the side one (which may be left out) as well. */
const PHOTOS = [['a full-body and a face photograph', false], ['a side photograph as well', true]] as const;
/** Does the customer of this test give the side photograph too? */
let sides = false;
const fresh = async (userId: string): Promise<SwapInput['people']> => [{ slot: 1, body: await upload(userId), face: await upload(userId), ...(sides ? { side: await upload(userId) } : {}) }];
/** One answer for each photograph the customer gave. */
const all = (value: boolean) => Array<boolean>(sides ? 3 : 2).fill(value);

/** A person swap of `userId` with fresh photographs (or the given ones), started the way the site does. */
async function start(userId = 'usr-demo', key = 'key-1', people?: SwapInput['people']): Promise<Job> {
  const input: SwapInput = { templateId: 'sw1', quality: 'fast', people: people ?? await fresh(userId) };
  return data.swap.start(userId, input, key, await data.swap.estimate(userId, input), consent);
}
const photosOf = (job: Job) => job.swap!.people.flatMap((person) => [person.body, person.face!, ...(person.side ? [person.side] : [])]);

/** What the worker writes when the run of a job ends. A done run has its video on the disk. */
function worker(jobId: string, state: 'done' | 'stopped', over: { reason?: string; detail?: string } = {}): string {
  const runId = runOf(jobId)!.id!;
  const variant = state === 'done'
    ? { n: 1, status: 'done', video: `jobs/${runId}/v1/final.mp4`, image: `jobs/${runId}/v1/poster.jpg`, reason: null }
    : { n: 1, status: 'stopped', video: null, image: null, reason: over.reason ?? 'clips-failed' };
  if (state === 'done') {
    mkdirSync(join(dir, 'jobs', runId, 'v1'), { recursive: true });
    writeFileSync(join(dir, 'jobs', runId, 'v1', 'final.mp4'), 'video');
  }
  db.prepare('UPDATE runs SET state = ?, reason = ?, detail = ?, missing = ?, variants = ?, updated_at = ? WHERE id = ?').run(
    state, state === 'stopped' ? (over.reason ?? 'clips-failed') : null, over.detail ?? null,
    state === 'stopped' ? JSON.stringify({ ...SWAP_PAID, clips: 1, clipSeconds: 6 }) : null, JSON.stringify([variant]), new Date().toISOString(), runId);
  return runId;
}

/** The parts the worker paid for, as its rows and files say: `jobs/<run>/paid/v1/clip-pNN.mp4`, each a finished request of kind 'clip'. No label, no sound. */
function parts(runId: string): string[] {
  mkdirSync(join(dir, 'jobs', runId, 'paid', 'v1'), { recursive: true });
  return ['p01', 'p02'].map((id) => {
    const file = `jobs/${runId}/paid/v1/clip-${id}.mp4`;
    writeFileSync(join(dir, file), 'part');
    db.prepare("INSERT INTO operations (run_id, key, kind, state, output, created_at, updated_at) VALUES (?, ?, 'clip', 'done', ?, 'a', 'a')").run(runId, `v1:clip:${id}`, file);
    return file;
  });
}

beforeEach(() => {
  ({ dir, db } = makeDataDir());
  sides = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir); vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');
  resetStore(); addDemoCustomers(); closeSqliteEngines();
  Object.assign(getStore().limits, { personSwap: true, swapReview: false });
  putTemplate(db, { id: 'sw1', state: 'published', card: swapCard(), estimate: SWAP_PAID, minutes: 3 });
  putTemplate(db, { id: 't1', state: 'published' });
});
afterEach(() => {
  closeSqliteEngines(); db.close(); rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); resetStore();
});

describe('a person-swap video of the engine', () => {
  it('is a template that is ready, with its people and parts, though it has no shot', async () => {
    expect(sqliteEngine(dir).template('sw1')).toMatchObject({ preparation: null, preparationNote: null, status: 'published', seconds: 12, shots: [],
      swap: { people: 1, sound: true, persons: [{ slot: 1, hint: 'the woman on the left' }], parts: [{ n: 1, from: 0, to: 6 }, { n: 2, from: 6, to: 12 }] } });
    expect(sqliteEngine(dir).template('t1')).not.toHaveProperty('swap');
    expect((await data.swap.templates()).map((template) => [template.id, template.swap?.persons[0]?.hint])).toEqual([['sw1', '']]);
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).map((template) => template.id)).toEqual(['t1']);
  });

  it('without a part is not one a job can start from', async () => {
    putTemplate(db, { id: 'sw2', state: 'ready', card: swapCard({ parts: [] }), estimate: SWAP_PAID, minutes: 3 });
    expect(sqliteEngine(dir).template('sw2')).toMatchObject({ preparation: 'failed', preparationNote: 'check-failed' });
  });
});

describe('starting a person swap next to the real engine', () => {
  it('hands the worker one produce run with the photographs of each slot, charged once, and marks the photographs', async () => {
    const job = await start();
    expect(job).toMatchObject({ status: 'running', credits: 3, swap: { review: null } });
    expect(job.steps.map((step) => [step.key, step.total])).toEqual([['clips', 2], ['edit', 1], ['render', 1]]);
    expect(JSON.parse(runOf(job.id)!.input!)).toEqual({
      kind: 'produce', templateId: 'sw1', ownerId: 'usr-demo', quality: 'fast', variants: 1, language: 'en', products: [], sample: false,
      swap: { people: job.swap!.people, outfit: 'keep' },
    });
    expect(runOf(job.id)).toMatchObject({ state: 'queued', approved: JSON.stringify(SWAP_PAID) });
    expect((await start()).id).toBe(job.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 1 });
    expect(await balance()).toBe(16);
    for (const stored of photosOf(job)) expect(on(join(folderOf(stored), 'swap'))).toBe(true);
  });

  it('hands the worker the clothes the customer chose, and none for a job written before the choice', async () => {
    const input: SwapInput = { templateId: 'sw1', quality: 'fast', outfit: 'photo', people: [{ slot: 1, body: await upload('usr-demo'), face: null }] };
    const job = await data.swap.start('usr-demo', input, 'key-photo', await data.swap.estimate('usr-demo', input), consent);
    expect(job.swap!.outfit).toBe('photo');
    expect(JSON.parse(runOf(job.id)!.input!).swap).toEqual({ people: job.swap!.people, outfit: 'photo' });
    const written = jobRecord({ userId: 'usr-demo', templateId: 'sw1', swap: { people: [{ slot: 1, body: await upload('usr-demo'), face: null }], review: null } });
    sqliteEngine(dir).start(written, SWAP_PAID, false);
    expect(JSON.parse(runOf(written.id)!.input!).swap).toEqual({ people: written.swap!.people });
  });

  it('hands the worker the side photograph when the customer gave one, marked like the other two, for the price of two', async () => {
    sides = true;
    const job = await start();
    const [person] = job.swap!.people;
    expect(new Set(photosOf(job)).size).toBe(3);
    expect(JSON.parse(runOf(job.id)!.input!).swap.people).toEqual([{ slot: 1, body: person!.body, face: person!.face, side: person!.side }]);
    for (const stored of photosOf(job)) expect(on(join(folderOf(stored), 'swap'))).toBe(true);
    expect([job.credits, await balance()]).toEqual([3, 16]);
  });

  it.each([['left out', {}], ['sent as none', { side: null }]])('hands the worker no side photograph when it was %s: the run reads as one written before there was a third', async (_name, side) => {
    const job = await start('usr-demo', 'key-1', [{ slot: 1, body: await upload('usr-demo'), face: null, ...side }]);
    expect(Object.keys(job.swap!.people[0]!).sort()).toEqual(['body', 'face', 'slot']);
    expect(Object.keys(JSON.parse(runOf(job.id)!.input!).swap.people[0]).sort()).toEqual(['body', 'face', 'slot']);
  });

  it('refuses a photograph somebody else uploaded, and one that is no stored photograph, before anything is charged', async () => {
    const theirs = await upload('usr-new');
    await expect(start('usr-demo', 'key-1', [{ slot: 1, body: theirs, face: null }])).rejects.toThrow('swap-people');
    await expect(start('usr-demo', 'key-2', [{ slot: 1, body: await upload('usr-demo'), face: theirs }])).rejects.toThrow('swap-people');
    await expect(start('usr-demo', 'key-3', [{ slot: 1, body: 'uploads/../site.json', face: null }])).rejects.toThrow('swap-people');
    await expect(start('usr-demo', 'key-4', [{ slot: 1, body: await upload('usr-demo'), face: null, side: theirs }])).rejects.toThrow('swap-people');
    await expect(start('usr-demo', 'key-5', [{ slot: 1, body: await upload('usr-demo'), face: null, side: 'uploads/../site.json' }])).rejects.toThrow('swap-people');
    expect(runOf(getStore().jobs.at(-1)?.id ?? '')).toBeUndefined();
    expect(getStore().jobs).toEqual([]);
    expect(await balance()).toBe(19);
    expect(on(join(folderOf(theirs), 'swap'))).toBe(false);
  });

  it('refuses a photograph somebody else uploaded by the site\'s own check: also when an admin looks first and the engine, which would refuse it too, is not asked yet', async () => {
    delete getStore().limits.swapReview;
    const theirs = await upload('usr-new');
    await expect(start('usr-demo', 'key-1', [{ slot: 1, body: theirs, face: null }])).rejects.toThrow('swap-people');
    await expect(start('usr-demo', 'key-2', [{ slot: 1, body: await upload('usr-demo'), face: theirs }])).rejects.toThrow('swap-people');
    await expect(start('usr-demo', 'key-3', [{ slot: 1, body: await upload('usr-demo'), face: null, side: theirs }])).rejects.toThrow('swap-people');
    expect(getStore().jobs).toEqual([]);
    expect(await balance()).toBe(19);
    expect(on(join(folderOf(theirs), 'swap'))).toBe(false);
  });

  it('is refused before the engine is handed anything when the balance does not reach the price: no run, no charge, no mark', async () => {
    const photo = await upload('usr-new');
    const input: SwapInput = { templateId: 'sw1', quality: 'fast', people: [{ slot: 1, body: photo, face: null }] };
    expect(await balance('usr-new')).toBe(0);
    await expect(data.swap.start('usr-new', input, 'key-1', { credits: 3, coveredByFreeVideo: false }, consent)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
    expect(getStore().jobs).toEqual([]);
    expect(on(join(folderOf(photo), 'swap'))).toBe(false);
  });

  it('the engine itself takes no person swap whose photographs are not its owner\'s, and none on a template of the other kind', () => {
    const engine = sqliteEngine(dir);
    const swap = { people: [{ slot: 1, body: 'uploads/00000000-0000-4000-8000-000000000000/1.png', face: null }], review: null };
    expect(() => engine.start(jobRecord({ templateId: 'sw1', swap }), SWAP_PAID, false)).toThrow('swap-people');
    expect(() => engine.start(jobRecord({ templateId: 't1', swap }), PAID, false)).toThrow('template-not-ready');
    expect(() => engine.start(jobRecord({ templateId: 'sw1' }), SWAP_PAID, false)).toThrow('template-not-ready');
    expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });

  it('the engine itself takes no person swap whose side photograph is not its owner\'s, though the other two are', async () => {
    const swap = { people: [{ slot: 1, body: await upload('usr-demo'), face: await upload('usr-demo'), side: await upload('usr-new') }], review: null };
    expect(() => sqliteEngine(dir).start(jobRecord({ userId: 'usr-demo', templateId: 'sw1', swap }), SWAP_PAID, false)).toThrow('swap-people');
    expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });

  it.each(['photo-refused', 'person-missing'])('reads a stop of the worker with %s, returns everything and lets its owner not continue it', async (detail) => {
    const job = await start();
    worker(job.id, 'stopped', { detail });
    expect(await read(job)).toMatchObject({ status: 'stopped', stoppedReason: 'clips-failed', stoppedDetail: detail, creditsReturned: 3 });
    expect(await balance()).toBe(19);
    await expect(data.jobs.resume(job.id, 'usr-demo', 0)).rejects.toThrow('not-resumable');
  });

  it('is refused while the switch is off: no run, no charge, no mark', async () => {
    const photo = await upload('usr-demo');
    getStore().limits.personSwap = false;
    await expect(data.swap.start('usr-demo', { templateId: 'sw1', quality: 'fast', people: [{ slot: 1, body: photo, face: null }] }, 'key-1', { credits: 3, coveredByFreeVideo: false }, consent))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
    expect(await balance()).toBe(19);
    expect(on(join(folderOf(photo), 'swap'))).toBe(false);
  });
});

describe('who may see a photograph of a person swap', () => {
  it('its uploader and the admins, nobody else', async () => {
    const [body] = photosOf(await start());
    const open = (who: string | null) => mediaFile(body!.split('/'), viewer(who)) !== null;
    expect([open('usr-demo'), open('usr-admin'), open('usr-new'), open(null)]).toEqual([true, true, false, false]);
  });

  it('the side photograph like the other two: its uploader and the admins, nobody else', async () => {
    sides = true;
    const { side } = (await start()).swap!.people[0]!;
    const open = (who: string | null) => mediaFile(side!.split('/'), viewer(who)) !== null;
    expect([open('usr-demo'), open('usr-admin'), open('usr-new'), open(null)]).toEqual([true, true, false, false]);
  });
});

describe.each(PHOTOS)('the photographs of a person swap (%s) are deleted from the disk', (_name, side) => {
  beforeEach(() => { sides = side; });

  it('24 hours after the job is done, not before', async () => {
    const job = await start();
    worker(job.id, 'done');
    const done = await read(job);
    const photos = photosOf(done);
    vi.setSystemTime(Date.parse(done.finishedAt!) + RULES.swapPhotosKeptHours * HOUR - 1);
    expect((await read(job)).swap!.people).toHaveLength(1);
    expect(photos.map(on)).toEqual(all(true));
    vi.setSystemTime(Date.parse(done.finishedAt!) + RULES.swapPhotosKeptHours * HOUR);
    expect((await read(job)).swap!.people).toEqual([]);
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));
    expect(mediaFile(photos[0]!.split('/'), viewer('usr-admin'))).toBeNull();
  });

  it('at once when its owner closes the stopped job, and by themselves 7 days after it stopped', async () => {
    const closed = await start('usr-demo', 'key-1');
    worker(closed.id, 'stopped');
    const photos = photosOf(await read(closed));
    await data.jobs.close(closed.id, 'usr-demo');
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));

    const left = await start('usr-demo', 'key-2');
    worker(left.id, 'stopped');
    const kept = photosOf(await read(left));
    vi.setSystemTime(Date.now() + RULES.swapStoppedPhotosKeptDays * DAY - 1);
    await read(left);
    expect(kept.map(on)).toEqual(all(true));
    vi.setSystemTime(Date.now() + 1);
    expect(await read(left)).toMatchObject({ status: 'closed', closedReason: 'expired', swap: { people: [] } });
    expect(kept.map((stored) => on(folderOf(stored)))).toEqual(all(false));
  });

  it('with the saved parts of a stopped job, by the engine\'s sweep 7 days after it stopped though nobody reads it: the job is closed, and nothing is returned a second time', async () => {
    const job = await start();
    const runId = worker(job.id, 'stopped');
    parts(runId);
    const stopped = await read(job);
    const photos = photosOf(stopped);
    expect(returned(job.id)).toEqual([3]);
    vi.setSystemTime(Date.parse(stopped.stoppedAt!) + RULES.swapStoppedPhotosKeptDays * DAY - 1);
    reopen();
    expect(storedJob(job.id).status).toBe('stopped');
    expect([...photos.map(on), on(join('jobs', runId, 'paid', 'v1', 'clip-p01.mp4'))]).toEqual([...all(true), true]);
    vi.setSystemTime(Date.now() + 1);
    reopen();
    expect(storedJob(job.id)).toMatchObject({
      status: 'closed', closedReason: 'expired', closedAt: new Date(Date.parse(stopped.stoppedAt!) + RULES.swapStoppedPhotosKeptDays * DAY).toISOString(), swap: { people: [] },
    });
    expect([...photos.map((stored) => on(folderOf(stored))), on(join('jobs', runId))]).toEqual([...all(false), false]);
    expect(runOf(job.id)).toMatchObject({ state: 'closed' });
    await read(job);
    reopen();
    expect(returned(job.id)).toEqual([3]);
    expect(await balance()).toBe(19);
  });

  it('at once when the admin refuses them, with everything returned and no run ever made', async () => {
    delete getStore().limits.swapReview;
    const job = await start();
    expect(job).toMatchObject({ status: 'queued', swap: { review: 'waiting' } });
    expect(runOf(job.id)).toBeUndefined();
    const photos = photosOf(job);
    expect(await reviewSwap(job.id, 'rejected')).toMatchObject({ status: 'closed', creditsReturned: 3, swap: { people: [], review: 'rejected' } });
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));
    expect(runOf(job.id)).toBeUndefined();
    expect(await balance()).toBe(19);
  });

  it('at once when the account is deleted', async () => {
    const job = await start();
    worker(job.id, 'done');
    const photos = photosOf(await read(job));
    expect(photos.map(on)).toEqual(all(true));
    await data.auth.deleteAccount('usr-demo');
    expect(getStore().jobs).toEqual([]);
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));
  });

  it('but one that another person swap still needs stays until that one lets go of it', async () => {
    const first = await start('usr-demo', 'key-1');
    const second = await start('usr-demo', 'key-2', first.swap!.people);
    worker(first.id, 'stopped');
    await read(first);
    await data.jobs.close(first.id, 'usr-demo');
    expect(photosOf(first).map(on)).toEqual(all(true));
    expect(storedJob(first.id).swap!.people).toEqual([]);
    worker(second.id, 'stopped');
    await read(second);
    await data.jobs.close(second.id, 'usr-demo');
    expect(photosOf(first).map((stored) => on(folderOf(stored)))).toEqual(all(false));
  });

  it('by the sweep when the engine opens, though nobody reads the job: what is due, and a marked folder no job names', async () => {
    const job = await start();
    worker(job.id, 'done');
    const photos = photosOf(await read(job));
    const product = await upload('usr-demo');                                // a product photograph: no mark, not the sweep's
    const orphan = '11111111-1111-4111-8111-111111111111', retired = '22222222-2222-4222-8222-222222222222';
    for (const folder of [join(dir, 'uploads', orphan), join(dir, 'retired', 'uploads', retired)]) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, '1.png'), PNG); writeFileSync(join(folder, 'swap'), '');
    }
    vi.setSystemTime(Date.now() + RULES.swapPhotosKeptHours * HOUR + 1);
    closeSqliteEngines();
    sqliteEngine(dir);
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));
    expect(storedJob(job.id).swap!.people).toEqual([]);
    expect([on(join('uploads', orphan)), on(join('retired', 'uploads', retired)), on(product)]).toEqual([false, false, true]);
  });

  it('not by the sweep of unused uploads while their job waits, to the last moment it may, for the admin\'s look (no run names them yet)', async () => {
    delete getStore().limits.swapReview;
    const people = await fresh('usr-demo');
    const unsent = await upload('usr-demo');                                 // a form that was never sent: the sweep's
    vi.setSystemTime(statSync(join(dir, people[0]!.body)).mtimeMs + 2 * DAY);    // the photographs were chosen two days before the job is started with them
    const job = await start('usr-demo', 'key-1', people);
    const photos = photosOf(job);
    vi.setSystemTime(Date.now() + RULES.swapReviewHours * HOUR - 1);
    await data.jobs.get(job.id, 'usr-demo');                                 // the store is on disk
    closeSqliteEngines();
    sqliteEngine(dir);
    expect([...photos.map(on), on(unsent)]).toEqual([...all(true), false]);
    expect(await reviewSwap(job.id, 'approved')).toMatchObject({ status: 'running' });
    expect(runOf(job.id)).toMatchObject({ state: 'held' });
  });

  it('never by a sweep of another data directory, and of a running job never', async () => {
    const job = await start();
    const photos = photosOf(job);
    vi.setSystemTime(Date.now() + 40 * DAY);
    expect(sweepSwapPhotos(join(dir, 'elsewhere'))).toBe(0);
    expect(sweepSwapPhotos()).toBe(0);
    expect(photos.map(on)).toEqual(all(true));
  });
});

describe('the video of a person swap', () => {
  it('is deleted from the disk 30 days after it was made', async () => {
    const job = await start();
    const runId = worker(job.id, 'done');
    const done = await read(job);
    expect(done).toMatchObject({ status: 'done', videoStored: true, variants: [{ status: 'done', video: `/media/jobs/${runId}/v1/final.mp4` }] });
    vi.setSystemTime(Date.parse(done.finishedAt!) + RULES.swapVideosKeptDays * DAY - 1);
    await read(job);
    expect(on(join('jobs', runId, 'v1', 'final.mp4'))).toBe(true);
    vi.setSystemTime(Date.parse(done.finishedAt!) + RULES.swapVideosKeptDays * DAY);
    expect(await read(job)).toMatchObject({ status: 'done', videoStored: false });
    expect(on(join('jobs', runId))).toBe(false);
  });

  it('is deleted by the sweep when the engine opens, though nobody reads the job', async () => {
    const job = await start();
    const runId = worker(job.id, 'done');
    await read(job);
    vi.setSystemTime(Date.now() + RULES.swapVideosKeptDays * DAY + 1);
    closeSqliteEngines();
    sqliteEngine(dir);
    expect(on(join('jobs', runId))).toBe(false);
    expect(storedJob(job.id).swapVideoGoneAt).toBe(new Date().toISOString());
  });

  it('is deleted with its parts when the engine opens only after the 30 days: nothing of it is moved aside', async () => {
    const job = await start();
    const runId = worker(job.id, 'done');
    parts(runId);
    await read(job);
    vi.setSystemTime(Date.now() + RULES.swapVideosKeptDays * DAY + 1);
    closeSqliteEngines();
    sqliteEngine(dir);
    expect([on(join('jobs', runId)), on(join('retired', 'jobs', runId))]).toEqual([false, false]);
  });

  it('that stopped and that nobody looked at for a month is deleted where it is when it closes: nothing of it was moved aside', async () => {
    const job = await start();
    const runId = worker(job.id, 'stopped');
    parts(runId);
    await read(job);
    vi.setSystemTime(Date.now() + RULES.stoppedKeptDays * DAY + 1);
    closeSqliteEngines();
    sqliteEngine(dir);
    expect([on(join('jobs', runId, 'paid', 'v1', 'clip-p01.mp4')), on(join('retired', 'jobs', runId))]).toEqual([false, false]);   // the sweep of the engine that opens closes it
    expect(await read(job)).toMatchObject({ status: 'closed', closedReason: 'expired' });
    expect([on(join('jobs', runId)), on(join('retired', 'jobs', runId))]).toEqual([false, false]);
  });
});

describe('the parts a person swap was made of (no label that an AI made them, no sound)', () => {
  it('are never served to the customer, whose video is the finished one; an admin sees them', async () => {
    const job = await start();
    const runId = worker(job.id, 'done');
    const [part] = parts(runId);
    await read(job);
    const open = (file: string, who: string | null) => mediaFile(file.split('/'), viewer(who)) !== null;
    expect([open(part!, 'usr-demo'), open(part!, 'usr-new'), open(part!, null), open(part!, 'usr-admin')]).toEqual([false, false, false, true]);
    expect(open(`jobs/${runId}/v1/final.mp4`, 'usr-demo')).toBe(true);
  });
});

describe('an account that is deleted takes the files of its person swaps with it', () => {
  /** A finished product job of `usr-demo` as the store and the engine keep it, with its video on the disk. */
  function productJob(): string {
    getStore().jobs.push(jobRecord({ id: 'job-product', userId: 'usr-demo', status: 'done', finishedAt: new Date().toISOString() }));
    db.prepare("INSERT INTO runs (id, kind, ref, state, input, created_at, updated_at) VALUES ('run-product', 'produce', 'job-product', 'done', '{}', 'a', 'a')").run();
    mkdirSync(join(dir, 'jobs', 'run-product', 'v1'), { recursive: true });
    writeFileSync(join(dir, 'jobs', 'run-product', 'v1', 'final.mp4'), 'video');
    return join('jobs', 'run-product', 'v1', 'final.mp4');
  }

  it('the video and its parts are deleted from the disk at once, and no later sweep finds anything to move aside', async () => {
    const job = await start();
    const runId = worker(job.id, 'done');
    parts(runId);
    await read(job);
    await data.auth.deleteAccount('usr-demo');
    expect(on(join('jobs', runId))).toBe(false);
    closeSqliteEngines();
    sqliteEngine(dir);
    expect(on(join('retired', 'jobs', runId))).toBe(false);
  });

  it('also what an earlier sweep had moved aside; the video of a product job is not deleted with them', async () => {
    const job = await start();
    const runId = worker(job.id, 'done');
    await read(job);
    mkdirSync(join(dir, 'retired', 'jobs', runId, 'paid', 'v1'), { recursive: true });
    writeFileSync(join(dir, 'retired', 'jobs', runId, 'paid', 'v1', 'clip-p01.mp4'), 'part');
    const product = productJob();
    await data.auth.deleteAccount('usr-demo');
    expect([on(join('jobs', runId)), on(join('retired', 'jobs', runId)), on(product)]).toEqual([false, false, true]);
  });

  it('a product job whose files are deleted leaves what an earlier sweep had moved aside of it: only a person swap takes that along', () => {
    const product = productJob();
    mkdirSync(join(dir, 'retired', 'jobs', 'run-product', 'v1'), { recursive: true });
    writeFileSync(join(dir, 'retired', 'jobs', 'run-product', 'v1', 'clip.mp4'), 'part');
    sqliteEngine(dir).deleteMedia(storedJob('job-product'));
    expect([on(product), on(join('retired', 'jobs', 'run-product', 'v1', 'clip.mp4'))]).toEqual([false, true]);
  });

  it.each(PHOTOS)('only its own: the video, the parts and the photographs (%s) of another customer\'s person swap stay where they are', async (_name, side) => {
    sides = side;
    const own = await start('usr-demo', 'key-1');
    const ownRun = worker(own.id, 'done');
    await read(own);
    const other = await start('usr-paying', 'key-2');
    const otherRun = worker(other.id, 'done');
    const [part] = parts(otherRun);
    const photos = photosOf(await read(other));
    await data.auth.deleteAccount('usr-demo');
    expect(on(join('jobs', ownRun))).toBe(false);
    expect([on(join('jobs', otherRun, 'v1', 'final.mp4')), on(part!), ...photos.map(on)]).toEqual([true, true, ...all(true)]);
    expect(await read(other)).toMatchObject({ status: 'done', videoStored: true, swap: { people: [{ slot: 1 }] } });
  });

  it('a deletion that fails half-way leaves the account, and the job whose video is gone already says so; the next try finishes', async () => {
    const first = await start('usr-demo', 'key-1');
    const firstRun = worker(first.id, 'done');
    await read(first);
    const second = await start('usr-demo', 'key-2');
    const secondRun = worker(second.id, 'done');
    await read(second);
    db.prepare("UPDATE runs SET state = 'running' WHERE id = ?").run(secondRun);   // the engine deletes no file of a run it works on
    await expect(data.auth.deleteAccount('usr-demo')).rejects.toThrow('engine-run-active');
    expect(getStore().users.some((user) => user.id === 'usr-demo')).toBe(true);
    expect([on(join('jobs', firstRun)), on(join('jobs', secondRun, 'v1', 'final.mp4'))]).toEqual([false, true]);
    expect(await read(first)).toMatchObject({ status: 'done', videoStored: false });
    expect(await read(second)).toMatchObject({ status: 'done', videoStored: true });
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(secondRun);
    await data.auth.deleteAccount('usr-demo');
    expect([getStore().users.some((user) => user.id === 'usr-demo'), getStore().jobs.length, on(join('jobs', secondRun))]).toEqual([false, 0, false]);
  });

  it('nothing while the account cannot be deleted: a job of it still runs', async () => {
    const job = await start('usr-demo', 'key-1');
    const runId = worker(job.id, 'done');
    await read(job);
    await start('usr-demo', 'key-2');
    await expect(data.auth.deleteAccount('usr-demo')).rejects.toThrow('job-running');
    expect(on(join('jobs', runId, 'v1', 'final.mp4'))).toBe(true);
  });
});

describe.each(PHOTOS)('a person swap (%s) that waits for the admin\'s look, next to the real engine', (_name, side) => {
  beforeEach(() => { sides = side; delete getStore().limits.swapReview; });                // no switch: an admin looks first

  it('given up by its owner: the photographs are deleted from the disk at once, everything comes back, no run was ever made, and the account can be deleted', async () => {
    const job = await start();
    const photos = photosOf(job);
    await expect(data.auth.deleteAccount('usr-demo')).rejects.toThrow('job-running');
    expect(await data.jobs.close(job.id, 'usr-demo')).toMatchObject({ status: 'closed', closedReason: 'customer', creditsReturned: 3, swap: { people: [] } });
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));
    expect(runOf(job.id)).toBeUndefined();
    expect(await balance()).toBe(19);
    await data.auth.deleteAccount('usr-demo');
    expect(getStore().users.some((user) => user.id === 'usr-demo')).toBe(false);
  });

  it('left for 48 hours: the photographs are deleted from the disk by the sweep though nobody reads the job, and the first read refuses it with everything returned', async () => {
    const job = await start();
    const photos = photosOf(job);
    vi.setSystemTime(Date.now() + RULES.swapReviewHours * HOUR - 1);
    closeSqliteEngines();
    sqliteEngine(dir);
    expect(photos.map(on)).toEqual(all(true));
    vi.setSystemTime(Date.now() + 1);
    closeSqliteEngines();
    sqliteEngine(dir);
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));
    expect(await reviewSwap(job.id, 'approved')).toMatchObject({ status: 'closed', closedReason: 'expired', creditsReturned: 3, swap: { people: [], review: 'rejected' } });
    expect(runOf(job.id)).toBeUndefined();
    expect(await balance()).toBe(19);
  });

  it('left for 48 hours is refused by the engine\'s sweep though nobody ever reads it: everything comes back, and a read, a late answer and the next sweep return nothing more', async () => {
    const job = await start();
    const photos = photosOf(job);
    vi.setSystemTime(Date.now() + RULES.swapReviewHours * HOUR - 1);
    reopen();
    expect(storedJob(job.id)).toMatchObject({ status: 'queued', returnedCredits: 0, swap: { review: 'waiting' } });
    vi.setSystemTime(Date.now() + 1);
    reopen();
    expect(storedJob(job.id)).toMatchObject({
      status: 'closed', closedReason: 'expired', closedAt: new Date(Date.parse(job.startedAt) + RULES.swapReviewHours * HOUR).toISOString(),
      returnedCredits: 3, swap: { people: [], review: 'rejected' },
    });
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));
    expect(returned(job.id)).toEqual([3]);
    await read(job);
    await reviewSwap(job.id, 'approved');
    reopen();
    expect(returned(job.id)).toEqual([3]);
    expect(await balance()).toBe(19);
    expect(runOf(job.id)).toBeUndefined();
  });

  it('left for 48 hours is refused by the sweep of an engine that stays open, the next time it is asked anything: no job is read', async () => {
    const job = await start();
    vi.setSystemTime(Date.now() + RULES.swapReviewHours * HOUR);
    await data.admin.health();
    expect(storedJob(job.id)).toMatchObject({ status: 'closed', closedReason: 'expired', returnedCredits: 3, swap: { people: [] } });
    expect(returned(job.id)).toEqual([3]);
  });

  it('approved, and then waiting for a place for more than 48 hours, keeps its photographs and its charge: only the wait for the look ends by itself', async () => {
    Object.assign(getStore().limits, { jobsAtOnce: 1, swapReview: false });
    await start('usr-demo', 'key-1');                                        // started with no look: it runs, and has the one place
    delete getStore().limits.swapReview;
    const job = await start('usr-demo', 'key-2');
    const photos = photosOf(job);
    expect(await reviewSwap(job.id, 'approved')).toMatchObject({ status: 'queued', swap: { review: 'approved' } });
    vi.setSystemTime(Date.now() + RULES.swapReviewHours * HOUR + 1);
    reopen();
    expect(photos.map(on)).toEqual(all(true));
    expect(await read(job)).toMatchObject({ status: 'queued', creditsReturned: 0, swap: { people: [{ slot: 1 }], review: 'approved' } });
    expect(photos.map(on)).toEqual(all(true));
  });

  it('left for 48 hours is not touched by the engine of another data directory: the jobs of the store are not its own', async () => {
    const job = await start();
    vi.setSystemTime(Date.now() + RULES.swapReviewHours * HOUR);
    const other = makeDataDir();
    try {
      sqliteEngine(other.dir);
      expect(storedJob(job.id)).toMatchObject({ status: 'queued', returnedCredits: 0, swap: { review: 'waiting' } });
    } finally {
      closeSqliteEngines(); other.db.close(); rmSync(other.dir, { recursive: true, force: true });
    }
  });

  it('left for 48 hours is returned once when the read of another job of its owner sets the sweep off on its way', async () => {
    getStore().limits.swapReview = false;
    const running = await start('usr-demo', 'key-1');                        // started with no look: it runs
    delete getStore().limits.swapReview;
    const waiting = await start('usr-demo', 'key-2');
    expect([running.status, waiting.status]).toEqual(['running', 'queued']);
    vi.setSystemTime(Date.now() + RULES.swapReviewHours * HOUR);
    await data.jobs.listFor('usr-demo');                                       // the running job asks the engine, the engine sweeps, then the read goes on to the waiting one
    expect(storedJob(waiting.id)).toMatchObject({ status: 'closed', closedReason: 'expired', returnedCredits: 3 });
    expect(returned(waiting.id)).toEqual([3]);
    expect(await balance()).toBe(16);                                        // 19 before the two, 3 for the one that runs
  });

  it('left for 48 hours does not stand in the way of deleting the account, though nobody read the job', async () => {
    const job = await start();
    const photos = photosOf(job);
    vi.setSystemTime(Date.now() + RULES.swapReviewHours * HOUR);
    await data.auth.deleteAccount('usr-demo');
    expect(getStore().users.some((user) => user.id === 'usr-demo')).toBe(false);
    expect(photos.map((stored) => on(folderOf(stored)))).toEqual(all(false));
    expect(getStore().ledger.filter((entry) => entry.type === 'returned' && entry.relatedJobId === job.id).map((entry) => entry.change)).toEqual([3]);
  });
});

describe('the files of a published person-swap video', () => {
  const open = (id: string, name: string, who: string | null) => mediaFile(['templates', id, name], viewer(who)) !== null;
  const toAll = (id: string, name: string) => [null, 'usr-demo', 'usr-admin'].map((who) => open(id, name, who));
  beforeEach(() => {
    for (const id of ['sw1', 't1']) {
      mkdirSync(join(dir, 'templates', id), { recursive: true });
      for (const name of ['poster.jpg', 'sample.mp4']) writeFileSync(join(dir, 'templates', id, name), 'bytes');
    }
  });

  it('go to everyone while person swap is switched on', () => {
    expect([toAll('sw1', 'poster.jpg'), toAll('sw1', 'sample.mp4')]).toEqual([[true, true, true], [true, true, true]]);
  });

  it.each([['off', false], ['not there (a store written before the feature)', undefined]])('go to the admins only while the switch is %s; a product template is served as ever', (_name, personSwap) => {
    if (personSwap === undefined) delete getStore().limits.personSwap; else getStore().limits.personSwap = personSwap;
    expect([toAll('sw1', 'poster.jpg'), toAll('sw1', 'sample.mp4')]).toEqual([[false, false, true], [false, false, true]]);
    expect([toAll('t1', 'poster.jpg'), toAll('t1', 'sample.mp4')]).toEqual([[true, true, true], [true, true, true]]);
  });

  it('a product template whose card says "no person swap" in so many words (swap: null) is served as ever while the switch is off', () => {
    putTemplate(db, { id: 't2', state: 'published', card: JSON.stringify({ ...card(), swap: null }) });
    mkdirSync(join(dir, 'templates', 't2'), { recursive: true });
    writeFileSync(join(dir, 'templates', 't2', 'poster.jpg'), 'bytes');
    getStore().limits.personSwap = false;
    expect(toAll('t2', 'poster.jpg')).toEqual([true, true, true]);
  });
});
