// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError } from '../ports';
import { getStore, resetStore } from './store';
import { startConfirmed } from './test-helpers';

const ids = (items: { id: string }[]) => items.map((item) => item.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('jobs', () => {
  it('lists every job, newest first, by status and search', async () => {
    const all = await data.admin.jobs({});
    expect(all).toHaveLength(10);
    expect(all[0]?.id).toBe('job-demo-running');
    expect(ids(await data.admin.jobs({ status: 'stopped' }))).toEqual(['job-demo-stopped']);
    expect(ids(await data.admin.jobs({ status: 'running' }))).toEqual(['job-demo-running']);
    expect(await data.admin.jobs({ status: 'done' })).toHaveLength(8);
    expect(ids(await data.admin.jobs({ search: 'DUPE' }))).toEqual(['job-demo-stopped']);
    expect(await data.admin.jobs({ search: 'paying@example.com' })).toHaveLength(3);
    expect(await data.admin.jobs({ search: 'paying@example.com', status: 'stopped' })).toEqual([]);
  });

  it('shows the progress of a job as it is now', async () => {
    const input = { templateId: 'tpl-layering', products: [], quality: 'fast' as const, variants: 1 as const, language: 'en' };
    const job = await startConfirmed('usr-demo', input, 'key-1');
    vi.advanceTimersByTime(40_000);
    expect((await data.admin.jobs({})).find((item) => item.id === job.id)?.status).toBe('done');
  });

  it('retryJob restarts a stopped job from the stopped step and charges nothing', async () => {
    const before = getStore().ledger.length;
    const job = await data.admin.retryJob('job-demo-stopped');
    expect(job).toMatchObject({ id: 'job-demo-stopped', status: 'running', stoppedReason: null, credits: 5 });
    expect(job.steps.find((step) => step.key === 'clips')).toEqual({ key: 'clips', status: 'running', done: 3, total: 5 });
    expect(getStore().ledger).toHaveLength(before);
    vi.advanceTimersByTime(16_000);
    expect((await data.jobs.get('job-demo-stopped', 'usr-demo'))?.status).toBe('done');
    await expect(data.admin.retryJob('job-missing')).rejects.toThrow(NotFoundError);
  });

  it('refundJob gives the credits of the job back, once', async () => {
    const first = await data.admin.refundJob('job-demo-stopped');
    const second = await data.admin.refundJob('job-demo-stopped');
    expect(first).toMatchObject({ userId: 'usr-demo', type: 'returned', change: 5, note: 'Dupe comparison', relatedJobId: 'job-demo-stopped' }); // the entry of the stop (B1)
    expect(second).toEqual(first);
    expect(await data.ledger.balance('usr-demo')).toBe(19);
  });

  it('refundJob of a free video or an unknown job throws and writes nothing', async () => {
    const before = getStore().ledger.length;
    await expect(data.admin.refundJob('job-demo-free')).rejects.toThrow('nothing-to-refund');
    await expect(data.admin.refundJob('job-missing')).rejects.toThrow(NotFoundError);
    expect(getStore().ledger).toHaveLength(before);
  });
});

describe('templates', () => {
  it('lists every template, whatever its status, by status and search', async () => {
    const mine = await data.catalog.addFromLink('usr-demo', 'https://www.tiktok.com/@someone/video/1');
    await data.admin.updateTemplate('tpl-eye', { status: 'hidden' });
    expect(await data.admin.templates({})).toHaveLength(9);
    expect(ids(await data.admin.templates({ status: 'hidden' }))).toEqual(['tpl-eye']);
    expect(ids(await data.admin.templates({ status: 'private' }))).toEqual(['tpl-own-ready', 'tpl-own-failed', mine.id]);
    expect(await data.admin.templates({ status: 'published' })).toHaveLength(5);
    expect(ids(await data.admin.templates({ search: 'lashes' }))).toEqual(['tpl-eye', 'tpl-story']);
    expect((await data.admin.template(mine.id))?.ownerId).toBe('usr-demo');
    expect(await data.admin.template('tpl-missing')).toBeNull();
  });

  it('updateTemplate saves the patch and the time of the edit', async () => {
    const shots = [{ n: 1, from: 0, to: 13, action: 'One long shot', text: 'none', product: 1 }];
    const template = await data.admin.updateTemplate('tpl-eye', { title: 'New title', category: 'Hair', products: 2, shots });
    expect(template).toMatchObject({ id: 'tpl-eye', title: 'New title', category: 'Hair', products: 2, shots, status: 'published', editedAt: '2026-10-04T12:00:00.000Z' });
    expect(await data.catalog.get('tpl-eye', 'usr-admin')).toEqual(template);   // the admin's own view: the source video stays in it
    await expect(data.admin.updateTemplate('tpl-missing', { title: 'x' })).rejects.toThrow(NotFoundError);
  });

  it('updateTemplate can change the description and the tags, and leaves an undefined field as it is', async () => {
    const before = await data.admin.template('tpl-eye');
    const tags = ['Presenter'];
    const template = await data.admin.updateTemplate('tpl-eye', { description: 'A new description.', tags });
    expect(template).toMatchObject({ description: 'A new description.', tags: ['Presenter'], title: before?.title });
    tags.push('Changed afterwards');
    expect((await data.catalog.get('tpl-eye'))?.tags).toEqual(['Presenter']);

    const untouched = await data.admin.updateTemplate('tpl-eye', { description: undefined, tags: undefined, title: 'Only the title' });
    expect(untouched).toMatchObject({ description: 'A new description.', tags: ['Presenter'], title: 'Only the title' });
  });

  it('the count of generated videos on a template matches the jobs of the fixtures', async () => {
    const jobs = await data.admin.jobs({});
    for (const template of await data.admin.templates({})) {
      expect(template.timesGenerated).toBe(jobs.filter((job) => job.templateId === template.id).length);
    }
  });
});

describe('candidates', () => {
  it('holds 5 candidates with a sample image', async () => {
    const candidates = await data.admin.candidates();
    expect(ids(candidates)).toEqual(['cand-1', 'cand-2', 'cand-3', 'cand-4', 'cand-5']);
    expect(candidates.every((candidate) => candidate.image.startsWith('/samples/'))).toBe(true);
  });

  it('every candidate carries the notes of its score; every scan says what it sent on to scoring', async () => {
    const candidates = await data.admin.candidates();
    expect(candidates.every((candidate) => (candidate.scoreNotes ?? []).length > 0)).toBe(true);
    expect((await data.admin.scans()).map((scan) => [scan.id, scan.queued])).toEqual([['scan-3', 6], ['scan-2', 0], ['scan-1', 15]]);
  });

  it('prepareCandidate turns a candidate into a template that waits to be published', async () => {
    const template = await data.admin.prepareCandidate('cand-1');
    expect(template).toMatchObject({
      title: 'Story told in on-screen text', seconds: 16, referenceViews: '27.2M', source: 'topads',
      image: '/samples/46a25bbd04d2da54503c58bfbd05efee.jpg', video: null, status: 'waiting', ownerId: null, timesGenerated: 0,
      editedAt: '2026-10-04T12:00:00.000Z', preparation: null, preparationNote: null, description: '', tags: [],
    });
    expect(template.shots).toHaveLength(5);
    expect(template.shots[4]?.to).toBe(16);
    expect(ids(await data.admin.candidates())).toEqual(['cand-2', 'cand-3', 'cand-4', 'cand-5']);
    expect(ids(await data.admin.templates({ status: 'waiting' }))).toEqual([template.id]);
    expect(await data.catalog.get(template.id)).toBeNull();
  });

  it('prepareCandidate twice makes one template: the second call does not find the candidate', async () => {
    await data.admin.prepareCandidate('cand-1');
    await expect(data.admin.prepareCandidate('cand-1')).rejects.toThrow(NotFoundError);
    await expect(data.admin.prepareCandidate('cand-missing')).rejects.toThrow(NotFoundError);
    expect(await data.admin.templates({ status: 'waiting' })).toHaveLength(1);
  });

  it('rejectCandidate removes the candidate; an unknown id is not found', async () => {
    await expect(data.admin.rejectCandidate('cand-2')).resolves.toBeUndefined();
    expect(ids(await data.admin.candidates())).toEqual(['cand-1', 'cand-3', 'cand-4', 'cand-5']);
    await expect(data.admin.rejectCandidate('cand-2')).rejects.toThrow(NotFoundError);
    await expect(data.admin.rejectCandidate('cand-missing')).rejects.toThrow(NotFoundError);
    expect(await data.admin.templates({})).toHaveLength(8);
  });
});

describe('scans', () => {
  it('holds 3 scans, newest first; a stopped scan carries its reason as a code', async () => {
    const scans = await data.admin.scans();
    expect(scans.map((scan) => [scan.status, scan.reason])).toEqual([['running', null], ['stopped', 'source-unavailable'], ['done', null]]);
    expect(scans.map((scan) => scan.startedAt)).toEqual(scans.map((scan) => scan.startedAt).sort().reverse());
  });

  it('runScan returns the scan that is already running: one running scan at a time', async () => {
    const scan = await data.admin.runScan();
    expect(scan).toMatchObject({ id: 'scan-3', status: 'running' });
    expect(await data.admin.scans()).toHaveLength(3);
  });

  it('runScan adds a running Top Ads scan when none is running; a second call returns the same one', async () => {
    const running = getStore().scans.find((scan) => scan.status === 'running');
    if (running) running.status = 'done';

    const first = await data.admin.runScan();
    const second = await data.admin.runScan();
    expect(first).toEqual({
      id: first.id, startedAt: '2026-10-04T12:00:00.000Z', source: 'topads', checked: 0, queued: 0, aboveThreshold: 0, prepared: 0, status: 'running', reason: null,
    });
    expect(second).toEqual(first);
    const scans = await data.admin.scans();
    expect(scans).toHaveLength(4);
    expect(scans[0]).toEqual(first);
  });
});

describe('a scan finishes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('the running scan of the fixtures is frozen: it stays running however long nobody presses "Run a scan now"', async () => {
    vi.advanceTimersByTime(3_600_000);
    expect((await data.admin.scans())[0]).toMatchObject({ id: 'scan-3', status: 'running' });
  });

  it('"Run a scan now" starts the clock of the running scan: it is done after the fake duration, with no extra field for the caller', async () => {
    const pressed = await data.admin.runScan();
    expect(pressed).toMatchObject({ id: 'scan-3', status: 'running' });
    expect(Object.keys(pressed).sort()).toEqual(['aboveThreshold', 'checked', 'id', 'prepared', 'queued', 'reason', 'source', 'startedAt', 'status']);
    vi.advanceTimersByTime(29_999);
    expect((await data.admin.scans()).find((scan) => scan.id === 'scan-3')?.status).toBe('running');
    vi.advanceTimersByTime(1);
    const finished = (await data.admin.scans()).find((scan) => scan.id === 'scan-3');
    expect(finished).toMatchObject({ status: 'done', reason: null, checked: 6, aboveThreshold: 1 });
    expect((await data.admin.scans()).some((scan) => scan.status === 'running')).toBe(false);
  });

  it('once it is done, the next "Run a scan now" starts a new scan, which finishes too', async () => {
    await data.admin.runScan();
    vi.advanceTimersByTime(30_000);
    const next = await data.admin.runScan();
    expect(next.id).not.toBe('scan-3');
    expect(next).toMatchObject({ source: 'topads', status: 'running', startedAt: '2026-10-04T12:00:30.000Z' });
    expect(await data.admin.scans()).toHaveLength(4);
    // A second press while it runs does not push the end further away.
    vi.advanceTimersByTime(20_000);
    expect((await data.admin.runScan()).id).toBe(next.id);
    vi.advanceTimersByTime(10_000);
    expect((await data.admin.scans())[0]).toMatchObject({ id: next.id, status: 'done' });
  });

  it('VC_FAKE_SPEED shortens the scan as it shortens a job', async () => {
    vi.stubEnv('VC_FAKE_SPEED', '20');
    await data.admin.runScan();
    vi.advanceTimersByTime(1_499);
    expect((await data.admin.scans())[0]?.status).toBe('running');
    vi.advanceTimersByTime(1);
    expect((await data.admin.scans())[0]?.status).toBe('done');
  });
});

describe('settings', () => {
  it('settings start from the defaults of the spec and saveSettings merges a patch', async () => {
    expect(await data.admin.settings()).toMatchObject({ scanTimes: ['09:00', '15:00', '21:00'], threshold: 70, dailyCandidates: 45, dailyTemplates: 10 });
    const saved = await data.admin.saveSettings({ threshold: 80, scanTimes: ['08:00', '14:00', '20:00'] });
    expect(saved).toMatchObject({ scanTimes: ['08:00', '14:00', '20:00'], threshold: 80, dailyCandidates: 45, dailyTemplates: 10 });
    expect(await data.admin.settings()).toEqual(saved);
  });

  it('saveSettings ignores a field that is undefined', async () => {
    const before = await data.admin.settings();
    const saved = await data.admin.saveSettings({ threshold: undefined, scanTimes: undefined, dailyCandidates: 50, providerAccount: undefined });
    expect(saved).toEqual({ ...before, dailyCandidates: 50 });
    expect(await data.admin.settings()).toEqual(saved);
  });
});
