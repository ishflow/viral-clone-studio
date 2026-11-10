import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registeredVideo } from '../real/video-test-fixture';
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, resetStore } from '../mock/store';
import type { JobRecord } from '../mock/store';
import { START } from '../mock/test-helpers';
import { NotFoundError } from '../ports';
import { fakeEngine as engine } from './fake';
import { engine as pick } from './index';

const LINK = 'https://www.tiktok.com/@someone/video/1';
const ZERO = { images: 0, clips: 0, clipSeconds: 0, music: 0, voice: 0 };
const ids = (items: { id: string }[]) => items.map((item) => item.id);
const statuses = (job: JobRecord) => job.steps.map((step) => step.status);
const clips = (job: JobRecord) => job.steps.find((step) => step.key === 'clips');

/** A job record as the site hands it to the engine: its own fields filled in, the engine's still empty. */
function record(templateId: string, variants: 1 | 2 | 3 = 1): JobRecord {
  return {
    id: 'job-new', userId: 'usr-demo', templateId, templateTitle: 'A title', credits: 2,
    input: { templateId, products: [], quality: 'fast', variants, language: 'en' },
    status: 'running', steps: [], stoppedReason: null, startedAt: new Date().toISOString(), finishedAt: null, variants: [],
    resumedAt: null, pinnedElapsed: null, refundEntryId: null, clockFrom: null, variantRuns: {}, approved: null, chargeEntryId: null, sample: false,
    freeVideo: false, returnedCredits: 0, stoppedAt: null, closedAt: null, closedReason: null, deletedAt: null,
  };
}

/** A job the engine has started. */
function started(templateId: string, variants: 1 | 2 | 3 = 1): JobRecord {
  const job = record(templateId, variants);
  engine.start(job, engine.paid(templateId, variants), false);
  return job;
}

function fixtureJob(id: string): JobRecord {
  const job = getStore().jobs.find((item) => item.id === id);
  if (!job) throw new Error(`no fixture job: ${id}`);
  return job;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('which engine', () => {
  it('is the fake unless VC_ENGINE=sqlite, and the choice is made on every call', () => {
    expect(pick()).toBe(engine);
    vi.stubEnv('VC_ENGINE', 'sqlite');
    vi.stubEnv('VC_DATA_DIR', '');
    expect(() => pick()).toThrow('data-dir-required');                    // the real engine (Task 9): it needs its data directory
    vi.stubEnv('VC_ENGINE', '');
    expect(pick()).toBe(engine);
  });
});

describe('templates', () => {
  it('holds the eight templates of the fixtures; one is found by its id, an unknown id is null', () => {
    expect(ids(engine.templates())).toEqual([
      'tpl-layering', 'tpl-eye', 'tpl-story', 'tpl-stop', 'tpl-shower', 'tpl-refused', 'tpl-own-ready', 'tpl-own-failed',
    ]);
    expect(engine.template('tpl-eye')).toMatchObject({ title: 'Eye close-up with a day counter', status: 'published', preparation: null });
    expect(engine.template('tpl-missing')).toBeNull();
  });

  it('hands out copies: a caller cannot change a template through what it was given', () => {
    const [first] = engine.templates();
    const one = engine.template('tpl-layering');
    if (first) first.title = 'Changed';
    one?.shots.pop();
    expect(engine.template('tpl-layering')).toMatchObject({ title: 'Fragrance layering recipe' });
    expect(engine.template('tpl-layering')?.shots).toHaveLength(5);
  });

  it('updateTemplate saves the patch and the time of the edit, and leaves an undefined field as it is', () => {
    const shots = [{ n: 1, from: 0, to: 13, action: 'One long shot', text: 'none', product: 1 }];
    const tags = ['Presenter'];
    const saved = engine.updateTemplate('tpl-eye', { title: 'New title', category: 'Hair', products: 2, shots, tags, description: undefined });
    expect(saved).toMatchObject({ id: 'tpl-eye', title: 'New title', category: 'Hair', products: 2, shots, tags, status: 'published', editedAt: START.toISOString() });
    expect(saved.description).not.toBe('');
    tags.push('Changed afterwards');
    expect(engine.template('tpl-eye')).toEqual(saved);
    expect(engine.updateTemplate('tpl-eye', { status: 'hidden' }).status).toBe('hidden');
    expect(() => engine.updateTemplate('tpl-missing', { title: 'x' })).toThrow(NotFoundError);
  });

  it('B11: new shots make a current sample outdated; publishing with an outdated sample is refused and changes nothing', () => {
    expect(engine.template('tpl-layering')?.sample).toBe('current');
    engine.updateTemplate('tpl-layering', { shots: engine.template('tpl-layering')?.shots ?? [] });
    expect(engine.template('tpl-layering')?.sample).toBe('current'); // the same shots are no change
    engine.updateTemplate('tpl-layering', { status: 'hidden', shots: [] });
    expect(engine.template('tpl-layering')?.sample).toBe('outdated');
    expect(() => engine.updateTemplate('tpl-layering', { status: 'published', title: 'x' })).toThrow('sample-outdated');
    expect(engine.template('tpl-layering')).toMatchObject({ status: 'hidden', sample: 'outdated' });
    expect(engine.template('tpl-layering')?.title).not.toBe('x');
    expect(engine.template('tpl-own-ready')?.sample).toBe('none');
  });

  it('B6: a link with split-screen is prepared and then fails with that note', () => {
    const template = engine.addFromLink('usr-demo', 'https://www.tiktok.com/@a/video/1?split-screen');
    vi.advanceTimersByTime(20_000);
    expect(engine.template(template.id)).toMatchObject({ preparation: 'failed', preparationNote: 'split-screen' });
    expect(() => engine.addFromUpload('usr-demo', 'upload-1')).toThrow('upload-not-found');
  });

  describe('a part of a link video, as the real engine treats it', () => {
    const LONG = 'https://www.tiktok.com/@a/video/long-video';   // the fake's stand-in for a video of 150 s
    const prepared = (url: string, range?: { from: number; to: number }) => {
      const template = engine.addFromLink('usr-demo', url, range);
      vi.advanceTimersByTime(20_000);
      return engine.template(template.id);
    };
    it.each([['longer than a minute', { from: 0, to: 61 }], ['backwards', { from: 40, to: 10 }], ['shorter than 3 s', { from: 5, to: 7 }], ['not numbers', { from: Number.NaN, to: 20 }]])(
      'a range %s is refused at once as source-rejected:range, and no template is made', (_name, range) => {
        const before = engine.templates().length;
        expect(() => engine.addFromLink('usr-demo', LINK, range)).toThrow('source-rejected:range');
        expect(engine.templates()).toHaveLength(before);
      });
    it('a long video without a part is too long; with a part inside it, ready; with a part that ends after it, a bad range', () => {
      expect(prepared(LONG)).toMatchObject({ preparation: 'failed', preparationNote: 'too-long' });
      expect(prepared(LONG, { from: 30, to: 80 })).toMatchObject({ preparation: 'ready' });
      expect(prepared(LONG, { from: 120, to: 151 })).toMatchObject({ preparation: 'failed', preparationNote: 'bad-range' });
      expect(prepared(LONG, { from: 120, to: 150.4 })).toMatchObject({ preparation: 'ready' });
    });
    it('a video over 5 minutes is too long whatever the part', () => {
      expect(prepared('https://www.tiktok.com/@a/video/too-long', { from: 0, to: 30 })).toMatchObject({ preparation: 'failed', preparationNote: 'too-long' });
    });
    it('a link of unknown length without a part is prepared as before', () => {
      expect(prepared(LINK)).toMatchObject({ preparation: 'ready' });
      expect(prepared(LINK, { from: 10, to: 40 })).toMatchObject({ preparation: 'ready' });
    });
  });

  it('removeTemplate takes a template away; an unknown id is not found', () => {
    engine.removeTemplate('tpl-own-failed');
    expect(engine.template('tpl-own-failed')).toBeNull();
    expect(engine.templates()).toHaveLength(7);
    expect(() => engine.removeTemplate('tpl-own-failed')).toThrow(NotFoundError);
  });

  it('updateTemplate changes the seven fields of the patch only, whatever else it is given', () => {
    const before = engine.template('tpl-eye');
    const patch = { title: 'New title', id: 'tpl-other', ownerId: 'usr-demo', timesGenerated: 99, image: '/x.jpg', preparation: 'failed' };
    const saved = engine.updateTemplate('tpl-eye', patch as never);
    expect(saved).toEqual({ ...before, title: 'New title', editedAt: START.toISOString() });
    expect(engine.template('tpl-other')).toBeNull();
  });

  it('addFromLink makes a private template of the owner that is being prepared', () => {
    const template = engine.addFromLink('usr-demo', LINK);
    expect(template).toMatchObject({
      status: 'private', ownerId: 'usr-demo', source: 'link', video: null, timesGenerated: 0, editedAt: START.toISOString(),
      preparation: 'preparing', preparationNote: null,
    });
    expect(engine.addFromLink('usr-demo', LINK).id).not.toBe(template.id);
    expect(engine.templates()).toHaveLength(10);
  });

  it('a template that is being prepared is ready 20 s later, on any read', () => {
    const first = engine.addFromLink('usr-demo', LINK);
    const second = engine.addFromLink('usr-demo', LINK);
    vi.advanceTimersByTime(19_999);
    expect(engine.template(first.id)?.preparation).toBe('preparing');
    vi.advanceTimersByTime(1);
    expect(engine.template(first.id)).toMatchObject({ preparation: 'ready', preparationNote: null, editedAt: first.editedAt });
    expect(engine.templates().find((template) => template.id === second.id)?.preparation).toBe('ready');
    vi.advanceTimersByTime(3_600_000);
    expect(engine.template('tpl-own-failed')).toMatchObject({ preparation: 'failed', preparationNote: 'split-screen' });
  });

  it('VC_FAKE_SPEED also speeds up the preparation', () => {
    vi.stubEnv('VC_FAKE_SPEED', '20');
    const template = engine.addFromLink('usr-demo', LINK);
    vi.advanceTimersByTime(999);
    expect(engine.template(template.id)?.preparation).toBe('preparing');
    vi.advanceTimersByTime(1);
    expect(engine.template(template.id)?.preparation).toBe('ready');
  });
});

describe('what a job needs', () => {
  it('paid counts images and clips from the shot list and the variants, 4 s per clip, one music track', () => {
    expect(engine.paid('tpl-layering', 1)).toEqual({ images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 });
    expect(engine.paid('tpl-layering', 3)).toEqual({ images: 15, clips: 15, clipSeconds: 60, music: 1, voice: 0 });
    expect(() => engine.paid('tpl-missing', 1)).toThrow(NotFoundError);
  });

  it('a talking template also needs a voice per variant', () => {
    expect(engine.paid('tpl-story', 2)).toMatchObject({ clips: 10, voice: 2 });
  });

  it('minutes is 7 per variant without talking and 12 with', () => {
    expect(engine.minutes('tpl-layering', 1)).toBe(7);
    expect(engine.minutes('tpl-layering', 3)).toBe(21);
    expect(engine.minutes('tpl-story', 1)).toBe(12);
    expect(() => engine.minutes('tpl-missing', 1)).toThrow(NotFoundError);
  });
});

describe('a job over time', () => {
  it('start counts the job on its template; a sample is not counted', () => {
    const before = engine.template('tpl-layering')?.timesGenerated ?? 0;
    started('tpl-layering');
    started('tpl-layering', 3);
    expect(engine.template('tpl-layering')?.timesGenerated).toBe(before + 2);
    engine.start(record('tpl-layering'), engine.paid('tpl-layering', 1), true);
    expect(engine.template('tpl-layering')?.timesGenerated).toBe(before + 2);
    expect('countGenerated' in engine).toBe(false);
  });

  it('start of a job on an unknown template is refused and writes nothing into the record', () => {
    const job = record('tpl-missing');
    expect(() => engine.start(job, ZERO, false)).toThrow(NotFoundError);
    expect(job.steps).toEqual([]);
  });

  it('committed has nothing to release: the fake has no worker', () => {
    const job = started('tpl-layering');
    const before = structuredClone({ job, templates: engine.templates() });
    expect(engine.committed()).toBeUndefined();
    expect({ job, templates: engine.templates() }).toEqual(before);
  });

  it('start writes the six steps, all waiting, with one image and one clip per shot and variant', () => {
    const job = started('tpl-layering', 2);
    expect(job.steps).toEqual([
      { key: 'adaptation', status: 'waiting', done: 0, total: 1 }, { key: 'images', status: 'waiting', done: 0, total: 10 },
      { key: 'clips', status: 'waiting', done: 0, total: 10 }, { key: 'music', status: 'waiting', done: 0, total: 1 },
      { key: 'edit', status: 'waiting', done: 0, total: 1 }, { key: 'render', status: 'waiting', done: 0, total: 1 },
    ]);
    expect(job.status).toBe('running');
  });

  it('refresh brings the steps up to the current time; music is made before the clips', () => {
    const job = started('tpl-layering');
    expect(statuses(engine.refresh(job))).toEqual(['running', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
    vi.advanceTimersByTime(13_000);
    expect(statuses(engine.refresh(job))).toEqual(['done', 'done', 'waiting', 'running', 'waiting', 'waiting']);
    vi.advanceTimersByTime(12_000);
    expect(clips(engine.refresh(job))).toEqual({ key: 'clips', status: 'running', done: 3, total: 5 });
    expect(job).toMatchObject({ status: 'running', finishedAt: null, variants: [{ id: 'job-new-v1', status: 'generating', video: null, reason: null }] });
  });

  it('B2: the variants are made one after the other: waiting, generating, done', () => {
    const job = started('tpl-layering', 2);
    expect(job.variants.map((variant) => variant.status)).toEqual(['generating', 'waiting']);
    vi.advanceTimersByTime(20_000);
    expect(engine.refresh(job).variants.map((variant) => variant.status)).toEqual(['done', 'generating']);
    expect(job.variants[0]).toMatchObject({ video: '/samples/layering.mp4' });
  });

  it('a job is done after 40 s: every step done, the finish time is when the work ended, one variant per asked variant', () => {
    const job = started('tpl-layering', 2);
    vi.advanceTimersByTime(39_999);
    expect(engine.refresh(job).status).toBe('running');
    vi.advanceTimersByTime(600_000);
    expect(engine.refresh(job)).toBe(job);
    expect(job).toMatchObject({ status: 'done', stoppedReason: null, finishedAt: '2026-10-04T12:00:40.000Z' });
    expect(job.steps.every((step) => step.status === 'done' && step.done === step.total)).toBe(true);
    expect(job.variants).toEqual([
      { id: 'job-new-v1', image: '/samples/f20a7ed7a7bc172a7da483415800077f.jpg', video: '/samples/layering.mp4', status: 'done', reason: null },
      { id: 'job-new-v2', image: '/samples/f20a7ed7a7bc172a7da483415800077f.jpg', video: '/samples/layering.mp4', status: 'done', reason: null },
    ]);
  });

  it('VC_FAKE_SPEED multiplies the speed', () => {
    vi.stubEnv('VC_FAKE_SPEED', '20');
    const job = started('tpl-layering');
    vi.advanceTimersByTime(1_999);
    expect(engine.refresh(job).status).toBe('running');
    vi.advanceTimersByTime(1);
    expect(engine.refresh(job)).toMatchObject({ status: 'done', finishedAt: '2026-10-04T12:00:02.000Z' });
  });

  it('a job on the stop template stops at the clips step when 3 of 5 clips are ready, with the reason as a code', () => {
    const job = started('tpl-stop');
    vi.advanceTimersByTime(24_399);
    expect(clips(engine.refresh(job))).toEqual({ key: 'clips', status: 'running', done: 2, total: 5 });
    vi.advanceTimersByTime(1);
    engine.refresh(job);
    expect(job).toMatchObject({ status: 'stopped', stoppedReason: 'clips-failed', finishedAt: null });
    expect(job.variants).toEqual([{ id: 'job-new-v1', image: '', video: null, status: 'stopped', reason: 'clips-failed' }]);
    expect(statuses(job)).toEqual(['done', 'done', 'stopped', 'done', 'waiting', 'waiting']);
    expect(clips(job)).toEqual({ key: 'clips', status: 'stopped', done: 3, total: 5 });
  });

  it('B2: a job on the stop template with 3 variants delivers two and ends done with the last one stopped', () => {
    const job = started('tpl-stop', 3);
    vi.advanceTimersByTime(60_000);
    engine.refresh(job);
    expect(job).toMatchObject({ status: 'done', stoppedReason: null });
    expect(job.variants.map((variant) => [variant.status, variant.reason])).toEqual([['done', null], ['done', null], ['stopped', 'clips-failed']]);
    expect(engine.missing(job)).toEqual(ZERO);
  });

  it('B2: regenerateVariant runs a stopped variant again for one job time; it is done after that and does not stop again', () => {
    const job = started('tpl-stop', 2);
    vi.advanceTimersByTime(60_000);
    engine.refresh(job);
    engine.regenerateVariant(job, 'job-new-v2', engine.paid('tpl-stop', 1));
    expect(job.variants.map((variant) => variant.status)).toEqual(['done', 'generating']);
    vi.advanceTimersByTime(39_999);
    expect(engine.refresh(job).variants[1]?.status).toBe('generating');
    vi.advanceTimersByTime(1);
    expect(engine.refresh(job).variants[1]).toMatchObject({ status: 'done', video: engine.template('tpl-stop')?.video ?? null });
    expect(job.status).toBe('done');
    expect(() => engine.regenerateVariant(job, 'job-new-v9', engine.paid('tpl-stop', 1))).toThrow(NotFoundError);
  });

  it('B12: a job whose product text holds the content-rule mark stops at the adaptation with content-rule', () => {
    const job = record('tpl-layering');
    job.input.products = [{ name: 'Oil content-rule-test', description: '', images: [] }];
    engine.start(job, engine.paid('tpl-layering', 1), false);
    vi.advanceTimersByTime(2_000);
    engine.refresh(job);
    expect(job).toMatchObject({ status: 'stopped', stoppedReason: 'content-rule' });
    expect(statuses(job)[0]).toBe('stopped');
  });

  it('a sample that is done makes the sample of its template current', () => {
    engine.updateTemplate('tpl-layering', { shots: [] });
    expect(engine.template('tpl-layering')?.sample).toBe('outdated');
    const job = record('tpl-layering');
    job.sample = true;
    engine.start(job, engine.paid('tpl-layering', 1), true);
    vi.advanceTimersByTime(40_000);
    engine.refresh(job);
    expect(engine.template('tpl-layering')?.sample).toBe('current');
  });

  it('close and deleteMedia change nothing in the fake', () => {
    const job = structuredClone(fixtureJob('job-demo-stopped'));
    engine.close(job);
    engine.deleteMedia(job);
    expect(job).toEqual(fixtureJob('job-demo-stopped'));
  });

  it('refresh leaves a job that is done or stopped as it is', () => {
    const done = structuredClone(fixtureJob('job-demo-story'));
    const stopped = structuredClone(fixtureJob('job-demo-stopped'));
    vi.advanceTimersByTime(3_600_000);
    expect(engine.refresh(fixtureJob('job-demo-story'))).toEqual(done);
    expect(engine.refresh(fixtureJob('job-demo-stopped'))).toEqual(stopped);
  });

  it('the running job of the fixtures is frozen at clips 3 of 5, so the state can always be shown', () => {
    vi.advanceTimersByTime(3_600_000);
    const job = engine.refresh(fixtureJob('job-demo-running'));
    expect(job.status).toBe('running');
    expect(statuses(job)).toEqual(['done', 'done', 'running', 'done', 'waiting', 'waiting']);
    expect(clips(job)).toEqual({ key: 'clips', status: 'running', done: 3, total: 5 });
  });
});

describe('a stopped job', () => {
  it('missing is nothing for a job that is not stopped', () => {
    expect(engine.missing(started('tpl-layering'))).toEqual(ZERO);
    expect(engine.missing(fixtureJob('job-demo-story'))).toEqual(ZERO);
  });

  it('missing is the clips that never came: 2 of 5, 4 s each', () => {
    expect(engine.missing(fixtureJob('job-demo-stopped'))).toEqual({ images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 });
    const one = started('tpl-stop', 1);
    vi.advanceTimersByTime(60_000);
    expect(engine.missing(engine.refresh(one))).toEqual({ images: 0, clips: 2, clipSeconds: 8, music: 0, voice: 0 });
  });

  it('resume goes on from the stopped step, does not stop again, and the job is done 15.6 s later', () => {
    const job = started('tpl-stop');
    vi.advanceTimersByTime(60_000);
    engine.refresh(job);
    engine.resume(job, engine.missing(job));
    expect(job).toMatchObject({ status: 'running', stoppedReason: null });
    expect(statuses(job)).toEqual(['done', 'done', 'running', 'done', 'waiting', 'waiting']);
    expect(clips(job)).toEqual({ key: 'clips', status: 'running', done: 3, total: 5 });
    expect(engine.missing(job)).toEqual(ZERO);
    vi.advanceTimersByTime(15_599);
    expect(engine.refresh(job).status).toBe('running');
    vi.advanceTimersByTime(1);
    expect(engine.refresh(job)).toMatchObject({ status: 'done', finishedAt: '2026-10-04T12:01:15.600Z' });
    expect(job.variants).toHaveLength(1);
  });
});

describe('candidates', () => {
  it('holds 5 candidates and hands out copies', () => {
    const candidates = engine.candidates();
    expect(ids(candidates)).toEqual(['cand-1', 'cand-2', 'cand-3', 'cand-4', 'cand-5']);
    if (candidates[0]) candidates[0].title = 'Changed';
    expect(engine.candidates()[0]?.title).toBe('Story told in on-screen text');
  });

  it('a candidate carries the notes of its score, and a copy of them', () => {
    const [first] = engine.candidates();
    expect(first?.scoreNotes?.length).toBeGreaterThan(0);
    first?.scoreNotes?.push('Changed');
    expect(engine.candidates()[0]?.scoreNotes).not.toContain('Changed');
  });

  it('prepareCandidate turns a candidate into a template that waits to be published, once', () => {
    const template = engine.prepareCandidate('cand-1');
    expect(template).toMatchObject({
      title: 'Story told in on-screen text', seconds: 16, referenceViews: '27.2M', source: 'topads', status: 'waiting', ownerId: null,
      timesGenerated: 0, editedAt: START.toISOString(), preparation: null, preparationNote: null,
    });
    expect(template.shots).toHaveLength(5);
    expect(ids(engine.candidates())).toEqual(['cand-2', 'cand-3', 'cand-4', 'cand-5']);
    expect(engine.template(template.id)).toEqual(template);
    expect(() => engine.prepareCandidate('cand-1')).toThrow(NotFoundError);
    expect(engine.templates().filter((item) => item.status === 'waiting')).toHaveLength(1);
  });

  it('rejectCandidate removes the candidate and makes no template; an unknown id is not found', () => {
    engine.rejectCandidate('cand-2');
    expect(ids(engine.candidates())).toEqual(['cand-1', 'cand-3', 'cand-4', 'cand-5']);
    expect(() => engine.rejectCandidate('cand-2')).toThrow(NotFoundError);
    expect(engine.templates()).toHaveLength(8);
  });
});

describe('scans', () => {
  it('holds 3 scans, newest first, without the clock of the fake', () => {
    const scans = engine.scans();
    expect(scans.map((scan) => [scan.id, scan.status, scan.reason])).toEqual([
      ['scan-3', 'running', null], ['scan-2', 'stopped', 'source-unavailable'], ['scan-1', 'done', null],
    ]);
    expect(scans.map((scan) => scan.queued)).toEqual([6, 0, 15]);
    expect(Object.keys(scans[0] ?? {}).sort()).toEqual(['aboveThreshold', 'checked', 'id', 'prepared', 'queued', 'reason', 'source', 'startedAt', 'status']);
  });

  it('the running scan of the fixtures is frozen until runScan starts its clock; it is done 30 s later', () => {
    vi.advanceTimersByTime(3_600_000);
    expect(engine.scans()[0]).toMatchObject({ id: 'scan-3', status: 'running' });
    expect(engine.runScan()).toMatchObject({ id: 'scan-3', status: 'running' });
    vi.advanceTimersByTime(29_999);
    expect(engine.scans()[0]?.status).toBe('running');
    vi.advanceTimersByTime(1);
    expect(engine.scans().find((scan) => scan.id === 'scan-3')).toMatchObject({ status: 'done', reason: null, checked: 6 });
  });

  it('with no scan running, runScan adds a Top Ads scan; a second call returns that one and does not move its end', () => {
    engine.runScan();
    vi.advanceTimersByTime(30_000);
    const next = engine.runScan();
    expect(next).toEqual({
      id: next.id, startedAt: '2026-10-04T12:00:30.000Z', source: 'topads', checked: 0, queued: 0, aboveThreshold: 0, prepared: 0, status: 'running', reason: null,
    });
    expect(engine.scans()).toHaveLength(4);
    vi.advanceTimersByTime(20_000);
    expect(engine.runScan()).toEqual(next);
    vi.advanceTimersByTime(10_000);
    expect(engine.scans()[0]).toMatchObject({ id: next.id, status: 'done' });
  });

  it('VC_FAKE_SPEED shortens the scan', () => {
    vi.stubEnv('VC_FAKE_SPEED', '20');
    engine.runScan();
    vi.advanceTimersByTime(1_499);
    expect(engine.scans()[0]?.status).toBe('running');
    vi.advanceTimersByTime(1);
    expect(engine.scans()[0]?.status).toBe('done');
  });
});

describe('settings', () => {
  it('start from the defaults of the spec; saveSettings merges a patch and ignores a field that is undefined', () => {
    const before = engine.settings();
    expect(before).toMatchObject({ scanTimes: ['09:00', '15:00', '21:00'], threshold: 70, dailyCandidates: 45, dailyTemplates: 10 });
    const saved = engine.saveSettings({ threshold: 80, scanTimes: ['08:00'], dailyCandidates: undefined });
    expect(saved).toEqual({ ...before, threshold: 80, scanTimes: ['08:00'] });
    expect(engine.settings()).toEqual(saved);
  });

  it('saveSettings keeps the fields of the settings only, whatever else it is given', () => {
    const before = engine.settings();
    const saved = engine.saveSettings({ threshold: 80, admin: true, keys: ['x'] } as never);
    expect(saved).toEqual({ ...before, threshold: 80 });
    expect(Object.keys(engine.settings()).sort()).toEqual(Object.keys(before).sort());
  });

  it('keeps the settings of the scan sources and limits, and hands out copies', () => {
    const searches = ['lash serum'];
    const saved = engine.saveSettings({
      sources: { topads: true, shorts: false }, searches, secondsMin: 8, secondsMax: 30, shortsMinViews: 1_000_000, topAdsCards: 20, perScan: 10,
    });
    expect(saved).toMatchObject({
      sources: { topads: true, shorts: false }, searches: ['lash serum'], secondsMin: 8, secondsMax: 30, shortsMinViews: 1_000_000, topAdsCards: 20, perScan: 10,
    });
    searches.push('changed afterwards');
    saved.scanTimes.push('23:59');
    expect(engine.settings()).toMatchObject({ searches: ['lash serum'], scanTimes: ['09:00', '15:00', '21:00'] });
  });
});

describe('health', () => {
  it('the fake has no worker to lose: it is running, seen now, with the fake provider', () => {
    expect(engine.health()).toEqual({ worker: 'running', lastSeen: START.toISOString(), provider: 'fake', swap: 'fake' });
  });
});

it('fake upload preparation enforces the same registry and owner admission', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-fake-video-'));
  vi.stubEnv('VC_DATA_DIR', dir);
  const id = registeredVideo(dir, 'usr-demo', 8, 'ürün-denemesi.mp4');
  expect(() => engine.addFromUpload('usr-paying', id)).toThrow('upload-not-found');
  const made = engine.addFromUpload('usr-demo', id);
  expect(made).toMatchObject({ title: 'ürün-denemesi.mp4', status: 'private', ownerId: 'usr-demo', preparation: 'preparing', sample: 'none' });
  vi.advanceTimersByTime(20_000);
  expect(engine.template(made.id)?.title).toBe('ürün-denemesi.mp4');
});
