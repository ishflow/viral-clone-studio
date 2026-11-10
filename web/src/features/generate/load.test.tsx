import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-demo';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { data } from '@/data';
import { resetStore, getStore } from '@/data/mock/store';
import { renderWithI18n } from '@/shared/ui/test-utils';
import { GenerateNotReady } from './GenerateNotReady';
import { loadGenerate } from './load';

beforeEach(() => {
  resetStore();
  sessionId = 'usr-demo';
});
afterEach(cleanup);

describe('loadGenerate', () => {
  it('gives the form its template, the rate card of its format, the free video and the draft, and spends nothing', async () => {
    const balance = await data.ledger.balance('usr-demo');
    const jobs = (await data.jobs.listFor('usr-demo')).length;
    expect(await loadGenerate('tpl-layering')).toEqual({
      ready: true,
      template: { id: 'tpl-layering', title: 'Fragrance layering recipe', image: expect.stringMatching(/^\/samples\//), products: 4, shots: 5, seconds: 8, format: 'no-talking' },
      rates: { fast: 2, best: 5 },
      free: false,
      freeHeld: false,
      paused: false,
      fromJob: false,
      draft: null,
      draftKey: 'vc:draft:generate:usr-demo:tpl-layering',
    });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect((await data.jobs.listFor('usr-demo')).length).toBe(jobs);
  });

  it('says whether the free video is still there, and brings back the draft of the user for this template only', async () => {
    sessionId = 'usr-new';
    const input = { templateId: 'tpl-layering', quality: 'best' as const, variants: 2 as const, language: 'tr', products: [{ name: 'Oil', description: '', images: ['uploads/a/1.png'] }, { name: 'B', description: '', images: ['uploads/a/2.png'] }, { name: 'C', description: '', images: ['uploads/a/3.png'] }, { name: 'D', description: '', images: ['uploads/a/4.png'] }] };
    await data.drafts.save('usr-new', input);
    expect(await loadGenerate('tpl-layering')).toMatchObject({ ready: true, free: true, draft: input });
    expect(await loadGenerate('tpl-eye')).toMatchObject({ ready: true, free: true, draft: null });
  });

  it('B1: the free video is not on the price line while a free video on the template would not start now; the user keeps it', async () => {
    sessionId = 'usr-new';
    getStore().limits.freeVideosPerDay = 0;
    expect(await loadGenerate('tpl-layering')).toMatchObject({ ready: true, free: false });
    expect((await data.auth.getUser('usr-new'))?.freeVideoAvailable).toBe(true);
    getStore().limits.freeVideosPerDay = 1;
    expect(await loadGenerate('tpl-layering')).toMatchObject({ ready: true, free: true });
  });

  it('the free video is kept but today\'s share is closed: free false, freeHeld true', async () => {
    sessionId = 'usr-new';
    getStore().limits.freeVideosPerDay = 0;
    expect(await loadGenerate('tpl-layering')).toMatchObject({ ready: true, free: false, freeHeld: true });
    getStore().limits.freeVideosPerDay = 1;
    expect(await loadGenerate('tpl-layering')).toMatchObject({ ready: true, free: true, freeHeld: false });
  });

  it('a user without a free video has nothing held', async () => {
    getStore().limits.freeVideosPerDay = 0;
    expect(await loadGenerate('tpl-layering')).toMatchObject({ ready: true, free: false, freeHeld: false });
  });

  it('from an own finished job fills the names; another user\'s job or another template\'s job is ignored', async () => {
    const own = (await data.jobs.get('job-demo-story', 'usr-demo'))!;
    const loaded = await loadGenerate('tpl-story', 'job-demo-story');
    expect(loaded).toMatchObject({ ready: true, fromJob: true, draft: { templateId: 'tpl-story', products: own.input.products } });
    expect(await loadGenerate('tpl-story', 'job-paying-free')).toMatchObject({ ready: true, fromJob: false, draft: null });   // another user's job
    expect(await loadGenerate('tpl-layering', 'job-demo-story')).toMatchObject({ ready: true, fromJob: false, draft: null }); // another template
    expect(await loadGenerate('tpl-story', 'job-missing')).toMatchObject({ ready: true, fromJob: false, draft: null });
  });

  it('a saved draft is kept over the job; photos that were deleted with the job are not brought back, the names are', async () => {
    const input = { templateId: 'tpl-story', quality: 'best' as const, variants: 1 as const, language: 'en', products: [{ name: 'Draft', description: '', images: ['uploads/a/1.png'] }] };
    await data.drafts.save('usr-demo', input);
    expect(await loadGenerate('tpl-story', 'job-demo-story')).toMatchObject({ fromJob: false, draft: input });
    await data.drafts.discard('usr-demo', 'tpl-story');
    getStore().jobs.find((j) => j.id === 'job-demo-story')!.finishedAt = '2020-01-01T00:00:00Z'; // long past the days the photos are kept
    const loaded = await loadGenerate('tpl-story', 'job-demo-story');
    expect(loaded).toMatchObject({ fromJob: true });
    if (loaded.ready) expect(loaded.draft?.products.every((p) => p.images.length === 0 && p.name !== '')).toBe(true);
  });

  it('still shows the form while generation is paused, and says so (the price line reads the rate card, not the job runner)', async () => {
    await data.admin.saveLimits('usr-admin', { generationPaused: true });
    expect(await loadGenerate('tpl-layering')).toMatchObject({ ready: true, paused: true });
  });

  it('an own template whose preparation failed is loaded as failed, with its title for the way back', async () => {
    expect(await loadGenerate('tpl-own-failed')).toEqual({ ready: false, failed: true, template: { id: 'tpl-own-failed', title: 'Split-screen reaction video' } });
  });

  it('an own template that is still being prepared is "not ready"', async () => {
    const added = await data.catalog.addFromLink('usr-demo', 'https://www.tiktok.com/@someone/video/1');
    expect(await loadGenerate(added.id)).toMatchObject({ ready: false, failed: false, template: { id: added.id } });
  });

  it('is a 404 for an unknown template and for another customer\'s own template', async () => {
    await expect(loadGenerate('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    sessionId = 'usr-paying';
    await expect(loadGenerate('tpl-own-ready')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends a signed-out visitor to the login page with the way back, and an unverified user to /verify-email', async () => {
    sessionId = null;
    await expect(loadGenerate('tpl-eye')).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Ftemplates%2Ftpl-eye%2Fgenerate');
    sessionId = 'usr-unverified';
    await expect(loadGenerate('tpl-eye')).rejects.toThrow('NEXT_REDIRECT:/verify-email');
  });
});

describe('GenerateNotReady', () => {
  it('a failed template does not say try again in a moment, says why nothing can be made and offers another video', () => {
    renderWithI18n(<GenerateNotReady failed template={{ id: 'tpl-own-failed', title: 'Split-screen reaction video' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This video could not be turned into a template, so no video can be made from it. The template page says why.');
    expect(screen.queryByText(/Try again in a moment/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Add another video' })).toHaveAttribute('href', '/templates/new');
    expect(screen.getByRole('link', { name: 'Split-screen reaction video' })).toHaveAttribute('href', '/templates/tpl-own-failed');
  });

  it('says the template is not ready and links back to it', () => {
    renderWithI18n(<GenerateNotReady failed={false} template={{ id: 'tpl-own-failed', title: 'Split-screen reaction video' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This template is not ready yet. Try again in a moment.');
    expect(screen.getByRole('link', { name: 'Split-screen reaction video' })).toHaveAttribute('href', '/templates/tpl-own-failed');
  });
});
