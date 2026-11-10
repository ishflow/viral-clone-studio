import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registeredVideo } from '../real/video-test-fixture';
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { DailyLimitError, GenerationPausedError, InsufficientCreditsError, PriceChangedError, UploadRejectedError } from '../ports';
import { fakeEngine } from '../engine/fake';
import { uploads } from './uploads';
import { getStore, resetStore } from './store';
import { START, generateInput as input, startConfirmed, storedJob } from './test-helpers';

// The flow contract's job, catalog and limits rules in the fake (task D0): B2, B3, B6, B7, B8, B10, B13, B18, B20, B21.
const DAY_MS = 86_400_000;
const ADMIN = 'usr-admin';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('B2: variants', () => {
  it('a job that delivers 1 of 2 variants ends done; the stopped one returns its share and can be generated again', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-stop', { variants: 2 }), 'two');
    expect(await data.ledger.balance('usr-demo')).toBe(15);
    vi.advanceTimersByTime(60_000);
    const done = await data.jobs.get(job.id, 'usr-demo');
    expect(done).toMatchObject({ status: 'done', credits: 4, creditsReturned: 2 });
    expect(done?.variants.map((variant) => variant.status)).toEqual(['done', 'stopped']);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    const variantId = `${job.id}-v2`;
    expect(await data.jobs.variantCost(job.id, 'usr-demo', variantId)).toBe(2);
    await expect(data.jobs.regenerateVariant(job.id, 'usr-demo', variantId, 1)).rejects.toThrow(PriceChangedError);
    const again = await data.jobs.regenerateVariant(job.id, 'usr-demo', variantId, 2);
    expect(again).toMatchObject({ status: 'done', creditsReturned: 0 });
    expect(again.variants[1]?.status).toBe('generating');
    await data.jobs.regenerateVariant(job.id, 'usr-demo', variantId, 2); // a double click charges once
    expect(await data.ledger.balance('usr-demo')).toBe(15);
    vi.advanceTimersByTime(40_000);
    expect((await data.jobs.get(job.id, 'usr-demo'))?.variants.map((variant) => variant.status)).toEqual(['done', 'done']);
  });

  it('a regeneration that stops gives its price back at once (B1); the variant is stopped again and can be generated again', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-stop', { variants: 2 }), 'two');
    vi.advanceTimersByTime(60_000);
    await data.jobs.get(job.id, 'usr-demo');
    const variantId = `${job.id}-v2`;
    await data.jobs.regenerateVariant(job.id, 'usr-demo', variantId, 2);
    expect(await data.ledger.balance('usr-demo')).toBe(15);
    // The real engine can stop a regeneration (the fake never does): the engine puts the variant back to stopped.
    vi.spyOn(fakeEngine, 'refresh').mockImplementation((record) => {
      record.variants = record.variants.map((variant) => (variant.status === 'generating' ? { ...variant, status: 'stopped', reason: 'clips-failed' } : variant));
      return record;
    });
    const after = await data.jobs.get(job.id, 'usr-demo');
    expect(after).toMatchObject({ status: 'done', creditsReturned: 2 });
    expect(after?.variants.map((variant) => [variant.status, variant.reason])).toEqual([['done', null], ['stopped', 'clips-failed']]);
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    await data.jobs.get(job.id, 'usr-demo');
    expect(await data.ledger.balance('usr-demo')).toBe(17);                 // once
    expect(await data.jobs.variantCost(job.id, 'usr-demo', variantId)).toBe(2);
  });

  it('after 30 days the product images are gone: the variant cannot be generated again (B13, K25)', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-stop', { variants: 2 }), 'two');
    vi.advanceTimersByTime(60_000);
    vi.setSystemTime(new Date(Date.parse((await data.jobs.get(job.id, 'usr-demo'))?.finishedAt ?? '') + 30 * DAY_MS));
    expect(await data.jobs.get(job.id, 'usr-demo')).toMatchObject({ imagesStored: false, videoStored: true });
    await expect(data.jobs.variantCost(job.id, 'usr-demo', `${job.id}-v2`)).rejects.toThrow('images-expired');
  });
});

describe('B3 + B10: the queue, jobs at once and the pause', () => {
  it('with 2 jobs running the next one is charged and queued, and starts when a slot is free', async () => {
    await startConfirmed('usr-demo', input('tpl-layering'), 'a'); // the fixture job runs too: 2 running
    const queued = await startConfirmed('usr-demo', input('tpl-eye'), 'b');
    const second = await startConfirmed('usr-demo', input('tpl-eye'), 'c');
    expect(queued).toMatchObject({ status: 'queued', queuePosition: 1, credits: 2 });
    expect(second).toMatchObject({ status: 'queued', queuePosition: 2 });
    expect(await data.ledger.balance('usr-demo')).toBe(13);
    // nothing has run: the six stages wait (the board shows them; the engine rewrites them when the job starts)
    expect(queued.steps.map((step) => [step.key, step.status, step.done])).toEqual(
      ['adaptation', 'images', 'clips', 'music', 'edit', 'render'].map((key) => [key, 'waiting', 0]),
    );
    expect(storedJob(queued.id).steps).toHaveLength(6);
    vi.advanceTimersByTime(40_000);
    expect(await data.jobs.get(queued.id, 'usr-demo')).toMatchObject({ status: 'running', queuePosition: null });
    expect(await data.jobs.get(second.id, 'usr-demo')).toMatchObject({ status: 'queued', queuePosition: 1 });
    vi.advanceTimersByTime(40_000);
    expect(await data.jobs.get(queued.id, 'usr-demo')).toMatchObject({ status: 'done' });
  });

  it('a pause refuses new estimates, starts and resumes; queued jobs wait and say so', async () => {
    await startConfirmed('usr-demo', input('tpl-layering'), 'a');
    const queued = await startConfirmed('usr-demo', input('tpl-eye'), 'b');
    await data.admin.saveLimits(ADMIN, { generationPaused: true });
    await expect(data.jobs.estimate('usr-demo', input('tpl-eye'))).rejects.toThrow(GenerationPausedError);
    await expect(data.jobs.start('usr-demo', input('tpl-eye'), 'c', { credits: 2, coveredByFreeVideo: false })).rejects.toThrow(GenerationPausedError);
    await expect(data.jobs.resume('job-demo-stopped', 'usr-demo', 5)).rejects.toThrow(GenerationPausedError);
    vi.advanceTimersByTime(40_000);
    expect(await data.jobs.get(queued.id, 'usr-demo')).toMatchObject({ status: 'queued', paused: true });
    await data.admin.saveLimits(ADMIN, { generationPaused: false });
    expect(await data.jobs.get(queued.id, 'usr-demo')).toMatchObject({ status: 'running', paused: false });
  });

  it('a running job that takes twice its estimate says delayed', async () => {
    expect(await data.jobs.get('job-demo-running', 'usr-demo')).toMatchObject({ delayed: false });
    vi.advanceTimersByTime(15 * 60_000);
    expect(await data.jobs.get('job-demo-running', 'usr-demo')).toMatchObject({ status: 'running', delayed: true });
  });

  it('the limits: admin only, validated, applied at once; talking templates are listed only while switched on', async () => {
    await expect(data.admin.saveLimits('usr-demo', { jobsAtOnce: 3 })).rejects.toThrow('forbidden');
    await expect(data.admin.saveLimits(ADMIN, { warnAtPercent: 101 })).rejects.toThrow('invalid-limit');
    await expect(data.admin.saveLimits(ADMIN, { jobsAtOnce: 0 })).rejects.toThrow('invalid-limit');
    expect((await data.catalog.list({})).some((template) => template.format === 'talking')).toBe(true);
    expect(await data.admin.saveLimits(ADMIN, { showTalkingTemplates: false, dailySpendingLimit: 500 })).toMatchObject({ showTalkingTemplates: false, dailySpendingLimit: 500 });
    expect((await data.catalog.list({})).some((template) => template.format === 'talking')).toBe(false);
    await data.admin.saveLimits(ADMIN, { freeFirstVideo: false });
    expect(await data.auth.verifyEmail('usr-unverified')).toMatchObject({ emailVerified: true, freeVideoAvailable: false });
  });
});

describe('B13, B18, B20, B21', () => {
  it('a video is kept 12 months after it was finished', async () => {
    const job = await data.jobs.get('job-demo-shower', 'usr-demo');
    expect(job).toMatchObject({ videoStored: true });
    vi.setSystemTime(new Date(job?.videoExpiresAt ?? ''));
    expect(await data.jobs.get('job-demo-shower', 'usr-demo')).toMatchObject({ videoStored: false });
  });

  it('deleteVideo: a delivered job leaves the customer\'s lists, stays for the admin, and its credits do not come back', async () => {
    await data.jobs.deleteVideo('job-demo-shower', 'usr-demo');
    expect(await data.jobs.get('job-demo-shower', 'usr-demo')).toBeNull();
    expect((await data.jobs.listFor('usr-demo')).map((job) => job.id)).not.toContain('job-demo-shower');
    expect((await data.admin.jobs({})).find((job) => job.id === 'job-demo-shower')?.deletedAt).toBe(START.toISOString());
    expect(await data.ledger.balance('usr-demo')).toBe(19);
    await expect(data.jobs.deleteVideo('job-demo-running', 'usr-demo')).rejects.toThrow('not-deletable');
    await expect(data.jobs.deleteVideo('job-demo-stopped', 'usr-demo')).rejects.toThrow('not-deletable');
    await expect(data.jobs.deleteVideo('job-demo-shower', 'usr-demo')).rejects.toThrow('not-found');
  });

  it('findByKey answers whether a start with this key made a job', async () => {
    expect(await data.jobs.findByKey('usr-demo', 'lost')).toBeNull();
    const job = await startConfirmed('usr-demo', input('tpl-eye'), 'lost');
    expect((await data.jobs.findByKey('usr-demo', 'lost'))?.id).toBe(job.id);
    expect(await data.jobs.findByKey('usr-paying', 'lost')).toBeNull();
  });

  it('usage has the approved paid requests of a job, and no cost yet', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'u');
    expect((await data.admin.usage('today')).find((row) => row.jobId === job.id)).toEqual({
      jobId: job.id, at: START.toISOString(), templateId: 'tpl-layering', paid: { images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 }, costCents: null,
    });
  });
});

describe('B6: own videos', () => {
  const link = (url: string) => ({ kind: 'link' as const, url });
  const file = (over: Partial<{ name: string; type: string; bytes: number; seconds: number | null; width: number | null; height: number | null }> = {}) =>
    ({ kind: 'file' as const, uploadId: 'up-1', name: 'clip.mp4', type: 'video/mp4', bytes: 1_000, seconds: 12, width: 1080, height: 1920, ...over });

  it('checkSource refuses before anything is charged, with the reason', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-file-'));
    vi.stubEnv('VC_DATA_DIR', dir);
    const uploadId = registeredVideo(dir, 'usr-demo', 12);
    const check = (source: Parameters<typeof data.catalog.checkSource>[1]) => data.catalog.checkSource('usr-demo', source);
    const admitted = (over: Parameters<typeof file>[0] = {}) => ({ ...file(over), uploadId });
    expect(await check(link('https://www.instagram.com/reel/abc'))).toEqual({ ok: true, seconds: null, format: null, shots: null });
    expect(await check(link('https://vimeo.com/1'))).toEqual({ ok: false, reason: 'unsupported-site' });
    expect(await check(link('not a link'))).toEqual({ ok: false, reason: 'link-not-found' });
    expect(await check(link('https://www.tiktok.com/@a/video/private'))).toEqual({ ok: false, reason: 'private' });
    expect(await check(file({ name: 'clip.avi', type: 'video/x-msvideo' }))).toEqual({ ok: false, reason: 'type' });
    expect(await check(file({ bytes: 101 * 1024 * 1024 }))).toEqual({ ok: false, reason: 'size' });
    expect(await check(admitted({ seconds: 61, width: 1920, height: 1080 }))).toEqual({ ok: true, seconds: 12, format: null, shots: null });
    expect(await check(file({ bytes: 0 }))).toEqual({ ok: false, reason: 'unreadable' });
    expect(await check(file())).toEqual({ ok: false, reason: 'unreadable' });
    expect(await check(admitted())).toEqual({ ok: true, seconds: 12, format: null, shots: null });
  });

  it('prepareOwn charges 1 credit once per key; a template that cannot be prepared gives it back', async () => {
    const first = await data.catalog.prepareOwn('usr-demo', link('https://www.tiktok.com/@a/video/1'), 1, 'own-1');
    expect(first).toMatchObject({ status: 'private', ownerId: 'usr-demo', preparation: 'preparing' });
    expect(await data.catalog.prepareOwn('usr-demo', link('https://www.tiktok.com/@a/video/1'), 1, 'own-1')).toEqual(first);
    expect(await data.ledger.balance('usr-demo')).toBe(18);
    const split = await data.catalog.prepareOwn('usr-demo', link('https://www.tiktok.com/@a/video/split-screen'), 1, 'own-2');
    expect(await data.ledger.balance('usr-demo')).toBe(17);
    vi.advanceTimersByTime(20_000);
    expect(await data.catalog.get(split.id, 'usr-demo')).toMatchObject({ preparation: 'failed', preparationNote: 'split-screen' });
    expect((await data.ledger.entries('usr-demo'))[0]).toMatchObject({ type: 'returned', change: 1, by: { kind: 'system' } });
    expect(await data.ledger.balance('usr-demo')).toBe(18);
    await data.catalog.get(split.id, 'usr-demo');
    expect(await data.ledger.balance('usr-demo')).toBe(18); // once
  });

  it('keeps a preparing own charge and refunds failed preparation before deleting its evidence, once', async () => {
    const initial = await data.ledger.balance('usr-demo');
    const made = await data.catalog.prepareOwn('usr-demo', link('https://www.tiktok.com/@a/video/split-screen'), 1, 'remove-failed');
    await expect(data.catalog.remove(made.id, 'usr-new')).rejects.toThrow('template');
    await expect(data.catalog.remove(made.id, 'usr-demo')).rejects.toThrow('template-in-use');
    expect(await data.ledger.balance('usr-demo')).toBe(initial - 1);
    vi.advanceTimersByTime(20_000);
    await data.catalog.remove(made.id, 'usr-demo');
    expect(fakeEngine.template(made.id)).toBeNull();
    expect(await data.ledger.balance('usr-demo')).toBe(initial);
    await expect(data.catalog.remove(made.id, 'usr-demo')).rejects.toThrow('template');
    await data.catalog.list({ viewerId: 'usr-demo' });
    expect(getStore().ownTemplates.filter(record => record.returnedEntryId)).toHaveLength(1);
  });

  it('refuses a rejected source, a changed price, too few credits, the daily limit and a pause, charging nothing', async () => {
    const ok = link('https://youtu.be/abc');
    await expect(data.catalog.prepareOwn('usr-demo', link('https://vimeo.com/1'), 1, 'k0')).rejects.toThrow('source-rejected:unsupported-site');
    await expect(data.catalog.prepareOwn('usr-demo', ok, 2, 'k1')).rejects.toThrow(PriceChangedError);
    await expect(data.catalog.prepareOwn('usr-new', ok, 1, 'k1')).rejects.toThrow(InsufficientCreditsError);
    for (const key of ['a', 'b', 'c']) await data.catalog.prepareOwn('usr-demo', ok, 1, key);
    expect(await data.catalog.ownVideoAllowance('usr-demo')).toEqual({ used: 3, limit: 3, left: 0 });
    await expect(data.catalog.prepareOwn('usr-demo', ok, 1, 'd')).rejects.toThrow(DailyLimitError);
    vi.setSystemTime(new Date(START.getTime() + DAY_MS));
    await data.admin.saveLimits(ADMIN, { generationPaused: true });
    await expect(data.catalog.prepareOwn('usr-demo', ok, 1, 'e')).rejects.toThrow(GenerationPausedError);
    expect(await data.ledger.balance('usr-demo')).toBe(16);
  });
});

describe('B7 + B8: uploads and drafts', () => {
  it('a product photo is JPG, PNG or WebP, at most 10 MB, not empty', async () => {
    const photo = (name: string, type: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type });
    expect(await uploads.save('usr-demo', photo('a.png', 'image/png', 10))).toBe('a.png');
    await expect(uploads.save('usr-demo', photo('a.heic', 'image/heic', 10))).rejects.toMatchObject({ reason: 'type' });
    await expect(uploads.save('usr-demo', photo('a.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1))).rejects.toThrow(UploadRejectedError);
    await expect(uploads.save('usr-demo', photo('a.webp', 'image/webp', 0))).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it('a draft is kept 24 hours per template, and a job started from that template uses it up', async () => {
    const draft = await data.drafts.save('usr-demo', input('tpl-eye'));
    expect(draft).toMatchObject({ templateId: 'tpl-eye', savedAt: START.toISOString(), expiresAt: new Date(START.getTime() + DAY_MS).toISOString() });
    expect(await data.drafts.get('usr-demo', 'tpl-eye')).toEqual(draft);
    await startConfirmed('usr-demo', input('tpl-eye'), 'from-draft');
    expect(await data.drafts.get('usr-demo', 'tpl-eye')).toBeNull();
    await data.drafts.save('usr-demo', input('tpl-layering'));
    vi.advanceTimersByTime(DAY_MS);
    expect(await data.drafts.get('usr-demo', 'tpl-layering')).toBeNull();
    expect(getStore().drafts).toEqual([]);
  });
});

it('an admitted file prepares once per key and a foreign upload never charges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-file-flow-'));
  vi.stubEnv('VC_DATA_DIR', dir);
  const uploadId = registeredVideo(dir, 'usr-demo');
  const source = { kind: 'file' as const, uploadId, name: 'video.mp4', type: 'video/mp4', bytes: 1000, seconds: 8, width: 90, height: 160 };
  const before = await data.ledger.balance('usr-demo');
  const first = await data.catalog.prepareOwn('usr-demo', source, 1, 'file-key');
  expect(await data.catalog.prepareOwn('usr-demo', source, 1, 'file-key')).toEqual(first);
  expect(await data.ledger.balance('usr-demo')).toBe(before - 1);
  await expect(data.catalog.prepareOwn('usr-paying', source, 1, 'foreign')).rejects.toThrow('source-rejected:unreadable');
});
