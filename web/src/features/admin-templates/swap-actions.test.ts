// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionId: string | null = 'usr-admin';
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (sessionId ? data.auth.getUser(sessionId) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/navigation', () => ({
  forbidden: () => { throw new Error('NEXT_FORBIDDEN'); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { data } from '@/data';
import { getStore, resetStore } from '@/data/mock/store';
import { SWAP_TEMPLATE_ID } from '@/data/mock/demo-values';
import { NotFoundError, RULES, type SwapSlot } from '@/data/ports';
import { addSwapVideo, publishSwapVideo, saveSwapPeople, withdrawSwapVideo, type SwapPeopleState } from './swap-actions';
import { loadEditor, loadInbox, loadList } from './load';
import { AdminTemplateEdit } from './index';
import { SwapEditView } from './SwapEditView';
import { EditView } from './EditView';

const IDLE = { status: 'idle' as const };
const LINK = 'https://www.tiktok.com/@a/video/1';
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const swapVideos = async () => (await data.admin.templates({})).filter((template) => template.swap);

beforeEach(() => {
  vi.stubEnv('VC_FAKE_SWAP', '1');
  resetStore();
  sessionId = 'usr-admin';
  revalidatePath.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('addSwapVideo', () => {
  it.each([['usr-demo'], [null]])('a visitor (%s) gets the forbidden page and no video is added', async (who) => {
    sessionId = who;
    await expect(addSwapVideo(IDLE, form({ kind: 'link', url: LINK }))).rejects.toThrow('NEXT_FORBIDDEN');
    sessionId = 'usr-admin';
    expect(await swapVideos()).toHaveLength(1); // the one of the fixtures
  });

  it('adds the video of a link through the data layer: it is a person-swap video, waiting, and says where to find it', async () => {
    const before = await swapVideos();
    const state = await addSwapVideo(IDLE, form({ kind: 'link', url: LINK }));
    expect(state.status).toBe('done');
    const added = (await swapVideos()).filter((template) => !before.some((old) => old.id === template.id));
    expect(added).toHaveLength(1);
    expect(state.id).toBe(added[0]!.id);
    expect(added[0]).toMatchObject({ status: 'waiting', source: 'link' });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it.each([
    ['a site that is not TikTok or YouTube', 'https://example.com/v/1'],
    ['a link with no https', 'http://www.tiktok.com/@a/video/1'],
    ['nothing', ''],
  ])('refuses %s as an invalid link and adds nothing', async (_name, url) => {
    const state = await addSwapVideo(IDLE, form({ kind: 'link', url }));
    expect(state).toEqual({ status: 'error', error: 'linkInvalid' });
    expect(await swapVideos()).toHaveLength(1);
  });

  it.each([
    ['an id that is not a uuid', '../../etc/passwd'],
    ['no id', ''],
  ])('refuses an upload with %s and adds nothing', async (_name, uploadId) => {
    const state = await addSwapVideo(IDLE, form({ kind: 'upload', uploadId }));
    expect(state).toEqual({ status: 'error', error: 'uploadFailed' });
    expect(await swapVideos()).toHaveLength(1);
  });

  it('says so when the data layer does not know the upload (it is not one of this admin\'s), and adds nothing', async () => {
    const state = await addSwapVideo(IDLE, form({ kind: 'upload', uploadId: '3f2b8c1e-9a4d-4e7f-8b21-6c5d0a9e1f34' }));
    expect(state).toEqual({ status: 'error', error: 'uploadFailed' });
    expect(await swapVideos()).toHaveLength(1);
  });

  it('refuses a kind that is neither a link nor an upload', async () => {
    expect(await addSwapVideo(IDLE, form({ kind: 'both', url: LINK }))).toEqual({ status: 'error', error: 'failed' });
    expect(await swapVideos()).toHaveLength(1);
  });

  it('names the reason the engine gave for a video it cannot use, and the provider cap as its own state', async () => {
    const add = vi.spyOn(data.admin, 'addSwapTemplate');
    add.mockRejectedValueOnce(new Error('source-rejected:length'));
    expect(await addSwapVideo(IDLE, form({ kind: 'link', url: LINK }))).toEqual({ status: 'error', error: 'length' });
    add.mockRejectedValueOnce(new Error('source-rejected:private'));
    expect(await addSwapVideo(IDLE, form({ kind: 'link', url: LINK }))).toEqual({ status: 'error', error: 'link' });
    add.mockRejectedValueOnce(new Error('provider-cap'));
    expect(await addSwapVideo(IDLE, form({ kind: 'link', url: LINK }))).toEqual({ status: 'error', providerCap: true });
    add.mockRejectedValueOnce(new Error('something else'));
    expect(await addSwapVideo(IDLE, form({ kind: 'link', url: LINK }))).toEqual({ status: 'error', error: 'failed' });
    add.mockRestore();
  });

  it('the data layer\'s own no is the forbidden page, not a failed state', async () => {
    const add = vi.spyOn(data.admin, 'addSwapTemplate').mockRejectedValueOnce(new Error('forbidden'));
    await expect(addSwapVideo(IDLE, form({ kind: 'link', url: LINK }))).rejects.toThrow('NEXT_FORBIDDEN');
    add.mockRestore();
  });
});

describe('the lists of templates', () => {
  it('marks a person-swap video in the list, and no product template', async () => {
    const { rows } = await loadList({});
    const swaps = rows.filter((row) => row.swapVideo);
    expect(swaps.map((row) => row.id)).toEqual((await swapVideos()).map((template) => template.id));
    expect(rows.filter((row) => !row.swapVideo).every((row) => !('swapVideo' in row))).toBe(true);
    expect(rows.length).toBeGreaterThan(swaps.length);
  });

  it('keeps a waiting person-swap video out of the inbox of product templates: it has no sample to pay for and no gallery to join', async () => {
    const added = await addSwapVideo(IDLE, form({ kind: 'link', url: LINK }));
    expect((await data.admin.templates({ status: 'waiting' })).some((template) => template.id === added.id)).toBe(true);
    expect((await loadInbox({})).waiting.some((card) => card.id === added.id)).toBe(false);
  });
});

const PEOPLE_IDLE: SwapPeopleState = { status: 'idle' };
const WOMAN: SwapSlot = { slot: 1, box: { left: 12.5, top: 20, right: 60, bottom: 98 }, hint: 'the woman on the left in a red dress' };
const MAN: SwapSlot = { slot: 2, box: { left: 55, top: 18, right: 100, bottom: 100 }, hint: 'the man on the right in a white shirt' };
const people = (persons: unknown, id = SWAP_TEMPLATE_ID) => saveSwapPeople(PEOPLE_IDLE, form({ id, persons: typeof persons === 'string' ? persons : JSON.stringify(persons) }));
const personsOf = async (id = SWAP_TEMPLATE_ID) => (await data.admin.template(id))!.swap!.persons;

describe('saveSwapPeople', () => {
  it.each([['usr-demo'], [null]])('a visitor (%s) gets the forbidden page and the video keeps its people', async (who) => {
    const before = await personsOf();
    sessionId = who;
    await expect(people([WOMAN, MAN])).rejects.toThrow('NEXT_FORBIDDEN');
    sessionId = 'usr-admin';
    expect(await personsOf()).toEqual(before);
  });

  it('hands the box and the words of each person to the data layer, and says when they are in the video', async () => {
    const state = await people([WOMAN, MAN]);
    expect(state).toEqual({ status: 'saved', pending: false });
    expect(await personsOf()).toEqual([WOMAN, MAN]);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('says they are pending when the data layer says the worker has not written them yet', async () => {
    const real = await data.admin.template(SWAP_TEMPLATE_ID);
    const set = vi.spyOn(data.admin, 'setSwapPeople').mockResolvedValueOnce({ ...real!, swapPeople: 'pending' });
    expect(await people([WOMAN])).toEqual({ status: 'saved', pending: true });
    expect(set).toHaveBeenCalledWith('usr-admin', SWAP_TEMPLATE_ID, [WOMAN]);
    set.mockRestore();
  });

  it('writes the words without the spaces around them', async () => {
    await people([{ ...WOMAN, hint: '  the woman in the white shirt  ' }]);
    expect((await personsOf())[0]!.hint).toBe('the woman in the white shirt');
  });

  it.each<[string, unknown, string]>([
    ['nobody', [], 'people'],
    ['three people', [WOMAN, MAN, { ...MAN, slot: 3 }], 'people'],
    ['text that is no list', 'not json', 'people'],
    ['people numbered out of order', [{ ...WOMAN, slot: 2 }], 'slot'],
    ['a box outside the picture', [{ ...WOMAN, box: { ...WOMAN.box, right: 120 } }], 'box'],
    ['a box that is turned round', [{ ...WOMAN, box: { left: 60, top: 20, right: 12, bottom: 98 } }], 'box'],
    ['a box with a side that is no number (a field left empty)', [{ ...WOMAN, box: { ...WOMAN.box, top: null } }], 'box'],
    ['no words', [{ ...WOMAN, hint: '   ' }], 'hint'],
    ['words on two lines', [{ ...WOMAN, hint: 'the woman\nand more' }], 'hint'],
    ['words that are too long', [{ ...WOMAN, hint: 'x'.repeat(RULES.swapHintMax + 1) }], 'hint'],
  ])('refuses %s with the rule of the data layer, and changes nothing', async (_name, persons, code) => {
    const before = await personsOf();
    expect(await people(persons)).toEqual({ status: 'error', error: code });
    expect(await personsOf()).toEqual(before);
  });

  it('says a video that is not there, or is no person-swap video, as gone', async () => {
    expect(await people([WOMAN], 'nope')).toEqual({ status: 'error', error: 'gone' });
    expect(await people([WOMAN], 'tpl-eye')).toEqual({ status: 'error', error: 'gone' });
  });

  it('says what the data layer answered when it will not take them', async () => {
    const set = vi.spyOn(data.admin, 'setSwapPeople');
    set.mockRejectedValueOnce(new Error('template-not-ready'));
    expect(await people([WOMAN])).toEqual({ status: 'error', error: 'notReady' });
    set.mockRejectedValueOnce(new NotFoundError('template'));
    expect(await people([WOMAN])).toEqual({ status: 'error', error: 'gone' });
    set.mockRejectedValueOnce(new Error('swap-people-invalid'));
    expect(await people([WOMAN])).toEqual({ status: 'error', error: 'people' });
    set.mockRejectedValueOnce(new Error('disk is full'));
    expect(await people([WOMAN])).toEqual({ status: 'error', error: 'failed' });
    set.mockRejectedValueOnce(new Error('forbidden'));
    await expect(people([WOMAN])).rejects.toThrow('NEXT_FORBIDDEN');
    set.mockRestore();
  });
});

describe('the page of a template', () => {
  it('is the page of a person-swap video for one, and the editor of shots for a product template', async () => {
    expect((await AdminTemplateEdit({ id: SWAP_TEMPLATE_ID }) as { type: unknown }).type).toBe(SwapEditView);
    expect((await AdminTemplateEdit({ id: 'tpl-eye' }) as { type: unknown }).type).toBe(EditView);
  });

  it('shows a video the preparation suggested no people for as unset, and as set once an admin has saved them', async () => {
    getStore().templates.find((template) => template.id === SWAP_TEMPLATE_ID)!.swapPeople = 'unset';
    expect((await loadEditor(SWAP_TEMPLATE_ID)).template.swapPeople).toBe('unset');
    await people([WOMAN]);
    expect((await loadEditor(SWAP_TEMPLATE_ID)).template.swapPeople).toBeUndefined();
  });
});

describe('publishing and withdrawing a person-swap video', () => {
  const STATUS_IDLE = { status: 'idle' as const };
  const publish = (id: string) => publishSwapVideo(STATUS_IDLE, form({ id }));
  const withdraw = (id: string) => withdrawSwapVideo(STATUS_IDLE, form({ id }));
  const statusOf = async (id: string) => (await data.admin.template(id))!.status;
  /** A video an admin added whose people are set, or (`unset`) the preparation suggested none: the fake suggests the fixture's, so the mark is put by hand. */
  async function added(unset = false): Promise<string> {
    const { id } = await addSwapVideo(IDLE, form({ kind: 'link', url: LINK }));
    if (unset) getStore().templates.find((template) => template.id === id)!.swapPeople = 'unset';
    return id!;
  }
  const inSwapList = async (id: string) => (await data.swap.templates()).some((template) => template.id === id);
  const inGallery = async (id: string) => (await data.catalog.list({ viewerId: 'usr-demo' })).some((template) => template.id === id);

  it.each([['usr-demo'], [null]])('a visitor (%s) gets the forbidden page from both, and the status stays', async (who) => {
    const id = await added();
    sessionId = who;
    await expect(publish(id)).rejects.toThrow('NEXT_FORBIDDEN');
    await expect(withdraw(SWAP_TEMPLATE_ID)).rejects.toThrow('NEXT_FORBIDDEN');
    sessionId = 'usr-admin';
    expect(await statusOf(id)).toBe('waiting');
    expect(await statusOf(SWAP_TEMPLATE_ID)).toBe('published');
  });

  it('publishes a video whose people are set: it is on the person-swap page and in no gallery of product templates', async () => {
    const id = await added();
    expect(await inSwapList(id)).toBe(false);
    expect(await publish(id)).toEqual({ status: 'done' });
    expect(await statusOf(id)).toBe('published');
    expect(await inSwapList(id)).toBe(true);
    expect(await inGallery(id)).toBe(false);
  });

  it('is on the person-swap page only while person swap is switched on: published with the switch off, it shows to no customer', async () => {
    const id = await added();
    await publish(id);
    await data.admin.saveLimits('usr-admin', { personSwap: false });
    expect(await inSwapList(id)).toBe(false);
    expect(await statusOf(id)).toBe('published');
  });

  it('refuses a video whose people are not set, says why, and changes nothing; once an admin has set them it is published', async () => {
    const id = await added(true);
    expect(await publish(id)).toEqual({ status: 'error', error: 'peopleUnset' });
    expect(await statusOf(id)).toBe('waiting');
    await people([WOMAN], id);
    expect(await publish(id)).toEqual({ status: 'done' });
  });

  it('withdraws a published video: it leaves the person-swap page, and can be published again', async () => {
    expect(await inSwapList(SWAP_TEMPLATE_ID)).toBe(true);
    expect(await withdraw(SWAP_TEMPLATE_ID)).toEqual({ status: 'done' });
    expect(await statusOf(SWAP_TEMPLATE_ID)).toBe('hidden');
    expect(await inSwapList(SWAP_TEMPLATE_ID)).toBe(false);
    expect(await publish(SWAP_TEMPLATE_ID)).toEqual({ status: 'done' });
    expect(await inSwapList(SWAP_TEMPLATE_ID)).toBe(true);
  });

  it('withdraws only what is published, and publishes only what waits or is hidden', async () => {
    const id = await added();
    expect(await withdraw(id)).toEqual({ status: 'error', error: 'transition' });
    expect(await publish(SWAP_TEMPLATE_ID)).toEqual({ status: 'error', error: 'transition' });
    expect(await statusOf(id)).toBe('waiting');
    expect(await statusOf(SWAP_TEMPLATE_ID)).toBe('published');
  });

  it('refuses a video that is still being prepared', async () => {
    const id = await added();
    getStore().templates.find((template) => template.id === id)!.preparation = 'preparing';
    expect(await publish(id)).toEqual({ status: 'error', error: 'notReady' });
    expect(await statusOf(id)).toBe('waiting');
  });

  it('is no way to publish or hide a product template: for one, and for an id that is not there, it says gone', async () => {
    const before = await statusOf('tpl-eye');
    expect(await withdraw('tpl-eye')).toEqual({ status: 'error', error: 'gone' });
    expect(await publish('tpl-eye')).toEqual({ status: 'error', error: 'gone' });
    expect(await publish('nope')).toEqual({ status: 'error', error: 'gone' });
    expect(await statusOf('tpl-eye')).toBe(before);
  });

  it('the admin named to the data layer is the one of the session, for both', async () => {
    const id = await added();
    const set = vi.spyOn(data.admin, 'setSwapStatus');
    await publish(id);
    await withdraw(id);
    expect(set.mock.calls).toEqual([['usr-admin', id, 'published'], ['usr-admin', id, 'hidden']]);
    set.mockRestore();
  });

  it('says what the data layer answered when it will not change the status', async () => {
    const id = await added();
    const update = vi.spyOn(data.admin, 'setSwapStatus');
    update.mockRejectedValueOnce(new Error('swap-people-unset'));
    expect(await publish(id)).toEqual({ status: 'error', error: 'peopleUnset' });
    update.mockRejectedValueOnce(new Error('disk is full'));
    expect(await publish(id)).toEqual({ status: 'error', error: 'failed' });
    update.mockRejectedValueOnce(new Error('forbidden'));
    await expect(publish(id)).rejects.toThrow('NEXT_FORBIDDEN');
    update.mockRestore();
  });
});
