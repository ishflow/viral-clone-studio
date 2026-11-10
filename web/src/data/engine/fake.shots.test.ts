// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { getStore, resetStore } from '../mock/store';
import type { JobRecord } from '../mock/store';
import { START, generateInput, startConfirmed, storedJob } from '../mock/test-helpers';
import { fakeEngine as engine } from './fake';

// The shots of a running job in the fake: the pictures and clips the steps say are made, in order. The fake makes no files: the
// picture of a shot is the sample picture of the template.

const SAMPLE = '/samples/f20a7ed7a7bc172a7da483415800077f.jpg';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); resetStore(); });
afterEach(() => { vi.useRealTimers(); });

/** Lets the fake clock run, a second at a time, until `ready` says so (or 60 s have passed). */
function until(job: JobRecord, ready: (job: JobRecord) => boolean): JobRecord {
  for (let seconds = 0; seconds < 60 && !ready(engine.refresh(job)); seconds++) vi.advanceTimersByTime(1_000);
  return job;
}
const made = (job: JobRecord, key: 'images' | 'clips') => job.steps.find((step) => step.key === key)?.done ?? 0;

/** A job record as the site hands it to the engine, its own fields filled in, the engine's still empty; then started. */
function started(templateId: string, variants: 1 | 2 | 3 = 1): JobRecord {
  const job: JobRecord = {
    id: 'job-new', userId: 'usr-demo', templateId, templateTitle: 'A title', credits: 2,
    input: { templateId, products: [], quality: 'fast', variants, language: 'en' },
    status: 'running', steps: [], stoppedReason: null, startedAt: new Date().toISOString(), finishedAt: null, variants: [],
    resumedAt: null, pinnedElapsed: null, refundEntryId: null, clockFrom: null, variantRuns: {}, approved: null, chargeEntryId: null, sample: false,
    freeVideo: false, returnedCredits: 0, stoppedAt: null, closedAt: null, closedReason: null, deletedAt: null,
  };
  engine.start(job, engine.paid(templateId, variants), false);
  return job;
}

describe('the shots of a job in the fake', () => {
  it('a job that has made nothing lists no shot', () => {
    expect(engine.refresh(started('tpl-layering')).shots).toEqual([]);
  });

  it('the pictures come first, then the clips: a shot shows the picture, and says its clip when that is made', () => {
    const job = until(started('tpl-layering'), (item) => made(item, 'images') >= 1 && made(item, 'clips') === 0);
    expect(made(job, 'clips')).toBe(0);
    expect(job.shots?.[0]).toEqual({ variant: 1, n: 1, image: SAMPLE, clip: false, clipUrl: null });
    until(job, (item) => made(item, 'clips') >= 1);
    expect(job.shots?.[0]).toEqual({ variant: 1, n: 1, image: SAMPLE, clip: true, clipUrl: '/samples/layering.mp4' });
    expect(job.shots).toHaveLength(Math.max(made(job, 'images'), made(job, 'clips')));
  });

  it('a clip is the sample video of the template (the fake makes no file); a template without one has a clip with no file to play', () => {
    const job = until(started('tpl-stop'), (item) => made(item, 'clips') >= 1);
    expect(job.shots?.[0]).toMatchObject({ clip: true, clipUrl: getStore().templates.find((item) => item.id === 'tpl-stop')!.video });
  });

  it('the music is there once its step is done, and it is a sound the browser plays; nothing is shared', () => {
    const job = until(started('tpl-layering'), (item) => made(item, 'images') >= 1);
    expect(job.made).toEqual({ music: [], shared: [] });
    until(job, (item) => item.steps.find((step) => step.key === 'music')?.status === 'done');
    expect(job.made?.shared).toEqual([]);
    expect(job.made?.music).toHaveLength(1);
    const url = job.made!.music[0]!.url;
    expect(url).toMatch(/^data:audio\/wav;base64,/);
    const bytes = Uint8Array.from(atob(url.split(',')[1]!), (letter) => letter.charCodeAt(0));
    expect([bytes.length, new DataView(bytes.buffer).getUint32(4, true), new DataView(bytes.buffer).getUint32(40, true)]).toEqual([844, 836, 800]);   // a WAV whose sizes are its own
  });

  it('the shots of the second variant are numbered again from 1', () => {
    const job = until(started('tpl-layering', 2), (item) => made(item, 'images') === item.steps.find((step) => step.key === 'images')!.total);
    const total = job.steps.find((step) => step.key === 'images')!.total;
    expect(job.shots).toHaveLength(total);
    expect(job.shots?.filter((shot) => shot.variant === 2).map((shot) => shot.n)).toEqual(Array.from({ length: total / 2 }, (_, index) => index + 1));
  });
});

describe('what the page is given of the shots', () => {
  it('the frames are given while the job\'s pictures are kept, and not after: a shot then shows its number, a made clip stays made but has no file to open; nor has the music', async () => {
    const job = await startConfirmed('usr-demo', generateInput('tpl-layering'), 'key-1');
    const record = storedJob(job.id);
    Object.assign(record, { status: 'done', finishedAt: START.toISOString(), shots: [{ variant: 1, n: 1, image: SAMPLE, clip: true, clipUrl: '/media/jobs/r/paid/v1/clip-s1.mp4' }], made: { music: [{ variant: 1, url: '/media/jobs/r/paid/v1/music.mp3' }], shared: [] } });
    expect((await data.jobs.get(job.id, 'usr-demo'))).toMatchObject({ shots: [{ variant: 1, n: 1, image: SAMPLE, clip: true, clipUrl: '/media/jobs/r/paid/v1/clip-s1.mp4' }], made: { music: [{ variant: 1, url: '/media/jobs/r/paid/v1/music.mp3' }], shared: [] } });
    record.finishedAt = new Date(START.getTime() - 40 * 86_400_000).toISOString();
    expect((await data.jobs.get(job.id, 'usr-demo'))).toMatchObject({ shots: [{ variant: 1, n: 1, image: null, clip: true, clipUrl: null }], made: { music: [], shared: [] } });
  });

  it('a job whose engine tells nothing of its shots has none in the page\'s data', async () => {
    const job = await startConfirmed('usr-demo', generateInput('tpl-layering'), 'key-2');
    const record = storedJob(job.id);
    Object.assign(record, { status: 'done', finishedAt: START.toISOString() });
    delete record.shots;
    expect(await data.jobs.get(job.id, 'usr-demo')).not.toHaveProperty('shots');
  });
});
