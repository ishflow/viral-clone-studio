// @vitest-environment node
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
import { SWAP_TEMPLATE_ID } from '@/data/mock/demo-values';
import { getStore, resetStore } from '@/data/mock/store';
import { START } from '@/data/mock/test-helpers';
import { RULES } from '@/data/ports';
import { personSwapOpen } from '@/core/person-swap';
import { loadSwapGallery, loadSwapVideo } from './load';

const estimate = () => data.swap.estimate('usr-demo', { templateId: SWAP_TEMPLATE_ID, quality: 'fast', people: [] });

beforeEach(() => {
  vi.stubEnv('VC_FAKE_SWAP', '1');
  resetStore();
  sessionId = 'usr-demo';
});
afterEach(() => vi.unstubAllEnvs());

describe('the person-swap pages while the switch is on', () => {
  it('are open', async () => {
    expect(await personSwapOpen()).toBe(true);
  });

  it('list the published videos, each with the price the data layer asks', async () => {
    const { cards } = await loadSwapGallery();
    expect(cards).toEqual([expect.objectContaining({ id: SWAP_TEMPLATE_ID, title: 'Walk to the camera', seconds: 12, people: 1, credits: (await estimate()).credits })]);
  });

  it('show a video with its estimate and the place of its person, never the words the model finds the person by', async () => {
    const loaded = await loadSwapVideo(SWAP_TEMPLATE_ID);
    expect(loaded.estimate).toEqual(await estimate());
    expect(loaded.paused).toBe(false);
    expect(loaded.template.persons).toEqual([{ slot: 1, box: { left: 30, top: 12, right: 70, bottom: 96 } }]);
    expect(JSON.stringify(loaded)).not.toContain('white shirt');
  });

  it('show the form without a price while generation is paused', async () => {
    getStore().limits.generationPaused = true;
    expect(await loadSwapVideo(SWAP_TEMPLATE_ID)).toMatchObject({ estimate: null, paused: true });
    expect((await loadSwapGallery()).cards[0]!.credits).toBeNull();
  });

  it('answer 404 for a video that is not a person-swap video', async () => {
    await expect(loadSwapVideo('tpl-layering')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('send a signed-out visitor to log in and back', async () => {
    sessionId = null;
    await expect(loadSwapGallery()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fswap');
  });
});

describe('the person-swap list with the videos used', () => {
  const OTHER = 'tpl-swap-2';
  const done = async (userId: string, templateId: string, key: string) => {
    const sent = { templateId, quality: 'fast' as const, people: [{ slot: 1, body: 'me.jpg', face: null }] };
    const job = await data.swap.start(userId, sent, key, await data.swap.estimate(userId, sent), { ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion });
    for (let minute = 0; minute < 3; minute += 1) {
      vi.advanceTimersByTime(30_000);
      await data.jobs.get(job.id, userId);
    }
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    resetStore();
    const first = getStore().templates.find((template) => template.id === SWAP_TEMPLATE_ID)!;
    getStore().templates.push({ ...structuredClone(first), id: OTHER, title: 'Turn around' });
  });
  afterEach(() => vi.useRealTimers());

  it('hold the number of times each video was used, and put the most used first', async () => {
    expect((await loadSwapGallery()).cards.map(({ id, uses }) => [id, uses])).toEqual([[SWAP_TEMPLATE_ID, 0], [OTHER, 0]]);
    await done('usr-demo', OTHER, 'key-1');
    await done('usr-paying', OTHER, 'key-2');
    await done('usr-demo', SWAP_TEMPLATE_ID, 'key-3');
    expect((await loadSwapGallery()).cards.map(({ id, uses }) => [id, uses])).toEqual([[OTHER, 2], [SWAP_TEMPLATE_ID, 1]]);
  });

  it('keep the order of the catalog for videos used the same number of times', async () => {
    await done('usr-demo', OTHER, 'key-1');
    await done('usr-demo', SWAP_TEMPLATE_ID, 'key-2');
    expect((await loadSwapGallery()).cards.map((card) => card.id)).toEqual([SWAP_TEMPLATE_ID, OTHER]);
  });

  it('carry a number and nothing of the customers who used the video', async () => {
    await done('usr-paying', SWAP_TEMPLATE_ID, 'key-1');
    sessionId = 'usr-demo';
    const text = JSON.stringify((await loadSwapGallery()).cards);
    expect(text).toContain('"uses":1');
    for (const secret of ['usr-paying', 'key-1', 'me.jpg']) expect(text).not.toContain(secret);
  });
});

describe('the person-swap pages while the switch is on and no video is published', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetStore();
    getStore().limits.personSwap = true;
  });

  it('are open: the list opens and says there is no video yet, the menu links to it', async () => {
    expect(await personSwapOpen()).toBe(true);
    expect((await loadSwapGallery()).cards).toEqual([]);
  });

  it('still answer 404 for a video', async () => {
    await expect(loadSwapVideo(SWAP_TEMPLATE_ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('the look at the photograph, as the form is told of it', () => {
  beforeEach(() => vi.stubEnv('VC_FAKE_SWAP', '1'));

  it('follows the switch of the admin, at once (the fake store starts with it off)', async () => {
    expect((await loadSwapVideo(SWAP_TEMPLATE_ID)).reviewed).toBe(false);
    getStore().limits.swapReview = true;
    expect((await loadSwapVideo(SWAP_TEMPLATE_ID)).reviewed).toBe(true);
    delete getStore().limits.swapReview;
    expect((await loadSwapVideo(SWAP_TEMPLATE_ID)).reviewed).toBe(true);
  });
});

describe('the person-swap pages while the switch is off', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetStore();
  });

  it('are closed', async () => {
    expect(await personSwapOpen()).toBe(false);
  });

  it('answer 404, the list and the video alike', async () => {
    await expect(loadSwapGallery()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(loadSwapVideo(SWAP_TEMPLATE_ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
