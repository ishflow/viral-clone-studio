// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from '../index';
import { NotFoundError } from '../ports';
import type { SwapSlot, Template } from '../ports';
import { SWAP_TEMPLATE_ID } from './demo-values';
import { getStore, resetStore } from './store';
import { START } from './test-helpers';

// The people of a person-swap video as an admin sets them, next to the fake engine (which takes them at once): who may set them,
// what is refused, and that a video the preparation suggested no people for is published only after an admin has set them.

const ADMIN = 'usr-admin';
const LINK = 'https://www.tiktok.com/@a/video/1';
const WOMAN: SwapSlot = { slot: 1, box: { left: 12.5, top: 20, right: 60, bottom: 98 }, hint: 'the woman on the left in a red dress' };
const MAN: SwapSlot = { slot: 2, box: { left: 55, top: 18, right: 100, bottom: 100 }, hint: 'the man on the right in a white shirt' };
const stored = (id: string): Template => getStore().templates.find((template) => template.id === id)!;
/** A video an admin added whose preparation suggested no people: the fake suggests the fixture's, so the mark is put by hand. */
async function unsuggested(): Promise<Template> {
  const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: LINK });
  stored(made.id).swapPeople = 'unset';
  return (await data.admin.template(made.id))!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv('VC_FAKE_SWAP', '1');
  resetStore();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('the people of a person-swap video', () => {
  it('are an admin\'s alone to set: a customer, nobody and an unknown id are refused and the video keeps its people', async () => {
    const before = structuredClone(stored(SWAP_TEMPLATE_ID));
    for (const who of ['usr-demo', '', 'usr-nobody']) await expect(data.admin.setSwapPeople(who, SWAP_TEMPLATE_ID, [WOMAN])).rejects.toThrow('forbidden');
    expect(stored(SWAP_TEMPLATE_ID)).toEqual(before);
  });

  it('are the box and the words of each person: the admin reads them back, the parts and the sound of the video stay', async () => {
    const before = stored(SWAP_TEMPLATE_ID).swap!;
    vi.setSystemTime(new Date(START.getTime() + 60_000));
    const saved = await data.admin.setSwapPeople(ADMIN, SWAP_TEMPLATE_ID, [WOMAN, MAN]);
    expect(saved.swap).toEqual({ people: 2, persons: [WOMAN, MAN], parts: before.parts, sound: before.sound });
    expect(saved.editedAt).toBe(new Date(START.getTime() + 60_000).toISOString());
    expect((await data.admin.template(SWAP_TEMPLATE_ID))!.swap).toEqual(saved.swap);
    expect((await data.admin.setSwapPeople(ADMIN, SWAP_TEMPLATE_ID, [WOMAN])).swap).toMatchObject({ people: 1, persons: [WOMAN] });
  });

  it('are kept apart from what was handed in: changing the list afterwards changes nothing of the video', async () => {
    const mine = [structuredClone(WOMAN)];
    await data.admin.setSwapPeople(ADMIN, SWAP_TEMPLATE_ID, mine);
    mine[0]!.hint = 'somebody else';
    mine[0]!.box.left = 99;
    expect(stored(SWAP_TEMPLATE_ID).swap!.persons).toEqual([WOMAN]);
  });

  it.each<[string, unknown]>([
    ['a box outside the picture', [{ ...WOMAN, box: { ...WOMAN.box, right: 120 } }]],
    ['words on two lines', [{ ...WOMAN, hint: 'the woman\nand more' }]],
    ['no words', [{ ...WOMAN, hint: '' }]],
    ['nobody', []],
    ['three people', [WOMAN, MAN, { ...MAN, slot: 3 }]],
    ['a person numbered 2 alone', [{ ...WOMAN, slot: 2 }]],
  ])('%s is refused and the video keeps its people', async (_name, persons) => {
    const before = structuredClone(stored(SWAP_TEMPLATE_ID));
    await expect(data.admin.setSwapPeople(ADMIN, SWAP_TEMPLATE_ID, persons as SwapSlot[])).rejects.toThrow('swap-people-invalid');
    expect(stored(SWAP_TEMPLATE_ID)).toEqual(before);
  });

  it('are set on a person-swap video only: a product template and an unknown id are no such video', async () => {
    const product = getStore().templates.find((template) => !template.swap)!;
    const before = structuredClone(product);
    await expect(data.admin.setSwapPeople(ADMIN, product.id, [WOMAN])).rejects.toBeInstanceOf(NotFoundError);
    await expect(data.admin.setSwapPeople(ADMIN, 'tpl-nowhere', [WOMAN])).rejects.toBeInstanceOf(NotFoundError);
    expect(stored(product.id)).toEqual(before);
    expect(stored(product.id)).not.toHaveProperty('swap');
  });
});

describe('a person-swap video whose preparation suggested no people', () => {
  it('says so to the admin and cannot be published: it stays waiting, on no page of a customer', async () => {
    getStore().limits.personSwap = true;
    const made = await unsuggested();
    expect(made).toMatchObject({ status: 'waiting', swapPeople: 'unset' });
    await expect(data.admin.updateTemplate(made.id, { status: 'published' })).rejects.toThrow('swap-people-unset');
    expect(stored(made.id).status).toBe('waiting');
    expect((await data.swap.templates()).map((template) => template.id)).not.toContain(made.id);
    // everything else of it can still be changed, and it can be put away
    expect(await data.admin.updateTemplate(made.id, { title: 'A walk' })).toMatchObject({ title: 'A walk', status: 'waiting', swapPeople: 'unset' });
    expect(await data.admin.updateTemplate(made.id, { status: 'hidden' })).toMatchObject({ status: 'hidden', swapPeople: 'unset' });
    await expect(data.admin.updateTemplate(made.id, { status: 'published' })).rejects.toThrow('swap-people-unset');
  });

  it('is published once an admin has set its people, withdrawn and published again; no gallery of product templates ever lists it', async () => {
    getStore().limits.personSwap = true;
    const made = await unsuggested();
    const saved = await data.admin.setSwapPeople(ADMIN, made.id, [WOMAN]);
    expect(saved).not.toHaveProperty('swapPeople');
    expect(saved.swap!.persons).toEqual([WOMAN]);
    const gallery = async () => (await data.catalog.list({ viewerId: 'usr-demo' })).map((template) => template.id);
    const swapPages = async () => (await data.swap.templates()).map((template) => template.id);
    expect(await data.admin.updateTemplate(made.id, { status: 'published' })).toMatchObject({ status: 'published' });
    expect([await swapPages(), await gallery()]).toEqual([expect.arrayContaining([made.id]), expect.not.arrayContaining([made.id])]);
    expect(await data.admin.updateTemplate(made.id, { status: 'hidden' })).toMatchObject({ status: 'hidden' });
    expect([await swapPages(), await gallery()]).toEqual([expect.not.arrayContaining([made.id]), expect.not.arrayContaining([made.id])]);
    expect(await data.admin.updateTemplate(made.id, { status: 'published' })).toMatchObject({ status: 'published' });
    expect(await swapPages()).toContain(made.id);
  });

  it('a video whose people were suggested carries no such mark and is published as before', async () => {
    const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: LINK });
    expect(made).not.toHaveProperty('swapPeople');
    expect(await data.admin.updateTemplate(made.id, { status: 'published' })).toMatchObject({ status: 'published' });
  });

  it('a customer\'s copy of a person-swap video carries no mark of the admin\'s work and none of the words', async () => {
    getStore().limits.personSwap = true;
    stored(SWAP_TEMPLATE_ID).swapPeople = 'pending';                         // an edit of a published video that waits for the worker
    const [copy] = await data.swap.templates();
    expect(copy).not.toHaveProperty('swapPeople');
    expect(copy!.swap!.persons.map((person) => person.hint)).toEqual(['']);
    expect(await data.swap.template(SWAP_TEMPLATE_ID)).not.toHaveProperty('swapPeople');
  });
});

describe('publishing and withdrawing a person-swap video', () => {
  it('are an admin\'s alone: a customer, nobody and an unknown id are refused, and the video stays as it is', async () => {
    const waiting = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: LINK });
    for (const who of ['usr-demo', '', 'usr-nobody']) {
      await expect(data.admin.setSwapStatus(who, waiting.id, 'published')).rejects.toThrow('forbidden');
      await expect(data.admin.setSwapStatus(who, SWAP_TEMPLATE_ID, 'hidden')).rejects.toThrow('forbidden');
    }
    expect([stored(waiting.id).status, stored(SWAP_TEMPLATE_ID).status]).toEqual(['waiting', 'published']);
  });

  it('is the admin\'s check before anything else: a customer is told nothing of a video that is not there, or of a status that is none', async () => {
    await expect(data.admin.setSwapStatus('usr-demo', 'tpl-nowhere', 'published')).rejects.toThrow('forbidden');
    await expect(data.admin.setSwapStatus('usr-demo', SWAP_TEMPLATE_ID, 'gone' as 'hidden')).rejects.toThrow('forbidden');
  });

  it('publish a video whose people are set, withdraw it, and publish it again', async () => {
    const made = await data.admin.addSwapTemplate(ADMIN, { kind: 'link', url: LINK });
    expect(await data.admin.setSwapStatus(ADMIN, made.id, 'published')).toMatchObject({ id: made.id, status: 'published' });
    expect(await data.admin.setSwapStatus(ADMIN, made.id, 'hidden')).toMatchObject({ status: 'hidden' });
    expect(await data.admin.setSwapStatus(ADMIN, made.id, 'published')).toMatchObject({ status: 'published' });
  });

  it('do not publish a video whose people are not set: it stays waiting', async () => {
    const made = await unsuggested();
    await expect(data.admin.setSwapStatus(ADMIN, made.id, 'published')).rejects.toThrow('swap-people-unset');
    expect(stored(made.id).status).toBe('waiting');
  });

  it('are for a person-swap video only: a product template and an unknown id are no such video, and no other status is set this way', async () => {
    const product = getStore().templates.find((template) => !template.swap)!;
    const before = structuredClone(product);
    for (const status of ['hidden', 'published'] as const) {
      await expect(data.admin.setSwapStatus(ADMIN, product.id, status)).rejects.toBeInstanceOf(NotFoundError);
      await expect(data.admin.setSwapStatus(ADMIN, 'tpl-nowhere', status)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(stored(product.id)).toEqual(before);
    for (const status of ['waiting', 'removed', '', null]) {
      await expect(data.admin.setSwapStatus(ADMIN, SWAP_TEMPLATE_ID, status as 'hidden')).rejects.toThrow('invalid-status');
    }
    expect(stored(SWAP_TEMPLATE_ID).status).toBe('published');
  });
});

describe('the answer to the look', () => {
  it('has one way in, the admin\'s: the module of person swap hands out no answer of its own', async () => {
    expect(Object.keys(await import('./swap')).sort()).toEqual(['swap']);
  });
});
