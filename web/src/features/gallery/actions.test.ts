// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The session is a signed cookie now: the tests stand in for `getSessionUser` and name the signed-in user (`jar`) directly.
const jar = new Map<string, string>();
vi.mock('@/core/session/session', async () => {
  const { data } = await import('@/data');
  const readUser = async () => (jar.has('vc_session') ? data.auth.getUser(jar.get('vc_session')!) : null);
  return { getSessionUser: readUser, getSessionState: async () => {
    const user = await readUser();
    return user ? { kind: user.blocked ? 'blocked' : 'active', user } : { kind: 'anonymous' };
  } };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { addVideo, type AddVideoState } from './actions';

const idle: AddVideoState = { status: 'idle', errors: {} };
const form = (link: string) => {
  const f = new FormData();
  f.set('link', link);
  return f;
};

beforeEach(() => {
  resetStore();
  jar.clear();
  jar.set('vc_session', 'usr-demo');
});

/** The two steps of "Add your own video": the free check gives the offer, the second call (with the offer's key) prepares and charges. */
async function addBoth(link: string): Promise<AddVideoState> {
  const first = await addVideo(idle, form(link));
  if (first.status !== 'confirm' || !first.offer) return first;
  const second = form(link);
  second.set('confirmed', String(first.offer.credits));
  second.set('key', first.offer.key);
  return addVideo(idle, second);
}

describe('addVideo', () => {
  it('shows a field error for an invalid link and adds nothing', async () => {
    const before = (await data.catalog.list({ viewerId: 'usr-demo' })).length;
    const state = await addVideo(idle, form('https://example.com/video'));
    expect(state).toEqual({ status: 'error', errors: { link: 'linkInvalid' } });
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).length).toBe(before);
  });
  it('first checks for free and offers the price: nothing is added and nothing is charged before the second step', async () => {
    const balance = await data.ledger.balance('usr-demo');
    const before = (await data.catalog.list({ viewerId: 'usr-demo' })).length;
    const state = await addVideo(idle, form('https://youtu.be/abc'));
    expect(state).toMatchObject({ status: 'confirm', errors: {}, offer: { link: 'https://youtu.be/abc', credits: 1, balance } });
    expect(state.offer?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
    expect((await data.catalog.list({ viewerId: 'usr-demo' })).length).toBe(before);
  });
  it('the second step prepares a private template that is preparing and charges one credit, once per key', async () => {
    const balance = await data.ledger.balance('usr-demo');
    const first = await addVideo(idle, form('https://youtu.be/abc'));
    const again = form('https://youtu.be/abc');
    again.set('confirmed', '1');
    again.set('key', first.offer!.key);
    expect((await addVideo(idle, again)).status).toBe('added');
    expect(await data.ledger.balance('usr-demo')).toBe(balance - 1);
    expect(await data.catalog.list({ viewerId: 'usr-demo' })).toEqual(expect.arrayContaining([expect.objectContaining({ ownerId: 'usr-demo', preparation: 'preparing', status: 'private' })]));
  });
  it('refuses a second step that does not carry what the offer showed', async () => {
    const f = form('https://youtu.be/abc');
    f.set('confirmed', '5');
    f.set('key', 'k');
    expect(await addVideo(idle, f)).toEqual({ status: 'error', errors: { link: 'failed' } });
    const g = form('https://youtu.be/abc');
    g.set('confirmed', '1');
    expect(await addVideo(idle, g)).toEqual({ status: 'error', errors: { link: 'failed' } });
  });
  it('says the reason of a source the check refuses (contract 7.2), and charges nothing', async () => {
    const balance = await data.ledger.balance('usr-demo');
    expect(await addVideo(idle, form('https://www.tiktok.com/@a/video/private-1'))).toEqual({ status: 'error', errors: { link: 'private' } });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
  });
  it('after the daily number of own videos it says so before offering anything', async () => {
    await data.admin.saveLimits('usr-admin', { ownVideosPerDay: 1 });
    expect((await addBoth('https://youtu.be/one')).status).toBe('added');
    expect(await addVideo(idle, form('https://youtu.be/two'))).toEqual({ status: 'error', errors: { link: 'dailyLimit' } });
  });
  it('with too few credits the offer is the same, with the balance, and the second step charges nothing and adds nothing', async () => {
    jar.set('vc_session', 'usr-new');
    const f = form('https://youtu.be/abc');
    const first = await addVideo(idle, f);
    expect(first.status).toBe('confirm');
    const { writeEntry } = await import('@/data/mock/ledger');
    writeEntry('usr-new', 'generation', -(await data.ledger.balance('usr-new')), 'spent');
    f.set('confirmed', '1');
    f.set('key', first.offer!.key);
    const second = await addVideo(idle, f);
    expect(second).toMatchObject({ status: 'confirm', offer: { balance: 0, credits: 1 } });
    expect((await data.catalog.list({ viewerId: 'usr-new' })).filter((t) => t.status === 'private')).toHaveLength(0);
  });
  it('adds a TikTok or YouTube link as a private template that is preparing', async () => {
    for (const link of ['https://www.tiktok.com/@a/video/1', 'https://youtu.be/abc']) {
      const state = await addBoth(link);
      expect(state.status).toBe('added');
    }
    const mine = (await data.catalog.list({ viewerId: 'usr-demo' })).filter((t) => t.status === 'private' && t.preparation === 'preparing');
    expect(mine).toHaveLength(2);
    expect(mine.every((t) => t.ownerId === 'usr-demo')).toBe(true);
  });
  it('sends a signed-out visitor to login before touching data', async () => {
    jar.clear();
    await expect(addVideo(idle, form('https://youtu.be/abc'))).rejects.toThrow('REDIRECT:/login');
  });
  it('sends a user whose email is not verified to /verify-email and adds nothing', async () => {
    jar.set('vc_session', 'usr-unverified');
    await expect(addVideo(idle, form('https://youtu.be/abc'))).rejects.toThrow('REDIRECT:/verify-email');
    expect((await data.catalog.list({ viewerId: 'usr-unverified' })).filter((t) => t.status === 'private')).toHaveLength(0);
  });
});

const rangedForm = (link: string, from: string, to: string) => {
  const f = form(link);
  f.set('rangeFrom', from);
  f.set('rangeTo', to);
  return f;
};
async function addRanged(link: string, from: string, to: string): Promise<AddVideoState> {
  const first = await addVideo(idle, rangedForm(link, from, to));
  if (first.status !== 'confirm' || !first.offer) return first;
  const second = rangedForm(link, from, to);
  second.set('confirmed', String(first.offer.credits));
  second.set('key', first.offer.key);
  return addVideo(idle, second);
}

describe('addVideo with a part of the video', () => {
  it('hands the range (seconds) to the engine and keeps the price', async () => {
    const { engine } = await import('@/data/engine');
    const spy = vi.spyOn(engine(), 'addFromLink');
    const balance = await data.ledger.balance('usr-demo');
    const first = await addVideo(idle, rangedForm('https://youtu.be/abc', '30', '80'));
    expect(first).toMatchObject({ status: 'confirm', offer: { range: { from: 30, to: 80 }, credits: 1 } });
    expect(await addRanged('https://youtu.be/abc', '30', '80')).toMatchObject({ status: 'added' });
    expect(spy).toHaveBeenCalledWith('usr-demo', 'https://youtu.be/abc', { from: 30, to: 80 });
    expect(await data.ledger.balance('usr-demo')).toBe(balance - 1);
    spy.mockRestore();
  });
  it('without range fields the engine gets no range', async () => {
    const { engine } = await import('@/data/engine');
    const spy = vi.spyOn(engine(), 'addFromLink');
    expect((await addBoth('https://youtu.be/abc')).status).toBe('added');
    expect(spy).toHaveBeenCalledWith('usr-demo', 'https://youtu.be/abc', undefined);
    spy.mockRestore();
  });
  it('the same link with the same range is a duplicate; another range is a new video', async () => {
    expect((await addRanged('https://youtu.be/abc', '30', '80')).status).toBe('added');
    expect(await addVideo(idle, rangedForm('https://youtu.be/abc', '30', '80'))).toEqual({ status: 'error', errors: { link: 'duplicate' } });
    expect((await addRanged('https://youtu.be/abc', '100', '140')).status).toBe('added');
  });
  it.each([
    ['longer than a minute', '0', '90'],
    ['backwards', '50', '20'],
    ['only one box filled', '30', ''],
    ['not a number', 'abc', '40'],
    ['written with an exponent', '1e-7', '40'],
    ['written in hex', '0x10', '40'],
    ['padded with spaces', ' 30', '80 '],
  ])('a range %s is a field error and charges nothing', async (_name, from, to) => {
    const balance = await data.ledger.balance('usr-demo');
    expect(await addRanged('https://youtu.be/abc', from, to)).toEqual({ status: 'error', errors: { link: 'range' } });
    expect(await data.ledger.balance('usr-demo')).toBe(balance);
  });
});

describe('removeTemplate', () => {
  it('the owner deletes a private template and lands on their templates; anyone else gets an answer and nothing changes', async () => {
    const { removeTemplate } = await import('./actions');
    const own = await data.catalog.addFromLink('usr-demo', 'https://www.tiktok.com/@a/video/1');
    jar.set('vc_session', 'usr-paying');
    expect(await removeTemplate(own.id)).toEqual({ status: 'error', code: 'failed' });
    expect(await data.catalog.get(own.id, 'usr-demo')).not.toBeNull();
    jar.set('vc_session', 'usr-demo');
    // A template still being prepared cannot be removed; once the preparation is over it can.
    expect(await removeTemplate(own.id)).toEqual({ status: 'error', code: 'in-use' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60 * 60_000);
    await expect(removeTemplate(own.id)).rejects.toThrow('REDIRECT:/templates/new');
    vi.useRealTimers();
    expect(await data.catalog.get(own.id, 'usr-demo')).toBeNull();
    expect(await removeTemplate(own.id)).toEqual({ status: 'error', code: 'failed' });
  });
});

describe('addVideo with an uploaded file', () => {
  const UPLOAD = '3f2b8c1e-5a47-4d0e-9b7c-1a2b3c4d5e6f';
  const fileForm = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set('uploadId', UPLOAD);
    f.set('fileName', 'clip.mp4');
    f.set('fileType', 'video/mp4');
    f.set('fileBytes', '1000');
    for (const [key, value] of Object.entries(extra)) f.set(key, value);
    return f;
  };
  const source = { kind: 'file', uploadId: UPLOAD, name: 'clip.mp4', type: 'video/mp4', bytes: 1000, seconds: null, width: null, height: null };

  it('runs the free check with the browser facts as advisory nulls and offers the file, not a link', async () => {
    const check = vi.spyOn(data.catalog, 'checkSource').mockResolvedValue({ ok: true, seconds: 31, format: 'vertical' as never, shots: null });
    const state = await addVideo(idle, fileForm());
    expect(check).toHaveBeenCalledWith('usr-demo', source);
    expect(state.status).toBe('confirm');
    expect(state.offer).toMatchObject({ link: '', seconds: 31, file: { uploadId: UPLOAD, name: 'clip.mp4', type: 'video/mp4', bytes: 1000 } });
  });

  it('prepares the file on the second step with the offer key and charges once', async () => {
    vi.spyOn(data.catalog, 'checkSource').mockResolvedValue({ ok: true, seconds: 31, format: null, shots: null });
    const prepare = vi.spyOn(data.catalog, 'prepareOwn');
    const first = await addVideo(idle, fileForm());
    const second = fileForm({ confirmed: String(first.offer!.credits), key: first.offer!.key });
    prepare.mockResolvedValue({ id: 'tpl-own' } as never);
    expect(await addVideo(idle, second)).toEqual({ status: 'added', errors: {} });
    expect(prepare).toHaveBeenCalledWith('usr-demo', source, first.offer!.credits, first.offer!.key);
  });

  it('answers the check refusal with its reason, and nothing is prepared', async () => {
    vi.spyOn(data.catalog, 'checkSource').mockResolvedValue({ ok: false, reason: 'ratio' });
    const prepare = vi.spyOn(data.catalog, 'prepareOwn');
    expect(await addVideo(idle, fileForm())).toEqual({ status: 'error', errors: { link: 'ratio' } });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([
    ['an id that is not a uuid', { uploadId: '../../etc/passwd' }],
    ['a name that is too long', { fileName: 'x'.repeat(300) }],
    ['bytes that are not a number', { fileBytes: 'many' }],
  ])('refuses %s before any check', async (_name, extra) => {
    const check = vi.spyOn(data.catalog, 'checkSource');
    expect(await addVideo(idle, fileForm(extra))).toEqual({ status: 'error', errors: { link: 'failed' } });
    expect(check).not.toHaveBeenCalled();
  });

  it('still counts toward the day limit', async () => {
    vi.spyOn(data.catalog, 'ownVideoAllowance').mockResolvedValue({ used: 3, limit: 3, left: 0 });
    const check = vi.spyOn(data.catalog, 'checkSource');
    expect(await addVideo(idle, fileForm())).toEqual({ status: 'error', errors: { link: 'dailyLimit' } });
    expect(check).not.toHaveBeenCalled();
  });
});
