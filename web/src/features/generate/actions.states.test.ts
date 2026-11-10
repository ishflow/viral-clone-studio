// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-demo';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { confirmGeneration, estimateGeneration, findStartedJob, saveFormDraft } from './actions';

const form = () => ({
  templateId: 'tpl-layering',
  products: ['A', 'B', 'C', 'D'].map((name) => ({ name, description: '', images: ['uploads/x/1.png'] })),
  quality: 'fast', variants: 1, language: 'en',
});

beforeEach(() => {
  resetStore();
  sessionId = 'usr-demo';
});

describe('a paused generation (B10)', () => {
  it('estimate and confirm answer paused, charge nothing and start nothing', async () => {
    await data.admin.saveLimits('usr-admin', { generationPaused: true });
    const balance = await data.ledger.balance('usr-demo');
    const jobs = (await data.jobs.listFor('usr-demo')).length;
    expect(await estimateGeneration(form())).toEqual({ status: 'error', code: 'paused' });
    expect(await confirmGeneration(form(), 'k-1', { credits: 2, free: false })).toEqual({ status: 'error', code: 'paused' });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect((await data.jobs.listFor('usr-demo')).length).toBe(jobs);
  });
});

describe('the free videos of the day are used up (K1)', () => {
  it('confirm answers free-video-cap: no job, the free video stays; a paid job of the same moment starts', async () => {
    await data.admin.saveLimits('usr-admin', { freeVideosPerDay: 0 });
    sessionId = 'usr-new';
    expect(await confirmGeneration(form(), 'k-free', { credits: 0, free: true })).toEqual({ status: 'error', code: 'free-video-cap' });
    expect(await data.jobs.listFor('usr-new')).toEqual([]);
    expect((await data.auth.getUser('usr-new'))?.freeVideoAvailable).toBe(true);
    sessionId = 'usr-demo';
    await expect(confirmGeneration(form(), 'k-paid', { credits: 2, free: false })).rejects.toThrow(/NEXT_REDIRECT:\/jobs\//);
  });
});

describe('a job the engine refuses for the provider limit (K3)', () => {
  it('confirm answers provider-cap, the code the form has a text for', async () => {
    const start = vi.spyOn(data.jobs, 'start').mockRejectedValue(new Error('provider-cap'));
    expect(await confirmGeneration(form(), 'k-cap', { credits: 2, free: false })).toEqual({ status: 'error', code: 'provider-cap' });
    start.mockRestore();
  });
});

describe('findStartedJob (R6)', () => {
  it('finds the job a start with this key made, and only for the user who started it', async () => {
    await expect(confirmGeneration(form(), 'k-2', { credits: 2, free: false })).rejects.toThrow(/NEXT_REDIRECT:\/jobs\//);
    const id = await findStartedJob('k-2');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await findStartedJob('k-other')).toBeNull();
    expect(await findStartedJob('')).toBeNull();
    expect(await findStartedJob(42)).toBeNull();
    sessionId = 'usr-paying';
    expect(await findStartedJob('k-2')).toBeNull();
  });
});

describe('saveFormDraft (B8)', () => {
  it('keeps a complete form of the signed-in user, with its stored photos, and refuses an incomplete one', async () => {
    expect(await saveFormDraft(form())).toBe(true);
    expect((await data.drafts.get('usr-demo', 'tpl-layering'))?.input.products[0]?.images).toEqual(['uploads/x/1.png']);
    expect(await data.drafts.get('usr-paying', 'tpl-layering')).toBeNull();
    expect(await saveFormDraft({ ...form(), products: [] })).toBe(false);
    expect(await saveFormDraft(null)).toBe(false);
  });
});
