// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Job, Template } from '@/data/ports';
import { filterOf, filterRows, hasLiveRow, parseFilter, toRow } from './rows';

const steps = (kind: 'running' | 'stopped' | 'done'): Job['steps'] => [
  { key: 'adaptation', status: 'done', done: 1, total: 1 },
  { key: 'images', status: 'done', done: 5, total: 5 },
  { key: 'clips', status: kind === 'done' ? 'done' : kind, done: kind === 'done' ? 5 : 3, total: 5 },
  { key: 'music', status: 'done', done: 1, total: 1 },
  { key: 'edit', status: kind === 'done' ? 'done' : 'waiting', done: kind === 'done' ? 1 : 0, total: 1 },
  { key: 'render', status: kind === 'done' ? 'done' : 'waiting', done: kind === 'done' ? 1 : 0, total: 1 },
];
const job = (id: string, status: Job['status'], startedAt: string): Job => ({
  id, userId: 'u', templateId: 't', templateTitle: 'Title ' + id, credits: 2, status, steps: steps(status as 'running' | 'stopped' | 'done'),
  stoppedReason: status === 'stopped' ? 'clips-failed' : null, startedAt, finishedAt: null, variants: [],
  freeVideo: false, creditsReturned: 0, queuePosition: null, delayed: false, paused: false, stoppedAt: null, continueUntil: null,
  closedAt: null, closedReason: null, videoExpiresAt: null, imagesExpireAt: null, videoStored: true, imagesStored: true, deletedAt: null,
  input: { templateId: 't', products: [{ name: 'Oil', description: '', images: [] }, { name: 'Mist', description: '', images: [] }], quality: 'fast', variants: 1, language: 'en' },
});
const template = { id: 't', image: '/samples/x.jpg', format: 'talking', seconds: 30 } as Template;

describe('videos rows', () => {
  it('maps a running job: step progress and a time estimate of at least one minute', () => {
    const row = toRow(job('a', 'running', '2026-01-01'), template);
    expect(row).toMatchObject({ id: 'a', status: 'running', title: 'Title a', image: '/samples/x.jpg', productNames: ['Oil', 'Mist'], quality: 'fast', variants: 1, seconds: 30 });
    expect(row.step).toEqual({ key: 'clips', done: 3, total: 5 });
    expect(row.minutesLeft).toBeGreaterThanOrEqual(1);
  });
  it('a job the engine has not begun is a queued row with its line, not a running one: no step, and the line is carried', () => {
    const line = { ahead: 2, waitMinutes: 14 };
    const row = toRow({ ...job('w', 'running', '2026-01-01'), engineQueue: line }, template);
    expect(row).toMatchObject({ status: 'queued', step: null, queuePosition: null, engineQueue: line });
    expect(filterOf(row.status)).toBe('running');
    expect(toRow({ ...job('w', 'running', '2026-01-01'), engineQueue: null }, template)).toMatchObject({ status: 'running', engineQueue: null });
    expect(toRow(job('w', 'running', '2026-01-01'), template).engineQueue).toBeNull();
  });
  it('maps a stopped job to its clip counts', () => {
    expect(toRow(job('b', 'stopped', '2026-01-01'), template).step).toEqual({ key: 'clips', done: 3, total: 5 });
  });
  it('has no image when the template is gone', () => {
    expect(toRow(job('c', 'done', '2026-01-01'), null).image).toBeNull();
  });
  it('shows the poster of the first delivered video, and the template picture only when no video has a poster', () => {
    const variants = [
      { id: 'v1', image: '', video: null, status: 'stopped' as const, reason: null },
      { id: 'v2', image: '/media/jobs/j/v2/poster.jpg', video: '/media/jobs/j/v2/final.mp4', status: 'done' as const, reason: null },
    ];
    const bare = { ...template, image: '' } as Template;
    expect(toRow({ ...job('p', 'done', 'x'), variants }, bare).image).toBe('/media/jobs/j/v2/poster.jpg');
    expect(toRow({ ...job('p', 'done', 'x'), variants }, template).image).toBe('/media/jobs/j/v2/poster.jpg');
    expect(toRow(job('p', 'running', 'x'), template).image).toBe('/samples/x.jpg');
    expect(toRow(job('p', 'running', 'x'), bare).image).toBeNull();
  });
  it('a job that runs shows the first frame made for its shots, then the template picture, then the empty box', () => {
    const shots = [{ variant: 1, n: 1, image: null, clip: true }, { variant: 1, n: 2, image: '/media/jobs/r/paid/v1/image-s2.png', clip: false }, { variant: 1, n: 3, image: '/media/jobs/r/paid/v1/image-s3.png', clip: false }];
    const bare = { ...template, image: '' } as Template;
    expect(toRow({ ...job('p', 'running', 'x'), shots }, template).image).toBe('/media/jobs/r/paid/v1/image-s2.png');
    expect(toRow({ ...job('p', 'running', 'x'), shots }, bare).image).toBe('/media/jobs/r/paid/v1/image-s2.png');
    expect(toRow({ ...job('p', 'running', 'x'), shots: [] }, template).image).toBe('/samples/x.jpg');
    expect(toRow({ ...job('p', 'running', 'x'), shots: [{ variant: 1, n: 1, image: null, clip: true }] }, bare).image).toBeNull();
    expect(toRow({ ...job('p', 'queued', 'x'), shots: [] }, bare).image).toBeNull();
  });
  it('the poster of a delivered video comes before a frame of a shot', () => {
    const variants = [{ id: 'v1', image: '/media/jobs/j/v1/poster.jpg', video: '/media/jobs/j/v1/final.mp4', status: 'done' as const, reason: null }];
    const shots = [{ variant: 1, n: 1, image: '/media/jobs/r/paid/v1/image-s1.png', clip: true }];
    expect(toRow({ ...job('p', 'done', 'x'), variants, shots }, template).image).toBe('/media/jobs/j/v1/poster.jpg');
  });
  it('parses the status filter and falls back to all', () => {
    expect(parseFilter('done')).toBe('done');
    expect(parseFilter('running')).toBe('running');
    expect(parseFilter('nonsense')).toBe('all');
    expect(parseFilter(undefined)).toBe('all');
  });
  it('maps queued to the Running filter and closed to the Stopped filter', () => {
    const rows = [job('a', 'running', 'x'), job('q', 'queued', 'x'), job('b', 'done', 'x'), job('c', 'stopped', 'x'), job('d', 'closed', 'x')].map((j) => toRow(j, template));
    expect(filterRows(rows, 'running').map((r) => r.id)).toEqual(['a', 'q']);
    expect(filterRows(rows, 'stopped').map((r) => r.id)).toEqual(['c', 'd']);
    expect(filterRows(rows, 'done').map((r) => r.id)).toEqual(['b']);
    expect(filterOf('queued')).toBe('running');
    expect(filterOf('closed')).toBe('stopped');
  });
  it('carries what the new row states need: returned credits, free, queue position, stored, delivered videos', () => {
    const queued = toRow({ ...job('q', 'queued', 'x'), queuePosition: 2 }, template);
    expect(queued).toMatchObject({ status: 'queued', queuePosition: 2, step: null });
    const closed = toRow({ ...job('d', 'closed', 'x'), creditsReturned: 2, freeVideo: false }, template);
    expect(closed).toMatchObject({ status: 'closed', returned: 2, free: false, step: null });
    const variants = ['v1', 'v2', 'v3'].map((id, i) => ({ id, image: '', video: '/v.mp4', status: (i < 2 ? 'done' : 'stopped') as 'done' | 'stopped', reason: null }));
    const done = toRow({ ...job('e', 'done', 'x'), videoStored: false, variants }, template);
    expect(done).toMatchObject({ stored: false, delivered: 2, templateId: 't' });
    expect(toRow(job('f', 'done', 'x'), template).delivered).toBe(1);
  });
  it('toRow carries the stop reason and the start day', () => {
    const stopped = toRow({ ...job('s', 'stopped', '2026-10-06T09:30:00.000Z'), stoppedReason: 'content-rule' }, template);
    expect(stopped.reason).toBe('content-rule');
    expect(stopped.startedAt).toBe('2026-10-06T09:30:00.000Z');
    expect(toRow(job('d', 'done', '2026-10-06T09:30:00.000Z'), template).reason).toBeNull();
  });
  it('filters rows by status', () => {
    const rows = [job('a', 'running', 'x'), job('b', 'done', 'x'), job('c', 'stopped', 'x')].map((j) => toRow(j, template));
    expect(filterRows(rows, 'all')).toHaveLength(3);
    expect(filterRows(rows, 'stopped').map((r) => r.id)).toEqual(['c']);
    expect(filterRows(rows, 'running').map((r) => r.id)).toEqual(['a']);
  });
  it('a list with a queued or a running video is live; a list of finished, stopped and closed videos is not', () => {
    const rowOf = (status: Job['status']) => toRow(job('x', status, '2026-01-01'), template);
    const queued = toRow({ ...job('q', 'running', '2026-01-01'), engineQueue: { ahead: 1, waitMinutes: 7 } }, template);
    expect(hasLiveRow([rowOf('done'), rowOf('running')])).toBe(true);
    expect(hasLiveRow([rowOf('done'), queued])).toBe(true);
    expect(hasLiveRow([rowOf('done'), rowOf('stopped'), rowOf('closed')])).toBe(false);
    expect(hasLiveRow([])).toBe(false);
  });
});
