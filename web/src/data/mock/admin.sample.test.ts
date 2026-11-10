// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../engine/fake';
import { data } from '../index';
import { NotFoundError, PaidChangedError, SampleRunningError } from '../ports';
import { getStore, resetStore } from './store';
import { START, generateInput as input, startConfirmed, storedJob } from './test-helpers';

const PAID = { images: 5, clips: 5, clipSeconds: 20, music: 1, voice: 0 };
const PRODUCTS = [1, 2, 3, 4, 5].map((n) => ({ name: `Serum ${n}`, description: '', images: [`uploads/sample/${n}.jpg`] }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sampleCost', () => {
  it('is the paid requests of one variant of the template', async () => {
    expect(await data.admin.sampleCost('tpl-layering')).toEqual(PAID);
    expect(await data.admin.sampleCost('tpl-story')).toEqual({ ...PAID, voice: 1 });
  });

  it('an unknown template is not found', async () => {
    await expect(data.admin.sampleCost('tpl-missing')).rejects.toThrow(NotFoundError);
  });
});

describe('generateSample', () => {
  it('starts a job of the admin with 0 credits and writes no ledger entry', async () => {
    const ledger = getStore().ledger.length;
    const job = await data.admin.generateSample('tpl-eye', 'usr-admin', PAID, PRODUCTS);
    expect(job).toMatchObject({
      userId: 'usr-admin', templateId: 'tpl-eye', templateTitle: 'Eye close-up with a day counter', credits: 0, status: 'running',
      startedAt: START.toISOString(), input: { templateId: 'tpl-eye', products: PRODUCTS, variants: 1 },
    });
    expect(job.steps.find((step) => step.key === 'clips')).toEqual({ key: 'clips', status: 'waiting', done: 0, total: 5 });
    expect(getStore().ledger).toHaveLength(ledger);
    expect(await data.ledger.balance('usr-admin')).toBe(0);
    expect((await data.auth.getUser('usr-admin'))?.freeVideoAvailable).toBe(true);
  });

  it('the sample is a job like any other: the admin sees it in the list and it is done after the fake time', async () => {
    const job = await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS);
    expect((await data.admin.jobs({}))[0]?.id).toBe(job.id);
    expect((await data.jobs.get(job.id, 'usr-admin'))?.status).toBe('running');
    vi.advanceTimersByTime(40_000);
    expect(await data.jobs.get(job.id, 'usr-admin')).toMatchObject({ status: 'done', finishedAt: '2026-10-04T12:00:40.000Z' });
  });

  it('tells the engine it is a sample, with the paid requests that were confirmed; a customer\'s job is not a sample', async () => {
    const start = vi.spyOn(fakeEngine, 'start');
    const sample = await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS);
    expect(start).toHaveBeenLastCalledWith(storedJob(sample.id), PAID, true);
    const job = await startConfirmed('usr-demo', input('tpl-layering', { variants: 2 }), 'key-1');
    expect(start).toHaveBeenLastCalledWith(storedJob(job.id), { ...PAID, images: 10, clips: 10, clipSeconds: 40 }, false);
  });

  it('a finished sample sends no "ready" email; a customer\'s finished job still does', async () => {
    const sample = await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS);
    const job = await startConfirmed('usr-demo', input('tpl-layering', { variants: 1 }), 'key-ready');
    vi.advanceTimersByTime(120_000);
    expect((await data.jobs.get(sample.id, 'usr-admin'))?.status).toBe('done');
    expect((await data.jobs.get(job.id, 'usr-demo'))?.status).toBe('done');
    const ready = (await data.mailer.outbox()).filter((email) => email.kind === 'ready');
    expect(ready.map((email) => email.data.jobId)).toEqual([job.id]);
  });

  it('is not a customer\'s generation: the count on the template stays', async () => {
    const before = (await data.admin.template('tpl-layering'))?.timesGenerated;
    await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS);
    expect((await data.admin.template('tpl-layering'))?.timesGenerated).toBe(before);
  });

  it('takes the admin\'s products into the job, and starts nothing without the products the template needs', async () => {
    const job = await data.admin.generateSample('tpl-eye', 'usr-admin', PAID, PRODUCTS);
    expect(job.input.products).toEqual(PRODUCTS);
  });

  it('too few products, a nameless one or one without a photo: Error(sample-products), nothing starts', async () => {
    const jobs = getStore().jobs.length;
    for (const products of [[], [{ name: ' ', description: '', images: ['uploads/sample/1.jpg'] }], [{ name: 'Serum', description: '', images: [] }]]) {
      await expect(data.admin.generateSample('tpl-eye', 'usr-admin', PAID, products)).rejects.toThrow('sample-products');
    }
    expect(getStore().jobs.length).toBe(jobs);
  });

  it('works on a template that waits to be published', async () => {
    const waiting = await data.admin.prepareCandidate('cand-1');
    const job = await data.admin.generateSample(waiting.id, 'usr-admin', await data.admin.sampleCost(waiting.id), PRODUCTS);
    expect(job).toMatchObject({ templateId: waiting.id, status: 'running', credits: 0 });
  });

  it('the paid requests changed after the dialog opened (a shot was removed): PaidChangedError with the ones of now, nothing starts', async () => {
    const confirmed = await data.admin.sampleCost('tpl-eye');
    const template = await data.admin.template('tpl-eye');
    await data.admin.updateTemplate('tpl-eye', { shots: template?.shots.slice(0, 4) });
    const refused = data.admin.generateSample('tpl-eye', 'usr-admin', confirmed, PRODUCTS);
    await expect(refused).rejects.toThrow(PaidChangedError);
    await expect(refused).rejects.toMatchObject({ paid: { images: 4, clips: 4, clipSeconds: 16, music: 1, voice: 0 } });
    expect(await data.admin.jobs({})).toHaveLength(10);
  });

  it('only an admin, only a template that exists and is ready', async () => {
    await expect(data.admin.generateSample('tpl-eye', 'usr-demo', PAID, PRODUCTS)).rejects.toThrow('forbidden');
    await expect(data.admin.generateSample('tpl-eye', 'nobody', PAID, PRODUCTS)).rejects.toThrow('forbidden');
    await expect(data.admin.generateSample('tpl-missing', 'usr-admin', PAID, PRODUCTS)).rejects.toThrow(NotFoundError);
    await expect(data.admin.generateSample('tpl-own-failed', 'usr-admin', PAID, PRODUCTS)).rejects.toThrow('template-not-ready');
    expect(await data.admin.jobs({})).toHaveLength(10);
  });
});

describe('one sample at a time per template (S11 review I1)', () => {
  it('a second generateSample while one runs is refused with the running job, and nothing new starts', async () => {
    const first = await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS);
    const jobsBefore = getStore().jobs.length;
    const refused = await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SampleRunningError);
    expect(refused).toMatchObject({ message: 'sample-running', jobId: first.id });
    expect(getStore().jobs).toHaveLength(jobsBefore);
  });

  it('runningSamples maps each template to its running sample job; a finished sample frees the template', async () => {
    expect(await data.admin.runningSamples()).toEqual({});
    const first = await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS);
    expect(await data.admin.runningSamples()).toEqual({ 'tpl-layering': first.id });
    vi.advanceTimersByTime(40_000);
    expect(await data.admin.runningSamples()).toEqual({});
    const second = await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS);
    expect(second.id).not.toBe(first.id);
  });

  it('the fake engine refuses a second sample run of the same template too', async () => {
    const first = await data.admin.generateSample('tpl-layering', 'usr-admin', PAID, PRODUCTS);
    const twin = { ...storedJob(first.id), id: 'job-twin', steps: [], variants: [] };
    expect(() => fakeEngine.start(twin, PAID, true)).toThrow('sample-running');
    const other = { ...twin, templateId: 'tpl-eye', input: { ...twin.input, templateId: 'tpl-eye' } };
    expect(() => fakeEngine.start(other, fakeEngine.paid('tpl-eye', 1), true)).not.toThrow();
  });
});

describe('health', () => {
  it('says what the engine says: the fake is running, with the fake provider', async () => {
    expect(await data.admin.health()).toEqual({ worker: 'running', lastSeen: START.toISOString(), provider: 'fake', swap: 'fake' });
  });
});
