// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { progress } from '../engine/fake';
import { data } from '../index';
import type { Job } from '../ports';
import { getStore, resetStore } from './store';
import { START, generateInput as input, storedJob, startConfirmed } from './test-helpers';

const statuses = (job: Job | null) => Object.fromEntries((job?.steps ?? []).map((step) => [step.key, step.status]));
const step = (job: Job | null, key: string) => job?.steps.find((item) => item.key === key);
const emails = async (kind: string) => (await data.mailer.outbox()).filter((email) => email.kind === kind);
const after = (milliseconds: number) => new Date(START.getTime() + milliseconds);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('a job over time', () => {
  it('with vi.useFakeTimers() a job is done after 40 s with all steps done and variants.length === input.variants', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-layering', { variants: 2 }), 'key-1');
    vi.advanceTimersByTime(39_000);
    expect((await data.jobs.get(job.id, 'usr-demo'))?.status).toBe('running');
    vi.advanceTimersByTime(1_000);
    const done = await data.jobs.get(job.id, 'usr-demo');
    expect(done?.status).toBe('done');
    expect(done?.steps.map((item) => item.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(done?.steps.every((item) => item.done === item.total)).toBe(true);
    expect(done?.variants).toHaveLength(2);
    expect(done?.variants[0]).toMatchObject({ image: '/samples/f20a7ed7a7bc172a7da483415800077f.jpg', video: '/samples/layering.mp4' });
    expect(done?.finishedAt).toBe('2026-10-04T12:00:40.000Z');
  });

  it('the finish time is when the work ended, not when somebody looked', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    vi.advanceTimersByTime(600_000);
    expect((await data.jobs.get(job.id, 'usr-demo'))?.finishedAt).toBe('2026-10-04T12:00:40.000Z');
  });

  it('VC_FAKE_SPEED multiplies the speed', async () => {
    vi.stubEnv('VC_FAKE_SPEED', '20');
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    vi.advanceTimersByTime(1_900);
    expect((await data.jobs.get(job.id, 'usr-demo'))?.status).toBe('running');
    vi.advanceTimersByTime(100);
    expect(await data.jobs.get(job.id, 'usr-demo')).toMatchObject({ status: 'done', finishedAt: '2026-10-04T12:00:02.000Z' });
  });

  it('sends one ready email when the job finishes, however often it is read', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    vi.advanceTimersByTime(40_000);
    await data.jobs.get(job.id, 'usr-demo');
    await data.jobs.listFor('usr-demo');
    await data.jobs.get(job.id, 'usr-demo');
    expect(await emails('ready')).toMatchObject([{ to: 'demo@viralclone.app', data: { jobId: job.id, templateTitle: 'Fragrance layering recipe' } }]);
  });

  it('the running job of the fixtures stays running, so the state can always be shown', async () => {
    vi.advanceTimersByTime(3_600_000);
    const job = await data.jobs.get('job-demo-running', 'usr-demo');
    expect(job?.status).toBe('running');
    expect(step(job, 'clips')).toEqual({ key: 'clips', status: 'running', done: 3, total: 5 });
    expect(step(job, 'music')?.status).toBe('done');
  });
});

describe('progress()', () => {
  it('maps elapsed seconds to step states', async () => {
    const { id } = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    const at = (seconds: number) => progress(storedJob(id), after(seconds * 1000));
    expect(at(0)[0]).toEqual({ key: 'adaptation', status: 'running', done: 0, total: 1 });
    expect(at(8)[1]).toEqual({ key: 'images', status: 'running', done: 2, total: 5 });
    expect(at(13).map((item) => item.status)).toEqual(['done', 'done', 'waiting', 'running', 'waiting', 'waiting']);
    expect(at(25).map((item) => item.status)).toEqual(['done', 'done', 'running', 'done', 'waiting', 'waiting']);
    expect(at(25)[2]).toEqual({ key: 'clips', status: 'running', done: 3, total: 5 });
    expect(at(36).map((item) => item.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'running']);
  });

  it.each([
    [3_999, { adaptation: 'running', images: 'waiting', clips: 'waiting', music: 'waiting', edit: 'waiting', render: 'waiting' }],
    [4_000, { adaptation: 'done', images: 'running', clips: 'waiting', music: 'waiting', edit: 'waiting', render: 'waiting' }],
    [11_999, { adaptation: 'done', images: 'running', clips: 'waiting', music: 'waiting', edit: 'waiting', render: 'waiting' }],
    [12_000, { adaptation: 'done', images: 'done', clips: 'waiting', music: 'running', edit: 'waiting', render: 'waiting' }],
    [16_000, { adaptation: 'done', images: 'done', clips: 'running', music: 'done', edit: 'waiting', render: 'waiting' }],
    [29_999, { adaptation: 'done', images: 'done', clips: 'running', music: 'done', edit: 'waiting', render: 'waiting' }],
    [30_000, { adaptation: 'done', images: 'done', clips: 'done', music: 'done', edit: 'running', render: 'waiting' }],
    [34_000, { adaptation: 'done', images: 'done', clips: 'done', music: 'done', edit: 'done', render: 'running' }],
    [39_999, { adaptation: 'done', images: 'done', clips: 'done', music: 'done', edit: 'done', render: 'running' }],
    [40_000, { adaptation: 'done', images: 'done', clips: 'done', music: 'done', edit: 'done', render: 'done' }],
  ])('at the step boundary %i ms', async (milliseconds, expected) => {
    const { id } = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    const steps = progress(storedJob(id), after(milliseconds));
    expect(Object.fromEntries(steps.map((item) => [item.key, item.status]))).toEqual(expected);
  });

  it('counts the items of a step from 0 at its start to all of them at its end', async () => {
    const { id } = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    const clips = (milliseconds: number) => progress(storedJob(id), after(milliseconds)).find((item) => item.key === 'clips');
    expect(clips(16_000)).toEqual({ key: 'clips', status: 'running', done: 0, total: 5 });
    expect(clips(29_999)).toEqual({ key: 'clips', status: 'running', done: 4, total: 5 });
    expect(clips(30_000)).toEqual({ key: 'clips', status: 'done', done: 5, total: 5 });
  });

  it('does not change the job it is given', async () => {
    const { id } = await startConfirmed('usr-demo', input('tpl-layering'), 'key-1');
    const copy = structuredClone(storedJob(id));
    progress(storedJob(id), after(40_000));
    expect(storedJob(id)).toEqual(copy);
  });

  it('keeps the frozen job of the fixtures at clips 3 of 5, whatever the time', () => {
    for (const milliseconds of [0, 40_000, 3_600_000]) {
      const steps = progress(storedJob('job-demo-running'), after(milliseconds));
      expect(steps.map((item) => item.status)).toEqual(['done', 'done', 'running', 'done', 'waiting', 'waiting']);
      expect(steps[2]).toEqual({ key: 'clips', status: 'running', done: 3, total: 5 });
    }
  });

  it('the steps written in the fixtures are the steps progress() gives for that state', () => {
    for (const job of getStore().jobs) {
      if (job.status !== 'running') expect(progress(job, after(3_600_000))).toEqual(job.steps);
    }
  });
});

describe('a job on the stop template', () => {
  it('a job on tpl-stop is stopped at step clips with a reason', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-stop'), 'key-1');
    vi.advanceTimersByTime(24_000);
    expect((await data.jobs.get(job.id, 'usr-demo'))?.status).toBe('running');
    vi.advanceTimersByTime(16_000);
    const stopped = await data.jobs.get(job.id, 'usr-demo');
    expect(stopped?.status).toBe('stopped');
    expect(stopped?.stoppedReason).toBe('clips-failed');
    expect(step(stopped, 'clips')).toEqual({ key: 'clips', status: 'stopped', done: 3, total: 5 });
    expect(statuses(stopped)).toEqual({ adaptation: 'done', images: 'done', clips: 'stopped', music: 'done', edit: 'waiting', render: 'waiting' });
    expect(stopped?.finishedAt).toBeNull();
    expect(stopped?.variants.map((variant) => [variant.status, variant.video])).toEqual([['stopped', null]]);
  });

  it('stops at the moment 3 of 5 clips are ready: 24.4 s', async () => {
    const { id } = await startConfirmed('usr-demo', input('tpl-stop'), 'key-1');
    const clips = (milliseconds: number) => progress(storedJob(id), after(milliseconds)).find((item) => item.key === 'clips');
    expect(clips(24_399)).toEqual({ key: 'clips', status: 'running', done: 2, total: 5 });
    expect(clips(24_400)).toEqual({ key: 'clips', status: 'stopped', done: 3, total: 5 });
    expect(clips(3_600_000)).toEqual({ key: 'clips', status: 'stopped', done: 3, total: 5 });
  });

  it('stays stopped and sends one stopped email, with the reason as a code', async () => {
    const job = await startConfirmed('usr-demo', input('tpl-stop'), 'key-1');
    vi.advanceTimersByTime(600_000);
    await data.jobs.get(job.id, 'usr-demo');
    vi.advanceTimersByTime(600_000);
    expect((await data.jobs.get(job.id, 'usr-demo'))?.status).toBe('stopped');
    expect(await emails('stopped')).toMatchObject([
      { to: 'demo@viralclone.app', data: { jobId: job.id, templateTitle: 'Dupe comparison', reason: 'clips-failed' } },
    ]);
    expect(await emails('ready')).toEqual([]);
  });
});
