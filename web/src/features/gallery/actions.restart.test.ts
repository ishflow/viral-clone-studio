// @vitest-environment node
// "Add your own video" after the site restarted: the real engine is the one that remembers (the database), the links the site added in
// its own memory are gone. The same link with the same part must still be one video, charged once.
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { addDemoCustomers } from '@/data/mock/test-helpers';
import { closeSqliteEngines } from '@/data/real/sqlite-engine';
import { makeDataDir } from '@/data/real/testing';
import { addVideo, type AddVideoState } from './actions';
import { resetLinkLimit } from './link-limit';

const idle: AddVideoState = { status: 'idle', errors: {} };
const LINK = 'https://youtu.be/long-video';
let dir: string, db: DatabaseSync;
beforeEach(() => {
  ({ dir, db } = makeDataDir());
  vi.stubEnv('VC_ENGINE', 'sqlite'); vi.stubEnv('VC_DATA_DIR', dir);
  vi.stubEnv('VC_ADMIN_PASSWORD', 'test-only-password-123');
  resetStore(); addDemoCustomers(); resetLinkLimit();
  jar.clear(); jar.set('vc_session', 'usr-demo');
});
afterEach(() => { closeSqliteEngines(); db.close(); vi.unstubAllEnvs(); resetStore(); resetLinkLimit(); vi.restoreAllMocks(); });

const formOf = (range?: { from: number; to: number }) => {
  const f = new FormData();
  f.set('link', LINK);
  if (range) { f.set('rangeFrom', String(range.from)); f.set('rangeTo', String(range.to)); }
  return f;
};
/** The two steps: the free check gives the offer, the second call charges. */
async function add(range?: { from: number; to: number }): Promise<AddVideoState> {
  const first = await addVideo(idle, formOf(range));
  if (first.status !== 'confirm' || !first.offer) return first;
  const second = formOf(range);
  second.set('confirmed', String(first.offer.credits));
  second.set('key', first.offer.key);
  return addVideo(idle, second);
}

describe('addVideo after a restart, with a template that is still preparing', () => {
  it('the same link with the same part is a duplicate and charges nothing more; another part, or the whole video, is a new video', async () => {
    const start = await data.ledger.balance('usr-demo');
    expect((await add({ from: 30, to: 80 })).status).toBe('added');
    expect(await data.ledger.balance('usr-demo')).toBe(start - 1);
    resetLinkLimit();                                                    // the restart: the site forgets what it added
    expect(await add({ from: 30, to: 80 })).toEqual({ status: 'error', errors: { link: 'duplicate' } });
    expect(await data.ledger.balance('usr-demo')).toBe(start - 1);
    expect((await add({ from: 90, to: 120 })).status).toBe('added');
    expect(await data.ledger.balance('usr-demo')).toBe(start - 2);
    resetLinkLimit();
    expect((await add()).status).toBe('added');
    expect(await data.ledger.balance('usr-demo')).toBe(start - 3);
  });

  it('a video added whole is a duplicate when added whole again after a restart, as before', async () => {
    expect((await add()).status).toBe('added');
    resetLinkLimit();
    expect(await add()).toEqual({ status: 'error', errors: { link: 'duplicate' } });
  });
});
