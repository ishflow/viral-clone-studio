// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

import { data } from '@/data';
import { resetStore } from '@/data/mock/store';
import { addVideo, type AddVideoState } from './actions';
import { MAX_PREPARING_LINKS, MAX_PRIVATE_TEMPLATES, resetLinkLimit } from './link-limit';

const USER = 'usr-paying'; // has no private template in the fixtures
const idle: AddVideoState = { status: 'idle', errors: {} };
const form = (link: string) => {
  const f = new FormData();
  f.set('link', link);
  return f;
};
const tiktok = (n: number) => `https://www.tiktok.com/@a/video/${n}`;
const own = async (id: string) => (await data.catalog.list({ viewerId: id })).filter((t) => t.status === 'private' && t.ownerId === id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  resetStore();
  resetLinkLimit();
  jar.clear();
  jar.set('vc_session', USER);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const confirmation = (link: string, key: string) => {
  const f = form(link);
  f.set('confirmed', '1');
  f.set('key', key);
  return f;
};
/** The two steps of the form, as the browser does them. */
async function add(link: string): Promise<AddVideoState> {
  const first = await addVideo(idle, form(link));
  return first.status === 'confirm' && first.offer ? addVideo(idle, confirmation(link, first.offer.key)) : first;
}
/** `n` private templates of the user that are ready (made on the admin path, which has no daily number; they let time pass to be ready). */
async function seedReady(n: number, userId = USER) {
  for (let i = 0; i < n; i += 1) await data.catalog.addFromLink(userId, `https://www.tiktok.com/@seed/video/${i}`);
  vi.advanceTimersByTime(21_000);
}

describe('addVideo limits (security review I1)', () => {
  it('(a) refuses the same link again, in another link style too, and prepares nothing', async () => {
    expect((await add(tiktok(1))).status).toBe('added');
    vi.advanceTimersByTime(21_000);
    const spies = [vi.spyOn(data.catalog, 'prepareOwn'), vi.spyOn(data.catalog, 'addFromLink')];
    expect(await addVideo(idle, form(tiktok(1)))).toEqual({ status: 'error', errors: { link: 'duplicate' } });
    expect(await addVideo(idle, form('https://tiktok.com/@a/video/1/?is_from_webapp=1'))).toEqual({ status: 'error', errors: { link: 'duplicate' } });
    expect(await addVideo(idle, confirmation(tiktok(1), 'k'))).toEqual({ status: 'error', errors: { link: 'duplicate' } });
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(await own(USER)).toHaveLength(1);
  });
  it('(a) lets the link be added again once its template is deleted', async () => {
    expect((await add(tiktok(1))).status).toBe('added');
    vi.advanceTimersByTime(21_000);
    const [first] = await own(USER);
    await data.catalog.remove(first!.id, USER);
    expect((await add(tiktok(1))).status).toBe('added');
  });
  it(`(b) refuses a link while ${MAX_PREPARING_LINKS} of the user's videos are still preparing, and prepares nothing`, async () => {
    for (let i = 0; i < MAX_PREPARING_LINKS; i += 1) await data.catalog.addFromLink(USER, `https://www.tiktok.com/@seed/video/${i}`);
    const spies = [vi.spyOn(data.catalog, 'prepareOwn'), vi.spyOn(data.catalog, 'addFromLink')];
    expect(await addVideo(idle, form(tiktok(99)))).toEqual({ status: 'error', errors: { link: 'tooManyPreparing' } });
    expect(await addVideo(idle, confirmation(tiktok(99), 'k'))).toEqual({ status: 'error', errors: { link: 'tooManyPreparing' } });
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    vi.advanceTimersByTime(21_000);
    expect((await add(tiktok(99))).status).toBe('added');
  });
  it(`(c) refuses a link at ${MAX_PRIVATE_TEMPLATES} private templates and prepares nothing`, async () => {
    await seedReady(MAX_PRIVATE_TEMPLATES);
    const spies = [vi.spyOn(data.catalog, 'prepareOwn'), vi.spyOn(data.catalog, 'addFromLink')];
    expect(await addVideo(idle, form(tiktok(500)))).toEqual({ status: 'error', errors: { link: 'limit' } });
    expect(await addVideo(idle, confirmation(tiktok(500), 'k'))).toEqual({ status: 'error', errors: { link: 'limit' } });
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(await own(USER)).toHaveLength(MAX_PRIVATE_TEMPLATES);
  });
  it('two parallel confirmations at the limit prepare one', async () => {
    await seedReady(MAX_PRIVATE_TEMPLATES - 1);
    const a = await addVideo(idle, form(tiktok(501)));
    const b = await addVideo(idle, form(tiktok(502)));
    expect([a.status, b.status]).toEqual(['confirm', 'confirm']); // both pass the free check: one more fits
    const results = await Promise.all([addVideo(idle, confirmation(tiktok(501), a.offer!.key)), addVideo(idle, confirmation(tiktok(502), b.offer!.key))]);
    expect(results.map((r) => r.status).sort()).toEqual(['added', 'error']);
    expect(results.find((r) => r.status === 'error')?.errors.link).toBe('limit');
    expect(await own(USER)).toHaveLength(MAX_PRIVATE_TEMPLATES);
  });
  it('two parallel confirmations of the same link prepare one', async () => {
    const first = await addVideo(idle, form(tiktok(7)));
    const second = await addVideo(idle, form(tiktok(7)));
    const results = await Promise.all([addVideo(idle, confirmation(tiktok(7), first.offer!.key)), addVideo(idle, confirmation(tiktok(7), second.offer!.key))]);
    expect(results.map((r) => r.status).sort()).toEqual(['added', 'error']);
    expect(await own(USER)).toHaveLength(1);
  });
  it("a different user is not held back by another user's limit or links", async () => {
    await seedReady(MAX_PRIVATE_TEMPLATES);
    jar.set('vc_session', 'usr-demo');
    expect((await add(tiktok(1))).status).toBe('added');
    expect(await own('usr-demo')).toHaveLength(3); // its two fixture templates and this one
  });
  it('a failed preparation leaves no link behind and does not block the next one', async () => {
    const spy = vi.spyOn(data.catalog, 'prepareOwn').mockRejectedValueOnce(new Error('db down'));
    expect(await add(tiktok(3))).toEqual({ status: 'error', errors: { link: 'failed' } });
    spy.mockRestore();
    expect((await add(tiktok(3))).status).toBe('added');
  });
  it('still refuses a link with credentials or a port before any check', async () => {
    const spies = [vi.spyOn(data.catalog, 'prepareOwn'), vi.spyOn(data.catalog, 'checkSource')];
    expect(await addVideo(idle, form('https://user:pw@www.tiktok.com/@a/video/1'))).toEqual({ status: 'error', errors: { link: 'linkInvalid' } });
    expect(await addVideo(idle, form('https://www.tiktok.com:8443/@a/video/1'))).toEqual({ status: 'error', errors: { link: 'linkInvalid' } });
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
