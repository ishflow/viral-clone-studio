// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../engine/fake';
import { data } from '../index';
import { RULES } from '../ports';
import { getStore, resetStore } from './store';

// "Prepare from a list of links" (admin): each link becomes a manual candidate and goes through the very path of "Add to gallery".

const ADMIN = 'usr-admin';
const video = (n: number) => `https://www.tiktok.com/@shop/video/7000000${String(n).padStart(12, '0')}`;
const templates = () => data.admin.templates({});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('who may', () => {
  it.each([['usr-demo'], ['usr-nobody'], ['']])('%j is refused with forbidden and nothing is queued', async (who) => {
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const candidates = (await data.admin.candidates()).length;
    await expect(data.admin.prepareLinks(who, [video(1)])).rejects.toThrow('forbidden');
    expect(prepare).not.toHaveBeenCalled();
    expect(await data.admin.candidates()).toHaveLength(candidates);
  });
});

describe('each link', () => {
  it('goes through prepareCandidate exactly once, and a waiting template comes out of it', async () => {
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const before = (await templates()).length;
    const rows = await data.admin.prepareLinks(ADMIN, [video(1), video(2)]);
    expect(rows.map((row) => row.status)).toEqual(['queued', 'queued']);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(await templates()).toHaveLength(before + 2);
    expect((await data.admin.candidates()).some((candidate) => candidate.title.includes('7000000000000000001'))).toBe(false);
  });

  it('spends nothing at the provider: no job starts, no sample, no estimate is asked', async () => {
    const start = vi.spyOn(fakeEngine, 'start');
    const resume = vi.spyOn(fakeEngine, 'resume');
    const paid = vi.spyOn(fakeEngine, 'paid');
    const jobs = getStore().jobs.length;
    await data.admin.prepareLinks(ADMIN, [video(1), video(2), video(3)]);
    expect([start, resume, paid].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    expect(getStore().jobs).toHaveLength(jobs);
  });

  it('a bad line (another site, http, not an address) is told so and does not stop the rest; nothing is prepared for it', async () => {
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const rows = await data.admin.prepareLinks(ADMIN, ['https://example.com/v/1', video(1), 'http://www.tiktok.com/@a/video/5', 'not a link']);
    expect(rows).toEqual([
      { line: 'https://example.com/v/1', status: 'invalid' }, { line: video(1), status: 'queued' },
      { line: 'http://www.tiktok.com/@a/video/5', status: 'invalid' }, { line: 'not a link', status: 'invalid' },
    ]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('the same video again (by another link of it, or later in the same list) is skipped as already there', async () => {
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const rows = await data.admin.prepareLinks(ADMIN, ['https://youtu.be/abcDEF12345?si=a', 'https://www.youtube.com/shorts/abcDEF12345', 'https://www.youtube.com/watch?v=abcDEF12345&t=4']);
    expect(rows.map((row) => row.status)).toEqual(['queued', 'exists', 'exists']);
    expect((await data.admin.prepareLinks(ADMIN, ['https://youtu.be/abcDEF12345']))[0]!.status).toBe('exists');
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('a video that is a candidate in the inbox already is skipped', async () => {
    getStore().candidates.push({ id: 'cand-link', title: 'Waiting', source: 'shorts', views: '1M', seconds: 10, score: 0, image: '', foundAt: new Date().toISOString(), url: 'https://www.youtube.com/shorts/zzzZZZ99999?feature=share' });
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    expect((await data.admin.prepareLinks(ADMIN, ['https://youtu.be/zzzZZZ99999']))[0]!.status).toBe('exists');
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('the list and the day', () => {
  it('more than the most one list may hold is refused whole', async () => {
    await data.admin.saveSettings({ dailyTemplates: 100, dailyCandidates: 100 });
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const lines = Array.from({ length: RULES.linkBatchMax + 1 }, (_, n) => video(n));
    await expect(data.admin.prepareLinks(ADMIN, lines)).rejects.toThrow('too-many-links');
    expect(prepare).not.toHaveBeenCalled();
    expect((await data.admin.prepareLinks(ADMIN, lines.slice(0, RULES.linkBatchMax))).every((row) => row.status === 'queued')).toBe(true);
  });

  it('never goes over the day\'s templates: the ones that do not fit are told "limit", and a later list the same', async () => {
    await data.admin.saveSettings({ dailyTemplates: 2 });
    const prepare = vi.spyOn(fakeEngine, 'prepareCandidate');
    const rows = await data.admin.prepareLinks(ADMIN, [video(1), video(2), video(3), video(4)]);
    expect(rows.map((row) => row.status)).toEqual(['queued', 'queued', 'limit', 'limit']);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect((await data.admin.prepareLinks(ADMIN, [video(5)]))[0]!.status).toBe('limit');
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('never goes over the day\'s candidates either', async () => {
    await data.admin.saveSettings({ dailyCandidates: 1 });
    const rows = await data.admin.prepareLinks(ADMIN, [video(1), video(2)]);
    expect(rows.map((row) => row.status)).toEqual(['queued', 'limit']);
  });

  it('a duplicate is "already there" even when the day is full, and the next day has room again', async () => {
    await data.admin.saveSettings({ dailyTemplates: 1 });
    await data.admin.prepareLinks(ADMIN, [video(1)]);
    expect((await data.admin.prepareLinks(ADMIN, [video(1), video(2)])).map((row) => row.status)).toEqual(['exists', 'limit']);
    vi.setSystemTime(new Date('2026-10-08T10:00:00.000Z'));
    expect((await data.admin.prepareLinks(ADMIN, [video(2)]))[0]!.status).toBe('queued');
  });
});
