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
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { data } from '@/data';
import { RULES } from '@/data/ports';
import { SWAP_TEMPLATE_ID } from '@/data/mock/demo-values';
import { writeEntry } from '@/data/mock/ledger';
import { getStore, resetStore } from '@/data/mock/store';
import { confirmSwap, estimateSwap, findStartedSwap, uploadPersonPhoto } from './actions';

const consent = (over: Record<string, unknown> = {}) => ({ ownPerson: true, adults: true, notCelebrity: true, version: RULES.swapConsentVersion, ...over });
const form = (over: Record<string, unknown> = {}) => ({ templateId: SWAP_TEMPLATE_ID, people: [{ slot: 1, body: 'me.jpg', face: null }], consent: consent(), ...over });
const balance = () => data.ledger.balance('usr-demo');
const swapJobs = () => getStore().jobs.filter((job) => job.swap);
/** The price the data layer asks for the fixture video: what every screen shows. */
const price = async () => (await data.swap.estimate('usr-demo', { templateId: SWAP_TEMPLATE_ID, quality: 'fast', people: [] })).credits;
const redirectOf = async (run: Promise<unknown>) => run.then(() => null, (error: Error) => error.message);

beforeEach(() => {
  vi.stubEnv('VC_FAKE_SWAP', '1');
  resetStore();
  sessionId = 'usr-demo';
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('estimateSwap', () => {
  it('answers with the estimate of the data layer, and charges nothing', async () => {
    const before = await balance();
    const outcome = await estimateSwap(form());
    expect(outcome).toEqual({ status: 'ready', estimate: await data.swap.estimate('usr-demo', { templateId: SWAP_TEMPLATE_ID, quality: 'fast', people: [] }) });
    expect(await balance()).toBe(before);
  });

  it('says the video is gone while person swap is switched off', async () => {
    vi.unstubAllEnvs();
    resetStore();
    expect(await estimateSwap(form())).toEqual({ status: 'error', code: 'gone' });
  });

  it('says so while generation is paused', async () => {
    getStore().limits.generationPaused = true;
    expect(await estimateSwap(form())).toEqual({ status: 'error', code: 'paused' });
  });
});

describe('confirmSwap', () => {
  it('starts one person-swap job for the price shown and goes to its page', async () => {
    const before = await balance();
    const credits = await price();
    const to = await redirectOf(confirmSwap(form(), 'key-1', { credits }));
    const [job] = swapJobs();
    expect(to).toBe(`NEXT_REDIRECT:/jobs/${job!.id}`);
    expect(job!.swap!.people).toEqual([{ slot: 1, body: 'me.jpg', face: null }]);
    expect(job!.swapConsent!.version).toBe(RULES.swapConsentVersion);
    expect(await balance()).toBe(before - credits);
  });

  it('keeps the side photograph the form sent with the job, for the same price; a form that names none starts as before', async () => {
    const credits = await price();
    await redirectOf(confirmSwap(form({ people: [{ slot: 1, body: 'me.jpg', face: null, side: 'my-side.jpg' }] }), 'key-1', { credits }));
    await redirectOf(confirmSwap(form({ people: [{ slot: 1, body: 'me.jpg', face: null, side: null }] }), 'key-2', { credits }));
    expect(swapJobs().map((job) => job.swap!.people)).toStrictEqual([[{ slot: 1, body: 'me.jpg', face: null, side: 'my-side.jpg' }], [{ slot: 1, body: 'me.jpg', face: null }]]);
    expect(swapJobs().map((job) => job.credits)).toEqual([credits, credits]);
  });

  it('starts nothing for a side photograph that is no stored name', async () => {
    const before = await balance();
    for (const side of ['', 7, 'x'.repeat(261)]) {
      expect(await confirmSwap(form({ people: [{ slot: 1, body: 'me.jpg', face: null, side }] }), 'key-1', { credits: await price() })).toEqual({ status: 'error', code: 'generic' });
    }
    expect([swapJobs(), await balance()]).toEqual([[], before]);
  });

  it('keeps the clothes the form chose with the job: the photograph\'s, or the video\'s when it chose that or said nothing', async () => {
    const credits = await price();
    await redirectOf(confirmSwap(form({ outfit: 'photo' }), 'key-photo', { credits }));
    await redirectOf(confirmSwap(form({ outfit: 'keep' }), 'key-keep', { credits }));
    await redirectOf(confirmSwap(form(), 'key-none', { credits }));
    expect(swapJobs().map((job) => job.swap!.outfit)).toEqual(['photo', 'keep', 'keep']);
  });

  it('starts nothing for clothes the form does not offer', async () => {
    const before = await balance();
    expect(await confirmSwap(form({ outfit: 'naked' }), 'key-1', { credits: await price() })).toEqual({ status: 'error', code: 'generic' });
    expect(swapJobs()).toEqual([]);
    expect(await balance()).toBe(before);
  });

  it('charges once when the same confirmation arrives twice', async () => {
    const before = await balance();
    const credits = await price();
    await redirectOf(confirmSwap(form(), 'key-1', { credits }));
    await redirectOf(confirmSwap(form(), 'key-1', { credits }));
    expect(swapJobs()).toHaveLength(1);
    expect(await balance()).toBe(before - credits);
  });

  it.each(['ownPerson', 'adults', 'notCelebrity'])('starts nothing while the box %s is open', async (box) => {
    const before = await balance();
    expect(await confirmSwap(form({ consent: consent({ [box]: false }) }), 'key-1', { credits: await price() })).toEqual({ status: 'error', code: 'consent' });
    expect(swapJobs()).toHaveLength(0);
    expect(await balance()).toBe(before);
  });

  it('starts nothing without the full-body photo', async () => {
    expect(await confirmSwap(form({ people: [] }), 'key-1', { credits: await price() })).toEqual({ status: 'error', code: 'people' });
    expect(swapJobs()).toHaveLength(0);
  });

  it('starts nothing when the price is not the one the window showed, and answers with the price of now', async () => {
    const credits = await price();
    const outcome = await confirmSwap(form(), 'key-1', { credits: credits + 1 });
    expect(outcome).toMatchObject({ status: 'changed', estimate: { credits } });
    expect(swapJobs()).toHaveLength(0);
  });

  it('answers with the estimate when the balance does not reach the price', async () => {
    writeEntry('usr-demo', 'generation', 0 - (await balance()), 'Down to nothing');
    const outcome = await confirmSwap(form(), 'key-1', { credits: await price() });
    expect(outcome).toMatchObject({ status: 'ready', estimate: { enough: false, balance: 0 } });
    expect(swapJobs()).toHaveLength(0);
  });

  it('a photo the data layer does not take is told as that, not as a job that could not be started; nothing is charged', async () => {
    const before = await balance();
    vi.spyOn(data.swap, 'start').mockRejectedValue(new Error('swap-photo'));
    expect(await confirmSwap(form(), 'key-1', { credits: await price() })).toEqual({ status: 'error', code: 'photo' });
    expect([await balance(), swapJobs()]).toEqual([before, []]);
  });

  it('refuses a form that is not a form', async () => {
    expect(await confirmSwap({ templateId: SWAP_TEMPLATE_ID }, 'key-1', { credits: 3 })).toEqual({ status: 'error', code: 'generic' });
    expect(await confirmSwap(form(), '', { credits: 3 })).toEqual({ status: 'error', code: 'generic' });
  });
});

describe('findStartedSwap', () => {
  it('finds the job a key started, for its owner only', async () => {
    await redirectOf(confirmSwap(form(), 'key-1', { credits: await price() }));
    expect(await findStartedSwap('key-1')).toBe(swapJobs()[0]!.id);
    expect(await findStartedSwap('key-2')).toBeNull();
    sessionId = 'usr-paying';
    expect(await findStartedSwap('key-1')).toBeNull();
  });
});

describe('uploadPersonPhoto', () => {
  const sent = (file: File) => { const form = new FormData(); form.set('file', file); return form; };
  const photo = new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' });

  it('stores the file as the photograph of a person, for the signed-in user', async () => {
    const save = vi.spyOn(data.uploads, 'save').mockResolvedValue('uploads/x/1.jpg');
    expect(await uploadPersonPhoto(sent(photo))).toEqual({ status: 'saved', path: 'uploads/x/1.jpg' });
    expect(save).toHaveBeenCalledWith('usr-demo', expect.any(File), 'person');
  });

  it('a file the data layer cannot read as a picture is refused as unreadable, not as a wrong type', async () => {
    vi.spyOn(data.uploads, 'save').mockRejectedValue(new Error('upload-unreadable'));
    expect(await uploadPersonPhoto(sent(photo))).toEqual({ status: 'refused', code: 'unreadable' });
  });
});
